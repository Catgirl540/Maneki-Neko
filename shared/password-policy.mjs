export const LOGIN_PASSWORD_MIN_LENGTH = 8
export const LOGIN_PASSWORD_MAX_BYTES = 1024
export const LOGIN_PASSWORD_REQUIREMENTS = '登录密码至少 8 位，须包含大写字母、小写字母和特殊字符（如 !@#，空格不计）'

/** Shared by registration, password changes and their client forms. */
export function isValidLoginPassword(value) {
  return typeof value === 'string' &&
    [...value].length >= LOGIN_PASSWORD_MIN_LENGTH &&
    new TextEncoder().encode(value).length <= LOGIN_PASSWORD_MAX_BYTES &&
    /[A-Z]/.test(value) && /[a-z]/.test(value) && /[\p{P}\p{S}]/u.test(value)
}
