import type { TransactionChannel, TransactionStatus } from '@/api/types'

/**
 * 交易渠道 / 状态的中文标签。
 * 放在 lib 而不是页面里：交易列表、详情、后续的电子回单都要用同一套文案。
 */
export const CHANNEL_LABEL: Record<TransactionChannel, string> = {
  quickpay: '网上交易',
  card: '刷卡消费',
  transfer: '转账汇款',
  account: '账户划转',
  interest: '利息结算',
}

export const STATUS_LABEL: Record<TransactionStatus, string> = {
  success: '交易成功',
  pending: '处理中',
  failed: '交易失败',
}
