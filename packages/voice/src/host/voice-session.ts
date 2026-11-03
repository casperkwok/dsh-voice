import type { VoiceSettings } from '../shared/settings.ts'
import type { VoiceServerFrame } from '../shared/protocol.ts'
import { pcmRms, splitForTts, type VoiceEngine } from './voice-engine.ts'

interface VoiceSessionOptions {
  engine: VoiceEngine
  settings: VoiceSettings
  sessionId: string
  send: (frame: VoiceServerFrame) => void
  onFinal: (text: string) => void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class VoiceSession {
  private readonly engine: VoiceEngine
  private readonly settings: VoiceSettings
  readonly sessionId: string
  private readonly send: (frame: VoiceServerFrame) => void
  private readonly onFinal: (text: string) => void

  private stream: any = null
  private vad: any = null
  private partial = ''
  private speaking = false
  private speechFrames = 0
  private lastVoiceAt: number | null = null
  private lastTurnVoiceAt: number | null = null
  private lastEndpointDelayMs: number | null = null
  private ttsEpoch = 0
  private speechGeneration = 0
  private speechChain: Promise<void> = Promise.resolve()
  private turnId = 0
  private recentFrames: Float32Array[] = []
  private recentSamples = 0
  private assistantBuffer = ''
  private assistantActive = false
  private muted = false
  private destroyed = false

  constructor(options: VoiceSessionOptions) {
    this.engine = options.engine
    this.settings = options.settings
    this.sessionId = options.sessionId
    this.send = options.send
    this.onFinal = options.onFinal
    this.resetAsr()
    this.resetVad()
  }

  private resetAsr(): void {
    if (!this.engine.recognizer) return
    if (this.stream) this.engine.recognizer.reset(this.stream)
    this.stream = this.engine.recognizer.createStream()
    this.partial = ''
  }

  private resetVad(): void {
    this.vad = this.engine.vadFactory?.() ?? null
    this.speechFrames = 0
    this.lastVoiceAt = null
  }

  private ensureAudio(): boolean {
    if (this.stream && this.vad) return true
    if (!this.engine.recognizer || !this.engine.vadFactory) return false
    this.resetAsr()
    this.resetVad()
    return true
  }

  pushAudio(samples: Float32Array): void {
    if (this.destroyed || !this.ensureAudio() || !this.vad || !this.stream) return
    this.remember(samples)
    this.vad.acceptWaveform(samples)
    if (!this.speaking && this.vad.isDetected() && pcmRms(samples) > 0.008) {
      this.lastVoiceAt = performance.now()
    }

    if (this.speaking) {
      if (this.vad.isDetected() && pcmRms(samples) > 0.02) {
        this.speechFrames += 1
        if (this.speechFrames >= 3) this.bargeIn()
      } else {
        this.speechFrames = 0
      }
    } else {
      this.stream.acceptWaveform({ sampleRate: 16000, samples })
      while (this.engine.recognizer.isReady(this.stream)) {
        this.engine.recognizer.decode(this.stream)
      }
      const text = this.engine.recognizer.getResult(this.stream).text.trim()
      if (text && text !== this.partial) {
        this.partial = text
        this.send({ type: 'partial', text })
      }
    }

    while (!this.vad.isEmpty()) {
      this.vad.pop()
      if (this.speaking) continue
      const endpointAt = performance.now()
      const finalText = this.engine.recognizer.getResult(this.stream).text.trim()
      if (!finalText) {
        this.resetAsr()
        this.resetVad()
        continue
      }
      this.turnId += 1
      this.muted = false
      this.lastTurnVoiceAt = this.lastVoiceAt
      this.lastEndpointDelayMs =
        this.lastVoiceAt === null ? null : Math.round(endpointAt - this.lastVoiceAt)
      this.send({ type: 'final', text: finalText })
      this.send({ type: 'status', state: 'thinking', sessionId: this.sessionId })
      this.resetAsr()
      this.resetVad()
      this.onFinal(finalText)
      break
    }
  }

  private remember(samples: Float32Array): void {
    this.recentFrames.push(samples)
    this.recentSamples += samples.length
    while (this.recentSamples > 16000 * 3 && this.recentFrames.length > 0) {
      const dropped = this.recentFrames.shift()
      this.recentSamples -= dropped?.length ?? 0
    }
  }

  private replayBargeBuffer(buffered: Float32Array[]): void {
    const primer = new Float32Array(1600)
    this.vad?.acceptWaveform(primer)
    this.stream?.acceptWaveform({ sampleRate: 16000, samples: primer })
    for (const frame of buffered) {
      if (!this.vad || !this.stream) break
      this.vad.acceptWaveform(frame)
      this.stream.acceptWaveform({ sampleRate: 16000, samples: frame })
      while (this.engine.recognizer.isReady(this.stream)) this.engine.recognizer.decode(this.stream)
    }
    const text = this.stream ? this.engine.recognizer.getResult(this.stream).text.trim() : ''
    if (text) {
      this.partial = text
      this.send({ type: 'partial', text })
    }
  }

  private bargeIn(): void {
    this.ttsEpoch += 1
    this.speechGeneration += 1
    this.speaking = false
    this.muted = true
    const buffered = this.recentFrames
    this.recentFrames = []
    this.recentSamples = 0
    this.resetAsr()
    this.resetVad()
    this.send({ type: 'barge-in' })
    this.send({ type: 'status', state: 'listening', sessionId: this.sessionId })
    this.replayBargeBuffer(buffered)
  }

  beginAssistant(): void {
    this.assistantActive = true
    this.assistantBuffer = ''
  }

  pushAssistantText(text: string): void {
    if (this.destroyed || this.muted) return
    this.assistantBuffer += text
    this.flushAssistant(false)
  }

  endAssistant(): void {
    this.assistantActive = false
    this.flushAssistant(true)
  }

  private flushAssistant(final: boolean): void {
    const clean = stripForSpeech(this.assistantBuffer)
    let start = 0
    for (let i = 0; i < clean.length; i += 1) {
      if ('。！？!?'.includes(clean[i]!)) {
        const sentence = clean.slice(start, i + 1).trim()
        start = i + 1
        if (sentence) this.enqueueSpeech(sentence)
      }
    }
    this.assistantBuffer = clean.slice(start)
    if (final) {
      const rest = this.assistantBuffer.trim()
      this.assistantBuffer = ''
      if (rest) this.enqueueSpeech(rest)
    }
  }

  private enqueueSpeech(text: string): void {
    const generation = this.speechGeneration
    this.speechChain = this.speechChain
      .then(() => {
        if (this.destroyed || generation !== this.speechGeneration) return
        return this.speak(text)
      })
      .catch((err) => console.warn('[dsh-voice] speech queue failed', err))
  }

  private async speak(text: string): Promise<void> {
    const epoch = ++this.ttsEpoch
    const ttsStart = performance.now()
    let firstChunkAt: number | null = null
    let lastChunkAt: number | null = null
    let lastChunkDurationMs = 0
    let totalDurationMs = 0
    let sentenceId = 0
    let chunkId = 0
    let metricsSent = false
    this.speaking = true
    this.send({ type: 'status', state: 'speaking', sessionId: this.sessionId })

    const emitMetrics = (): void => {
      if (metricsSent || firstChunkAt === null) return
      metricsSent = true
      this.send({
        type: 'metrics',
        turnId: this.turnId,
        ttsFirstChunkMs: Math.round(firstChunkAt - ttsStart),
        lastSpeechToFirstChunkMs:
          this.lastTurnVoiceAt === null
            ? null
            : Math.round(firstChunkAt - this.lastTurnVoiceAt),
        vadEndpointDelayMs: this.lastEndpointDelayMs,
      })
    }

    for (const segment of splitForTts(text)) {
      if (epoch !== this.ttsEpoch) return
      sentenceId += 1
      chunkId = 0
      const spoken = /[A-Za-z]/.test(segment) ? segment : normalizeChineseNumbers(segment)
      await this.engine.synthesize(
        spoken,
        (chunk) => {
          if (epoch !== this.ttsEpoch) return
          const now = performance.now()
          if (firstChunkAt === null) firstChunkAt = now
          const durationMs = (chunk.samples.length / chunk.sampleRate) * 1000
          lastChunkAt = now
          lastChunkDurationMs = durationMs
          totalDurationMs += durationMs
          chunkId += 1
          this.send({
            type: 'audio',
            audio: floatToBase64(chunk.samples),
            sampleRate: chunk.sampleRate,
            sentenceId,
            chunkId,
            final: false,
          })
          emitMetrics()
        },
        () => epoch === this.ttsEpoch,
      )
    }

    if (epoch !== this.ttsEpoch) return
    if (firstChunkAt !== null) {
      const playbackEnd = Math.max(
        firstChunkAt + totalDurationMs,
        (lastChunkAt ?? firstChunkAt) + lastChunkDurationMs,
      )
      while (performance.now() < playbackEnd) {
        if (epoch !== this.ttsEpoch || this.destroyed) return
        await sleep(40)
      }
    }
    this.speaking = false
    this.send({ type: 'status', state: 'listening', sessionId: this.sessionId })
  }

  destroy(): void {
    this.destroyed = true
    this.ttsEpoch += 1
    this.speechGeneration += 1
  }
}

function floatToBase64(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    int16[i] = Math.max(-1, Math.min(1, samples[i]!)) * 32767
  }
  return Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).toString('base64')
}

function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/^[#>\-+\s]+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[（）()]/g, '，')
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const CN_UNITS = ['', '十', '百', '千']

function digitsToChinese(value: string): string {
  return [...value].map((char) => CN_DIGITS[Number(char)] ?? char).join('')
}

function intToChinese(value: number): string {
  if (!Number.isFinite(value) || value < 0) return String(value)
  if (value === 0) return '零'
  if (value >= 10000) return digitsToChinese(String(Math.floor(value)))
  let out = ''
  let pendingZero = false
  for (let i = 3; i >= 0; i -= 1) {
    const unit = 10 ** i
    const digit = Math.floor(value / unit) % 10
    if (digit > 0) {
      if (pendingZero && out) out += '零'
      out += CN_DIGITS[digit]! + CN_UNITS[i]!
      pendingZero = false
    } else if (out) {
      pendingZero = true
    }
  }
  return out.startsWith('一十') ? out.slice(1) : out
}

function numberToChinese(raw: string): string {
  const [whole, fraction] = raw.split('.')
  const base = intToChinese(Number(whole))
  return fraction ? `${base}点${digitsToChinese(fraction)}` : base
}

/** Convert the number shapes a Chinese assistant actually emits into readings
 * Matcha's Chinese lexicon can pronounce. English-bearing segments skip this. */
function normalizeChineseNumbers(text: string): string {
  return text
    .replace(/(\d{4})\s*年/g, (_m, year: string) => `${digitsToChinese(year)}年`)
    .replace(/(\d{1,2}):(\d{2})/g, (_m, hour: string, minute: string) => {
      const h = intToChinese(Number(hour))
      if (minute === '00') return `${h}点整`
      const mm = Number(minute)
      return `${h}点${mm < 10 ? '零' : ''}${intToChinese(mm)}分`
    })
    .replace(/(\d{1,2})\s*月/g, (_m, month: string) => `${intToChinese(Number(month))}月`)
    .replace(/(\d{1,2})\s*日/g, (_m, day: string) => `${intToChinese(Number(day))}日`)
    .replace(/(\d+(?:\.\d+)?)\s*%/g, (_m, n: string) => `百分之${numberToChinese(n)}`)
    .replace(/\d+(?:\.\d+)?/g, (n) => numberToChinese(n))
}
