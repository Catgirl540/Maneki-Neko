import { ApiError } from '@/api/contract'
import type { Currency, FxQuote, TransferRequest } from '@/api/types'

/** 提交时再次核对客户确认的价格，校验与扣款同在银行请求的串行区间。 */
export function assertTransferConfirmation(req: TransferRequest, fee: number, fromCurrency: Currency, fx?: FxQuote, accepted = false): void {
  const confirmed = req.confirmedQuote
  if (!confirmed) return
  if (confirmed.version !== 1 || !Number.isFinite(confirmed.submitBefore) || (!accepted && confirmed.submitBefore <= Date.now())) {
    throw new ApiError('转账报价已过期，请重新确认', 409, 'QUOTE_EXPIRED')
  }
  const keys = ['fromCurrency', 'toCurrency', 'rate', 'fromAmount', 'toAmount', 'spread'] as const
  if (confirmed.fromCurrency !== fromCurrency || confirmed.fee !== fee ||
      (fx ? !confirmed.fx || keys.some(k => confirmed.fx?.[k] !== fx[k]) : confirmed.fx !== null)) {
    throw new ApiError('手续费或换汇报价已变化，请重新确认', 409, 'QUOTE_CHANGED')
  }
}
