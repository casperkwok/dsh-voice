import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VOICE_DEFAULTS, type VoiceSettings } from '../../src/shared/settings.ts'
import { ensureModels, modelFiles, modelStatus, KOKORO_FP32_DIR } from '../../src/host/models.ts'

const roots: string[] = []

function settings(patch: Partial<VoiceSettings>): VoiceSettings {
  return { ...VOICE_DEFAULTS, ...patch }
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

describe('local model plan', () => {
  it('does not require a TTS model in cloud mode', () => {
    const files = modelFiles(settings({ ttsMode: 'cloud' }), '/models')
    expect(files.map((file) => file.phase)).toEqual(['asr', 'asr', 'asr', 'asr', 'vad'])
  })

  it('downloads Kokoro fp32 for the default local provider', () => {
    const files = modelFiles(settings({ ttsMode: 'local', ttsProvider: 'kokoro' }), '/models')
    expect(files.filter((file) => file.phase === 'tts')).toHaveLength(5)
    expect(files.some((file) => file.relativePath.includes(KOKORO_FP32_DIR))).toBe(true)
  })

  it('prefers ModelScope and keeps Hugging Face as a fallback', () => {
    const previous = process.env.DSH_VOICE_MODEL_SOURCE
    delete process.env.DSH_VOICE_MODEL_SOURCE
    try {
      const files = modelFiles(settings({ ttsMode: 'local', ttsProvider: 'kokoro' }), '/models')
      const asr = files.find((file) => file.phase === 'asr')
      expect(asr?.locations[0]?.source).toBe('modelscope')
      expect(asr?.locations[1]?.source).toBe('huggingface')
      expect(asr?.locations[0]?.sha256).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      if (previous === undefined) delete process.env.DSH_VOICE_MODEL_SOURCE
      else process.env.DSH_VOICE_MODEL_SOURCE = previous
    }
  })

  it('downloads only the selected TTS family', () => {
    const files = modelFiles(settings({ ttsMode: 'local', ttsProvider: 'matcha' }), '/models')
    expect(files.some((file) => file.relativePath.includes('matcha-icefall-zh-en'))).toBe(true)
    expect(files.some((file) => file.relativePath.includes(KOKORO_FP32_DIR))).toBe(false)
  })

  it('reports missing files before a download', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-voice-models-'))
    roots.push(root)
    const status = modelStatus(settings({ ttsMode: 'local', ttsProvider: 'kokoro' }), root)
    expect(status.ready).toBe(false)
    expect(status.missing.length).toBeGreaterThan(0)
  })

  it('reports ready once the planned files exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-voice-models-'))
    roots.push(root)
    const plan = modelFiles(settings({ ttsMode: 'local', ttsProvider: 'kokoro' }), root)
    for (const file of plan) {
      const path = join(root, file.relativePath)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'x')
    }
    const status = modelStatus(settings({ ttsMode: 'local', ttsProvider: 'kokoro' }), root)
    expect(status.ready).toBe(true)
  })

  it('downloads missing files and reports progress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-voice-models-'))
    roots.push(root)
    writeFileSync(join(root, 'silero_vad.onnx'), 'x')

    const server = createServer((_req, res) => {
      const body = Buffer.from('model-bytes')
      res.writeHead(200, { 'content-length': body.length, 'content-type': 'application/octet-stream' })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no test server address')
    const previousEndpoint = process.env.MODELSCOPE_ENDPOINT
    const previousSource = process.env.DSH_VOICE_MODEL_SOURCE
    process.env.MODELSCOPE_ENDPOINT = `http://127.0.0.1:${address.port}`
    process.env.DSH_VOICE_MODEL_SOURCE = 'modelscope'
    const progress: string[] = []
    try {
      const config = settings({ ttsMode: 'local', ttsProvider: 'kokoro' })
      await ensureModels(root, config, {
        onProgress: (item) => progress.push(item.label),
        verify: false,
      })
      expect(modelStatus(config, root).ready).toBe(true)
      expect(readFileSync(join(root, KOKORO_FP32_DIR, 'model.onnx'), 'utf8')).toBe('model-bytes')
      expect(progress.some((label) => label === '语音模型已就绪')).toBe(true)
    } finally {
      if (previousEndpoint === undefined) delete process.env.MODELSCOPE_ENDPOINT
      else process.env.MODELSCOPE_ENDPOINT = previousEndpoint
      if (previousSource === undefined) delete process.env.DSH_VOICE_MODEL_SOURCE
      else process.env.DSH_VOICE_MODEL_SOURCE = previousSource
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('falls back to Hugging Face when ModelScope fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-voice-models-'))
    roots.push(root)
    writeFileSync(join(root, 'silero_vad.onnx'), 'x')

    const server = createServer((req, res) => {
      if ((req.url ?? '').startsWith('/models/')) {
        res.writeHead(503)
        res.end('unavailable')
        return
      }
      const body = Buffer.from('model-bytes')
      res.writeHead(200, { 'content-length': body.length })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no test server address')
    const base = `http://127.0.0.1:${address.port}`
    const previous = {
      ms: process.env.MODELSCOPE_ENDPOINT,
      hf: process.env.HF_ENDPOINT,
      source: process.env.DSH_VOICE_MODEL_SOURCE,
    }
    process.env.MODELSCOPE_ENDPOINT = base
    process.env.HF_ENDPOINT = base
    delete process.env.DSH_VOICE_MODEL_SOURCE
    try {
      await ensureModels(root, settings({ ttsMode: 'local', ttsProvider: 'kokoro' }), {
        verify: false,
      })
      expect(readFileSync(join(root, KOKORO_FP32_DIR, 'model.onnx'), 'utf8')).toBe('model-bytes')
    } finally {
      if (previous.ms === undefined) delete process.env.MODELSCOPE_ENDPOINT
      else process.env.MODELSCOPE_ENDPOINT = previous.ms
      if (previous.hf === undefined) delete process.env.HF_ENDPOINT
      else process.env.HF_ENDPOINT = previous.hf
      if (previous.source === undefined) delete process.env.DSH_VOICE_MODEL_SOURCE
      else process.env.DSH_VOICE_MODEL_SOURCE = previous.source
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

})
