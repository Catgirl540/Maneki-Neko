import type { TicketChannel, TicketStatus } from '@/api'

/** 工单展示用字典。单独一个文件，组件文件只导出组件（Fast Refresh 要求）。 */

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: '待处理',
  processing: '处理中',
  waiting: '等客户',
  resolved: '已解决',
  suspended: '已挂起',
}

export const CHANNEL_LABEL: Record<TicketChannel, string> = {
  app: 'App',
  im: 'IM',
  web: '网页',
}

/** 状态色：待处理=金、处理中=蓝、等客户=浅金、已解决=灰（办完了）、已挂起=珊瑚 */
export const STATUS_CLASS: Record<TicketStatus, string> = {
  open: 'bg-[var(--color-gold-wash)] text-[var(--color-gold-deep)]',
  processing: 'bg-[var(--color-blue-wash)] text-[var(--color-blue-deep)]',
  waiting: 'bg-[var(--color-gold-tint)] text-[var(--color-ink-soft)]',
  resolved: 'bg-[var(--color-sunk)] text-[var(--color-ink-mute)]',
  suspended: 'bg-[var(--color-coral-wash)] text-[var(--color-coral)]',
}

export function formatTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
