/**
 * 姓名展示规则（唯一来源）：列表只露「姓氏 + 称呼」，详情再打星号。
 *
 * - 称呼：开户录入的 18 位身份证号第 17 位，奇数为先生、偶数为女士；
 *   判定不了（演示账号、老数据）时用 [DEFAULT_HONORIFIC]。
 * - 脱敏：保留首尾字，中间每位一个 `*`（林小满 → 林*满；两字名 → 林*）。
 *
 * 网页端 `shared/name-display.d.mts` 与安卓 `NameDisplay.kt` 是同一套规则的镜像，
 * 改这里要同步改那边（`tools/check-name-display.mjs` 会核对样例）。
 */
export const HONORIFIC_MR = 'mr'
export const HONORIFIC_MS = 'ms'

/** 判定不了性别时用的默认称呼。 */
export const DEFAULT_HONORIFIC = HONORIFIC_MS

const HONORIFIC_LABEL = {
  [HONORIFIC_MR]: '先生',
  [HONORIFIC_MS]: '女士',
}

/** 从身份证号推称呼；格式不对返回 null。 */
export function honorificFromIdNumber(idNumber) {
  const value = String(idNumber ?? '').trim()
  if (!/^\d{17}[\dXx]$/.test(value)) return null
  return Number(value[16]) % 2 === 1 ? HONORIFIC_MR : HONORIFIC_MS
}

/** 姓氏：中文名取首字（单字姓），英文名取首字母大写。 */
export function surnameOf(name) {
  const value = String(name ?? '').trim()
  if (!value) return ''
  return /^[A-Za-z]/.test(value) ? value[0].toUpperCase() : value[0]
}

/** 列表展示用：「林小满」+ ms → 「林女士」。 */
export function displayNameOf(name, honorific) {
  const surname = surnameOf(name)
  if (!surname) return ''
  const label = HONORIFIC_LABEL[honorific === HONORIFIC_MR ? HONORIFIC_MR : HONORIFIC_MS]
  return `${surname}${label}`
}

/** 详情展示用：「林小满」→「林*满」，「马斯克」→「马*克」，两字名「林一」→「林*」。 */
export function maskedNameOf(name) {
  const value = String(name ?? '').trim()
  if (value.length <= 1) return value
  if (value.length === 2) return `${value[0]}*`
  return `${value[0]}${'*'.repeat(value.length - 2)}${value[value.length - 1]}`
}
