import type { ReactElement } from 'react'
import { useVoiceState } from './store.ts'
import { voiceControl } from './control.ts'
import { VoiceOrb } from './VoiceOrb.tsx'

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

const COLORS: Record<string, string> = {
  listening: '#6ee7b7',
  thinking: '#fbbf24',
  speaking: '#93c5fd',
  interrupted: '#fca5a5',
}

export function VoiceDock({ sessionId }: VoiceDockProps): ReactElement | null {
  const ui = useVoiceState()
  if (!ui.active) return null
  if (sessionId && ui.sessionId && sessionId !== ui.sessionId) return null

  const color = COLORS[ui.status] ?? '#6ee7b7'
  const caption =
    ui.error ??
    (ui.status === 'speaking' ? ui.caption : ui.status === 'listening' ? ui.partial : '')

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '2px 0 10px',
      }}
    >
      <button
        type="button"
        title="点击结束语音（Esc）"
        aria-label="结束语音"
        onClick={() => voiceControl.stop?.()}
        style={{
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          lineHeight: 0,
        }}
      >
        <VoiceOrb size={172} state={ui.status} level={ui.level} muted={ui.muted} />
      </button>

      <span
        style={{
          fontSize: 11.5,
          letterSpacing: '.08em',
          color: ui.error ? '#fca5a5' : color,
          opacity: 0.78,
        }}
      >
        {ui.error ? '语音不可用' : (LABELS[ui.status] ?? ui.status)}
      </span>

      {caption ? (
        <div
          style={{
            maxWidth: 620,
            padding: '0 12px',
            color: ui.error ? '#fca5a5' : 'rgba(240,244,250,.66)',
            fontSize: 12.5,
            lineHeight: 1.5,
            textAlign: 'center',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  )
}
