/**
 * Phase 0 WebSocket smoke test, without a browser.
 *
 * Feeds test-input.wav into /ws at 20ms per 320-sample frame, then checks:
 * 1. streaming ASR final
 * 2. TTS audio chunks arrive
 * 3. endpoint -> first audio chunk latency
 * 4. sending speech while TTS plays triggers barge-in
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../..')
const require = createRequire(join(ROOT, 'packages/voice/package.json'))
const sherpa = require('sherpa-onnx-node')
const WebSocket = require('ws')

const URL = process.env.VOICE_WS ?? 'ws://127.0.0.1:7799/ws'
const WAV = join(HERE, 'test-input.wav')
const FRAME = 320
const FRAME_MS = 20

const wave = sherpa.readWave(WAV)
const silence = new Float32Array(wave.sampleRate)
const samples = new Float32Array(wave.samples.length + silence.length)
samples.set(wave.samples, 0)
samples.set(silence, wave.samples.length)

function toInt16Buffer(source, offset, length) {
  const out = Buffer.alloc(length * 2)
  for (let i = 0; i < length; i += 1) {
    const v = Math.max(-1, Math.min(1, source[offset + i] ?? 0))
    out.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  return out
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendFrames(ws, start, end, onFrame) {
  for (let offset = start; offset < end; offset += FRAME) {
    const length = Math.min(FRAME, end - offset)
    ws.send(toInt16Buffer(samples, offset, length))
    if (onFrame) onFrame(offset)
    await wait(FRAME_MS)
  }
}

async function runTurnTest() {
  const ws = await connect()
  const started = performance.now()
  const result = {
    partials: [],
    final: null,
    audioChunks: 0,
    audioBytes: 0,
    metrics: null,
    firstAudioAt: null,
    lastAudioAt: null,
    speakingSeen: false,
    playbackDone: false,
  }

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'partial') result.partials.push(msg.text)
    if (msg.type === 'final') result.final = msg.text
    if (msg.type === 'audio') {
      if (result.firstAudioAt === null) result.firstAudioAt = performance.now()
      result.lastAudioAt = performance.now()
      result.audioChunks += 1
      result.audioBytes += Buffer.from(msg.audio, 'base64').length
    }
    if (msg.type === 'metrics') result.metrics = msg
    if (msg.type === 'status') {
      if (msg.state === 'speaking') result.speakingSeen = true
      if (msg.state === 'listening' && result.speakingSeen) result.playbackDone = true
    }
  })

  console.log(`[turn] sending ${(samples.length / wave.sampleRate).toFixed(2)}s audio`)
  await sendFrames(ws, 0, samples.length)

  for (let i = 0; i < 200 && !(result.metrics && result.playbackDone); i += 1) await wait(100)
  const doneAt = performance.now()
  ws.close()

  console.log('[turn] partials:', result.partials.join(' | '))
  console.log('[turn] final:', result.final)
  console.log(
    `[turn] audio chunks ${result.audioChunks}, ` +
      `${result.audioBytes} bytes, ` +
      `first at ${result.firstAudioAt === null ? 'n/a' : Math.round(result.firstAudioAt - started)}ms, ` +
      `last at ${result.lastAudioAt === null ? 'n/a' : Math.round(result.lastAudioAt - started)}ms`,
  )
  console.log('[turn] metrics:', result.metrics)
  console.log(`[turn] total ${Math.round(doneAt - started)}ms`)
  return result
}

async function runBargeTest() {
  const ws = await connect()
  const started = performance.now()
  let firstAudioAt = null
  let bargeAt = null
  let audioChunks = 0

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'audio') {
      audioChunks += 1
      if (firstAudioAt === null) firstAudioAt = performance.now()
    }
    if (msg.type === 'barge-in' && bargeAt === null) bargeAt = performance.now()
  })

  console.log('[barge] sending first utterance')
  await sendFrames(ws, 0, samples.length)

  for (let i = 0; i < 100 && firstAudioAt === null; i += 1) await wait(100)
  console.log(
    `[barge] TTS started after ${firstAudioAt === null ? 'n/a' : Math.round(firstAudioAt - started)}ms, ` +
      `chunks ${audioChunks}`,
  )
  if (firstAudioAt === null) {
    ws.close()
    return
  }

  const interruptStart = performance.now()
  console.log('[barge] sending speech while TTS plays')
  await sendFrames(ws, 0, Math.min(samples.length, wave.sampleRate * 2))

  for (let i = 0; i < 50 && bargeAt === null; i += 1) await wait(50)
  console.log(
    `[barge] barge-in ${bargeAt === null ? 'NOT DETECTED' : `after ${Math.round(bargeAt - interruptStart)}ms`}`,
  )
  ws.close()
  return { detected: bargeAt !== null, ms: bargeAt === null ? null : Math.round(bargeAt - interruptStart) }
}

const turn = await runTurnTest()
await wait(500)
const barge = await runBargeTest()

const ok =
  Boolean(turn.final) &&
  turn.audioChunks > 0 &&
  turn.metrics?.endpointToFirstChunkMs != null &&
  barge.detected
console.log('[summary]', JSON.stringify({ ok, turn, barge }, null, 2))
process.exit(ok ? 0 : 1)
