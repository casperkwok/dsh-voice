export class Playback {
  private readonly ctx: AudioContext
  private readonly onLevel?: (level: number) => void
  private sources: AudioBufferSourceNode[] = []
  private nextPlayAt = 0

  constructor(ctx: AudioContext, onLevel?: (level: number) => void) {
    this.ctx = ctx
    this.onLevel = onLevel
  }

  play(base64: string, sampleRate: number): void {
    if (!base64 || !sampleRate) return
    const samples = base64ToFloat32(base64)
    if (!samples.length) return
    this.onLevel?.(Math.min(1, rms(samples) * 5))
    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate)
    buffer.getChannelData(0).set(samples)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)
    const at = Math.max(this.ctx.currentTime + 0.02, this.nextPlayAt)
    source.start(at)
    this.nextPlayAt = at + buffer.duration
    this.sources.push(source)
    source.onended = () => {
      this.sources = this.sources.filter((item) => item !== source)
      if (this.sources.length === 0) this.onLevel?.(0)
    }
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    this.sources = []
    this.nextPlayAt = 0
    this.onLevel?.(0)
  }
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i]! * samples[i]!
  return Math.sqrt(sum / samples.length)
}

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const int16 = new Int16Array(bytes.buffer)
  const samples = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i += 1) samples[i] = int16[i]! / 32768
  return samples
}
