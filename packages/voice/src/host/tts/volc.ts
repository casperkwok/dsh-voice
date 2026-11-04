import { randomBytes } from 'node:crypto'
import { WebSocket } from 'ws'
import { cloudProfile, type VoiceSettings } from '../../shared/settings.ts'

export interface CloudAudioChunk {
  samples: Float32Array
  sampleRate: number
}

const URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection'
const MT_CLIENT_REQ = 0b0001
const MT_AUDIO_RSP = 0b1011
const FLAG_EVENT = 0b0100
const SER_JSON = 0b0001
const EV_START_CONNECTION = 1
const EV_CONNECTION_STARTED = 50
const EV_START_SESSION = 100
const EV_SESSION_STARTED = 150
const EV_SESSION_FINISHED = 152
const EV_SESSION_FAILED = 153
const EV_TASK_REQUEST = 200
const EV_TTS_RESPONSE = 352

/** Volcengine bidirectional TTS, one connection/session per synthesis. */
export class VolcTts {
  readonly provider = 'volc' as const
  readonly sampleRate = 24000
  private readonly settings: VoiceSettings

  constructor(settings: VoiceSettings) {
    this.settings = settings
  }

  async synthesize(
    text: string,
    onChunk: (chunk: CloudAudioChunk) => void,
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    const p = cloudProfile(this.settings)
    const key = p.apiKey
    if (!key) throw new Error('火山 TTS API Key 未配置')
    const resource = p.resourceId || 'seed-tts-2.0'
    const voice = p.voice || 'zh_female_xiaohe_uranus_bigtts'
    const endpoint = p.endpoint.startsWith('ws') ? p.endpoint : URL

    return new Promise<boolean>((resolve, reject) => {
      const ws = new WebSocket(endpoint, {
        headers: { 'X-Api-Key': key, 'X-Api-Resource-Id': resource },
        maxPayload: 16 * 1024 * 1024,
      })
      const sessionId = randomBytes(8).toString('hex')
      let emitted = false
      let settled = false
      const finish = (ok: boolean, error?: Error): void => {
        if (settled) return
        settled = true
        try {
          ws.close()
        } catch {
          // ignore
        }
        if (error) reject(error)
        else resolve(ok)
      }
      const timer = setTimeout(() => finish(false, new Error('火山 TTS 超时')), 20000)

      ws.on('open', () => {
        ws.send(build(EV_START_CONNECTION, {}))
      })
      ws.on('message', (data: Buffer) => {
        if (!shouldContinue()) {
          clearTimeout(timer)
          finish(emitted)
          return
        }
        let parsed: ReturnType<typeof parse>
        try {
          parsed = parse(data)
        } catch {
          return
        }
        const { type, event, payload } = parsed
        if (type === 0b1111) {
          clearTimeout(timer)
          finish(false, new Error(`火山 TTS 错误: ${payload.toString('utf8').slice(0, 160)}`))
          return
        }
        if (event === EV_CONNECTION_STARTED) {
          ws.send(
            build(
              EV_START_SESSION,
              {
                user: { uid: 'dsh-voice' },
                event: EV_START_SESSION,
                namespace: 'BidirectionalTTS',
                req_params: {
                  speaker: voice,
                  audio_params: {
                    format: 'pcm',
                    sample_rate: this.sampleRate,
                    speech_rate: Math.max(-50, Math.min(100, Math.round((p.speed - 1) * 100))),
                  },
                },
              },
              sessionId,
            ),
          )
          return
        }
        if (event === EV_SESSION_STARTED) {
          ws.send(
            build(
              EV_TASK_REQUEST,
              {
                event: EV_TASK_REQUEST,
                namespace: 'BidirectionalTTS',
                req_params: { text },
              },
              sessionId,
            ),
          )
          ws.send(build(102, {}, sessionId))
          return
        }
        if (event === EV_TTS_RESPONSE && type === MT_AUDIO_RSP) {
          const samples = pcm16ToFloat32(payload)
          if (samples.length && shouldContinue()) {
            emitted = true
            onChunk({ samples, sampleRate: this.sampleRate })
          }
          return
        }
        if (event === EV_SESSION_FINISHED || event === EV_SESSION_FAILED) {
          clearTimeout(timer)
          if (event === EV_SESSION_FAILED) {
            finish(false, new Error(`火山 TTS 会话失败: ${payload.toString('utf8').slice(0, 160)}`))
          } else {
            finish(emitted)
          }
        }
      })
      ws.on('error', (error) => {
        clearTimeout(timer)
        finish(false, error instanceof Error ? error : new Error(String(error)))
      })
      ws.on('close', () => {
        clearTimeout(timer)
        finish(emitted)
      })
    })
  }
}

function build(event: number, payload: unknown, sessionId?: string): Buffer {
  const header = Buffer.from([(1 << 4) | 1, (MT_CLIENT_REQ << 4) | FLAG_EVENT, SER_JSON << 4, 0])
  const parts: Buffer[] = [header, int32(event)]
  if (sessionId) {
    const sid = Buffer.from(sessionId)
    parts.push(uint32(sid.length), sid)
  }
  const body = Buffer.from(JSON.stringify(payload))
  parts.push(uint32(body.length), body)
  return Buffer.concat(parts)
}

function parse(data: Buffer): { type: number; event: number | null; payload: Buffer } {
  const type = (data[1]! >> 4) & 0x0f
  const flags = data[1]! & 0x0f
  let offset = 4
  let event: number | null = null
  if (flags & FLAG_EVENT) {
    event = data.readInt32BE(offset)
    offset += 4
  }
  if (event !== null && (event < 100 || event === EV_CONNECTION_STARTED || event === 51 || event === 52)) {
    const size = data.readUInt32BE(offset)
    offset += 4 + size
  } else if (event !== null) {
    const size = data.readUInt32BE(offset)
    offset += 4 + size
  }
  if (type === 0b1111) offset += 4
  const length = data.readUInt32BE(offset)
  offset += 4
  return { type, event, payload: data.subarray(offset, offset + length) }
}

function int32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32BE(value)
  return buffer
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function pcm16ToFloat32(bytes: Buffer): Float32Array {
  const length = Math.floor(bytes.length / 2)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) out[i] = bytes.readInt16LE(i * 2) / 32768
  return out
}
