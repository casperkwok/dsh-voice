import { describe, expect, it } from 'vitest'
import { splitForTts } from '../../src/host/voice-engine.ts'

describe('splitForTts', () => {
  it('splits at Chinese punctuation', () => {
    expect(splitForTts('你好。我是语音助手。')).toEqual(['你好。', '我是语音助手。'])
  })

  it('keeps a short first segment for TTS latency', () => {
    expect(splitForTts('我听到了：你好')[0]).toBe('我听到了：')
  })

  it('splits long segments at the max length', () => {
    const parts = splitForTts('一二三四五六七八九十一二三四五六七八九十', 10)
    expect(parts.join('')).toBe('一二三四五六七八九十一二三四五六七八九十')
    expect(parts.every((part) => part.length <= 10)).toBe(true)
  })

  it('returns the original text when there is no punctuation', () => {
    expect(splitForTts('不用标点的一句话')).toEqual(['不用标点的一句话'])
  })
})
