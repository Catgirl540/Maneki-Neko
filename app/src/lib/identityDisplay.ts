/** 接口即使返回完整证件号，界面也仅保留前三位与末四位。 */
export function maskIdentityNumber(value: string): string {
  const text = value.trim()
  if (!text) return '—'
  if (text.length <= 7) return '*'.repeat(text.length)
  return `${text.slice(0, 3)}${'*'.repeat(text.length - 7)}${text.slice(-4)}`
}
