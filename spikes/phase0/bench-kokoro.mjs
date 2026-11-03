import { createRequire } from 'node:module'
import { join } from 'node:path'

const ROOT = process.cwd()
const DIR = join(ROOT, '.models/kokoro-int8-multi-lang-v1_1')
const sherpaLib = join(
  ROOT,
  'node_modules/.pnpm/sherpa-onnx-node@2.0.1/node_modules/sherpa-onnx-darwin-arm64',
)
process.env.DYLD_LIBRARY_PATH = `${sherpaLib}:${process.env.DYLD_LIBRARY_PATH ?? ''}`
const require = createRequire(join(ROOT, 'packages/voice/package.json'))
const sherpa = require('sherpa-onnx-node')

const threads = Number(process.argv[2] ?? 4)
const sid = Number(process.argv[3] ?? 47)
const tts = new sherpa.OfflineTts({
  model: {
    kokoro: {
      model: join(DIR, 'model.int8.onnx'),
      voices: join(DIR, 'voices.bin'),
      tokens: join(DIR, 'tokens.txt'),
      lexicon: `${join(DIR, 'lexicon-us-en.txt')},${join(DIR, 'lexicon-zh.txt')}`,
    },
    debug: 0,
    numThreads: threads,
    provider: 'cpu',
  },
  maxNumSentences: 1,
})
const cfg = new sherpa.GenerationConfig({ sid, speed: 1.0, silenceScale: 0.2 })
tts.generate({ text: '预热。', generationConfig: cfg })

for (const text of ['嗯。', '好的。', '我听到了：', '我听到了：你好我是语音助手。', '你好，我是语音助手。今天天气不错。']) {
  const runs = []
  for (let i = 0; i < 3; i += 1) {
    const t0 = performance.now()
    let first = null
    let chunks = 0
    let samples = 0
    await tts.generateAsync({
      text,
      generationConfig: cfg,
      onProgress: ({ samples: s }) => {
        chunks += 1
        samples += s.length
        if (first === null) first = performance.now() - t0
        return 1
      },
    })
    runs.push({ first: first.toFixed(0), total: (performance.now() - t0).toFixed(0), chunks, samples })
  }
  console.log(
    `threads=${threads} sid=${sid} text=${JSON.stringify(text)} ` +
      `first=[${runs.map((r) => r.first).join(',')}]ms ` +
      `total=[${runs.map((r) => r.total).join(',')}]ms ` +
      `chunks=${runs[0].chunks} samples=${runs[0].samples}`,
  )
}
