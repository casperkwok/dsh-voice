/**
 * Host <-> client protocol types for the voice plugin.
 *
 * Keep this file dependency-free: both the host and client tsconfigs include it,
 * and it is the contract that survives host/client API churn.
 */

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted'

export interface VoiceStatusFrame {
  type: 'status'
  state: VoiceState
  sessionId: string
}

export interface VoicePartialFrame {
  type: 'partial'
  text: string
}

export interface VoiceFinalFrame {
  type: 'final'
  text: string
}

export interface VoiceAudioFrame {
  type: 'audio'
  /** base64 PCM16 little-endian */
  audio: string
  /** model-native sample rate; the client resamples with WebAudio */
  sampleRate: number
  sentenceId: number
  chunkId: number
  final: boolean
}

export interface VoiceBargeInFrame {
  type: 'barge-in'
}

export interface VoiceMetricsFrame {
  type: 'metrics'
  turnId: number
  ttsFirstChunkMs: number | null
  lastSpeechToFirstChunkMs: number | null
  vadEndpointDelayMs: number | null
}

export interface VoiceErrorFrame {
  type: 'error'
  code: string
  message: string
}

export interface VoiceConfigFrame {
  type: 'config'
  provider: string
  sampleRate: number
  inputSampleRate: 16000
  frameSamples: 320
}

export type VoiceServerFrame =
  | VoiceStatusFrame
  | VoicePartialFrame
  | VoiceFinalFrame
  | VoiceAudioFrame
  | VoiceBargeInFrame
  | VoiceMetricsFrame
  | VoiceErrorFrame
  | VoiceConfigFrame

export interface VoiceStartMessage {
  type: 'start'
  sessionId: string
}

export interface VoiceStopMessage {
  type: 'stop'
}

export type VoiceClientMessage = VoiceStartMessage | VoiceStopMessage
