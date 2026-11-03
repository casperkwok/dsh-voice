import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../..')
const MODELS = join(ROOT, '.models')
const TTS_DIR = join(MODELS, 'sherpa-onnx-vits-zh-ll')
const sherpaLib = join(
  ROOT,
  'node_modules/.pnpm/sherpa-onnx-node@2.0.1/node_modules/sherpa-onnx-darwin-arm64',
)
process.env.DYLD_LIBRARY_PATH = `${sherpaLib}:${process.env.DYLD_LIBRARY_PATH ?? ''}`
const require = createRequire(join(ROOT, 'packages/voice/package.json'))
const sherpa = require('sherpa-onnx-node')

const threads = Number(process.argv[2] ?? 1)
const ruleFsts = ['date.fst', 'phone.fst', 'number.fst']
  .map((f) => join(TTS_DIR, f))
  .filter(existsSync)
  .join(',')

const tts = new sherpa.OfflineTts({
  model: {
    vits: {
      model: join(TTS_DIR, 'model.onnx'),
      tokens: join(TTS_DIR, 'tokens.txt'),
      lexicon: join(TTS_DIR, 'lexicon.txt'),
    },
    debug: 0,
    numThreads: threads,
    provider: 'cpu',
  },
  maxNumSentences: 1,
  ...(ruleFsts ? { ruleFsts } : {}),
})

const cfg = new sherpa.GenerationConfig({ sid: 0, speed: 1.0, silenceScale: 0.2 })
tts.generate({ text: '预热。', generationConfig: cfg })

const texts = ['好的。', '我听到了：', '我听到了：你好我是语音助手。', '我听到了：你好我是语音助手今天天气不错。']
for (const text of texts) {
  const runs = []
  for (let i = 0; i < 5; i += 1) {
    const t0 = performance.now()
    let first = null
    let chunks = 0
    await tts.generateAsync({
      text,
      generationConfig: cfg,
      onProgress: ({ samples }) => {
        chunks += 1
        if (first === null) first = performance.now() - t0
        void samples
        return 1
      },
    })
    runs.push({ first, total: performance.now() - t0, chunks })
  }
  const firsts = runs.map((r) => r.first.toFixed(0))
  const totals = runs.map((r) => r.total.toFixed(0))
  console.log(
    `threads=${threads} text=${JSON.stringify(text)} first=[${firsts.join(',')}]ms total=[${totals.join(',')}]ms chunks=${runs[0].chunks}`,
  )
}
