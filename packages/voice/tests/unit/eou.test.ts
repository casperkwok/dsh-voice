import { describe, expect, it } from 'vitest'
import { incompleteDelay, isDuplicateFinal } from '../../src/host/eou.ts'

describe('incompleteDelay', () => {
  it('extends after a connector', () => {
    expect(incompleteDelay('我想问一下因为')).toBe(900)
    expect(incompleteDelay('然后')).toBe(900)
    expect(incompleteDelay('现在出发。')).toBe(0)
  })

  it('extends after a trailing comma', () => {
    expect(incompleteDelay('我先说，')).toBe(900)
    expect(incompleteDelay('第一点、')).toBe(900)
  })

  it('extends short utterances', () => {
    expect(incompleteDelay('你好')).toBe(500)
    expect(incompleteDelay('停')).toBe(500)
    expect(incompleteDelay('今天几点')).toBe(500)
  })

  it('does not extend a complete sentence', () => {
    expect(incompleteDelay('现在可以出发了吗')).toBe(0)
    expect(incompleteDelay('我们明天再聊')).toBe(0)
    expect(incompleteDelay('')).toBe(0)
  })
})

describe('isDuplicateFinal', () => {
  it('ignores the same final inside two seconds', () => {
    expect(isDuplicateFinal('你好', 1000, '你好', 2500)).toBe(true)
    expect(isDuplicateFinal('你好', 1000, '你好', 3500)).toBe(false)
    expect(isDuplicateFinal('你好', 1000, '再见', 1200)).toBe(false)
  })
})
