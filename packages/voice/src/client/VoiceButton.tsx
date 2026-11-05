import { useEffect, useRef, useState, type ReactElement } from 'react'
import { setVoiceState, useVoiceState } from './store.ts'
import { startMic, type MicCapture } from './mic.ts'
import { Playback } from './playback.ts'
import { voiceControl } from './control.ts'
import { WaveIcon } from './icons.tsx'

const BASE_PATH = '/voice'

interface VoiceButtonProps {
  sessionId?: string
}

export function VoiceButton({ sessionId }: VoiceButtonProps): ReactElement | null {
  const ui = useVoiceState()
  const [busy, setBusy] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const micRef = useRef<MicCapture | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const playbackRef = useRef<Playback | null>(null)
  const mutedRef = useRef(false)

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
    mutedRef.current = false
    setBusy(false)
    setVoiceState({
      active: false,
      status: 'idle',
      partial: '',
      final: '',
      caption: '',
      error: null,
      sessionId: null,
      muted: false,
      level: 0,
      approval: null,
      model: null,
    })
  }

  const toggleMute = (): void => {
    if (!ui.active) return
    mutedRef.current = !mutedRef.current
    setVoiceState({ muted: mutedRef.current, level: mutedRef.current ? 0 : ui.level })
  }

  useEffect(() => stop, [])

  useEffect(() => {
    voiceControl.stop = stop
    voiceControl.toggleMute = toggleMute
    return () => {
      if (voiceControl.stop === stop) delete voiceControl.stop
      if (voiceControl.toggleMute === toggleMute) delete voiceControl.toggleMute
    }
  })

  const start = async (): Promise<void> => {
    if (busy || ui.active) return
    if (!sessionId) {
      setVoiceState({ error: '请先打开一个会话' })
      return
    }
    setBusy(true)
    mutedRef.current = false
    setVoiceState({
      active: true,
      sessionId,
      status: 'listening',
      partial: '',
      final: '',
      caption: '',
      error: null,
      muted: false,
      level: 0,
      approval: null,
      model: null,
    })

    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      ctxRef.current = ctx
      const playback = new Playback(ctx, (level) => setVoiceState({ level }))
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
          setVoiceState({
            status: message.state,
            sessionId: message.sessionId ?? sessionId,
            ...(message.state === 'listening' ? {} : { level: 0 }),
          })
        } else if (message.type === 'partial') {
          setVoiceState({ partial: message.text })
        } else if (message.type === 'final') {
          setVoiceState({ final: message.text, partial: '', caption: '' })
        } else if (message.type === 'caption') {
          setVoiceState({ caption: message.text })
        } else if (message.type === 'approval') {
          setVoiceState({
            approval: { toolName: message.toolName, reason: message.reason, prompt: message.prompt },
          })
        } else if (message.type === 'approval-resolved') {
          setVoiceState({
            approval: null,
            caption: message.decision === 'allowed' ? '已允许' : '已拒绝',
          })
        } else if (message.type === 'audio') {
          playback.play(message.audio, message.sampleRate)
        } else if (message.type === 'barge-in') {
          playback.stop()
          setVoiceState({ status: 'listening' })
        } else if (message.type === 'config') {
          setVoiceState({ provider: message.provider })
        } else if (message.type === 'model-progress') {
          setVoiceState({
            model: {
              label: message.label,
              percent: Number(message.percent) || 0,
              done: Boolean(message.done),
              source: message.source,
            },
          })
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
      let lastLevelAt = 0
      micRef.current = await startMic(ctx, (frame) => {
        if (mutedRef.current) return
        const pcm = new Int16Array(frame)
        let sum = 0
        for (let i = 0; i < pcm.length; i += 1) {
          const value = pcm[i]! / 32768
          sum += value * value
        }
        const now = performance.now()
        if (now - lastLevelAt > 70) {
          lastLevelAt = now
          setVoiceState({ level: Math.min(1, Math.sqrt(sum / pcm.length) * 6) })
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(frame)
      })
      setBusy(false)
    } catch (err) {
      console.warn('[dsh-voice] start failed', err)
      const message = err instanceof Error ? err.message : '语音启动失败'
      stop()
      setVoiceState({ error: message })
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const combo =
        (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'v'
      if (combo) {
        event.preventDefault()
        if (ui.active) stop()
        else void start()
      } else if (event.key === 'Escape' && ui.active) {
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui.active, sessionId, busy])

  if (ui.active) return null

  const shortcut = navigator.userAgent.includes('Mac') ? '⌘⇧V' : 'Ctrl+Shift+V'
  return (
    <button
      type="button"
      onClick={() => (ui.active ? stop() : void start())}
      disabled={busy}
      title={`${ui.active ? '结束语音' : '开始语音'} ${shortcut}`}
      aria-label={ui.active ? '结束语音' : '开始语音'}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: 32,
        height: 32,
        padding: 0,
        borderRadius: '50%',
        border: 'none',
        background: '#3b82f6',
        color: '#fff',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.65 : 1,
        boxShadow: ui.active
          ? '0 0 0 2px rgba(110,231,183,.55), 0 4px 16px rgba(59,130,246,.35)'
          : '0 2px 10px rgba(59,130,246,.25)',
      }}
    >
      <WaveIcon size={17} />
    </button>
  )
}
