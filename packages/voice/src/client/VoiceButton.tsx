import { useEffect, useRef, useState, type ReactElement } from 'react'
import { setVoiceState, useVoiceState } from './store.ts'
import { startMic, type MicCapture } from './mic.ts'
import { Playback } from './playback.ts'

const BASE_PATH = '/voice'

interface VoiceButtonProps {
  sessionId?: string
}

export function VoiceButton({ sessionId }: VoiceButtonProps): ReactElement {
  const ui = useVoiceState()
  const [busy, setBusy] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const micRef = useRef<MicCapture | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const playbackRef = useRef<Playback | null>(null)

  const stop = (): void => {
    const ws = wsRef.current
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }))
        ws.close()
      } catch {
        // ignore
      }
      wsRef.current = null
    }
    micRef.current?.stop()
    micRef.current = null
    playbackRef.current?.stop()
    playbackRef.current = null
    if (ctxRef.current) {
      void ctxRef.current.close()
      ctxRef.current = null
    }
    setBusy(false)
    setVoiceState({
      active: false,
      status: 'idle',
      partial: '',
      final: '',
      error: null,
      sessionId: null,
    })
  }

  useEffect(() => stop, [])

  const start = async (): Promise<void> => {
    if (busy || ui.active) return
    if (!sessionId) {
      setVoiceState({ error: '请先打开一个会话' })
      return
    }
    setBusy(true)
    setVoiceState({
      active: true,
      sessionId,
      status: 'listening',
      partial: '',
      final: '',
      error: null,
    })

    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      ctxRef.current = ctx
      const playback = new Playback(ctx)
      playbackRef.current = playback

      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${BASE_PATH}/ws`,
      )
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onmessage = (event) => {
        let message: any
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'status') {
          setVoiceState({ status: message.state, sessionId: message.sessionId ?? sessionId })
        } else if (message.type === 'partial') {
          setVoiceState({ partial: message.text })
        } else if (message.type === 'final') {
          setVoiceState({ final: message.text, partial: '' })
        } else if (message.type === 'audio') {
          playback.play(message.audio, message.sampleRate)
        } else if (message.type === 'barge-in') {
          playback.stop()
          setVoiceState({ status: 'listening' })
        } else if (message.type === 'config') {
          setVoiceState({ provider: message.provider })
        } else if (message.type === 'error') {
          setVoiceState({ error: message.message })
        }
      }

      const opened = new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('语音连接失败'))
      })
      await opened
      ws.send(JSON.stringify({ type: 'start', sessionId }))
      micRef.current = await startMic(ctx, (frame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame)
      })
      setBusy(false)
    } catch (err) {
      console.warn('[dsh-voice] start failed', err)
      setVoiceState({
        active: false,
        status: 'idle',
        error: err instanceof Error ? err.message : '语音启动失败',
      })
      stop()
    }
  }

  const active = ui.active
  return (
    <button
      type="button"
      onClick={() => (active ? stop() : void start())}
      disabled={busy}
      title={active ? '退出语音模式' : '语音模式'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 10px',
        borderRadius: 8,
        border: `1px solid ${active ? 'rgba(110,231,183,.55)' : 'rgba(255,255,255,.14)'}`,
        background: active ? 'rgba(110,231,183,.12)' : 'transparent',
        color: active ? '#6ee7b7' : 'inherit',
        cursor: busy ? 'wait' : 'pointer',
        fontSize: 13,
        lineHeight: 1,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: active ? '#6ee7b7' : 'currentColor',
          opacity: active ? 1 : 0.55,
          boxShadow: active ? '0 0 0 3px rgba(110,231,183,.16)' : 'none',
        }}
      />
      {active ? '语音中' : '语音'}
    </button>
  )
}
