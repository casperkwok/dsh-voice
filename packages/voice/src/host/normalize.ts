const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const CN_UNITS = ['', '十', '百', '千']

function digitsToChinese(value: string): string {
  return [...value].map((char) => CN_DIGITS[Number(char)] ?? char).join('')
}

function intToChinese(value: number): string {
  if (!Number.isFinite(value) || value < 0) return String(value)
  if (value === 0) return '零'
  if (value >= 10000) return digitsToChinese(String(Math.floor(value)))
  let out = ''
  let pendingZero = false
  for (let i = 3; i >= 0; i -= 1) {
    const unit = 10 ** i
    const digit = Math.floor(value / unit) % 10
    if (digit > 0) {
      if (pendingZero && out) out += '零'
      out += CN_DIGITS[digit]! + CN_UNITS[i]!
      pendingZero = false
    } else if (out) {
      pendingZero = true
    }
  }
  return out.startsWith('一十') ? out.slice(1) : out
}

function numberToChinese(raw: string): string {
  const [whole, fraction] = raw.split('.')
  const base = intToChinese(Number(whole))
  return fraction ? `${base}点${digitsToChinese(fraction)}` : base
}

/** Convert the number shapes a Chinese assistant actually emits into readings
 * Matcha's Chinese lexicon can pronounce. English-bearing segments skip this. */
export function normalizeChineseNumbers(text: string): string {
  return text
    .replace(/(\d{4})\s*年/g, (_m, year: string) => `${digitsToChinese(year)}年`)
    .replace(/(\d{1,2}):(\d{2})/g, (_m, hour: string, minute: string) => {
      const h = intToChinese(Number(hour))
      if (minute === '00') return `${h}点整`
      const mm = Number(minute)
      return `${h}点${mm < 10 ? '零' : ''}${intToChinese(mm)}分`
    })
    .replace(/(\d{1,2})\s*点\s*(\d{1,2})\s*分/g, (_m, hour: string, minute: string) => {
      const mm = Number(minute)
      return `${intToChinese(Number(hour))}点${mm < 10 ? '零' : ''}${intToChinese(mm)}分`
    })
    .replace(/(\d{1,2})\s+(\d{1,2})\s*分/g, (_m, hour: string, minute: string) => {
      const mm = Number(minute)
      return `${intToChinese(Number(hour))}点${mm < 10 ? '零' : ''}${intToChinese(mm)}分`
    })
    .replace(/(\d{1,2})\s*月/g, (_m, month: string) => `${intToChinese(Number(month))}月`)
    .replace(/(\d{1,2})\s*日/g, (_m, day: string) => `${intToChinese(Number(day))}日`)
    .replace(/(\d+(?:\.\d+)?)\s*%/g, (_m, n: string) => `百分之${numberToChinese(n)}`)
    .replace(/\d+(?:\.\d+)?/g, (n) => numberToChinese(n))
}

export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/^[#>\-+\s]+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[（）()]/g, '，')
    .replace(/\b(?:CST|UTC|GMT|PST|PDT|EST|EDT|CET|DST)\b/g, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[，,]\s*([。！？!?])/g, '$1')
    .replace(/^[，,。\s]+/, '')
}
