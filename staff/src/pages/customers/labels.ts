/** 客户查询展示用字典。单独一个文件，组件文件只导出组件（Fast Refresh 要求）。 */

export const CARD_STATUS_LABEL: Record<string, string> = {
  active: '正常',
  locked: '已锁',
  pending: '制卡中',
  replaced: '已换发',
}

export const TX_STATUS_LABEL: Record<string, string> = {
  success: '成功',
  pending: '处理中',
  failed: '失败',
}

/** 整数分 → 带符号的人民币字符串。负号表示支出（与客户端 signedAmount 一致）。 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const yuan = Math.floor(abs / 100)
  const fen = String(abs % 100).padStart(2, '0')
  return `${sign}¥${yuan.toLocaleString('zh-CN')}.${fen}`
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
