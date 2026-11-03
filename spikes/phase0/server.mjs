/**
 * Phase 0 audio loop: browser mic -> VAD/ASR -> fixed reply -> local TTS -> browser.
 *
 * This server intentionally has no DSH integration. It validates the audio loop,
 * barge-in, and latency numbers before the plugin UI is built.
 */
import http from 'node:http'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../..')
const MODELS = join(ROOT, '.models')
const PUBLIC = join(HERE, 'public')

const sherpaLib = join(
  ROOT,
  'node_modules/.pnpm/sherpa-onnx-node@2.0.1/node_modules/sherpa-onnx-darwin-arm64',
)
process.env.DYLD_LIBRARY_PATH = `${sherpaLib}:${process.env.DYLD_LIBRARY_PATH ?? ''}`

const require = createRequire(join(ROOT, 'packages/voice/package.json'))
const sherpa = require('sherpa-onnx-node')
const { WebSocketServer } = require('ws')

const ASR_DIR = join(MODELS, 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20')
const TTS_DIR = join(MODELS, 'sherpa-onnx-vits-zh-ll')
const VAD_MODEL = join(MODELS, 'silero_vad.onnx')

for (const p of [ASR_DIR, TTS_DIR, VAD_MODEL]) {
  if (!existsSync(p)) {
    console.error('missing model:', p)
    process.exit(1)
  }
}

function createRecognizer() {
  return new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(ASR_DIR, 'encoder-epoch-99-avg-1.onnx'),
        decoder: join(ASR_DIR, 'decoder-epoch-99-avg-1.onnx'),
        joiner: join(ASR_DIR, 'joiner-epoch-99-avg-1.onnx'),
      },
      tokens: join(ASR_DIR, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  })
}

function createVad() {
  return new sherpa.Vad(
    {
      sileroVad: {
        model: VAD_MODEL,
        threshold: 0.5,
        minSpeechDuration: 0.15,
        minSilenceDuration: 0.6,
        windowSize: 512,
      },
      tenVad: {
        model: '',
        threshold: 0.5,
        minSpeechDuration: 0.15,
        minSilenceDuration: 0.6,
        windowSize: 256,
      },
      sampleRate: 16000,
      debug: 0,
      numThreads: 1,
    },
    60,
  )
}

function createTts() {
  const ruleFsts = ['date.fst', 'phone.fst', 'number.fst']
    .map((f) => join(TTS_DIR, f))
    .filter(existsSync)
    .join(',')
  return new sherpa.OfflineTts({
    model: {
      vits: {
        model: join(TTS_DIR, 'model.onnx'),
        tokens: join(TTS_DIR, 'tokens.txt'),
        lexicon: join(TTS_DIR, 'lexicon.txt'),
      },
      debug: 0,
      numThreads: Number(process.env.TTS_THREADS ?? 4),
      provider: 'cpu',
    },
    maxNumSentences: 1,
    ...(ruleFsts ? { ruleFsts } : {}),
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function rms(samples) {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

function splitForTts(text, maxLen = 18) {
  const parts = text.split(/(?<=[。！？!?；;：:，,])/)
  const out = []
  for (const part of parts) {
    const value = part.trim()
    if (!value) continue
    if (value.length <= maxLen) {
      out.push(value)
    } else {
      for (let i = 0; i < value.length; i += maxLen) out.push(value.slice(i, i + maxLen))
    }
  }
  return out.length ? out : [text]
}

console.log('[init] loading TTS / ASR / VAD')
const tts = createTts()
const recognizer = createRecognizer()
console.log('[init] warming TTS')
tts.generate({
  text: '你好，我是语音助手。',
  generationConfig: new sherpa.GenerationConfig({ sid: 0, speed: 1.0, silenceScale: 0.2 }),
})
console.log('[init] ready')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204)
    res.end()
    return
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  const file = normalize(join(PUBLIC, rel))
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  console.log('[ws] client connected')
  let stream = recognizer.createStream()
  let vad = createVad()
  let partial = ''
  let speaking = false
  let speechFrames = 0
  let ttsEpoch = 0
  let turnId = 0
  let lastVoiceAt = null

  const send = (payload) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
  }

  const resetAsr = () => {
    recognizer.reset(stream)
    stream = recognizer.createStream()
    partial = ''
  }

  const resetVad = () => {
    vad = createVad()
    speechFrames = 0
    lastVoiceAt = null
  }

  const bargeIn = () => {
    ttsEpoch += 1
    speaking = false
    resetAsr()
    resetVad()
    send({ type: 'barge-in' })
    send({ type: 'status', state: 'listening' })
    console.log('[barge-in]')
  }

  const speak = async (text, turn, endpointTime, lastVoiceTime) => {
    const myEpoch = ++ttsEpoch
    const ttsStart = performance.now()
    speaking = true
    send({ type: 'status', state: 'speaking' })

    let firstChunkAt = null
    let lastChunkAt = null
    let lastChunkSamples = 0
    let totalSamples = 0
    let sampleRate = 0
    let metricsSent = false

    const sendMetrics = () => {
      if (metricsSent || firstChunkAt === null) return
      metricsSent = true
      send({
        type: 'metrics',
        turnId: turn,
        endpointAt: endpointTime,
        ttsFirstChunkMs: Math.round(firstChunkAt - ttsStart),
        endpointToFirstChunkMs:
          endpointTime === null ? null : Math.round(firstChunkAt - endpointTime),
        vadEndpointDelayMs:
          endpointTime === null || lastVoiceTime === null
            ? null
            : Math.round(endpointTime - lastVoiceTime),
        lastSpeechToFirstChunkMs:
          lastVoiceTime === null ? null : Math.round(firstChunkAt - lastVoiceTime),
      })
    }

    const sendChunk = (samples, final) => {
      const int16 = new Int16Array(samples.length)
      for (let i = 0; i < samples.length; i += 1) {
        int16[i] = Math.max(-1, Math.min(1, samples[i])) * 32767
      }
      send({
        type: 'audio',
        turnId: turn,
        sampleRate,
        audio: Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).toString('base64'),
        final,
      })
    }

    const takeChunk = (samples) => {
      if (!samples.length) return
      const now = performance.now()
      if (firstChunkAt === null) {
        firstChunkAt = now
        sampleRate = tts.sampleRate
      }
      lastChunkAt = now
      lastChunkSamples = samples.length
      totalSamples += samples.length
      sendChunk(samples, false)
      sendMetrics()
    }

    for (const segment of splitForTts(text)) {
      if (myEpoch !== ttsEpoch) return
      let callbackSawChunk = false
      const audio = await tts.generateAsync({
        text: segment,
        generationConfig: new sherpa.GenerationConfig({ sid: 0, speed: 1.0, silenceScale: 0.2 }),
        onProgress: ({ samples }) => {
          if (myEpoch !== ttsEpoch) return 0
          callbackSawChunk = true
          takeChunk(samples)
          return 1
        },
      })
      if (myEpoch !== ttsEpoch) return
      if (!callbackSawChunk) {
        sampleRate = audio.sampleRate
        takeChunk(audio.samples)
      }
    }

    if (myEpoch !== ttsEpoch) return

    if (firstChunkAt !== null) {
      const playbackEnd = Math.max(
        firstChunkAt + (totalSamples / sampleRate) * 1000,
        lastChunkAt + (lastChunkSamples / sampleRate) * 1000,
      )
      while (performance.now() < playbackEnd) {
        if (myEpoch !== ttsEpoch) return
        await sleep(40)
      }
    }

    speaking = false
    send({ type: 'status', state: 'listening' })
  }

  ws.on('message', async (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'stop') {
          ttsEpoch += 1
          speaking = false
          resetAsr()
          resetVad()
          send({ type: 'status', state: 'idle' })
        }
      } catch {
        // ignore malformed control messages
      }
      return
    }

    const pcm16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2)
    const f32 = new Float32Array(pcm16.length)
    for (let i = 0; i < pcm16.length; i += 1) f32[i] = pcm16[i] / 32768

    vad.acceptWaveform(f32)
    if (!speaking && vad.isDetected() && rms(f32) > 0.008) lastVoiceAt = performance.now()

    if (speaking) {
      if (vad.isDetected()) {
        speechFrames += 1
        if (speechFrames >= 3) bargeIn()
      } else {
        speechFrames = 0
      }
    } else {
      stream.acceptWaveform({ sampleRate: 16000, samples: f32 })
      while (recognizer.isReady(stream)) recognizer.decode(stream)
      const text = recognizer.getResult(stream).text.trim()
      if (text && text !== partial) {
        partial = text
        send({ type: 'partial', text })
      }
    }

    while (!vad.isEmpty()) {
      const segment = vad.front()
      vad.pop()
      if (speaking) continue
      const endpointAt = performance.now()
      const voiceAt = lastVoiceAt
      const finalText = recognizer.getResult(stream).text.trim()
      if (!finalText) {
        resetAsr()
        resetVad()
        continue
      }
      send({ type: 'final', text: finalText })
      const turn = ++turnId
      resetAsr()
      resetVad()
      await speak(`我听到了：${finalText}`, turn, endpointAt, voiceAt)
      break
    }
  })

  ws.on('close', () => {
    ttsEpoch += 1
    speaking = false
    console.log('[ws] client disconnected')
  })
})

const port = Number(process.env.PORT ?? 7799)
server.listen(port, '127.0.0.1', () => {
  console.log(`[server] http://127.0.0.1:${port}`)
})
