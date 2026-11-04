export type TtsMode = 'local' | 'cloud'
export type LocalTtsProvider = 'auto' | 'matcha' | 'kokoro' | 'vits'
export type CloudTtsProvider = 'minimax' | 'volc' | 'dashscope'

export interface VoiceSettings {
  /** Models directory. Empty means ~/.cache/dsh-voice/models. */
  modelsDir: string
  ttsMode: TtsMode
  /** Preferred local TTS. */
  ttsProvider: LocalTtsProvider
  /** Kokoro voice id. 45–48 female, 49–52 male. */
  ttsSid: number
  ttsThreads: number
  /** Local speed multiplier. */
  ttsSpeed: number
  /** Silence that ends a user turn, in milliseconds. */
  silenceMs: number
  /** Local WebSocket path. Fixed to keep the client bundle stable. */
  basePath: string

  /** Cloud TTS provider. */
  cloudProvider: CloudTtsProvider
  /** Secret. Never returned to the client in full. */
  cloudApiKey: string
  /** MiniMax Group ID / Volc resource id / DashScope workspace. */
  cloudResourceId: string
  cloudGroupId: string
  cloudVoice: string
  cloudModel: string
  cloudEndpoint: string
  cloudSpeed: number
}

export interface PublicVoiceSettings extends Omit<VoiceSettings, 'cloudApiKey'> {
  hasCloudApiKey: boolean
  cloudApiKeyMasked: string
}

export const VOICE_DEFAULTS: VoiceSettings = {
  modelsDir: '',
  ttsMode: 'local',
  ttsProvider: 'kokoro',
  ttsSid: 47,
  ttsThreads: 4,
  ttsSpeed: 1,
  silenceMs: 900,
  basePath: '/voice',

  cloudProvider: 'minimax',
  cloudApiKey: '',
  cloudResourceId: '',
  cloudGroupId: '',
  cloudVoice: 'female-shaonv',
  cloudModel: 'speech-02-hd',
  cloudEndpoint: 'https://api.minimax.io',
  cloudSpeed: 1,
}

export function publicSettings(settings: VoiceSettings): PublicVoiceSettings {
  const { cloudApiKey, ...rest } = settings
  return {
    ...rest,
    hasCloudApiKey: cloudApiKey.length > 0,
    cloudApiKeyMasked: cloudApiKey ? `••••${cloudApiKey.slice(-4)}` : '',
  }
}
