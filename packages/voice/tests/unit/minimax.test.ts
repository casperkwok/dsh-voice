import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { MiniMaxTts } from '../../src/host/tts/minimax.ts'
import { VOICE_DEFAULTS, type VoiceSettings } from '../../src/shared/settings.ts'

let server: Server | null = null

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
  server = null
})

function pcmHex(values: number[]): string {
  const bytes = Buffer.alloc(values.length * 2)
  values.forEach((value, i) => bytes.writeInt16LE(value, i * 2))
  return bytes.toString('hex')
}

describe('MiniMaxTts', () => {
  it('streams PCM chunks and sends GroupId', async () => {
    let requestBody: any = null
    let requestUrl = ''
    server = createServer((req, res) => {
      requestUrl = req.url ?? ''
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        requestBody = JSON.parse(body)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(
          `data: ${JSON.stringify({ data: { audio: pcmHex([0, 16384, -16384]) }, base_resp: { status_code: 0 } })}\n\n`,
        )
        res.end()
      })
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server!.address() as { port: number }).port
    const settings: VoiceSettings = {
      ...VOICE_DEFAULTS,
      ttsMode: 'cloud',
      cloudProvider: 'minimax',
      cloudApiKey: 'test-key',
      cloudGroupId: 'group-1',
      cloudEndpoint: `http://127.0.0.1:${port}`,
      cloudVoice: 'female-shaonv',
      cloudModel: 'speech-02-hd',
    }
    const chunks: Float32Array[] = []
    const tts = new MiniMaxTts(settings)
    const ok = await tts.synthesize('你好', (chunk) => chunks.push(chunk.samples), () => true)
    expect(ok).toBe(true)
    expect(requestUrl).toContain('/v1/t2a_v2')
    expect(requestUrl).toContain('GroupId=group-1')
    expect(requestBody.model).toBe('speech-02-hd')
    expect(requestBody.voice_setting.voice_id).toBe('female-shaonv')
    expect(requestBody.audio_setting).toMatchObject({ format: 'pcm', sample_rate: 32000 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]![1]).toBeCloseTo(0.5, 3)
  })
})
