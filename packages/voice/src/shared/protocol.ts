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

export interface VoiceAudioFrame {
  type: 'audio'
  /** base64 PCM/MP3 chunk */
  audio: string
  mime: string
  sentenceId: number
  chunkId: number
  final: boolean
}

export type VoiceFrame = VoiceStatusFrame | VoicePartialFrame | VoiceAudioFrame
