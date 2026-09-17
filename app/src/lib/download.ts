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
