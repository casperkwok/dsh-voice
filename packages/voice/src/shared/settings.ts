export type TtsMode = 'local' | 'cloud'
export type LocalTtsProvider = 'auto' | 'matcha' | 'kokoro' | 'vits'
export type CloudTtsProvider = 'minimax' | 'volc' | 'dashscope'

export interface CloudProfile {
  /** Secret. Never returned to the client in full. */
  apiKey: string
  endpoint: string
  resourceId: string
  groupId: string
  voice: string
  model: string
  speed: number
}

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

  cloudProvider: CloudTtsProvider
  cloudProfiles: Record<CloudTtsProvider, CloudProfile>
}

export interface PublicCloudProfile extends Omit<CloudProfile, 'apiKey'> {
  hasApiKey: boolean
  apiKeyMasked: string
}

export interface PublicVoiceSettings extends Omit<VoiceSettings, 'cloudProfiles'> {
  cloudProfiles: Record<CloudTtsProvider, PublicCloudProfile>
}

const emptyProfile = (): CloudProfile => ({
  apiKey: '',
  endpoint: '',
  resourceId: '',
  groupId: '',
  voice: '',
  model: '',
  speed: 1,
})

export const VOICE_DEFAULTS: VoiceSettings = {
  modelsDir: '',
  ttsMode: 'local',
  ttsProvider: 'kokoro',
  ttsSid: 47,
  ttsThreads: 4,
  ttsSpeed: 1,
  silenceMs: 900,
  basePath: '/voice',

  cloudProvider: 'volc',
  cloudProfiles: {
    minimax: {
      ...emptyProfile(),
      endpoint: 'https://api.minimax.io',
      voice: 'female-shaonv',
      model: 'speech-02-hd',
    },
    volc: {
      ...emptyProfile(),
      resourceId: 'seed-tts-2.0',
      voice: 'zh_female_xiaohe_uranus_bigtts',
    },
    dashscope: {
      ...emptyProfile(),
      endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      voice: 'Cherry',
      model: 'qwen3-tts-flash',
    },
  },
}

export function cloudProfile(settings: VoiceSettings): CloudProfile {
  return settings.cloudProfiles[settings.cloudProvider]
}

export function publicSettings(settings: VoiceSettings): PublicVoiceSettings {
  const { cloudProfiles, ...rest } = settings
  return {
    ...rest,
    cloudProfiles: {
      minimax: mask(cloudProfiles.minimax),
      volc: mask(cloudProfiles.volc),
      dashscope: mask(cloudProfiles.dashscope),
    },
  }
}

function mask(profile: CloudProfile): PublicCloudProfile {
  const { apiKey, ...rest } = profile
  return {
    ...rest,
    hasApiKey: apiKey.length > 0,
    apiKeyMasked: apiKey ? `••••${apiKey.slice(-4)}` : '',
  }
}
