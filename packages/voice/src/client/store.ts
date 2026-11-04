import { useSyncExternalStore } from 'react'
import type { VoiceState } from '../shared/protocol.ts'

export interface VoiceUiState {
  active: boolean
  sessionId: string | null
  status: VoiceState
  partial: string
  final: string
  caption: string
  error: string | null
  provider: string
}

const initial: VoiceUiState = {
  active: false,
  sessionId: null,
  status: 'idle',
  partial: '',
  final: '',
  caption: '',
  error: null,
  provider: '',
}

let state = initial
const listeners = new Set<() => void>()

export function setVoiceState(patch: Partial<VoiceUiState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function getVoiceState(): VoiceUiState {
  return state
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useVoiceState(): VoiceUiState {
  return useSyncExternalStore(subscribe, getVoiceState, getVoiceState)
}

export function resetVoiceState(): void {
  state = { ...initial }
  for (const listener of listeners) listener()
}
