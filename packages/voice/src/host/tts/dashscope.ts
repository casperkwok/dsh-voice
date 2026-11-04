import { cloudProfile, type VoiceSettings } from '../../shared/settings.ts'

export interface CloudAudioChunk {
  samples: Float32Array
  sampleRate: number
}

/** Alibaba Cloud Bailian / DashScope Qwen3-TTS HTTP synthesis. */
export class DashScopeTts {
  readonly provider = 'dashscope' as const
  sampleRate = 24000
  private readonly settings: VoiceSettings

  constructor(settings: VoiceSettings) {
    this.settings = settings
  }

  async synthesize(
    text: string,
    onChunk: (chunk: CloudAudioChunk) => void,
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    const p = cloudProfile(this.settings)
    if (!p.apiKey) throw new Error('阿里百炼 API Key 未配置')
    const endpoint =
      p.endpoint ||
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${p.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: p.model || 'qwen3-tts-flash',
        input: {
          text,
          voice: p.voice || 'Cherry',
          language_type: 'Chinese',
        },
      }),
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`阿里百炼 TTS ${res.status}: ${body.slice(0, 160)}`)
    const payload = JSON.parse(body) as {
      output?: { audio?: { url?: string; data?: string } }
      message?: string
    }
    const audio = payload.output?.audio
    if (!audio) throw new Error(`阿里百炼 TTS 无音频: ${payload.message ?? body.slice(0, 160)}`)
    let bytes: Uint8Array
    if (audio.data) {
      bytes = Uint8Array.from(Buffer.from(audio.data, 'base64'))
    } else if (audio.url) {
      const audioRes = await fetch(audio.url)
      if (!audioRes.ok) throw new Error(`阿里百炼音频下载失败 ${audioRes.status}`)
      bytes = new Uint8Array(await audioRes.arrayBuffer())
    } else {
      throw new Error('阿里百炼 TTS 没有 audio.url 或 audio.data')
    }
    const wave = parseWav(bytes)
    if (shouldContinue() && wave.samples.length) {
      this.sampleRate = wave.sampleRate
      onChunk({ samples: wave.samples, sampleRate: wave.sampleRate })
    }
    return wave.samples.length > 0
  }
}

export function parseWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, false) !== 0x52494646) throw new Error('不是 WAV 音频')
  let offset = 12
  let sampleRate = 24000
  let channels = 1
  let bits = 16
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      bits = view.getUint16(offset + 22, true)
    }
    if (id === 'data') {
      if (bits !== 16 || channels !== 1) throw new Error(`不支持的 WAV 格式 ${channels}ch/${bits}bit`)
      const start = offset + 8
      const length = Math.min(size, bytes.byteLength - start) / 2
      const samples = new Float32Array(length)
      for (let i = 0; i < length; i += 1) samples[i] = view.getInt16(start + i * 2, true) / 32768
      return { samples, sampleRate }
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error('WAV 没有 data 块')
}
