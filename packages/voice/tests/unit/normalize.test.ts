import { describe, expect, it } from 'vitest'
import { normalizeChineseNumbers, stripForSpeech } from '../../src/host/normalize.ts'

describe('normalizeChineseNumbers', () => {
  it('reads dates and times in Chinese', () => {
    expect(normalizeChineseNumbers('2026年11月3日 21:15')).toBe(
      '二零二六年十一月三日 二十一点十五分',
    )
    expect(normalizeChineseNumbers('现在是 21 22 分')).toBe('现在是 二十一点二十二分')
    expect(normalizeChineseNumbers('9:05')).toBe('九点零五分')
    expect(normalizeChineseNumbers('9:00')).toBe('九点整')
  })

  it('reads percentages and decimals', () => {
    expect(normalizeChineseNumbers('降雨概率 90%')).toBe('降雨概率 百分之九十')
    expect(normalizeChineseNumbers('温度 26.5 度')).toBe('温度 二十六点五 度')
  })
})

describe('stripForSpeech', () => {
  it('removes markdown and timezone labels', () => {
    const text = stripForSpeech('**21:15**（CST，北京时间）。')
    expect(text).not.toContain('**')
    expect(text).not.toContain('CST')
    expect(text).toContain('北京时间')
    expect(text).not.toContain('，。')
  })

  it('drops fenced code blocks', () => {
    expect(stripForSpeech('看这里\n```ts\nconst x = 1\n```\n结束')).toContain('结束')
    expect(stripForSpeech('看这里\n```ts\nconst x = 1\n```\n结束')).not.toContain('const x')
  })
})
