/**
 * Local model discovery and first-run download.
 *
 * The plugin never downloads models at import time. `VoiceEngine.init()` calls
 * `ensureModels()` when the user first opens the voice UI or asks for a
 * preview, so installing the plugin does not silently pull a gigabyte of
 * weights.
 *
 * ModelScope is the first source because it is reachable from mainland China.
 * Hugging Face and GitHub Releases remain fallbacks. Downloads resume from
 * per-source `.part` files and are checked against the SHA256 values returned
 * by the ModelScope repository, so a mirror serving a different revision is
 * rejected instead of loaded.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VoiceSettings } from '../shared/settings.ts'

export type ModelPhase = 'asr' | 'vad' | 'tts'
export type ModelSource = 'modelscope' | 'huggingface' | 'github'

export interface ModelLocation {
  source: ModelSource
  url: string
  sha256?: string
}

export interface ModelFile {
  phase: ModelPhase
  /** Human label used by the settings page and voice caption. */
  label: string
  /** Path relative to the models directory. */
  relativePath: string
  locations: ModelLocation[]
}

export interface ModelProgress {
  phase: ModelPhase
  label: string
  file: string
  source?: ModelSource
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

const SOURCE_LABELS: Record<ModelSource, string> = {
  modelscope: '魔搭',
  huggingface: 'Hugging Face',
  github: 'GitHub',
}

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

function modelscopeHost(): string {
  return (process.env.MODELSCOPE_ENDPOINT || 'https://modelscope.cn').replace(/\/$/, '')
}

function sourceOrder(): ModelSource[] {
  const requested = (process.env.DSH_VOICE_MODEL_SOURCE || 'auto').toLowerCase()
  if (requested === 'huggingface' || requested === 'hf') {
    return ['huggingface', 'modelscope', 'github']
  }
  return ['modelscope', 'huggingface', 'github']
}

function hf(repoId: string, file: string): string {
  return `${modelHost()}/${repoId}/resolve/main/${file}`
}

function ms(repoId: string, file: string): string {
  return `${modelscopeHost()}/models/${repoId}/resolve/master/${file}`
}

function github(releasePath: string): string {
  return `https://github.com/k2-fsa/sherpa-onnx/releases/download/${releasePath}`
}

function ordered(
  locations: Partial<Record<ModelSource, { url: string; sha256?: string }>>,
): ModelLocation[] {
  return sourceOrder()
    .map((source) => {
      const location = locations[source]
      return location ? { source, ...location } : null
    })
    .filter((location): location is ModelLocation => location !== null)
}

const ASR_HASHES: Record<string, string> = {
  'tokens.txt': 'a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3',
  'encoder-epoch-99-avg-1.onnx': '709f0ed53a734b7942f170127e7547b566cb29c4afc5e67719f314c3d63ccb10',
  'decoder-epoch-99-avg-1.onnx': '2e3b5ec371f8899ee6acd829fd753ba45772df57a91bdf37cde3136354e7db7d',
  'joiner-epoch-99-avg-1.onnx': '5f2adc585dd1bec6421c8bb8660d2a73fc8b9ceb24491ef51399ba2a2f0fc31b',
}

function asrFiles(): ModelFile[] {
  return Object.entries(ASR_HASHES).map(([file, sha256]) => ({
    phase: 'asr' as const,
    label: '语音识别',
    relativePath: join(ASR_DIR, file),
    locations: ordered({
      modelscope: {
        url: ms('pengzhendong/sherpa-onnx-streaming-zipformer-bilingual-zh-en', file),
        sha256,
      },
      huggingface: {
        url: hf('csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20', file),
        sha256,
      },
    }),
  }))
}

function vadFiles(): ModelFile[] {
  return [
    {
      phase: 'vad' as const,
      label: '静音检测',
      relativePath: 'silero_vad.onnx',
      locations: ordered({
        modelscope: {
          url: ms('WEAAEW/silero-vad-onnx', 'v4-sherpa/silero_vad.onnx'),
          sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
        },
        github: {
          url: github('asr-models/silero_vad.onnx'),
          sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
        },
      }),
    },
  ]
}

const KOKORO_SHARED_HASHES: Record<string, string> = {
  'voices.bin': 'e64a5a581d8c2a350d848f51c3121657cd83aa07ed6109172177345874a7244c',
  'tokens.txt': '931ab2df2400cd65d580a22402024c2347ced8ae9ea300e545144b1aacc48e14',
  'lexicon-us-en.txt': '7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14',
}

function kokoroFiles(kind: 'fp32' | 'int8'): ModelFile[] {
  const dir = kind === 'fp32' ? KOKORO_FP32_DIR : KOKORO_INT8_DIR
  const model = kind === 'fp32' ? 'model.onnx' : 'model.int8.onnx'
  const hfRepo = `csukuangfj/${dir}`
  const msRepo = kind === 'fp32' ? 'finchxu/kokoro-multi-lang-v1_1' : 'liaowenbin/kokoro-int8-multi-lang-v1_1'
  const files: ModelFile[] = [
    {
      phase: 'tts',
      label: 'Kokoro 语音',
      relativePath: join(dir, model),
      locations: ordered({
        modelscope: {
          url: ms(msRepo, model),
          sha256:
            kind === 'fp32'
              ? 'acc4adc175b9d9986106cd20060329673ad5a2e12ef3c557d2d3745b694f8b38'
              : 'bda15858163726a492d02a9a727bc263551b86ac77f90812c4b30ff41d380e26',
        },
        huggingface: {
          url: hf(hfRepo, model),
          sha256:
            kind === 'fp32'
              ? '99db0bc8fd0c5033d249fe922db16768b71b4a6b26cfd93d206fbf66c76efb5f'
              : '05d793700b0b507f760c183c0e39bdd6a97b43d32fdc7bf7b54a5179f1b11222',
        },
      }),
    },
    ...['voices.bin', 'tokens.txt', 'lexicon-us-en.txt'].map((file) => ({
      phase: 'tts' as const,
      label: 'Kokoro 语音',
      relativePath: join(dir, file),
      locations: ordered({
        modelscope: { url: ms(msRepo, file), sha256: KOKORO_SHARED_HASHES[file] },
        huggingface: { url: hf(hfRepo, file), sha256: KOKORO_SHARED_HASHES[file] },
      }),
    })),
    {
      phase: 'tts',
      label: 'Kokoro 语音',
      relativePath: join(dir, 'lexicon-zh.txt'),
      locations: ordered({
        modelscope: {
          url: ms(msRepo, 'lexicon-zh.txt'),
          sha256: '11111d8cd695fba2ace1367a1d0a708b586e6ef5c1f9be91da5d7eef129b651c',
        },
        huggingface: {
          url: hf(hfRepo, 'lexicon-zh.txt'),
          sha256: 'fea060803db3e59193987f1a3436f56917bda09f3b3595b6588e46ae60cebf93',
        },
      }),
    },
  ]
  return files
}

const MATCHA_HASHES: Record<string, string> = {
  'model-steps-3.onnx': '524286bf6cf11be74329ae1c682ac69e34d6860c2ea9fd1290319d561540b16a',
  'tokens.txt': '77fee8e5e5dd96b3547119e6159292c648e99e065c54c97777722e3ce710b9a4',
  'lexicon.txt': '599efdcdaff4df2a123ce988c2cb90abcd59b919ef609ce36eb587d68b7ca2c0',
}

function matchaFiles(): ModelFile[] {
  const files = Object.entries(MATCHA_HASHES).map(([file, sha256]) => ({
    phase: 'tts' as const,
    label: 'Matcha 语音',
    relativePath: join(MATCHA_DIR, file),
    locations: ordered({
      modelscope: { url: ms('bujidc/matcha-icefall-zh-en', file), sha256 },
      huggingface: { url: hf('csukuangfj/matcha-icefall-zh-en', file), sha256 },
    }),
  }))
  files.push({
    phase: 'tts',
    label: 'Matcha 语音',
    relativePath: join(MATCHA_DIR, 'vocos-16khz-univ.onnx'),
    locations: ordered({
      modelscope: {
        url: ms('bujidc/matcha-icefall-zh-en', 'vocos-16khz-univ.onnx'),
        sha256: 'b599142a1fb8ff03de3e84ac35ff537c619e56f4267a6fe894851a42844acf9e',
      },
      github: {
        url: github('vocoder-models/vocos-16khz-univ.onnx'),
        sha256: 'b599142a1fb8ff03de3e84ac35ff537c619e56f4267a6fe894851a42844acf9e',
      },
    }),
  })
  return files
}

const VITS_HASHES: Record<string, string> = {
  'model.onnx': '6c349bdd73dc928234dd7bc86929748bba32cd5264d32d915bf7b7aa0595965b',
  'tokens.txt': '34b035b9aeb070df6188b022f29c00e0e142c7ade9f25611ced65db5e9cc8402',
  'lexicon.txt': 'b3a82f16b286c424953dea3686039e7ab465fa8e15d87ef8abd0ec69175beb21',
  'date.fst': 'eb8aa079ae3cb81d8f4404992f39d61a0cb990947512b5b8d1e54d1f6980e718',
  'phone.fst': '1ac2b6fa56b1442320c4de7db08353bab8963a2b57f365eebcdd3a2d3562f8d7',
  'number.fst': '743f402181fcfebf76cc2f0546b71fa26476e626fbe4e460fb7b4c3a7a8bd5bd',
}

function vitsFiles(): ModelFile[] {
  return Object.entries(VITS_HASHES).map(([file, sha256]) => ({
    phase: 'tts' as const,
    label: 'VITS 语音',
    relativePath: join(VITS_DIR, file),
    locations: ordered({
      modelscope: { url: ms('liaowenbin/sherpa-onnx-vits-zh-ll', file), sha256 },
      huggingface: { url: hf('csukuangfj/sherpa-onnx-vits-zh-ll', file), sha256 },
    }),
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
  /** Tests use a local HTTP server whose bytes intentionally do not match the
   * repository hashes. Production callers leave this undefined. */
  verify?: boolean
}

async function hashFile(path: string, hash: ReturnType<typeof createHash>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', resolve)
      .on('error', reject)
  })
}

async function downloadLocation(
  file: ModelFile,
  location: ModelLocation,
  dest: string,
  options: DownloadOptions,
): Promise<void> {
  const tmp = `${dest}.part.${location.source}`
  let offset = existsSync(tmp) ? statSync(tmp).size : 0
  const open = (range: number): Promise<Response> =>
    fetch(location.url, {
      headers: range > 0 ? { range: `bytes=${range}-` } : {},
      redirect: 'follow',
    }).catch((err: unknown) => {
      throw new Error(
        `下载 ${file.label}（${SOURCE_LABELS[location.source]}）失败：${err instanceof Error ? err.message : String(err)}`,
      )
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
    throw new Error(`下载 ${file.label}（${SOURCE_LABELS[location.source]}）失败：HTTP ${response.status}`)
  }

  const length = Number(response.headers.get('content-length') || 0)
  const total = length + offset
  const out = createWriteStream(tmp, { flags: offset > 0 ? 'a' : 'w' })
  const hash = createHash('sha256')
  if (offset > 0) await hashFile(tmp, hash)
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
      source: location.source,
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
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
      emit(false)
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.on('error', reject)
    })
    const digest = hash.digest('hex')
    if (options.verify !== false && location.sha256 && digest !== location.sha256) {
      rmSync(tmp, { force: true })
      throw new Error(
        `下载 ${file.label}（${SOURCE_LABELS[location.source]}）校验失败：文件与仓库记录不一致`,
      )
    }
    renameSync(tmp, dest)
    emit(true)
  } catch (err) {
    out.destroy()
    throw err instanceof Error ? err : new Error(String(err))
  }
}

async function downloadFile(file: ModelFile, root: string, options: DownloadOptions): Promise<void> {
  const dest = join(root, file.relativePath)
  if (existsSync(dest) && statSync(dest).size > 0) return
  mkdirSync(dirname(dest), { recursive: true })

  let lastError: Error | null = null
  for (const location of file.locations) {
    try {
      await downloadLocation(file, location, dest, options)
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error(`没有可用的下载源：${file.label}`)
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
