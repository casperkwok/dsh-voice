const $ = (id) => document.getElementById(id)
const logEl = $('log')

let ws = null
let audioCtx = null
let micStream = null
let worklet = null
let sources = []
let nextPlayAt = 0
let captureStartedAt = null
let aiSpeaking = false
let bargeSpeechStartAt = null

function log(line) {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logEl.textContent += `[${stamp}] ${line}\n`
  logEl.scrollTop = logEl.scrollHeight
}

function setStatus(text) {
  $('status').textContent = text
}

function frameRms(buffer) {
  const samples = new Int16Array(buffer)
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] / 32768
    sum += v * v
  }
  return Math.sqrt(sum / samples.length)
}

function stopPlayback() {
  for (const src of sources) {
    try {
      src.stop()
    } catch {
      // already stopped
    }
  }
  sources = []
  nextPlayAt = 0
}

function base64ToInt16(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

function playAudio(msg) {
  if (!audioCtx) return
  const int16 = base64ToInt16(msg.audio)
  const f32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i += 1) f32[i] = int16[i] / 32768
  const buffer = audioCtx.createBuffer(1, f32.length, msg.sampleRate)
  buffer.copyToChannel(f32, 0)
  const src = audioCtx.createBufferSource()
  src.buffer = buffer
  src.connect(audioCtx.destination)
  const at = Math.max(audioCtx.currentTime + 0.02, nextPlayAt)
  src.start(at)
  nextPlayAt = at + buffer.duration
  sources.push(src)
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'status':
      setStatus(msg.state)
      aiSpeaking = msg.state === 'speaking'
      if (aiSpeaking) bargeSpeechStartAt = null
      break
    case 'partial':
      $('partial').textContent = msg.text
      break
    case 'final':
      $('final').textContent = msg.text
      break
    case 'audio':
      playAudio(msg)
      break
    case 'barge-in':
      stopPlayback()
      log(
        bargeSpeechStartAt === null
          ? '检测到打断，停止播放'
          : `检测到打断，停止播放（开口到停止 ${Math.round(performance.now() - bargeSpeechStartAt)}ms）`,
      )
      break
    case 'error':
      log(`错误：${msg.message}`)
      break
    case 'metrics':
      $('m-first').textContent = msg.ttsFirstChunkMs == null ? '—' : `${msg.ttsFirstChunkMs} ms`
      const perceived = msg.lastSpeechToFirstChunkMs ?? msg.endpointToFirstChunkMs
      $('m-end').textContent = perceived == null ? '—' : `${perceived} ms`
      $('m-turn').textContent = msg.turnId ?? '—'
      log(`metrics ${JSON.stringify(msg)}`)
      break
    default:
      log(`message ${JSON.stringify(msg)}`)
  }
}

async function start() {
  if (ws) return
  $('start').disabled = true
  $('stop').disabled = false

  audioCtx = new AudioContext({ latencyHint: 'interactive' })
  await audioCtx.audioWorklet.addModule('/worklet.js')

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  })
  captureStartedAt = performance.now()

  const source = audioCtx.createMediaStreamSource(micStream)
  worklet = new AudioWorkletNode(audioCtx, 'mic-downsample', {
    processorOptions: { targetRate: 16000, chunkSamples: 320 },
  })

  ws = new WebSocket(`ws://${location.host}/ws`)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => {
    log('WebSocket 已连接')
    setStatus('listening')
  }
  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data))
    } catch (err) {
      log(`消息解析失败: ${err}`)
    }
  }
  ws.onclose = () => log('WebSocket 已关闭')
  ws.onerror = () => log('WebSocket 错误')

  worklet.port.onmessage = (event) => {
    if (aiSpeaking && bargeSpeechStartAt === null && frameRms(event.data) > 0.02) {
      bargeSpeechStartAt = performance.now()
      log('检测到用户开口')
    }
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(event.data)
  }
  source.connect(worklet)
}

function stop() {
  if (ws) {
    try {
      ws.send(JSON.stringify({ type: 'stop' }))
      ws.close()
    } catch {
      // ignore
    }
    ws = null
  }
  if (worklet) {
    worklet.port.onmessage = null
    worklet.disconnect()
    worklet = null
  }
  if (micStream) {
    for (const track of micStream.getTracks()) track.stop()
    micStream = null
  }
  stopPlayback()
  if (audioCtx) {
    audioCtx.close()
    audioCtx = null
  }
  setStatus('未开始')
  $('start').disabled = false
  $('stop').disabled = true
  log('已停止')
}

$('start').addEventListener('click', () => start().catch((err) => {
  log(`启动失败: ${err}`)
  stop()
}))
$('stop').addEventListener('click', stop)
$('barge').addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    stopPlayback()
    log('手动停止播放')
  }
})
