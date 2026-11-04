import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VoiceSettings } from '../shared/settings.ts'
import { MiniMaxTts } from './tts/minimax.ts'

const require = createRequire(import.meta.url)

function loadSherpa(): any {
  const platform = `sherpa-onnx-${process.platform}-${process.arch}`
  try {
    const pkg = require.resolve(`${platform}/package.json`)
    const libDir = dirname(pkg)
    const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH'
    process.env[key] = `${libDir}:${process.env[key] ?? ''}`
  } catch {
    // The platform package may be bundled elsewhere; sherpa-onnx-node will report it.
  }
  return require('sherpa-onnx-node')
}

const sherpa = loadSherpa()

export interface TtsHandle {
  provider: 'matcha' | 'kokoro' | 'vits'
  tts: any
  sid: number
  sampleRate: number
}

export interface AudioChunk {
  samples: Float32Array
  sampleRate: number
}

function resolveModelsDir(settings: VoiceSettings): string {
  if (settings.modelsDir) return settings.modelsDir
  if (process.env.DSH_VOICE_MODELS) return process.env.DSH_VOICE_MODELS
  const cache = join(homedir(), '.cache', 'dsh-voice', 'models')
  if (existsSync(cache)) return cache
  // Development fallback: walk up from lib/ or src/host/ to the repository .models.
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i += 1) {
    const candidate = join(dir, '.models')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  return cache
}

export class VoiceEngine {
  private modelsDir: string
  private settings: VoiceSettings
  private readyPromise: Promise<void> | null = null
  recognizer: any = null
  vadFactory: (() => any) | null = null
  primary: TtsHandle | null = null
  latin: TtsHandle | null = null
  cloud: MiniMaxTts | null = null
  thinkingCue: { samples: Float32Array; sampleRate: number } | null = null
  error: string | null = null

  constructor(settings: VoiceSettings) {
    this.settings = settings
    this.modelsDir = resolveModelsDir(settings)
  }

  get provider(): string {
    return this.cloud?.provider ?? this.primary?.provider ?? 'none'
  }

  get sampleRate(): number {
    return this.cloud?.sampleRate ?? this.primary?.sampleRate ?? 16000
  }

  get ready(): boolean {
    return this.recognizer !== null && (this.cloud !== null || this.primary !== null)
  }

  async init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = this.load()
    return this.readyPromise
  }

  private async load(): Promise<void> {
    const asrDir = join(
      this.modelsDir,
      'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    )
    const vadModel = join(this.modelsDir, 'silero_vad.onnx')
    if (!existsSync(asrDir) || !existsSync(vadModel)) {
      throw new Error(`voice models not found in ${this.modelsDir}`)
    }

    this.recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(asrDir, 'encoder-epoch-99-avg-1.onnx'),
          decoder: join(asrDir, 'decoder-epoch-99-avg-1.onnx'),
          joiner: join(asrDir, 'joiner-epoch-99-avg-1.onnx'),
        },
        tokens: join(asrDir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
      maxActivePaths: 4,
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    })

    this.vadFactory = () =>
      new sherpa.Vad(
        {
          sileroVad: {
            model: vadModel,
            threshold: 0.5,
            minSpeechDuration: 0.15,
            minSilenceDuration: this.settings.silenceMs / 1000,
            windowSize: 512,
          },
          tenVad: {
            model: '',
            threshold: 0.5,
            minSpeechDuration: 0.15,
            minSilenceDuration: this.settings.silenceMs / 1000,
            windowSize: 256,
          },
          sampleRate: 16000,
          debug: 0,
          numThreads: 1,
        },
        60,
      )

    await this.loadTts()
  }

  private async loadTts(): Promise<void> {
    this.primary = null
    this.latin = null
    this.cloud = null
    this.thinkingCue = null

    if (this.settings.ttsMode === 'cloud') {
      if (this.settings.cloudProvider !== 'minimax') {
        throw new Error(`cloud TTS provider "${this.settings.cloudProvider}" 尚未接入`)
      }
      this.cloud = new MiniMaxTts(this.settings)
      return
    }

    switch (this.settings.ttsProvider) {
      case 'matcha':
        this.primary = this.createMatcha() ?? this.createKokoro() ?? this.createVits()
        break
      case 'auto':
        this.primary = this.createKokoro() ?? this.createMatcha() ?? this.createVits()
        break
      case 'vits':
        this.primary = this.createVits()
        break
      default:
        this.primary = this.createKokoro() ?? this.createMatcha() ?? this.createVits()
    }
    if (!this.primary) throw new Error(`no usable TTS model in ${this.modelsDir}`)
    if (this.primary.provider === 'matcha') {
      this.latin = this.createKokoro()
    }
    this.primary.tts.generate({
      text: '你好。',
      generationConfig: new sherpa.GenerationConfig({
        sid: this.primary.sid,
        speed: this.settings.ttsSpeed,
        silenceScale: 0.2,
      }),
    })
    try {
      const cue = this.primary.tts.generate({
        text: '我正在思考。',
        generationConfig: new sherpa.GenerationConfig({
          sid: this.primary.sid,
          speed: this.settings.ttsSpeed,
          silenceScale: 0.2,
        }),
      })
      if (cue?.samples?.length) {
        this.thinkingCue = { samples: cue.samples, sampleRate: cue.sampleRate }
      }
    } catch (err) {
      console.warn('[dsh-voice] thinking cue unavailable', err)
    }
  }

  async updateSettings(next: VoiceSettings): Promise<void> {
    this.settings = next
    this.modelsDir = resolveModelsDir(next)
    this.error = null
    await this.loadTts()
  }

  private createMatcha(): TtsHandle | null {
    const dir = join(this.modelsDir, 'matcha-icefall-zh-en')
    if (
      !existsSync(join(dir, 'model-steps-3.onnx')) ||
      !existsSync(join(dir, 'vocos-16khz-univ.onnx'))
    ) {
      return null
    }
    const tts = new sherpa.OfflineTts({
      model: {
        matcha: {
          acousticModel: join(dir, 'model-steps-3.onnx'),
          vocoder: join(dir, 'vocos-16khz-univ.onnx'),
          tokens: join(dir, 'tokens.txt'),
          lexicon: join(dir, 'lexicon.txt'),
        },
        debug: 0,
        numThreads: this.settings.ttsThreads,
        provider: 'cpu',
      },
      maxNumSentences: 1,
    })
    return { provider: 'matcha', tts, sid: 0, sampleRate: tts.sampleRate }
  }

  private createKokoro(): TtsHandle | null {
    const fp32 = join(this.modelsDir, 'kokoro-multi-lang-v1_1')
    const int8 = join(this.modelsDir, 'kokoro-int8-multi-lang-v1_1')
    const dir = existsSync(join(fp32, 'model.onnx')) ? fp32 : int8
    const model = dir === fp32 ? 'model.onnx' : 'model.int8.onnx'
    if (
      !existsSync(join(dir, model)) ||
      !existsSync(join(dir, 'voices.bin')) ||
      !existsSync(join(dir, 'lexicon-zh.txt'))
    ) {
      return null
    }
    const tts = new sherpa.OfflineTts({
      model: {
        kokoro: {
          model: join(dir, model),
          voices: join(dir, 'voices.bin'),
          tokens: join(dir, 'tokens.txt'),
          lexicon: `${join(dir, 'lexicon-us-en.txt')},${join(dir, 'lexicon-zh.txt')}`,
        },
        debug: 0,
        numThreads: this.settings.ttsThreads,
        provider: 'cpu',
      },
      maxNumSentences: 1,
    })
    return { provider: 'kokoro', tts, sid: this.settings.ttsSid, sampleRate: tts.sampleRate }
  }

  private createVits(): TtsHandle | null {
    const dir = join(this.modelsDir, 'sherpa-onnx-vits-zh-ll')
    if (!existsSync(join(dir, 'model.onnx'))) return null
    const ruleFsts = ['date.fst', 'phone.fst', 'number.fst']
      .map((f) => join(dir, f))
      .filter(existsSync)
      .join(',')
    const tts = new sherpa.OfflineTts({
      model: {
        vits: {
          model: join(dir, 'model.onnx'),
          tokens: join(dir, 'tokens.txt'),
          lexicon: join(dir, 'lexicon.txt'),
        },
        debug: 0,
        numThreads: this.settings.ttsThreads,
        provider: 'cpu',
      },
      maxNumSentences: 1,
      ...(ruleFsts ? { ruleFsts } : {}),
    })
    return { provider: 'vits', tts, sid: 0, sampleRate: tts.sampleRate }
  }

  /**
   * Synthesize one sentence, invoking onChunk as audio arrives. Returns false
   * when the caller cancelled or the engine failed.
   */
  async synthesize(
    text: string,
    onChunk: (chunk: AudioChunk) => void,
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    await this.init()
    if (this.cloud) {
      return this.cloud.synthesize(text, onChunk, shouldContinue)
    }
    const engine = this.latin && /[A-Za-z]/.test(text) ? this.latin : this.primary
    if (!engine) return false
    let sawChunk = false
    try {
      const audio = await engine.tts.generateAsync({
        text,
        generationConfig: new sherpa.GenerationConfig({
          sid: engine.sid,
          speed: this.settings.ttsSpeed,
          silenceScale: 0.2,
        }),
        onProgress: ({ samples }: { samples: Float32Array }) => {
          if (!shouldContinue()) return 0
          if (!samples.length) return 1
          sawChunk = true
          onChunk({ samples, sampleRate: engine.sampleRate })
          return 1
        },
      })
      if (!sawChunk && audio?.samples?.length && shouldContinue()) {
        onChunk({ samples: audio.samples, sampleRate: audio.sampleRate })
      }
      return true
    } catch (err) {
      console.warn('[dsh-voice] TTS segment failed', JSON.stringify(text), err)
      return false
    }
  }

  /** Synthesize one short sample for the settings page. */
  async preview(text: string): Promise<AudioChunk> {
    await this.init()
    if (this.cloud) {
      const chunks: AudioChunk[] = []
      let sampleRate = this.cloud.sampleRate
      await this.cloud.synthesize(
        text,
        (chunk) => {
          chunks.push(chunk)
          sampleRate = chunk.sampleRate
        },
        () => true,
      )
      const length = chunks.reduce((n, chunk) => n + chunk.samples.length, 0)
      const samples = new Float32Array(length)
      let offset = 0
      for (const chunk of chunks) {
        samples.set(chunk.samples, offset)
        offset += chunk.samples.length
      }
      return { samples, sampleRate }
    }

    const engine = this.primary
    if (!engine) throw new Error('本地 TTS 不可用')
    const audio = engine.tts.generate({
      text,
      generationConfig: new sherpa.GenerationConfig({
        sid: engine.sid,
        speed: this.settings.ttsSpeed,
        silenceScale: 0.2,
      }),
    })
    return { samples: audio.samples, sampleRate: audio.sampleRate }
  }
}

export function splitForTts(text: string, maxLen = 18): string[] {
  const parts = text.split(/(?<=[。！？!?；;：:，,])/)
  const out: string[] = []
  for (const part of parts) {
    const value = part.trim()
    if (!value) continue
    if (value.length <= maxLen) {
      out.push(value)
    } else {
      for (let i = 0; i < value.length; i += maxLen) out.push(value.slice(i, i + maxLen))
    }
  }
  return out.length ? out : [text]
}

export function pcmRms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i]! * samples[i]!
  return Math.sqrt(sum / samples.length)
}
