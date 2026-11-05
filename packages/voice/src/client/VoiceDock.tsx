import type { ReactElement } from 'react'
import { useVoiceState } from './store.ts'
import { voiceControl } from './control.ts'
import { VoiceOrb } from './VoiceOrb.tsx'

interface VoiceDockProps {
  sessionId?: string
}

export function VoiceDock({ sessionId }: VoiceDockProps): ReactElement | null {
  const ui = useVoiceState()
  if (!ui.active) return null
  if (sessionId && ui.sessionId && sessionId !== ui.sessionId) return null

  const downloading =
    ui.model && !ui.model.done
      ? `${ui.model.label}${ui.model.source ? ` · ${ui.model.source === 'modelscope' ? '魔搭' : ui.model.source === 'huggingface' ? 'HF' : 'GitHub'}` : ''}${ui.model.percent > 0 ? ` ${ui.model.percent}%` : '…'}`
      : ''
  const caption =
    ui.approval?.prompt ??
    ui.error ??
    (downloading || (ui.status === 'speaking' ? ui.caption : ui.status === 'listening' ? ui.partial : ''))

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

      {caption ? (
        <div
          style={{
            maxWidth: 620,
            padding: '0 12px',
            color: ui.approval ? '#fbbf24' : ui.error ? '#fca5a5' : 'rgba(240,244,250,.66)',
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
