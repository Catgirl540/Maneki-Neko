/**
 * 金额与敏感值的展示格式。纯函数。
 *
 * 两条硬规矩：
 *   1. 金额一律用「分」的整数传递，只在展示时才变成元——避免浮点误差；
 *   2. **演示数据里不存在完整卡号/CVV**，这里只负责把尾号拼成 `**** 1234`，
 *      绝不"补全"出像真卡号的东西。
 *
 * @module @luckycat/dsh-bank-demo/format
 */

/** 分 → 「1,234.56 元」。 */
export function formatCents(cents: number, currency = 'CNY'): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const yuan = Math.floor(abs / 100)
  const fen = String(abs % 100).padStart(2, '0')
  const grouped = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${grouped}.${fen} ${currency}`
}

/**
 * 只保留尾号的卡/账户展示：`**** 1234`。
 *
 * **只取最后 4 位**，而不是"原样加个前缀"：工具参数是模型给的，
 * 它完全可能把一整串数字塞进 `payeeAccountTail`。如果这里原样回显，
 * 敏感值就会经由"脱敏展示"反而泄漏出去。取尾 4 位是这一层能给的保证。
 */
export function maskTail(tail: string): string {
  const digits = tail.replace(/\D/g, '')
  return `**** ${digits.slice(-4)}`
}

/** 把 ISO 时刻转成「2026-09-17 14:03」。 */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 演示回执号的统一前缀：任何回执号都能一眼看出是假的。 */
export const DEMO_REFERENCE_PREFIX = 'LCB-DEMO-'

/** 造一个演示回执号。 */
export function demoReference(seq: number): string {
  return `${DEMO_REFERENCE_PREFIX}${String(seq).padStart(4, '0')}`
}

/** 每条工具结果都必须带这句，避免模型把占位数据当成真实业务数据转述。 */
export const DEMO_NOTICE = '【演示占位数据】本框架未接入银行后端，以下内容不是真实业务数据。'
