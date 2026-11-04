import type { CSSProperties, ReactElement } from 'react'
import { useVoiceState } from './store.ts'
import { voiceControl } from './control.ts'
import { KeyboardIcon, MicIcon, StopIcon } from './icons.tsx'
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

function focusComposer(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('textarea, [contenteditable="true"]')
    el?.focus()
  })
}

function CircleButton({
  title,
  onClick,
  children,
  primary = false,
  danger = false,
}: {
  title: string
  onClick: () => void
  children: ReactElement
  primary?: boolean
  danger?: boolean
}): ReactElement {
  const style: CSSProperties = primary
    ? {
        width: 38,
        height: 38,
        border: 'none',
        background: '#3b82f6',
        color: '#fff',
        boxShadow: '0 4px 16px rgba(59,130,246,.35)',
      }
    : {
        width: 34,
        height: 34,
        border: '1px solid rgba(255,255,255,.1)',
        background: danger ? 'rgba(248,113,113,.16)' : 'rgba(255,255,255,.055)',
        color: danger ? '#fca5a5' : 'rgba(235,240,248,.82)',
      }
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        padding: 0,
        borderRadius: '50%',
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  )
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
      {caption ? (
        <div
          style={{
            maxWidth: 560,
            padding: '0 12px',
            color: ui.error ? '#fca5a5' : 'rgba(240,244,250,.68)',
            fontSize: 12.5,
            lineHeight: 1.45,
            textAlign: 'center',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {caption}
        </div>
      ) : null}

      <VoiceOrb size={172} state={ui.status} level={ui.level} muted={ui.muted} />

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
        <CircleButton
          title="退出语音，改用打字"
          onClick={() => {
            voiceControl.stop?.()
            focusComposer()
          }}
        >
          <KeyboardIcon size={15} />
        </CircleButton>
        <CircleButton
          title={ui.muted ? '取消静音' : '静音'}
          danger={ui.muted}
          onClick={() => voiceControl.toggleMute?.()}
        >
          <MicIcon size={16} muted={ui.muted} />
        </CircleButton>
        <CircleButton title="结束语音" primary onClick={() => voiceControl.stop?.()}>
          <StopIcon size={16} />
        </CircleButton>
      </div>
    </div>
  )
}
