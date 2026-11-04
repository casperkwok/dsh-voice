import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  VOICE_DEFAULTS,
  type CloudProfile,
  type CloudTtsProvider,
  type VoiceSettings,
} from '../shared/settings.ts'

const SETTINGS_KEYS: (keyof VoiceSettings)[] = [
  'modelsDir',
  'ttsMode',
  'ttsProvider',
  'ttsSid',
  'ttsThreads',
  'ttsSpeed',
  'silenceMs',
  'basePath',
  'cloudProvider',
  'cloudProfiles',
]

const CLOUD_PROVIDERS: CloudTtsProvider[] = ['minimax', 'volc', 'dashscope']

export function settingsPath(): string {
  return process.env.DSH_VOICE_SETTINGS ?? join(homedir(), '.dsh-voice', 'settings.json')
}

function profile(raw: unknown, base: CloudProfile): CloudProfile {
  if (!raw || typeof raw !== 'object') return { ...base }
  const input = raw as Record<string, unknown>
  const out = { ...base }
  for (const key of ['apiKey', 'endpoint', 'resourceId', 'groupId', 'voice', 'model'] as const) {
    if (typeof input[key] === 'string') out[key] = input[key]
  }
  if (Number.isFinite(input.speed)) out.speed = Math.min(2, Math.max(0.5, Number(input.speed)))
  return out
}

function coerce(raw: unknown): Partial<VoiceSettings> {
  if (!raw || typeof raw !== 'object') return {}
  const input = raw as Record<string, unknown>
  const out: Partial<VoiceSettings> = {}
  if (typeof input.modelsDir === 'string') out.modelsDir = input.modelsDir
  if (input.ttsMode === 'local' || input.ttsMode === 'cloud') out.ttsMode = input.ttsMode
  if (
    input.ttsProvider === 'auto' ||
    input.ttsProvider === 'matcha' ||
    input.ttsProvider === 'kokoro' ||
    input.ttsProvider === 'vits'
  ) {
    out.ttsProvider = input.ttsProvider
  }
  if (Number.isFinite(input.ttsSid)) out.ttsSid = Math.min(52, Math.max(0, Number(input.ttsSid)))
  if (Number.isFinite(input.ttsThreads)) {
    out.ttsThreads = Math.min(8, Math.max(1, Math.round(Number(input.ttsThreads))))
  }
  if (Number.isFinite(input.ttsSpeed)) {
    out.ttsSpeed = Math.min(2, Math.max(0.5, Number(input.ttsSpeed)))
  }
  if (Number.isFinite(input.silenceMs)) {
    out.silenceMs = Math.min(2000, Math.max(200, Math.round(Number(input.silenceMs))))
  }
  if (CLOUD_PROVIDERS.includes(input.cloudProvider as CloudTtsProvider)) {
    out.cloudProvider = input.cloudProvider as CloudTtsProvider
  }
  const profiles: Partial<Record<CloudTtsProvider, CloudProfile>> = {}
  if (input.cloudProfiles && typeof input.cloudProfiles === 'object') {
    const rawProfiles = input.cloudProfiles as Record<string, unknown>
    for (const provider of CLOUD_PROVIDERS) {
      if (rawProfiles[provider]) profiles[provider] = profile(rawProfiles[provider], VOICE_DEFAULTS.cloudProfiles[provider])
    }
  }
  // Migrate the old flat cloud fields once.
  if (!input.cloudProfiles && CLOUD_PROVIDERS.includes(input.cloudProvider as CloudTtsProvider)) {
    const provider = input.cloudProvider as CloudTtsProvider
    profiles[provider] = profile(
      {
        apiKey: input.cloudApiKey,
        endpoint: input.cloudEndpoint,
        resourceId: input.cloudResourceId,
        groupId: input.cloudGroupId,
        voice: input.cloudVoice,
        model: input.cloudModel,
        speed: input.cloudSpeed,
      },
      VOICE_DEFAULTS.cloudProfiles[provider],
    )
  }
  if (Object.keys(profiles).length) out.cloudProfiles = profiles as VoiceSettings['cloudProfiles']
  return out
}

export function loadSettings(): VoiceSettings {
  let file: Partial<VoiceSettings> = {}
  const path = settingsPath()
  if (existsSync(path)) {
    try {
      file = coerce(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      // A corrupt settings file falls back to defaults; the card rewrites it.
    }
  }
  const env: Partial<VoiceSettings> = {}
  if (process.env.DSH_VOICE_MODELS) env.modelsDir = process.env.DSH_VOICE_MODELS
  if (process.env.DSH_VOICE_TTS_SID) env.ttsSid = Number(process.env.DSH_VOICE_TTS_SID)
  if (process.env.DSH_VOICE_TTS_THREADS) env.ttsThreads = Number(process.env.DSH_VOICE_TTS_THREADS)
  if (process.env.DSH_VOICE_SILENCE_MS) env.silenceMs = Number(process.env.DSH_VOICE_SILENCE_MS)
  const profiles = {
    minimax: { ...VOICE_DEFAULTS.cloudProfiles.minimax, ...file.cloudProfiles?.minimax },
    volc: { ...VOICE_DEFAULTS.cloudProfiles.volc, ...file.cloudProfiles?.volc },
    dashscope: { ...VOICE_DEFAULTS.cloudProfiles.dashscope, ...file.cloudProfiles?.dashscope },
  }
  return { ...VOICE_DEFAULTS, ...file, ...env, cloudProfiles: profiles }
}

export function saveSettings(patch: unknown): VoiceSettings {
  const current = loadSettings()
  const input = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}
  const coerced = coerce(input)
  const next: VoiceSettings = { ...current, ...coerced }
  const rawProfiles =
    input.cloudProfiles && typeof input.cloudProfiles === 'object'
      ? (input.cloudProfiles as Record<string, unknown>)
      : {}

  for (const provider of CLOUD_PROVIDERS) {
    const raw = rawProfiles[provider] as Record<string, unknown> | undefined
    const candidate = coerced.cloudProfiles?.[provider] ?? current.cloudProfiles[provider]
    next.cloudProfiles[provider] = {
      ...current.cloudProfiles[provider],
      ...candidate,
      // Blank key means keep the secret; the UI never receives it.
      apiKey:
        raw && typeof raw.apiKey === 'string' && raw.apiKey.trim()
          ? raw.apiKey.trim()
          : current.cloudProfiles[provider].apiKey,
    }
  }

  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  const payload: Record<string, unknown> = {}
  for (const key of SETTINGS_KEYS) payload[key] = next[key]
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return next
}
