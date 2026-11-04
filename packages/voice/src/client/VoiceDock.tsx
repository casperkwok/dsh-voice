import type { ReactElement } from 'react'
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
  speaking: '#93c5fd',
  interrupted: '#fca5a5',
}

const DOCK_CSS = `
@keyframes dshv-orb {
  0%, 100% { transform: scale(.82); opacity: .65; }
  50% { transform: scale(1); opacity: 1; }
}
@keyframes dshv-halo {
  0%, 100% { transform: scale(.9); opacity: .18; }
  50% { transform: scale(1.35); opacity: .04; }
}
`

function focusComposer(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('textarea, [contenteditable="true"]')
    el?.focus()
  })
}

export function VoiceDock({ sessionId }: VoiceDockProps): ReactElement | null {
  const ui = useVoiceState()
  if (!ui.active) return null
  if (sessionId && ui.sessionId && sessionId !== ui.sessionId) return null

  const color = COLORS[ui.status] ?? '#6ee7b7'
  const caption =
    ui.error ??
    (ui.status === 'speaking' || ui.status === 'thinking'
      ? ui.caption
      : ui.partial || ui.final)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '2px 0 8px' }}>
      <style>{DOCK_CSS}</style>

      {caption ? (
        <div
          style={{
            maxWidth: 620,
            padding: '6px 12px',
            borderRadius: 14,
            background: 'rgba(255,255,255,.055)',
            border: '1px solid rgba(255,255,255,.07)',
            color: ui.error ? '#fca5a5' : 'rgba(240,244,250,.9)',
            fontSize: 13,
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
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: 'min(560px, 100%)',
          height: 54,
          padding: '0 8px 0 10px',
          borderRadius: 27,
          background: 'rgba(18,21,28,.94)',
          border: '1px solid rgba(255,255,255,.1)',
          boxShadow: '0 10px 36px rgba(0,0,0,.32)',
          backdropFilter: 'blur(18px)',
        }}
      >
        <button
          type="button"
          title="退出语音，改用打字"
          onClick={() => {
            voiceControl.stop?.()
            focusComposer()
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 34,
            padding: '0 9px',
            borderRadius: 17,
            border: 'none',
            background: 'transparent',
            color: 'rgba(235,240,248,.72)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          <KeyboardIcon size={15} />
          打字
        </button>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, minWidth: 0 }}>
          <span style={{ position: 'relative', display: 'inline-grid', placeItems: 'center', width: 28, height: 28 }}>
            <span
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: color,
                animation: 'dshv-halo 2.4s ease-in-out infinite',
              }}
            />
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: color,
                boxShadow: `0 0 14px ${color}`,
                animation: 'dshv-orb 1.8s ease-in-out infinite',
              }}
            />
          </span>
          <span style={{ fontSize: 12, color: 'rgba(235,240,248,.62)', whiteSpace: 'nowrap' }}>
            {LABELS[ui.status] ?? ui.status}
          </span>
        </div>

        <button
          type="button"
          title={ui.muted ? '取消静音' : '静音'}
          onClick={() => voiceControl.toggleMute?.()}
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            width: 34,
            height: 34,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,.1)',
            background: ui.muted ? 'rgba(248,113,113,.16)' : 'rgba(255,255,255,.06)',
            color: ui.muted ? '#fca5a5' : 'rgba(235,240,248,.86)',
            cursor: 'pointer',
          }}
        >
          <MicIcon size={16} muted={ui.muted} />
        </button>

        <button
          type="button"
          title="结束语音"
          aria-label="结束语音"
          onClick={() => voiceControl.stop?.()}
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            width: 38,
            height: 38,
            borderRadius: '50%',
            border: 'none',
            background: '#3b82f6',
            color: '#fff',
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(59,130,246,.35)',
          }}
        >
          <StopIcon size={16} />
        </button>
      </div>
    </div>
  )
}
