/**
 * 复制到剪贴板。
 *
 * 单独抽出来是因为「复制单个字段」和「复制全部」都要用，
 * 而 `navigator.clipboard` 在非 HTTPS / 旧浏览器里是 undefined ——
 * 不处理的话按钮点了没反应，用户只会以为坏了。
 */
export function copyText(
  value: string,
  label: string,
  toast: { show: (message: string, tone?: 'info' | 'success' | 'error') => void },
): void {
  if (!navigator.clipboard) {
    toast.show('当前环境不支持自动复制，请手动选中', 'error')
    return
  }
  navigator.clipboard
    .writeText(value)
    .then(() => toast.show(`已复制${label}`, 'success'))
    .catch(() => toast.show('复制失败，请手动选中', 'error'))
}
