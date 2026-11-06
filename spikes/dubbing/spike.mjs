#!/usr/bin/env node
/**
 * Phase 0 spike: script -> multi-role audio.
 *
 * This deliberately avoids DSH, cloud TTS and ffmpeg. It proves the smallest
 * useful workflow with the local Kokoro model already in .models:
 *
 *   parse roles -> assign voices -> synthesize each line -> mix + per-role
 *   tracks + SRT + timing report.
 *
 * Run:
 *   node spikes/dubbing/spike.mjs
 *   node spikes/dubbing/spike.mjs --script spikes/dubbing/scripts/short-drama.txt
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const require = createRequire(join(REPO, 'packages/voice/package.json'))
const MODELS = process.env.DSH_VOICE_MODELS || join(REPO, '.models')
const KOKORO = join(MODELS, 'kokoro-multi-lang-v1_1')
const OUT_ROOT = join(HERE, 'out')
const SAMPLE_RATE = 24000

function loadSherpa() {
  const sherpaPath = require.resolve('sherpa-onnx-node')
  const platformDir = join(
    dirname(sherpaPath),
    'node_modules',
    `sherpa-onnx-${process.platform}-${process.arch}`,
  )
  const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH'
  process.env[key] = `${platformDir}:${process.env[key] ?? ''}`
  return require('sherpa-onnx-node')
}

const sherpa = loadSherpa()

// A fixed casting table keeps the spike deterministic. Unknown roles fall back
// to the next voice id in the list.
const ROLE_VOICES = {
  林夏: 47,
  陈默: 49,
  小满: 48,
  旁白: 45,
  主持人: 47,
  讲师: 50,
  叙述: 45,
}
const FALLBACK_VOICES = [47, 49, 48, 50, 45, 46, 51, 52]
const ROLE_SPEEDS = {
  旁白: 0.96,
  讲师: 0.98,
  主持人: 1,
}

function loadTts() {
  const model = join(KOKORO, 'model.onnx')
  const voices = join(KOKORO, 'voices.bin')
  const tokens = join(KOKORO, 'tokens.txt')
  const lexicon = `${join(KOKORO, 'lexicon-us-en.txt')},${join(KOKORO, 'lexicon-zh.txt')}`
  if (!existsSync(model) || !existsSync(voices) || !existsSync(tokens)) {
    throw new Error(`Kokoro model not found at ${KOKORO}; run scripts/install-models.mjs`)
  }
  return new sherpa.OfflineTts({
    model: {
      kokoro: { model, voices, tokens, lexicon },
      debug: 0,
      numThreads: 4,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  })
}

function parseScript(text) {
  const segments = []
  const roleNames = []
  let scene = 1
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^##\s*/.test(line)) {
      scene += 1
      continue
    }
    const match = line.match(/^([^：:]{1,16})[：:]\s*(.+)$/)
    const roleName = match ? match[1].trim() : '旁白'
    let speech = match ? match[2].trim() : line
    let emotion = ''
    const parenthetical = speech.match(/^[（(]([^）)]{1,20})[）)]\s*/)
    if (parenthetical) {
      emotion = parenthetical[1].trim()
      speech = speech.slice(parenthetical[0].length).trim()
    }
    if (!speech) continue
    if (!roleNames.includes(roleName)) roleNames.push(roleName)
    segments.push({ scene, roleName, text: speech, emotion })
  }
  const roles = new Map()
  roleNames.forEach((name, index) => {
    const explicit = ROLE_VOICES[name]
    const sid = explicit ?? FALLBACK_VOICES[index % FALLBACK_VOICES.length]
    roles.set(name, { name, sid, speed: ROLE_SPEEDS[name] ?? 1 })
  })
  return { segments, roles: [...roles.values()] }
}

function encodeWav(samples, sampleRate) {
  const data = Buffer.alloc(44 + samples.length * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + samples.length * 2, 4)
  data.write('WAVE', 8)
  data.write('fmt ', 12)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(sampleRate, 24)
  data.writeUInt32LE(sampleRate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
  }
  return data
}

function srtTime(ms) {
  const value = Math.max(0, Math.round(ms))
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.floor((value % 3_600_000) / 60_000)
  const seconds = Math.floor((value % 60_000) / 1000)
  const millis = value % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

function safeName(value, index) {
  return `${String(index + 1).padStart(2, '0')}-${value.replace(/[\\/:*?"<>|]/g, '_')}`
}

function synthesize(tts, scriptPath) {
  const text = readFileSync(scriptPath, 'utf8')
  const { segments, roles } = parseScript(text)
  if (!segments.length) throw new Error(`no segments in ${scriptPath}`)
  const roleMap = new Map(roles.map((role) => [role.name, role]))
  const outDir = join(OUT_ROOT, safeName(scriptPath.split('/').pop().replace(/\.txt$/, ''), 0).replace(/^01-/, ''))
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(join(outDir, 'tracks'), { recursive: true })

  const startedAt = performance.now()
  const results = []
  let previousScene = segments[0].scene
  for (const [index, segment] of segments.entries()) {
    const role = roleMap.get(segment.roleName)
    const t0 = performance.now()
    const audio = tts.generate({
      text: segment.text,
      generationConfig: new sherpa.GenerationConfig({
        sid: role.sid,
        speed: role.speed,
        silenceScale: 0.2,
      }),
    })
    const ttsMs = performance.now() - t0
    if (audio.sampleRate !== SAMPLE_RATE) {
      throw new Error(`expected ${SAMPLE_RATE}Hz from Kokoro, got ${audio.sampleRate}Hz`)
    }
    const samples = audio.samples
    const durationMs = (samples.length / audio.sampleRate) * 1000
    results.push({
      index,
      scene: segment.scene,
      role: segment.roleName,
      sid: role.sid,
      speed: role.speed,
      text: segment.text,
      emotion: segment.emotion,
      ttsMs: Math.round(ttsMs),
      durationMs: Math.round(durationMs),
      chars: segment.text.length,
      samples,
      sampleRate: audio.sampleRate,
      pauseBeforeMs: index === 0 ? 0 : segment.scene !== previousScene ? 800 : 250,
    })
    previousScene = segment.scene
    console.log(
      `[${String(index + 1).padStart(2, '0')}/${segments.length}] ${segment.roleName} · ${segment.text.slice(0, 24)} · ${Math.round(ttsMs)}ms · ${durationMs.toFixed(0)}ms`,
    )
  }

  let cursor = 0
  for (const result of results) {
    result.startMs = cursor + result.pauseBeforeMs
    result.endMs = result.startMs + result.durationMs
    cursor = result.endMs
  }
  const totalMs = cursor
  let totalSamples = 0
  for (const result of results) {
    const offset = Math.round((result.startMs / 1000) * SAMPLE_RATE)
    totalSamples = Math.max(totalSamples, offset + result.samples.length)
  }
  const mix = new Float32Array(totalSamples)
  const tracks = new Map()
  for (const role of roles) tracks.set(role.name, new Float32Array(totalSamples))

  for (const result of results) {
    const offset = Math.round((result.startMs / 1000) * SAMPLE_RATE)
    mix.set(result.samples, offset)
    const track = tracks.get(result.role)
    track.set(result.samples, offset)
  }

  const mixPath = join(outDir, 'mix.wav')
  writeFileSync(mixPath, encodeWav(mix, SAMPLE_RATE))
  for (const [roleName, samples] of tracks) {
    writeFileSync(join(outDir, 'tracks', `${safeName(roleName, 0).replace(/^01-/, '')}.wav`), encodeWav(samples, SAMPLE_RATE))
  }

  const srt = results
    .map((result, index) => `${index + 1}\n${srtTime(result.startMs)} --> ${srtTime(result.endMs)}\n${result.text}\n`)
    .join('\n')
  writeFileSync(join(outDir, 'captions.srt'), srt)

  const wallMs = performance.now() - startedAt
  const report = {
    script: scriptPath,
    audio: mixPath,
    roles: roles.map((role) => ({ name: role.name, sid: role.sid, speed: role.speed })),
    segments: results.map(({ samples: _samples, sampleRate: _sampleRate, ...rest }) => rest),
    summary: {
      segmentCount: results.length,
      charCount: results.reduce((sum, item) => sum + item.chars, 0),
      audioMs: Math.round(totalMs),
      wallMs: Math.round(wallMs),
      ttsMs: Math.round(results.reduce((sum, item) => sum + item.ttsMs, 0)),
      realTimeFactor: Number((results.reduce((sum, item) => sum + item.ttsMs, 0) / totalMs).toFixed(3)),
    },
  }
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

function scriptPaths() {
  const explicit = process.argv.indexOf('--script')
  if (explicit >= 0 && process.argv[explicit + 1]) return [resolve(process.argv[explicit + 1])]
  const dir = join(HERE, 'scripts')
  return readdirSync(dir)
    .filter((file) => file.endsWith('.txt'))
    .sort()
    .map((file) => join(dir, file))
}

const tts = loadTts()
const reports = scriptPaths().map((script) => synthesize(tts, script))
console.log('\n--- summary ---')
for (const report of reports) {
  console.log(
    `${report.script.split('/').pop()}: ${report.summary.segmentCount} segments, ${(report.summary.audioMs / 1000).toFixed(1)}s audio, ${(report.summary.wallMs / 1000).toFixed(1)}s wall, RTF ${report.summary.realTimeFactor}`,
  )
  console.log(`  ${report.audio}`)
}
