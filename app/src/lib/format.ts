import type { Cents, Currency } from '@/api/types'

export const CURRENCY_LABEL: Record<Currency, string> = {
  CNY: '人民币',
  USD: '美元',
  HKD: '港币',
}

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  CNY: '¥',
  USD: 'US$',
  HKD: 'HK$',
}

/** 分 → "1,234.56" */
export function formatAmount(cents: Cents, opts: { sign?: boolean } = {}): string {
  const value = Math.abs(cents) / 100
  const text = value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (!opts.sign) return text
  return `${cents < 0 ? '-' : '+'}${text}`
}

/** 分 → "¥1,234.56" */
export function formatMoney(cents: Cents, currency = '¥'): string {
  return `${currency}${formatAmount(cents)}`
}

/**
 * 分 → "+¥1,234.56" / "-¥1,234.56"。
 *
 * 与 `formatAmount(cents, { sign: true })` 的区别：那个给的是 "+1,234.56"（没币种）。
 * 交易详情页一直写的是 "+¥45.00"，而交易列表用的是前者 —— 同一个数在两处长得不一样，
 * 所以统一到这里，符号在前、币种紧跟其后。
 */
export function formatMoneySigned(cents: Cents, currency = '¥'): string {
  return `${cents < 0 ? '-' : '+'}${currency}${formatAmount(cents)}`
}

/** 分 → "HK$1,088.52"，符号按币种取 */
export function formatCurrency(cents: Cents, currency: Currency): string {
  return `${CURRENCY_SYMBOL[currency]}${formatAmount(cents)}`
}

/**
 * 外币金额：按 ISO 4217 惯例把币种代码放在数字**前面**（USD 5.00）。
 * 参照 Alipay+ 交易详情页规范 —— 金额是「代码 数字」，汇率是「数字 代码 数字」。
 */
export function formatFxAmount(cents: Cents, currency: Currency): string {
  return `${currency} ${formatAmount(cents)}`
}

/**
 * 汇率固定保留 8 位小数。
 * 规范要求 4–8 位且**不得四舍五入**（凑整会造成实际贬值），
 * 所以这里保留由后端给出的精度，不做任何舍入。
 */
export function formatRate(rate: number): string {
  return rate.toFixed(8)
}

/** 元（用户输入） → 分 */
export function toCents(yuan: string | number): Cents {
  const n = typeof yuan === 'number' ? yuan : Number.parseFloat(yuan)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/** 分 → 元字符串，用于输入框回填 */
export function toYuan(cents: Cents): string {
  return (cents / 100).toFixed(2)
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 回单需要精确到秒：交易编号与授权码要和交易时间一起核对 */
export function formatDateTimeFull(iso: string): string {
  const d = new Date(iso)
  return `${formatDateTime(iso)}:${pad(d.getSeconds())}`
}

export function formatMonthDay(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

export function formatToday(): string {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

/** 根据当前时间返回问候语 */
export function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 隐藏手机号中间四位：13800138000 → 138****8000 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length !== 11) return digits
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

/** 隐藏账号中间位：6222 **** **** 8888 */
export function maskAccountNo(no: string): string {
  const digits = no.replace(/\s/g, '')
  if (digits.length <= 8) return digits
  return `${digits.slice(0, 4)} **** **** ${digits.slice(-4)}`
}