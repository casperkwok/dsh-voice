/**
 * dsh-voice host half.
 *
 * Registers a local WebSocket audio route, one VoiceSession per connection,
 * and bridges finalized user text into the owning DSH agent. Assistant text is
 * tapped from `agent/assistant-stream` and synthesized sentence by sentence.
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { VoiceEngine } from './host/voice-engine.ts'
import { VoiceSession } from './host/voice-session.ts'
import { loadSettings, saveSettings, settingsPath } from './host/settings-store.ts'
import type { VoiceSettings } from './shared/settings.ts'

export const name = 'dsh-voice'
export const inject = ['webServer', 'agents']

const BASE_PATH = '/voice'

export function apply(ctx: Context): void {
  const c = ctx as any
  const settings: VoiceSettings = loadSettings()
  const engine = new VoiceEngine(settings)
  const sessionsByAgent = new Map<string, VoiceSession>()
  const wss = new WebSocketServer({ noServer: true })

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const readJson = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    if (!chunks.length) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  const sendToAgent = (sessionId: string, text: string, ws: WebSocket): void => {
    const agent = c.agents.get(sessionId)
    if (!agent) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'E_SESSION_NOT_FOUND',
          message: '当前会话不可用，请刷新后重试',
        }),
      )
      return
    }
    try {
      const message = {
        id: randomUUID(),
        role: 'user' as const,
        content: [{ type: 'text' as const, text }],
        source: { kind: 'user' as const },
      }
      if (agent.status === 'running') agent.steer(message)
      else agent.followup(message)
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'E_SEND_FAILED',
          message: '语音消息发送失败，请改用文字',
        }),
      )
      console.warn('[dsh-voice] send to agent failed', err)
    }
  }

  c.effect(() =>
    c.webServer.register({
      kind: 'exact',
      path: `${BASE_PATH}/config`,
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        json(res, 200, {
          basePath: BASE_PATH,
          provider: engine.provider,
          sampleRate: engine.sampleRate,
          ready: engine.ready,
          error: engine.error,
          inputSampleRate: 16000,
          frameSamples: 320,
        })
      },
    }),
  )

  c.effect(() =>
    c.webServer.register({
      kind: 'exact',
      path: `${BASE_PATH}/status`,
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        json(res, 200, {
          ready: engine.ready,
          provider: engine.provider,
          sessions: [...sessionsByAgent.keys()],
        })
      },
    }),
  )

  c.effect(() =>
    c.webServer.register({
      kind: 'exact',
      path: `${BASE_PATH}/settings`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'POST') {
          try {
            const saved = saveSettings(await readJson(req))
            json(res, 200, {
              ok: true,
              settings: saved,
              settingsPath: settingsPath(),
              restartRequired: true,
            })
          } catch (err) {
            json(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          return
        }
        json(res, 200, {
          settings: loadSettings(),
          settingsPath: settingsPath(),
          effectiveProvider: engine.provider,
          ready: engine.ready,
        })
      },
    }),
  )

  c.effect(() =>
    c.webServer.registerUpgrade({
      path: `${BASE_PATH}/ws`,
      handler: (req: IncomingMessage, socket: any, head: Buffer) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      },
    }),
  )

  wss.on('connection', (ws: WebSocket) => {
    let session: VoiceSession | null = null
    let sessionId: string | null = null

    const send = (frame: unknown): void => {
      if (ws.readyState === 1) ws.send(JSON.stringify(frame))
    }

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        let message: { type?: string; sessionId?: string }
        try {
          message = JSON.parse(data.toString())
        } catch {
          return
        }
        if (message.type === 'start' && message.sessionId) {
          sessionId = message.sessionId
          session?.destroy()
          session = new VoiceSession({
            engine,
            settings,
            sessionId,
            send: (frame) => send(frame),
            onFinal: (text) => {
              if (sessionId) sendToAgent(sessionId, text, ws)
            },
          })
          sessionsByAgent.set(sessionId, session)
          send({
            type: 'config',
            provider: engine.provider,
            sampleRate: engine.sampleRate,
            inputSampleRate: 16000,
            frameSamples: 320,
          })
          send({ type: 'status', state: 'listening', sessionId })
          void engine.init().catch((err) => {
            engine.error = err instanceof Error ? err.message : String(err)
            send({
              type: 'error',
              code: 'E_MODELS_UNAVAILABLE',
              message: `本地语音模型不可用：${engine.error}`,
            })
          })
        }
        if (message.type === 'stop') {
          session?.destroy()
          session = null
          if (sessionId) sessionsByAgent.delete(sessionId)
          sessionId = null
        }
        return
      }

      if (!session) return
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      const pcm16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2)
      const samples = new Float32Array(pcm16.length)
      for (let i = 0; i < pcm16.length; i += 1) samples[i] = pcm16[i]! / 32768
      session.pushAudio(samples)
    })

    ws.on('close', () => {
      session?.destroy()
      if (sessionId && sessionsByAgent.get(sessionId) === session) {
        sessionsByAgent.delete(sessionId)
      }
    })
  })

  c.effect(() =>
    c.on(
      'agent/assistant-stream',
      ({ agent, frame }: { agent: { id: string }; frame: any }) => {
        const session = sessionsByAgent.get(agent.id)
        if (!session) return
        if (frame.type === 'start') session.beginAssistant()
        else if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') {
          session.pushAssistantText(frame.chunk.text)
        } else if (frame.type === 'end') session.endAssistant()
      },
    ),
  )

  c.effect(() =>
    c.on('agent/error', ({ agent }: { agent: { id: string } }) => {
      const session = sessionsByAgent.get(agent.id)
      session?.pushAssistantText('\n语音回复中断。\n')
      session?.endAssistant()
    }),
  )

  c.effect(() => () => {
    for (const client of wss.clients) client.close()
    wss.close()
    for (const session of sessionsByAgent.values()) session.destroy()
    sessionsByAgent.clear()
  })

  void engine.init().catch((err) => {
    engine.error = err instanceof Error ? err.message : String(err)
    console.warn(`[dsh-voice] model init failed: ${engine.error}`)
  })
}
