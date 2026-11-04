import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from '../../src/host/settings-store.ts'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-voice-settings-'))
  process.env.DSH_VOICE_SETTINGS = join(dir, 'settings.json')
})

afterEach(() => {
  delete process.env.DSH_VOICE_SETTINGS
  rmSync(dir, { recursive: true, force: true })
})

describe('settings store', () => {
  it('loads defaults when the file is absent', () => {
    expect(loadSettings().silenceMs).toBe(900)
    expect(loadSettings().ttsProvider).toBe('auto')
  })

  it('persists and clamps values', () => {
    const saved = saveSettings({ silenceMs: 5000, ttsSid: 999, ttsThreads: 0 })
    expect(saved.silenceMs).toBe(2000)
    expect(saved.ttsSid).toBe(52)
    expect(saved.ttsThreads).toBe(1)
    expect(loadSettings().silenceMs).toBe(2000)
  })
})
