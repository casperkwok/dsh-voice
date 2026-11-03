export interface VoiceSettings {
  /** Models directory. Empty means ~/.cache/dsh-voice/models. */
  modelsDir: string
  /** Preferred TTS: auto picks Matcha, then Kokoro, then VITS. */
  ttsProvider: 'auto' | 'matcha' | 'kokoro' | 'vits'
  /** Kokoro voice id. 45–48 female, 49–52 male. */
  ttsSid: number
  ttsThreads: number
  /** Silence that ends a user turn, in milliseconds. */
  silenceMs: number
  /** Local WebSocket path. Fixed to keep the client bundle stable. */
  basePath: string
}

export const VOICE_DEFAULTS: VoiceSettings = {
  modelsDir: '',
  ttsProvider: 'auto',
  ttsSid: 47,
  ttsThreads: 4,
  silenceMs: 600,
  basePath: '/voice',
}
