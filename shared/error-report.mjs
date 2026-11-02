/**
 * 报错反馈的字段规则（唯一来源）。
 *
 * 客户在界面上遇到错误时，可以把**错误原文 + 上下文**发给运维。
 * 这里只做清洗和长度约束，不判断错误本身是谁的责任——
 * 那属于运维看到之后的事，客户端不该替他们下结论。
 *
 * 约束的出发点：
 * - `message` 是错误原文，必须保留（截断了就没法定位问题）
 * - `note` 是用户补充说明，可选，限长防止一条记录被灌爆
 * - 上下文字段（页面/版本/平台）由客户端自动填，不接受任意对象
 */
export const ERROR_REPORT_MESSAGE_MAX = 2000
export const ERROR_REPORT_NOTE_MAX = 200
export const ERROR_REPORT_FIELD_MAX = 120

/** 去掉控制字符与首尾空白。 */
function clean(value, max) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  return Array.from(text).slice(0, max).join('')
}

/**
 * 规范一条报错记录。
 * @returns {{ message: string, note: string, page: string, appVersion: string, platform: string }}
 */
export function normalizeErrorReport(input = {}) {
  return {
    message: clean(input.message, ERROR_REPORT_MESSAGE_MAX),
    note: clean(input.note, ERROR_REPORT_NOTE_MAX),
    page: clean(input.page, ERROR_REPORT_FIELD_MAX),
    appVersion: clean(input.appVersion, ERROR_REPORT_FIELD_MAX),
    platform: clean(input.platform, ERROR_REPORT_FIELD_MAX),
  }
}

/** 校验：返回错误文案，合法返回 `null`。 */
export function validateErrorReport(input) {
  const report = normalizeErrorReport(input)
  if (report.message === '') return '缺少错误信息'
  return null
}
