import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MODELS = join(ROOT, '.models')
const require = createRequire(join(ROOT, 'packages/voice/package.json'))
const sherpaLib = join(
  ROOT,
  'node_modules/.pnpm/sherpa-onnx-node@2.0.1/node_modules/sherpa-onnx-darwin-arm64',
)
process.env.DYLD_LIBRARY_PATH = `${sherpaLib}:${process.env.DYLD_LIBRARY_PATH ?? ''}`
const sherpa = require('sherpa-onnx-node')

const text = '你好，我是语音助手。今天天气不错。'
const out = []
const push = (label, audio) => {
  out.push({ label, audio })
  sherpa.writeWave(join(ROOT, `spikes/phase0/voices/${label}.wav`), audio)
  console.log(label, (audio.samples.length / audio.sampleRate).toFixed(2) + 's', audio.sampleRate)
}

function resample(samples, from, to) {
  if (from === to) return samples
  const ratio = from / to
  const length = Math.floor(samples.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(samples.length - 1, i0 + 1)
    const t = x - i0
    out[i] = samples[i0] * (1 - t) + samples[i1] * t
  }
  return out
}

const vitsDir = join(MODELS, 'sherpa-onnx-vits-zh-ll')
if (existsSync(join(vitsDir, 'model.onnx'))) {
  const ruleFsts = ['date.fst', 'phone.fst', 'number.fst']
    .map((f) => join(vitsDir, f))
    .filter(existsSync)
    .join(',')
  const tts = new sherpa.OfflineTts({
    model: {
      vits: {
        model: join(vitsDir, 'model.onnx'),
        tokens: join(vitsDir, 'tokens.txt'),
        lexicon: join(vitsDir, 'lexicon.txt'),
      },
      debug: 0,
      numThreads: 4,
      provider: 'cpu',
    },
    maxNumSentences: 1,
    ...(ruleFsts ? { ruleFsts } : {}),
  })
  for (const [sid, name] of [[0, 'suyingxue'], [2, 'fushiyu']]) {
    push(`vits-${sid}-${name}`, tts.generate({ text, generationConfig: new sherpa.GenerationConfig({ sid, speed: 1.0, silenceScale: 0.2 }) }))
  }
}

const matchaDir = join(MODELS, 'matcha-icefall-zh-en')
if (existsSync(join(matchaDir, 'model-steps-3.onnx'))) {
  const tts = new sherpa.OfflineTts({
    model: {
      matcha: {
        acousticModel: join(matchaDir, 'model-steps-3.onnx'),
        vocoder: join(matchaDir, 'vocos-16khz-univ.onnx'),
        tokens: join(matchaDir, 'tokens.txt'),
        lexicon: join(matchaDir, 'lexicon.txt'),
      },
      debug: 0,
      numThreads: 4,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  })
  push('matcha-zh-en', tts.generate({ text, generationConfig: new sherpa.GenerationConfig({ sid: 0, speed: 1.0, silenceScale: 0.2 }) }))
}

const kokoroDir = join(MODELS, 'kokoro-int8-multi-lang-v1_1')
if (existsSync(join(kokoroDir, 'model.int8.onnx'))) {
  const tts = new sherpa.OfflineTts({
    model: {
      kokoro: {
        model: join(kokoroDir, 'model.int8.onnx'),
        voices: join(kokoroDir, 'voices.bin'),
        tokens: join(kokoroDir, 'tokens.txt'),
        lexicon: `${join(kokoroDir, 'lexicon-us-en.txt')},${join(kokoroDir, 'lexicon-zh.txt')}`,
      },
      debug: 0,
      numThreads: 4,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  })
  for (const [sid, name] of [[47, 'zf_xiaoxiao'], [48, 'zf_xiaoyi'], [49, 'zm_yunjian']]) {
    push(`kokoro-${sid}-${name}`, tts.generate({ text, generationConfig: new sherpa.GenerationConfig({ sid, speed: 1.0, silenceScale: 0.2 }) }))
  }
}

// Concatenate with 0.8s gaps for quick A/B listening, resampled to 24k.
const sr = 24000
const gap = new Float32Array(Math.round(sr * 0.8))
const pieces = []
for (const item of out) {
  pieces.push(resample(item.audio.samples, item.audio.sampleRate, sr), gap)
}
if (pieces.length) {
  const total = pieces.reduce((n, x) => n + x.length, 0)
  const all = new Float32Array(total)
  let offset = 0
  for (const piece of pieces) {
    all.set(piece, offset)
    offset += piece.length
  }
  sherpa.writeWave(join(ROOT, 'spikes/phase0/voices/compare-all.wav'), { samples: all, sampleRate: sr })
  console.log('combined sample rate', sr, 'order:', out.map((x) => x.label).join(', '))
}
