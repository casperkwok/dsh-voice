/** PRD REQ-04: identical text inside two seconds is sent once. */
export function isDuplicateFinal(
  previousText: string,
  previousAt: number,
  text: string,
  now: number,
  windowMs = 2000,
): boolean {
  return text === previousText && now - previousAt < windowMs
}

/** How long to keep listening after the VAD sees silence. */
export function incompleteDelay(text: string): number {
  const value = text.trim()
  if (!value) return 0
  if (/[，,、]$/.test(value)) return 900
  if (
    /(因为|然后|就是|所以|但是|不过|如果|那个|这个|还有|以及|比如|我觉得|就是说|或者说|问题是|比如说)$/.test(
      value,
    )
  ) {
    return 900
  }
  return value.length <= 4 ? 500 : 0
}
