/**
 * 昵称规则（唯一来源）。
 *
 * 昵称**不是姓名**：姓名是实名，详情里只显示脱敏版本；昵称是展示名，
 * 用在问候语、个人页头部这些地方。没设自定义昵称时回退到「姓氏 + 称呼」（林女士）。
 *
 * 服务端存 `user.nickname`（空串表示未设置）；对外同时给：
 * - `nickname`：真正用于展示的值（自定义优先，否则称呼）
 * - `customNickname`：用户自己设的值，空串表示跟随默认
 *
 * 网页用本文件，安卓镜像在 `NameDisplay.kt`，`tools/check-name-display.mjs` 核对一致。
 */
export const NICKNAME_MAX = 16

/** 去掉首尾空白与控制字符；返回规范化后的值（空串表示未设置）。 */
export function normalizeNickname(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
}

/**
 * 校验昵称：返回错误文案，合法返回 `null`。
 *
 * 空串合法——表示"恢复默认称呼"。
 */
export function validateNickname(value) {
  const text = normalizeNickname(value)
  if (text === '') return null
  if (Array.from(text).length > NICKNAME_MAX) return `昵称最多 ${NICKNAME_MAX} 个字`
  return null
}

/** 展示用昵称：自定义优先，否则用传入的默认称呼。 */
export function nicknameOf(user) {
  const custom = normalizeNickname(user?.nickname)
  return custom || String(user?.displayName ?? '')
}