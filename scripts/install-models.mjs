#!/usr/bin/env node
/**
 * Download the local models dsh-voice needs into DSH_VOICE_MODELS (or
 * ~/.cache/dsh-voice/models).
 *
 * Usage:
 *   node scripts/install-models.mjs
 *   node scripts/install-models.mjs --with-kokoro
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const ROOT = process.env.DSH_VOICE_MODELS || join(homedir(), '.cache', 'dsh-voice', 'models')
const HF = (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/$/, '')
const withKokoro = process.argv.includes('--with-kokoro')

const ASR_REPO = `${HF}/csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/resolve/main`
const MATCHA_REPO = `${HF}/csukuangfj/matcha-icefall-zh-en/resolve/main`
const KOKORO_REPO = `${HF}/csukuangfj/kokoro-int8-multi-lang-v1_1/resolve/main`

async function download(url, dest, label) {
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`[skip] ${label}`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  console.log(`[get ] ${label}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  const tmp = `${dest}.part`
  const out = createWriteStream(tmp)
  let received = 0
  let last = 0
  for await (const chunk of res.body) {
    received += chunk.length
    if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
    const now = Date.now()
    if (now - last > 1000) {
      last = now
      const pct = total ? ` ${((received / total) * 100).toFixed(1)}%` : ''
      process.stdout.write(`\r[get ] ${label}${pct} ${(received / 1e6).toFixed(1)}MB`)
    }
  }
  await new Promise((resolve, reject) => {
    out.end(() => resolve())
    out.on('error', reject)
  })
  process.stdout.write('\n')
  renameSync(tmp, dest)
}

async function main() {
  console.log(`models: ${ROOT}`)
  mkdirSync(ROOT, { recursive: true })

  await download('https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', join(ROOT, 'silero_vad.onnx'), 'silero_vad.onnx')

  const asr = join(ROOT, 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20')
  for (const file of ['tokens.txt', 'encoder-epoch-99-avg-1.onnx', 'decoder-epoch-99-avg-1.onnx', 'joiner-epoch-99-avg-1.onnx']) {
    await download(`${ASR_REPO}/${file}`, join(asr, file), `asr/${file}`)
  }

  const matcha = join(ROOT, 'matcha-icefall-zh-en')
  for (const file of ['model-steps-3.onnx', 'vocos-16khz-univ.onnx', 'tokens.txt', 'lexicon.txt']) {
    const url = file === 'vocos-16khz-univ.onnx'
      ? 'https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-16khz-univ.onnx'
      : `${MATCHA_REPO}/${file}`
    await download(url, join(matcha, file), `matcha/${file}`)
  }

  if (withKokoro) {
    const kokoro = join(ROOT, 'kokoro-int8-multi-lang-v1_1')
    for (const file of ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt']) {
      await download(`${KOKORO_REPO}/${file}`, join(kokoro, file), `kokoro/${file}`)
    }
  }

  console.log('\n[done] models ready')
  if (!withKokoro) console.log('Kokoro (English fallback) skipped; rerun with --with-kokoro to add it.')
}

main().catch((err) => {
  console.error('\n[failed]', err.message)
  process.exit(1)
})
