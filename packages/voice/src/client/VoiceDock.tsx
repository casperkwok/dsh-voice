import type { CSSProperties, ReactElement } from 'react'
import { useVoiceState } from './store.ts'
import { voiceControl } from './control.ts'
import { KeyboardIcon, MicIcon, StopIcon } from './icons.tsx'

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
  speaking: '#bfdbfe',
  interrupted: '#fca5a5',
}

const CSS = `
@keyframes dshv-breathe {
  0%, 100% { transform: scale(.97); }
  50% { transform: scale(1.03); }
}
@keyframes dshv-bar {
  0%, 100% { transform: scaleY(.35); opacity: .55; }
  50% { transform: scaleY(1); opacity: 1; }
}
@keyframes dshv-ring {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`

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
        gap: 7,
        padding: '2px 0 10px',
      }}
    >
      <style>{CSS}</style>

      {caption ? (
        <div
          style={{
            maxWidth: 520,
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

      <div
        style={{
          position: 'relative',
          width: 74,
          height: 74,
          display: 'grid',
          placeItems: 'center',
          filter: ui.muted ? 'grayscale(.7) opacity(.65)' : undefined,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: -6,
            borderRadius: '50%',
            border: `1.5px solid ${color}`,
            opacity: 0.35,
            animation: ui.status === 'thinking' ? 'dshv-ring 3.2s linear infinite' : undefined,
            borderTopColor: 'transparent',
            borderLeftColor: 'transparent',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            clipPath: 'circle(50%)',
            overflow: 'hidden',
            background:
              'radial-gradient(circle at 32% 26%, #dbeafe 0%, #60a5fa 34%, #2563eb 68%, rgba(37,99,235,.35) 100%)',
            boxShadow: `0 0 30px ${color}33, inset 0 0 20px rgba(255,255,255,.18)`,
            animation: 'dshv-breathe 2.2s ease-in-out infinite',
          }}
        />
        <span
          aria-hidden="true"
          style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3, height: 24 }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              style={{
                width: 2.5,
                height: 20,
                borderRadius: 2,
                background: 'rgba(255,255,255,.9)',
                transformOrigin: 'center',
                animation: `dshv-bar ${ui.status === 'thinking' ? 1.6 : 0.9}s ease-in-out ${i * 0.1}s infinite`,
              }}
            />
          ))}
        </span>
      </div>

      <span
        style={{
          fontSize: 11.5,
          letterSpacing: '.06em',
          color: ui.error ? '#fca5a5' : 'rgba(235,240,248,.5)',
        }}
      >
        {ui.error ? '语音不可用' : (LABELS[ui.status] ?? ui.status)}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 1 }}>
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
