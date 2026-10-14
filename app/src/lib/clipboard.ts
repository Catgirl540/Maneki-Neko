/**
 * 复制到剪贴板。
 *
 * 单独抽出来是因为「复制单个字段」和「复制全部」都要用，
 * 而 `navigator.clipboard` 在非 HTTPS / 旧浏览器里是 undefined ——
 * 不处理的话按钮点了没反应，用户只会以为坏了。
 */
export async function copyText(
  value: string,
  label: string,
  toast: { show: (message: string, tone?: 'info' | 'success' | 'error') => void },
): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      toast.show(`已复制${label}`, 'success')
      return true
    } catch { /* 权限受限时尝试兼容方式。 */ }
  }
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = window.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
  const field = document.createElement('textarea')
  field.value = value
  field.readOnly = true
  field.tabIndex = -1
  field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none'
  // 留在当前对话框内，避免焦点约束把选区移走。
  const host = focused?.closest('[role="dialog"]') ?? document.body
  host.append(field)
  let copied = false
  try {
    field.focus({ preventScroll: true })
    field.select()
    copied = document.execCommand('copy')
  } catch { /* 调用方提供可选择的完整文本。 */ }
  finally {
    field.remove()
    if (focused?.isConnected) focused.focus({ preventScroll: true })
    selection?.removeAllRanges()
    for (const range of ranges) selection?.addRange(range)
  }
  if (copied) toast.show(`已复制${label}`, 'success')
  return copied
}
