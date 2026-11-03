import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../..')
const MODELS = join(ROOT, '.models')
const sherpaLib = join(ROOT, 'node_modules/.pnpm/sherpa-onnx-node@2.0.1/node_modules/sherpa-onnx-darwin-arm64')
process.env.DYLD_LIBRARY_PATH = `${sherpaLib}:${process.env.DYLD_LIBRARY_PATH ?? ''}`
const require = createRequire(join(ROOT, 'packages/voice/package.json'))
const sherpa = require('sherpa-onnx-node')
const TTS_DIR = join(MODELS, 'sherpa-onnx-vits-zh-ll')
const ruleFsts = ['date.fst','phone.fst','number.fst'].map(f=>join(TTS_DIR,f)).filter(existsSync).join(',')
const tts = new sherpa.OfflineTts({
  model:{vits:{model:join(TTS_DIR,'model.onnx'),tokens:join(TTS_DIR,'tokens.txt'),lexicon:join(TTS_DIR,'lexicon.txt')},debug:0,numThreads:1,provider:'cpu'},
  maxNumSentences:1,
  ...(ruleFsts?{ruleFsts}:{}),
})
for (const text of ['你好。','你好，我是语音助手。','你好，我是语音助手，今天天气不错。请告诉我现在几点了。']) {
  const t0 = performance.now()
  let first = null, chunks = 0, samples = 0
  const audio = await tts.generateAsync({
    text,
    generationConfig: new sherpa.GenerationConfig({sid:0,speed:1.0,silenceScale:0.2}),
    onProgress: ({samples: s, progress}) => {
      if (first === null) first = performance.now() - t0
      chunks++; samples += s.length
      if (chunks <= 3) console.log(`  chunk ${chunks}: ${s.length} samples, progress=${progress.toFixed(2)}, at ${(performance.now()-t0).toFixed(0)}ms`)
    },
  })
  const total = performance.now() - t0
  const dur = audio.samples.length / audio.sampleRate
  console.log(`text=${text.length} chars | first=${first?.toFixed(0)}ms | total=${total.toFixed(0)}ms | audio=${dur.toFixed(2)}s | RTF=${(total/1000/dur).toFixed(2)} | chunks=${chunks}`)
}
