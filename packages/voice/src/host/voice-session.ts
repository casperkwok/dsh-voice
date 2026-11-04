import type { VoiceSettings } from '../shared/settings.ts'
import type { VoiceServerFrame } from '../shared/protocol.ts'
import { pcmRms, splitForTts, type VoiceEngine } from './voice-engine.ts'
import { approvalIntent, incompleteDelay, isDuplicateFinal } from './eou.ts'
import { normalizeChineseNumbers, stripForSpeech } from './normalize.ts'

interface VoiceSessionOptions {
  engine: VoiceEngine
  settings: VoiceSettings
  sessionId: string
  send: (frame: VoiceServerFrame) => void
  onFinal: (text: string) => void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const debug = (...args: unknown[]): void => {
  if (process.env.DSH_VOICE_DEBUG) console.log('[dsh-voice:eou]', ...args)
}

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
  private lastFinalText = ''
  private lastFinalAt = 0
  private pendingFinal: {
    text: string
    deadline: number
    voiceAt: number | null
    endpointAt: number
  } | null = null
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null
  private pendingApproval: {
    resolve: (outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable') => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

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
      if (this.pendingFinal) {
        debug('resume, cancel pending', this.pendingFinal.text)
        this.pendingFinal = null
        this.send({ type: 'status', state: 'listening', sessionId: this.sessionId })
      }
    }
    if (this.pendingFinal && performance.now() >= this.pendingFinal.deadline) {
      const pending = this.pendingFinal
      debug('pending deadline, finalize', pending.text)
      this.pendingFinal = null
      this.finalizeTurn(pending.text, pending.endpointAt, pending.voiceAt)
      return
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
      const extensionMs = incompleteDelay(finalText)
      debug('segment', JSON.stringify(finalText), 'extensionMs=', extensionMs)
      if (extensionMs > 0) {
        this.pendingFinal = {
          text: finalText,
          deadline: performance.now() + extensionMs,
          voiceAt: this.lastVoiceAt,
          endpointAt,
        }
        this.resetVad()
        break
      }
      this.finalizeTurn(finalText, endpointAt, this.lastVoiceAt)
      break
    }
  }

  private finalizeTurn(
    text: string,
    endpointAt: number,
    voiceAt: number | null,
  ): void {
    const now = performance.now()
    if (isDuplicateFinal(this.lastFinalText, this.lastFinalAt, text, now)) {
      debug('duplicate final, ignored', JSON.stringify(text))
      this.resetAsr()
      this.resetVad()
      return
    }
    this.lastFinalText = text
    this.lastFinalAt = now
    this.turnId += 1
    this.muted = false
    this.lastTurnVoiceAt = voiceAt
    this.lastEndpointDelayMs =
      voiceAt === null ? null : Math.round(endpointAt - voiceAt)
    const handlingApproval = this.pendingApproval !== null
    this.send({ type: 'final', text })
    if (!handlingApproval) {
      this.send({ type: 'status', state: 'thinking', sessionId: this.sessionId })
      this.send({ type: 'caption', text: '正在思考…' })
    }
    this.resetAsr()
    this.resetVad()
    this.onFinal(text)
    if (!handlingApproval) this.scheduleThinkingCue()
  }

  requestApproval(request: {
    toolName: string
    reason?: string
    signal?: AbortSignal
  }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'> {
    if (this.pendingApproval) return Promise.resolve('unavailable')
    const prompt = `有一个操作需要你授权：${request.toolName}。说“允许”或“拒绝”。`
    this.send({
      type: 'approval',
      toolName: request.toolName,
      reason: request.reason,
      prompt,
    })
    this.enqueueSpeech(prompt)
    return new Promise((resolve) => {
      const settle = (outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'): void => {
        if (!this.pendingApproval) return
        clearTimeout(this.pendingApproval.timer)
        this.pendingApproval = null
        resolve(outcome)
      }
      const timer = setTimeout(() => settle('unavailable'), 60000)
      this.pendingApproval = { resolve: settle, timer }
      request.signal?.addEventListener('abort', () => settle('cancelled'), { once: true })
    })
  }

  /** Returns true when the utterance was consumed by a pending approval. */
  resolveApproval(text: string): boolean {
    if (!this.pendingApproval) return false
    const intent = approvalIntent(text)
    if (intent === 'allowed') {
      this.send({ type: 'approval-resolved', decision: 'allowed' })
      this.pendingApproval.resolve('allowed-once')
      this.enqueueSpeech('已允许。')
      return true
    }
    if (intent === 'rejected') {
      this.send({ type: 'approval-resolved', decision: 'rejected' })
      this.pendingApproval.resolve('rejected')
      this.enqueueSpeech('已拒绝。')
      return true
    }
    this.enqueueSpeech('请说“允许”或“拒绝”。')
    return true
  }

  private scheduleThinkingCue(): void {
    this.clearThinkingCue()
    this.thinkingTimer = setTimeout(() => {
      this.thinkingTimer = null
      if (this.destroyed || this.speaking || this.muted) return
      const cue = this.engine.thinkingCue
      if (!cue) return
      this.send({ type: 'caption', text: '正在思考…' })
      this.send({
        type: 'audio',
        audio: floatToBase64(cue.samples),
        sampleRate: cue.sampleRate,
        sentenceId: 0,
        chunkId: 0,
        final: true,
      })
    }, 600)
  }

  private clearThinkingCue(): void {
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer)
    this.thinkingTimer = null
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
    this.clearThinkingCue()
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
    this.clearThinkingCue()
    this.assistantActive = true
    this.assistantBuffer = ''
  }

  pushAssistantText(text: string): void {
    if (this.destroyed || this.muted) return
    this.clearThinkingCue()
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
    this.send({ type: 'caption', text })

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
    this.clearThinkingCue()
    if (this.pendingApproval) this.pendingApproval.resolve('cancelled')
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
