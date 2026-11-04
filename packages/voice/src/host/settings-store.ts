import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { VOICE_DEFAULTS, type VoiceSettings } from '../shared/settings.ts'

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
  'cloudApiKey',
  'cloudResourceId',
  'cloudGroupId',
  'cloudVoice',
  'cloudModel',
  'cloudEndpoint',
  'cloudSpeed',
]

export function settingsPath(): string {
  return process.env.DSH_VOICE_SETTINGS ?? join(homedir(), '.dsh-voice', 'settings.json')
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
  if (
    input.cloudProvider === 'minimax' ||
    input.cloudProvider === 'volc' ||
    input.cloudProvider === 'dashscope'
  ) {
    out.cloudProvider = input.cloudProvider
  }
  for (const key of ['cloudApiKey', 'cloudResourceId', 'cloudGroupId', 'cloudVoice', 'cloudModel', 'cloudEndpoint'] as const) {
    if (typeof input[key] === 'string') out[key] = input[key]
  }
  if (Number.isFinite(input.cloudSpeed)) {
    out.cloudSpeed = Math.min(2, Math.max(0.5, Number(input.cloudSpeed)))
  }
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
  return { ...VOICE_DEFAULTS, ...file, ...env }
}

export function saveSettings(patch: unknown): VoiceSettings {
  const current = loadSettings()
  const input = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}
  const next = { ...current, ...coerce(input) }
  // An empty key means "keep the current secret"; the UI never receives it.
  if (typeof input.cloudApiKey === 'string' && input.cloudApiKey.trim()) {
    next.cloudApiKey = input.cloudApiKey.trim()
  } else {
    next.cloudApiKey = current.cloudApiKey
  }

  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  const payload: Record<string, unknown> = {}
  for (const key of SETTINGS_KEYS) payload[key] = next[key]
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return next
}
