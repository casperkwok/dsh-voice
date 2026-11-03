/**
 * Verify that a failing TTS segment does not kill the WebSocket or the server.
 * Sends unpronounceable English to the current VITS model, then Chinese.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../..')
const require = createRequire(join(ROOT, 'packages/voice/package.json'))
const WebSocket = require('ws')
const URL = process.env.VOICE_WS ?? 'ws://127.0.0.1:7799/ws'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ws = new WebSocket(URL)
const messages = []
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  messages.push(msg)
  if (msg.type === 'error' || msg.type === 'audio' || msg.type === 'metrics') {
    console.log(msg.type, msg.message ?? msg.turnId)
  }
})

await new Promise((resolve, reject) => {
  ws.once('open', resolve)
  ws.once('error', reject)
})

console.log('[fail] sending English')
ws.send(JSON.stringify({ type: 'say', text: 'FOCUSING IS A' }))
for (let i = 0; i < 100; i += 1) {
  const done = messages.some(
    (m) =>
      (m.type === 'audio' && m.turnId === 1) ||
      (m.type === 'metrics' && m.turnId === 1) ||
      m.type === 'error',
  )
  if (done) break
  await wait(100)
}

console.log('[fail] sending Chinese')
ws.send(JSON.stringify({ type: 'say', text: '你好，我是语音助手。' }))

const deadline = Date.now() + 15000
while (Date.now() < deadline) {
  if (messages.some((m) => m.type === 'audio' && m.turnId === 2)) break
  await wait(100)
}

const errors = messages.filter((m) => m.type === 'error').length
const englishAudio = messages.filter((m) => m.type === 'audio' && m.turnId === 1).length
const audio = messages.filter((m) => m.type === 'audio' && m.turnId === 2).length
console.log(
  `[fail] errors=${errors} englishAudio=${englishAudio} audioChunksTurn2=${audio} wsState=${ws.readyState}`,
)
ws.close()
process.exit((errors > 0 || englishAudio > 0) && audio > 0 ? 0 : 1)
