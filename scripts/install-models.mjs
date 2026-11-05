#!/usr/bin/env node
/**
 * Download the local models dsh-voice needs into DSH_VOICE_MODELS (or
 * ~/.cache/dsh-voice/models).
 *
 * ModelScope is tried first; Hugging Face / GitHub Releases are fallbacks.
 *
 * Usage:
 *   node scripts/install-models.mjs                 # ASR + VAD + Kokoro fp32
 *   node scripts/install-models.mjs --with-matcha   # also install Matcha
 *   node scripts/install-models.mjs --with-vits     # also install VITS
 *   DSH_VOICE_MODELS=... node scripts/install-models.mjs
 *   DSH_VOICE_MODEL_SOURCE=huggingface node scripts/install-models.mjs
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const ROOT = process.env.DSH_VOICE_MODELS || join(homedir(), '.cache', 'dsh-voice', 'models')
const HF = (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/$/, '')
const MS = (process.env.MODELSCOPE_ENDPOINT || 'https://modelscope.cn').replace(/\/$/, '')
const PREFER_HF = ['huggingface', 'hf'].includes((process.env.DSH_VOICE_MODEL_SOURCE || '').toLowerCase())
const withMatcha = process.argv.includes('--with-matcha')
const withVits = process.argv.includes('--with-vits')

const ASR_MS = 'pengzhendong/sherpa-onnx-streaming-zipformer-bilingual-zh-en'
const ASR_HF = 'csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20'
const KOKORO_MS = 'finchxu/kokoro-multi-lang-v1_1'
const KOKORO_HF = 'csukuangfj/kokoro-multi-lang-v1_1'
const MATCHA_MS = 'bujidc/matcha-icefall-zh-en'
const MATCHA_HF = 'csukuangfj/matcha-icefall-zh-en'
const VITS_MS = 'liaowenbin/sherpa-onnx-vits-zh-ll'
const VITS_HF = 'csukuangfj/sherpa-onnx-vits-zh-ll'

function urls(hfRepo, msRepo, file) {
  const ms = `${MS}/models/${msRepo}/resolve/master/${file}`
  const hf = `${HF}/${hfRepo}/resolve/main/${file}`
  return PREFER_HF ? [hf, ms] : [ms, hf]
}

async function downloadOne(url, dest, label, index) {
  const tmp = `${dest}.part.${index}`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
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

async function download(candidates, dest, label) {
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`[skip] ${label}`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  let lastError
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      await downloadOne(candidates[i], dest, label, i)
      return
    } catch (err) {
      lastError = err
      console.warn(`[warn] ${label}: ${err.message}`)
    }
  }
  throw lastError ?? new Error(`${label}: no download source`)
}

async function main() {
  console.log(`models: ${ROOT}`)
  console.log(`source: ${PREFER_HF ? 'Hugging Face first' : 'ModelScope first'}`)
  mkdirSync(ROOT, { recursive: true })

  await download(
    [
      `${MS}/models/WEAAEW/silero-vad-onnx/resolve/master/v4-sherpa/silero_vad.onnx`,
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    ],
    join(ROOT, 'silero_vad.onnx'),
    'silero_vad.onnx',
  )

  const asr = join(ROOT, 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20')
  for (const file of ['tokens.txt', 'encoder-epoch-99-avg-1.onnx', 'decoder-epoch-99-avg-1.onnx', 'joiner-epoch-99-avg-1.onnx']) {
    await download(urls(ASR_HF, ASR_MS, file), join(asr, file), `asr/${file}`)
  }

  const kokoro = join(ROOT, 'kokoro-multi-lang-v1_1')
  for (const file of ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt']) {
    await download(urls(KOKORO_HF, KOKORO_MS, file), join(kokoro, file), `kokoro/${file}`)
  }

  if (withMatcha) {
    const matcha = join(ROOT, 'matcha-icefall-zh-en')
    for (const file of ['model-steps-3.onnx', 'tokens.txt', 'lexicon.txt']) {
      await download(urls(MATCHA_HF, MATCHA_MS, file), join(matcha, file), `matcha/${file}`)
    }
    await download(
      [
        `${MS}/models/${MATCHA_MS}/resolve/master/vocos-16khz-univ.onnx`,
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-16khz-univ.onnx',
      ],
      join(matcha, 'vocos-16khz-univ.onnx'),
      'matcha/vocos-16khz-univ.onnx',
    )
  }

  if (withVits) {
    const vits = join(ROOT, 'sherpa-onnx-vits-zh-ll')
    for (const file of ['model.onnx', 'tokens.txt', 'lexicon.txt', 'date.fst', 'phone.fst', 'number.fst']) {
      await download(urls(VITS_HF, VITS_MS, file), join(vits, file), `vits/${file}`)
    }
  }

  console.log('\n[done] models ready')
  console.log('Optional: --with-matcha / --with-vits. Kokoro fp32 is the default local voice.')
}

main().catch((err) => {
  console.error('\n[failed]', err.message)
  process.exit(1)
})
