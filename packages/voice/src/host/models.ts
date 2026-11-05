/**
 * Local model discovery and first-run download.
 *
 * The plugin never downloads models at import time. `VoiceEngine.init()` calls
 * `ensureModels()` when the user first opens the voice UI or asks for a
 * preview, so installing the plugin does not silently pull a gigabyte of
 * weights. Downloads resume from `.part` files and report progress through the
 * host WebSocket.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VoiceSettings } from '../shared/settings.ts'

export type ModelPhase = 'asr' | 'vad' | 'tts'

export interface ModelFile {
  phase: ModelPhase
  /** Human label used by the settings page and voice caption. */
  label: string
  /** Path relative to the models directory. */
  relativePath: string
  url: string
}

export interface ModelProgress {
  phase: ModelPhase
  label: string
  file: string
  received: number
  total: number
  percent: number
  done: boolean
  error?: string
}

export interface ModelStatus {
  modelsDir: string
  ready: boolean
  missing: string[]
  ttsModel: string
}

export const ASR_DIR = 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20'
export const MATCHA_DIR = 'matcha-icefall-zh-en'
export const KOKORO_FP32_DIR = 'kokoro-multi-lang-v1_1'
export const KOKORO_INT8_DIR = 'kokoro-int8-multi-lang-v1_1'
export const VITS_DIR = 'sherpa-onnx-vits-zh-ll'

export function resolveModelsDir(settings: VoiceSettings): string {
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

function modelHost(): string {
  return (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/$/, '')
}

function repo(repoId: string): string {
  return `${modelHost()}/${repoId}/resolve/main`
}

function asrFiles(): ModelFile[] {
  const base = repo('csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20')
  return ['tokens.txt', 'encoder-epoch-99-avg-1.onnx', 'decoder-epoch-99-avg-1.onnx', 'joiner-epoch-99-avg-1.onnx'].map(
    (file) => ({
      phase: 'asr' as const,
      label: '语音识别',
      relativePath: join(ASR_DIR, file),
      url: `${base}/${file}`,
    }),
  )
}

function vadFiles(): ModelFile[] {
  return [
    {
      phase: 'vad',
      label: '静音检测',
      relativePath: 'silero_vad.onnx',
      // The VAD release is hosted on GitHub, not Hugging Face. It is small
      // enough that a mirror is rarely needed.
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    },
  ]
}

function kokoroFiles(kind: 'fp32' | 'int8'): ModelFile[] {
  const dir = kind === 'fp32' ? KOKORO_FP32_DIR : KOKORO_INT8_DIR
  const base = repo(`csukuangfj/${dir}`)
  const files = [
    kind === 'fp32' ? 'model.onnx' : 'model.int8.onnx',
    'voices.bin',
    'tokens.txt',
    'lexicon-us-en.txt',
    'lexicon-zh.txt',
  ]
  return files.map((file) => ({
    phase: 'tts' as const,
    label: 'Kokoro 语音',
    relativePath: join(dir, file),
    url: `${base}/${file}`,
  }))
}

function matchaFiles(): ModelFile[] {
  const base = repo('csukuangfj/matcha-icefall-zh-en')
  const files = ['model-steps-3.onnx', 'tokens.txt', 'lexicon.txt']
  const out: ModelFile[] = files.map((file) => ({
    phase: 'tts' as const,
    label: 'Matcha 语音',
    relativePath: join(MATCHA_DIR, file),
    url: `${base}/${file}`,
  }))
  out.push({
    phase: 'tts',
    label: 'Matcha 语音',
    relativePath: join(MATCHA_DIR, 'vocos-16khz-univ.onnx'),
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-16khz-univ.onnx',
  })
  return out
}

function vitsFiles(): ModelFile[] {
  const base = repo('csukuangfj/sherpa-onnx-vits-zh-ll')
  return ['model.onnx', 'tokens.txt', 'lexicon.txt', 'date.fst', 'phone.fst', 'number.fst'].map((file) => ({
    phase: 'tts' as const,
    label: 'VITS 语音',
    relativePath: join(VITS_DIR, file),
    url: `${base}/${file}`,
  }))
}

function hasAll(files: ModelFile[], root: string): boolean {
  return files.every((file) => {
    const path = join(root, file.relativePath)
    return existsSync(path) && statSync(path).size > 0
  })
}

/** Pick the files needed by the current settings. */
export function modelFiles(settings: VoiceSettings, root = resolveModelsDir(settings)): ModelFile[] {
  const files = [...asrFiles(), ...vadFiles()]
  if (settings.ttsMode === 'cloud') return files

  if (settings.ttsProvider === 'matcha') {
    files.push(...matchaFiles())
    return files
  }
  if (settings.ttsProvider === 'vits') {
    files.push(...vitsFiles())
    return files
  }

  // Kokoro and auto both prefer fp32, matching VoiceEngine's load order. If an
  // existing int8 install is complete, use it instead of downloading fp32.
  if (!hasAll(kokoroFiles('fp32'), root) && hasAll(kokoroFiles('int8'), root)) {
    files.push(...kokoroFiles('int8'))
  } else {
    files.push(...kokoroFiles('fp32'))
  }
  return files
}

export function modelStatus(settings: VoiceSettings, modelsDir = resolveModelsDir(settings)): ModelStatus {
  const files = modelFiles(settings, modelsDir)
  const missing = files
    .filter((file) => {
      const path = join(modelsDir, file.relativePath)
      return !existsSync(path) || statSync(path).size === 0
    })
    .map((file) => file.relativePath)
  const tts = files.find((file) => file.phase === 'tts')
  return {
    modelsDir,
    ready: missing.length === 0,
    missing,
    ttsModel: tts ? tts.label : '云端语音',
  }
}

interface DownloadOptions {
  onProgress?: (progress: ModelProgress) => void
}

async function downloadFile(file: ModelFile, root: string, options: DownloadOptions): Promise<void> {
  const dest = join(root, file.relativePath)
  if (existsSync(dest) && statSync(dest).size > 0) return
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  let offset = existsSync(tmp) ? statSync(tmp).size : 0

  const open = (range: number): Promise<Response> =>
    fetch(file.url, {
      headers: range > 0 ? { range: `bytes=${range}-` } : {},
      redirect: 'follow',
    }).catch((err: unknown) => {
      throw new Error(`下载 ${file.label} 失败：${err instanceof Error ? err.message : String(err)}`)
    })

  let response = await open(offset)
  // Some mirrors ignore Range and reply 200. Drop the partial file rather than
  // appending a second copy of the model.
  if (offset > 0 && response.status === 200) {
    rmSync(tmp, { force: true })
    offset = 0
  }
  if (offset > 0 && response.status === 416) {
    rmSync(tmp, { force: true })
    offset = 0
    response = await open(0)
  }
  if (!response.ok || !response.body) {
    throw new Error(`下载 ${file.label} 失败：HTTP ${response.status}`)
  }
  const length = Number(response.headers.get('content-length') || 0)
  const total = length + offset
  const out = createWriteStream(tmp, { flags: offset > 0 ? 'a' : 'w' })
  let received = offset
  let lastEmit = 0

  const emit = (done: boolean): void => {
    const now = Date.now()
    if (!done && now - lastEmit < 250) return
    lastEmit = now
    options.onProgress?.({
      phase: file.phase,
      label: file.label,
      file: file.relativePath,
      received,
      total,
      percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
      done,
    })
  }

  try {
    emit(false)
    for await (const chunk of response.body) {
      received += chunk.length
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
      emit(false)
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.on('error', reject)
    })
    renameSync(tmp, dest)
    emit(true)
  } catch (err) {
    out.destroy()
    throw new Error(`下载 ${file.label} 失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

let active: { key: string; promise: Promise<void> } | null = null

/**
 * Ensure every file required by the current settings exists. Concurrent calls
 * for the same models directory share one download.
 */
export async function ensureModels(
  modelsDir: string,
  settings: VoiceSettings,
  options: DownloadOptions = {},
): Promise<void> {
  const files = modelFiles(settings, modelsDir)
  const missing = files.filter((file) => {
    const path = join(modelsDir, file.relativePath)
    return !existsSync(path) || statSync(path).size === 0
  })
  if (!missing.length) return

  const key = `${modelsDir}:${missing.map((file) => file.relativePath).join(',')}`
  if (active?.key === key) return active.promise
  if (active) await active.promise.catch(() => {})
  if (active?.key === key) return active.promise

  const promise = (async () => {
    mkdirSync(modelsDir, { recursive: true })
    for (const file of missing) await downloadFile(file, modelsDir, options)
    options.onProgress?.({
      phase: 'tts',
      label: '语音模型已就绪',
      file: '',
      received: 0,
      total: 0,
      percent: 100,
      done: true,
    })
  })()
  active = { key, promise }
  try {
    await promise
  } finally {
    if (active.promise === promise) active = null
  }
}
