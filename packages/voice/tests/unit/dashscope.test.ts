import { describe, expect, it } from 'vitest'
import { parseWav } from '../../src/host/tts/dashscope.ts'

function wav(samples: number[], sampleRate = 24000): Uint8Array {
  const data = Buffer.alloc(44 + samples.length * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + samples.length * 2, 4)
  data.write('WAVE', 8)
  data.write('fmt ', 12)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(sampleRate, 24)
  data.writeUInt32LE(sampleRate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((value, i) => data.writeInt16LE(value, 44 + i * 2))
  return new Uint8Array(data)
}

describe('DashScope WAV parser', () => {
  it('reads PCM16 mono', () => {
    const parsed = parseWav(wav([0, 16384, -16384], 24000))
    expect(parsed.sampleRate).toBe(24000)
    expect(parsed.samples[1]).toBeCloseTo(0.5, 3)
    expect(parsed.samples[2]).toBeCloseTo(-0.5, 3)
  })
})
