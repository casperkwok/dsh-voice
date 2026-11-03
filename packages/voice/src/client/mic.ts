/**
 * Microphone capture: 16 kHz, mono, PCM16, 20 ms frames.
 *
 * Chrome ignores an explicit sampleRate on getUserMedia, so the AudioWorklet
 * decimates from the context rate. The same AudioContext is reused for playback.
 */
const WORKLET_SOURCE = `
class DshVoiceMic extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = options.processorOptions || {}
    this.ratio = sampleRate / (opts.targetRate || 16000)
    this.chunkSamples = opts.chunkSamples || 320
    this.phase = 0
    this.buffer = []
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input) return true
    for (let i = 0; i < input.length; i += 1) {
      this.phase += 1
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio
        this.buffer.push(input[i])
        if (this.buffer.length >= this.chunkSamples) {
          const out = new Int16Array(this.buffer.length)
          for (let j = 0; j < this.buffer.length; j += 1) {
            const v = Math.max(-1, Math.min(1, this.buffer[j]))
            out[j] = v * 32767
          }
          this.port.postMessage(out.buffer, [out.buffer])
          this.buffer = []
        }
      }
    }
    return true
  }
}
registerProcessor('dsh-voice-mic', DshVoiceMic)
`

export interface MicCapture {
  stop: () => void
}

export async function startMic(
  ctx: AudioContext,
  onFrame: (frame: ArrayBuffer) => void,
): Promise<MicCapture> {
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  })
  const source = ctx.createMediaStreamSource(stream)
  const worklet = new AudioWorkletNode(ctx, 'dsh-voice-mic', {
    processorOptions: { targetRate: 16000, chunkSamples: 320 },
  })
  worklet.port.onmessage = (event) => onFrame(event.data as ArrayBuffer)
  source.connect(worklet)

  return {
    stop: () => {
      worklet.port.onmessage = null
      worklet.disconnect()
      source.disconnect()
      for (const track of stream.getTracks()) track.stop()
    },
  }
}
