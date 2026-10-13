/** Shared preview/storage redaction. Never attach images, tool arguments or secure-card events. */
export function redactSupportText(value) {
  return String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/Bearer\s+\S+/gi, '[凭据已隐藏]')
    .replace(/\bsk-[\w-]+/g, '[凭据已隐藏]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[长编号已隐藏]')
    .replace(/\d{17}[xX]/g, '[证件号已隐藏]')
    .replace(/\d{6,}/g, '[敏感数字已隐藏]')
    .trim()
}
export function supportTranscript(items) {
  return items.filter(item => item.kind === 'user' || item.kind === 'assistant')
    .slice(-20).map(item => ({ role: item.kind, text: redactSupportText(item.text).slice(0, 2000) }))
    .filter(item => item.text)
}
