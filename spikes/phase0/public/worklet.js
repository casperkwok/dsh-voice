class MicDownsample extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = options.processorOptions || {}
    this.targetRate = opts.targetRate || 16000
    this.chunkSamples = opts.chunkSamples || 320
    this.ratio = sampleRate / this.targetRate
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

registerProcessor('mic-downsample', MicDownsample)
