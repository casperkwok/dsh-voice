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

export function VoiceDock({ sessionId }: VoiceDockProps): ReactElement | null {
  const ui = useVoiceState()
  if (!ui.active) return null
  if (sessionId && ui.sessionId && sessionId !== ui.sessionId) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 26,
        padding: '2px 2px 4px',
        fontSize: 12,
        color: 'var(--dsh-text-secondary, rgba(235,240,248,.62))',
      }}
    >
      <span style={{ color: '#6ee7b7', fontWeight: 600 }}>
        {LABELS[ui.status] ?? ui.status}
      </span>
      {ui.provider ? <span style={{ opacity: 0.6 }}>{ui.provider}</span> : null}
      {ui.error ? (
        <span style={{ color: '#fca5a5' }}>{ui.error}</span>
      ) : (
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {ui.partial || ui.final}
        </span>
      )}
    </div>
  )
}
