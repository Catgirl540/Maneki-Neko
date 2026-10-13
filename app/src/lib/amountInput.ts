import type { Cents } from '@/api/types'

/** 表单金额：完整解析，最多两位小数，不截断多余字符或接受不安全整数。 */
export function parseAmountInput(value: string): Cents | null {
  const text = value.trim()
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null
  const cents = Math.round(Number(text) * 100)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null
}
