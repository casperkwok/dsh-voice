import type { ReactElement } from 'react'
import { useVoiceState } from './store.ts'

interface VoiceDockProps {
  sessionId?: string
}

const LABELS: Record<string, string> = {
  idle: '未开始',
  listening: '聆听中',
  thinking: '思考中',
  speaking: '朗读中',
  interrupted: '已打断',
}

const HINTS: Record<string, string> = {
  listening: '停顿一下再发送',
  thinking: '正在组织回答',
  speaking: '开口即可打断',
}

const COLORS: Record<string, string> = {
  listening: '#6ee7b7',
  thinking: '#fbbf24',
  speaking: '#93c5fd',
  interrupted: '#fca5a5',
}

const EQUALIZER_CSS = `
@keyframes dshv-eq {
  0%, 100% { transform: scaleY(.35); opacity: .55; }
  50% { transform: scaleY(1); opacity: 1; }
}
`

function Equalizer({ color }: { color: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 14, width: 16 }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 14,
            borderRadius: 2,
            background: color,
            transformOrigin: 'center',
            animation: `dshv-eq .9s ease-in-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </span>
  )
}

export function VoiceDock({ sessionId }: VoiceDockProps): ReactElement | null {
  const ui = useVoiceState()
  if (!ui.active) return null
  if (sessionId && ui.sessionId && sessionId !== ui.sessionId) return null

  const color = COLORS[ui.status] ?? '#6ee7b7'
  const text =
    ui.status === 'speaking' || ui.status === 'thinking'
      ? ui.caption || (ui.status === 'thinking' ? '正在组织回答…' : '')
      : ui.partial || ui.final

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        minHeight: 32,
        padding: '4px 10px',
        marginBottom: 6,
        borderRadius: 9,
        border: '1px solid rgba(255,255,255,.09)',
        background: 'rgba(255,255,255,.035)',
        fontSize: 12,
        color: 'rgba(235,240,248,.82)',
      }}
    >
      <style>{EQUALIZER_CSS}</style>
      <Equalizer color={color} />
      <span style={{ color, fontWeight: 650, flex: '0 0 auto' }}>
        {LABELS[ui.status] ?? ui.status}
      </span>
      {ui.error ? (
        <span style={{ color: '#fca5a5', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {ui.error}
        </span>
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: ui.partial ? 'rgba(235,240,248,.58)' : 'rgba(235,240,248,.9)',
          }}
        >
          {text}
        </span>
      )}
      <span style={{ flex: '0 0 auto', opacity: 0.42, fontSize: 11 }}>
        {ui.provider ? `${ui.provider} · ` : ''}
        {HINTS[ui.status] ?? ''}
      </span>
    </div>
  )
}
