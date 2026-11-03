/**
 * Phase 0: validate the local ASR + VAD + TTS APIs without the browser.
 *
 * Run: ./spikes/phase0/run-pipeline.sh
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../..')
const MODELS = join(ROOT, '.models')

const sherpaLib = join(
  ROOT,
  'node_modules/.pnpm/sherpa-onnx-node@2.0.1/node_modules/sherpa-onnx-darwin-arm64',
)
process.env.DYLD_LIBRARY_PATH = `${sherpaLib}:${process.env.DYLD_LIBRARY_PATH ?? ''}`

const require = createRequire(join(ROOT, 'packages/voice/package.json'))
const sherpa = require('sherpa-onnx-node')

const ASR_DIR = join(MODELS, 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20')
const TTS_DIR = join(MODELS, 'sherpa-onnx-vits-zh-ll')
const VAD_MODEL = join(MODELS, 'silero_vad.onnx')

for (const p of [ASR_DIR, TTS_DIR, VAD_MODEL]) {
  if (!existsSync(p)) {
    console.error('missing model:', p)
    process.exit(1)
  }
}

function createRecognizer() {
  return new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(ASR_DIR, 'encoder-epoch-99-avg-1.onnx'),
        decoder: join(ASR_DIR, 'decoder-epoch-99-avg-1.onnx'),
        joiner: join(ASR_DIR, 'joiner-epoch-99-avg-1.onnx'),
      },
      tokens: join(ASR_DIR, 'tokens.txt'),
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
}

function createVad() {
  return new sherpa.Vad(
    {
      sileroVad: {
        model: VAD_MODEL,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.6,
        windowSize: 512,
      },
      tenVad: {
        model: '',
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.6,
        windowSize: 256,
      },
      sampleRate: 16000,
      debug: 0,
      numThreads: 1,
    },
    60,
  )
}

function createTts() {
  const ruleFsts = ['date.fst', 'phone.fst', 'number.fst']
    .map((f) => join(TTS_DIR, f))
    .filter(existsSync)
    .join(',')
  return new sherpa.OfflineTts({
    model: {
      vits: {
        model: join(TTS_DIR, 'model.onnx'),
        tokens: join(TTS_DIR, 'tokens.txt'),
        lexicon: join(TTS_DIR, 'lexicon.txt'),
      },
      debug: 0,
      numThreads: 1,
      provider: 'cpu',
    },
    maxNumSentences: 1,
    ...(ruleFsts ? { ruleFsts } : {}),
  })
}

console.log('[init] loading TTS')
const tts = createTts()
console.log('[init] loading ASR')
const recognizer = createRecognizer()
console.log('[init] loading VAD')
const vad = createVad()

const inputText = '你好，我是语音助手，今天天气不错。请告诉我现在几点了。'
console.log('[tts] generating input audio:', inputText)
const ttsInputStart = performance.now()
const inputAudio = tts.generate({
  text: inputText,
  generationConfig: new sherpa.GenerationConfig({ sid: 0, speed: 1.0, silenceScale: 0.2 }),
})
const ttsInputMs = performance.now() - ttsInputStart
const inputWav = join(HERE, 'test-input.wav')
sherpa.writeWave(inputWav, inputAudio)
console.log(
  `[tts] input audio ${inputAudio.samples.length / inputAudio.sampleRate}s, ` +
    `generated in ${ttsInputMs.toFixed(0)}ms, saved ${inputWav}`,
)

const wave = sherpa.readWave(inputWav)
console.log(`[asr] reading ${wave.samples.length / wave.sampleRate}s audio`)
const stream = recognizer.createStream()
const chunkSize = 512
let lastPartial = ''
let endpointMs = null
const asrStart = performance.now()
const segments = []

for (let i = 0; i < wave.samples.length; i += chunkSize) {
  const chunk = wave.samples.subarray(i, Math.min(i + chunkSize, wave.samples.length))
  vad.acceptWaveform(chunk)
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: chunk })
  while (recognizer.isReady(stream)) recognizer.decode(stream)
  const text = recognizer.getResult(stream).text.trim()
  if (text && text !== lastPartial) {
    lastPartial = text
    console.log(`[asr] partial ${(performance.now() - asrStart).toFixed(0)}ms: ${text}`)
  }
  while (!vad.isEmpty()) {
    const segment = vad.front()
    vad.pop()
    segments.push(segment)
    if (endpointMs === null) endpointMs = performance.now() - asrStart
  }
}

const tail = new Float32Array(wave.sampleRate * 0.4)
stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: tail })
while (recognizer.isReady(stream)) recognizer.decode(stream)
const finalText = recognizer.getResult(stream).text.trim()
console.log(`[asr] final after ${(performance.now() - asrStart).toFixed(0)}ms: ${finalText}`)
console.log(`[asr] vad segments: ${segments.length}, first endpoint at ${endpointMs?.toFixed(0) ?? 'n/a'}ms`)

const reply = finalText || inputText
console.log('[tts] generating reply:', reply)
const ttsStart = performance.now()
const replyAudio = tts.generate({
  text: reply,
  generationConfig: new sherpa.GenerationConfig({ sid: 0, speed: 1.0, silenceScale: 0.2 }),
})
const ttsMs = performance.now() - ttsStart
const replyWav = join(HERE, 'test-output.wav')
sherpa.writeWave(replyWav, replyAudio)
const duration = replyAudio.samples.length / replyAudio.sampleRate
console.log(
  `[tts] reply ${duration.toFixed(2)}s, generated in ${ttsMs.toFixed(0)}ms, ` +
    `RTF ${(ttsMs / 1000 / duration).toFixed(2)}, saved ${replyWav}`,
)
