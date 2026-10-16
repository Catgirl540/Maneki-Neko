// Server-owned business implementation; API contract preserved from the existing client.
import { ApiError } from '../api/contract.mjs';
/** 提交时再次核对客户确认的价格，校验与扣款同在银行请求的串行区间。 */
export function assertTransferConfirmation(req, fee, fromCurrency, fx, accepted = false) {
    const confirmed = req.confirmedQuote;
    if (!confirmed)
        return;
    if (confirmed.version !== 1 || !Number.isFinite(confirmed.submitBefore) || (!accepted && confirmed.submitBefore <= Date.now())) {
        throw new ApiError('转账报价已过期，请重新确认', 409, 'QUOTE_EXPIRED');
    }
    const keys = ['fromCurrency', 'toCurrency', 'rate', 'fromAmount', 'toAmount', 'spread'];
    if (confirmed.fromCurrency !== fromCurrency || confirmed.fee !== fee ||
        (fx ? !confirmed.fx || keys.some(k => confirmed.fx?.[k] !== fx[k]) : confirmed.fx !== null)) {
        throw new ApiError('手续费或换汇报价已变化，请重新确认', 409, 'QUOTE_CHANGED');
    }
}
