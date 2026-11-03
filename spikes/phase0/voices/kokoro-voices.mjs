import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../..')
const MODELS = join(ROOT, '..', '.models')
const DIR = join(MODELS, 'kokoro-int8-multi-lang-v1_1')
const sherpaLib = join(
  ROOT,
  '..',
  'node_modules/.pnpm/sherpa-onnx-node@2.0.1/node_modules/sherpa-onnx-darwin-arm64',
)
process.env.DYLD_LIBRARY_PATH = `${sherpaLib}:${process.env.DYLD_LIBRARY_PATH ?? ''}`
const require = createRequire(join(ROOT, '..', 'packages/voice/package.json'))
const sherpa = require('sherpa-onnx-node')

if (!existsSync(join(DIR, 'model.int8.onnx')) || !existsSync(join(DIR, 'voices.bin'))) {
  console.error('Kokoro model not ready:', DIR)
  process.exit(1)
}

const tts = new sherpa.OfflineTts({
  model: {
    kokoro: {
      model: join(DIR, 'model.int8.onnx'),
      voices: join(DIR, 'voices.bin'),
      tokens: join(DIR, 'tokens.txt'),
      lexicon: `${join(DIR, 'lexicon-us-en.txt')},${join(DIR, 'lexicon-zh.txt')}`,
    },
    debug: 0,
    numThreads: 4,
    provider: 'cpu',
  },
  maxNumSentences: 1,
})

const voices = [
  [45, 'zf_xiaobei'],
  [46, 'zf_xiaoni'],
  [47, 'zf_xiaoxiao'],
  [48, 'zf_xiaoyi'],
  [49, 'zm_yunjian'],
  [50, 'zm_yunxi'],
  [51, 'zm_yunxia'],
  [52, 'zm_yunyang'],
]
const text = '你好，我是语音助手。今天天气不错。This is a local voice.'
const cfg = (sid) => new sherpa.GenerationConfig({ sid, speed: 1.0, silenceScale: 0.2 })
const sr = tts.sampleRate
const gap = new Float32Array(Math.round(sr * 0.6))
const pieces = []

for (const [sid, name] of voices) {
  const t0 = performance.now()
  const audio = tts.generate({ text, generationConfig: cfg(sid) })
  const ms = performance.now() - t0
  sherpa.writeWave(join(HERE, `kokoro-${sid}-${name}.wav`), audio)
  pieces.push(audio.samples, gap)
  console.log(
    `${sid} ${name}: ${(audio.samples.length / audio.sampleRate).toFixed(2)}s, ` +
      `${ms.toFixed(0)}ms, RTF ${(ms / 1000 / (audio.samples.length / audio.sampleRate)).toFixed(2)}`,
  )
}

const total = pieces.reduce((n, x) => n + x.length, 0)
const all = new Float32Array(total)
let offset = 0
for (const piece of pieces) {
  all.set(piece, offset)
  offset += piece.length
}
sherpa.writeWave(join(HERE, 'kokoro-all.wav'), { samples: all, sampleRate: sr })
console.log('combined:', (total / sr).toFixed(2) + 's')
