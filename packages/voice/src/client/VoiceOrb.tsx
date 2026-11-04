import { useEffect, useRef, type ReactElement } from 'react'
import type { VoiceState } from '../shared/protocol.ts'

interface VoiceOrbProps {
  size: number
  state: VoiceState
  level: number
  muted: boolean
}

/** A lightweight Canvas 2D fluid orb. It reacts to the real microphone level
 * without pulling three.js into the DSH client bundle. */
export function VoiceOrb({ size, state, level, muted }: VoiceOrbProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef(state)
  const levelRef = useRef(level)
  const mutedRef = useRef(muted)

  useEffect(() => {
    stateRef.current = state
    levelRef.current = level
    mutedRef.current = muted
  }, [state, level, muted])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    let raf = 0
    const started = performance.now()
    const points = 96

    const drawBlob = (cx: number, cy: number, radius: number, time: number, layer: number): void => {
      ctx.beginPath()
      for (let i = 0; i <= points; i += 1) {
        const angle = (i / points) * Math.PI * 2
        const wobble =
          1 +
          0.026 * Math.sin(angle * 3 + time * 1.15 + layer * 1.7) +
          0.016 * Math.sin(angle * 5 - time * 0.82 + layer * 2.4) +
          levelRef.current * 0.035 * Math.sin(angle * 7 + time * 2.1)
        const r = radius * wobble
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
    }

    const draw = (now: number): void => {
      const t = (now - started) / 1000
      const thinking = stateRef.current === 'thinking'
      const speed = thinking ? 0.45 : stateRef.current === 'speaking' ? 1.65 : 1.1
      const time = t * speed
      const mutedNow = mutedRef.current
      const cx = size / 2
      const cy = size / 2
      const base = size * 0.285 + levelRef.current * size * 0.045

      ctx.clearRect(0, 0, size, size)
      ctx.save()
      if (mutedNow) ctx.globalAlpha = 0.55

      // Soft outer halo, then a solid sphere. Additive blending only on the
      // halo; the core stays blue instead of blowing out to white.
      ctx.globalCompositeOperation = 'lighter'
      for (let layer = 2; layer >= 1; layer -= 1) {
        const radius = base * (1 + layer * 0.07)
        const grad = ctx.createRadialGradient(cx, cy, radius * 0.45, cx, cy, radius * 1.2)
        grad.addColorStop(0, 'rgba(59,130,246,.16)')
        grad.addColorStop(0.65, 'rgba(37,99,235,.07)')
        grad.addColorStop(1, 'rgba(29,78,216,0)')
        ctx.fillStyle = grad
        drawBlob(cx, cy, radius, time + layer * 0.7, layer)
        ctx.fill()
      }

      ctx.globalCompositeOperation = 'source-over'
      const core = ctx.createRadialGradient(
        cx - size * 0.1,
        cy - size * 0.14,
        size * 0.02,
        cx,
        cy,
        base * 1.04,
      )
      core.addColorStop(0, 'rgba(191,219,254,.98)')
      core.addColorStop(0.28, 'rgba(96,165,250,.98)')
      core.addColorStop(0.62, 'rgba(37,99,235,.97)')
      core.addColorStop(0.88, 'rgba(29,78,216,.92)')
      core.addColorStop(1, 'rgba(23,63,180,.88)')
      ctx.fillStyle = core
      ctx.shadowColor = 'rgba(59,130,246,.45)'
      ctx.shadowBlur = size * 0.14
      drawBlob(cx, cy, base, time, 0)
      ctx.fill()

      // A restrained specular highlight.
      const highlight = ctx.createRadialGradient(
        cx - size * 0.1,
        cy - size * 0.15,
        0,
        cx - size * 0.1,
        cy - size * 0.14,
        size * 0.24,
      )
      highlight.addColorStop(0, 'rgba(255,255,255,.28)')
      highlight.addColorStop(0.55, 'rgba(255,255,255,.05)')
      highlight.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = highlight
      ctx.beginPath()
      ctx.arc(cx - size * 0.08, cy - size * 0.11, size * 0.22, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: 'block',
        filter: muted
          ? 'grayscale(.75) opacity(.6)'
          : 'drop-shadow(0 18px 40px rgba(37,99,235,.3))',
      }}
    />
  )
}
