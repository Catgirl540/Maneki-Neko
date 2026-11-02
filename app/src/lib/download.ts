import { getAuthToken } from './authToken'

/**
 * 触发浏览器下载一段文本。
 *
 * 用 Blob + 临时 <a download>：不需要后端返回文件，也不跳转页面。
 * 注意 revoke 要推迟一拍 —— 立刻 revoke 在部分浏览器会打断下载。
 */
export function downloadText(
  fileName: string,
  text: string,
  mime = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A file capability is insufficient without the currently signed-in customer. */
export async function downloadBankExport(path: string): Promise<void> {
  if (!/^\/api\/exports\/[A-Za-z0-9_-]{24,64}$/.test(path)) throw new Error('无效下载地址')
  const token = getAuthToken()
  if (!token) throw new Error('请重新登录')
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error('文件下载失败')
  const blob = await response.blob(), url = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = url
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('content-disposition') ?? '')?.[1]
  try { anchor.download = encoded ? decodeURIComponent(encoded) : '银行账单.csv' } catch { anchor.download = '银行账单.csv' }
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
