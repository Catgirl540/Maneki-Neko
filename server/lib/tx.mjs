// Server-owned business implementation; API contract preserved from the existing client.
/**
 * 交易渠道 / 状态的中文标签。
 * 放在 lib 而不是页面里：交易列表、详情、后续的电子回单都要用同一套文案。
 */
export const CHANNEL_LABEL = {
    quickpay: '网上交易',
    card: '刷卡消费',
    transfer: '转账汇款',
    account: '账户划转',
    interest: '利息结算',
};
export const STATUS_LABEL = {
    success: '交易成功',
    pending: '处理中',
    failed: '交易失败',
};
/**
 * 带原因的状态文案（清单 §9）：
 * - pendingReason='inflight'（大额延迟到账）→ 「在途」，不是笼统的「处理中」。
 *   客户要能看出钱还没到对方账上、窗口内还能撤销。
 * - pendingReason='clearing'（模拟清算）→ 「清算中」。
 */
export function statusText(status, pendingReason) {
    if (status === 'pending' && pendingReason === 'inflight')
        return '在途·延迟到账';
    if (status === 'pending' && pendingReason === 'clearing')
        return '清算中';
    return STATUS_LABEL[status];
}
