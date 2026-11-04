import { cloudProfile, type VoiceSettings } from '../../shared/settings.ts'

export interface CloudAudioChunk {
  samples: Float32Array
  sampleRate: number
}

/** MiniMax T2A v2, PCM over SSE. The API returns hex-encoded PCM chunks. */
export class MiniMaxTts {
  readonly provider = 'minimax' as const
  readonly sampleRate = 32000
  private readonly settings: VoiceSettings

  constructor(settings: VoiceSettings) {
    this.settings = settings
  }

  private url(): string {
    const p = cloudProfile(this.settings)
    const base = (p.endpoint || 'https://api.minimax.io').replace(/\/+$/, '')
    const url = new URL(base.endsWith('/v1/t2a_v2') ? base : `${base}/v1/t2a_v2`)
    if (p.groupId) url.searchParams.set('GroupId', p.groupId)
    return url.toString()
  }

  async synthesize(
    text: string,
    onChunk: (chunk: CloudAudioChunk) => void,
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    const p = cloudProfile(this.settings)
    const key = p.apiKey
    if (!key) throw new Error('MiniMax API Key 未配置')
    if (!p.groupId) throw new Error('MiniMax Group ID 未配置')
    const res = await fetch(this.url(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: p.model || 'speech-02-hd',
        text,
        stream: true,
        stream_options: { exclude_aggregated_audio: true },
        voice_setting: {
          voice_id: p.voice || 'female-shaonv',
          speed: p.speed || 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          format: 'pcm',
          sample_rate: this.sampleRate,
          channel: 1,
        },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`MiniMax TTS ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`)
    }

    let emitted = false
    const consume = (payload: unknown): void => {
      const data = (payload as { data?: { audio?: string } })?.data
      const meta = (payload as { base_resp?: { status_code?: number; status_msg?: string } })?.base_resp
      if (meta?.status_code && meta.status_code !== 0) {
        throw new Error(`MiniMax TTS: ${meta.status_msg || meta.status_code}`)
      }
      if (!data?.audio || !shouldContinue()) return
      const bytes = hexToBytes(data.audio)
      const samples = pcm16ToFloat32(bytes)
      if (!samples.length) return
      emitted = true
      onChunk({ samples, sampleRate: this.sampleRate })
    }

    if ((res.headers.get('content-type') || '').includes('application/json')) {
      consume(await res.json())
      return emitted
    }

    if (!res.body) throw new Error('MiniMax TTS: 响应没有音频流')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (shouldContinue()) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) {
          const raw = line.slice(5).trim()
          if (raw && raw !== '[DONE]') consume(JSON.parse(raw))
        }
        newline = buffer.indexOf('\n')
      }
    }
    return emitted
  }
}

function hexToBytes(value: string): Uint8Array {
  const clean = value.length % 2 === 0 ? value : value.slice(0, -1)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = Math.floor(bytes.byteLength / 2)
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i += 1) samples[i] = view.getInt16(i * 2, true) / 32768
  return samples
}
