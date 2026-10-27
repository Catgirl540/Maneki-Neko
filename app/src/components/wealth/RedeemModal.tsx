import { useState } from 'react'
import { api, ApiError } from '@/api'
import type { WealthHolding, WealthProduct, WealthRedeemResult } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { AlertIcon, CheckIcon } from '@/components/ui/icons'
import { formatAmount } from '@/lib/format'
import { RiskBadge } from './RiskBadge'
import { wealthRedemptionQuote } from '../../../../shared/wealth-redemption.mjs'

/**
 * 赎回。
 *
 * 与申购不同，赎回**不验支付密码** —— 钱是回到你自己账户，不是往外付。
 * 真实银行也是这个逻辑（部分银行对大额赎回会加验证，这里不做）。
 */
export function RedeemModal({
  holding,
  product,
  onClose,
  onDone,
}: {
  holding: WealthHolding
  product: WealthProduct
  onClose: () => void
  onDone: () => void
}) {
  const [sharesText, setSharesText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<WealthRedeemResult | null>(null)
  const [quotedAt] = useState(() => Date.now())

  const closed = holding.closed
  const availableShares = holding.redeemableShares ?? holding.shares
  const shares = sharesText ? Number(sharesText) : availableShares
  const gross = Math.round((Number.isFinite(shares) ? shares : 0) * product.nav)
  let quote: ReturnType<typeof wealthRedemptionQuote> | null = null
  try { quote = wealthRedemptionQuote(product, holding, shares, quotedAt) } catch { /* Invalid input is explained on submit. */ }
  const fee = quote?.fee ?? 0
  const net = Math.max(0, gross - fee)

  async function submit() {
    setError(null)
    if (!Number.isFinite(shares) || shares <= 0) {
      setError('请输入赎回份额')
      return
    }
    if (shares > availableShares) {
      setError('赎回份额超过当前已开放份额')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.redeemWealth({
        holdingId: holding.id,
        shares: shares === holding.shares ? undefined : shares,
      })
      setResult(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '赎回失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeDisabled={submitting}
      width="max-w-[480px]"
      title={result ? '演示赎回已完成' : '赎回'}
      footer={
        result ? (
          <Button block variant="primary" onClick={onDone}>
            完成
          </Button>
        ) : (
          <>
            <Button block onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button
              block
              variant="primary"
              loading={submitting}
              disabled={closed}
              onClick={() => void submit()}
            >
              确认赎回
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-chip bg-blue-wash text-blue">
            <CheckIcon size={28} />
          </span>
          <p className="num mt-4 text-[30px] leading-none font-bold text-ink">
            ¥{formatAmount(result.estimatedAmount)}
          </p>
          <p className="mt-2 text-[13px] text-ink-mute">演示到账金额</p>
          <dl className="mt-6 flex flex-col gap-3 border-t border-line pt-5 text-left text-[13px]">
            <div className="flex justify-between">
              <dt className="text-ink-soft">赎回份额</dt>
              <dd className="num text-ink">{result.shares.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">受理时间</dt>
              <dd className="num text-ink">{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(result.acceptedAt))}（北京时间）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">到账时间</dt>
              <dd className="text-ink">{result.etaText}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">
            本次按演示净值记账，已扣赎回费 ¥{formatAmount(result.fees)}，款项已进入你本人的储蓄资金账户。这不代表真实基金清算。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="rounded-field bg-sunk px-4 py-3.5">
            <p className="text-[14px] font-medium text-ink">{holding.productName}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-mute">
              <RiskBadge risk={holding.risk} showLevel={false} />
              <span className="num">持有 {holding.shares.toFixed(2)} 份</span>
              <span className="num">可赎 {availableShares.toFixed(2)} 份</span>
              <span className="num">净值 {product.nav.toFixed(4)}</span>
            </p>
          </div>

          {closed && (
            <p className="flex items-start gap-2 rounded-field bg-gold-wash px-4 py-3 text-[13px] text-gold-deep">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />
              该产品处于封闭期，
              {holding.redeemableAt?.slice(0, 10)} 起可赎回。封闭期产品不能提前赎回。
            </p>
          )}

          <div className="flex items-end gap-2.5">
            <div className="min-w-0 flex-1">
              <Field
                label="赎回份额"
            id="wealth-redeem-shares"
            type="number"
            min="0"
            step="any"
            name="wealth-redeem-shares"
            autoComplete="off"
                value={sharesText}
                inputMode="decimal"
                onChange={(e) => setSharesText(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder={availableShares.toFixed(2)}
                disabled={closed}
                hint={sharesText ? undefined : '留空表示赎回全部已开放份额'}
              />
            </div>
            <Button
              className="h-14 shrink-0"
              disabled={closed}
              onClick={() => setSharesText(availableShares.toFixed(2))}
            >
              赎回可用份额
            </Button>
          </div>

          <dl className="flex flex-col gap-3 rounded-field bg-sunk px-4 py-3.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-ink-soft">赎回金额（按当前净值估算）</dt>
              <dd className="num text-ink">¥{formatAmount(gross)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">赎回费</dt>
              <dd className="num text-ink">{fee > 0 ? `¥${formatAmount(fee)}` : '免费'}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt className="text-ink-soft">预计到账</dt>
              <dd className="num text-[15px] font-semibold text-ink">¥{formatAmount(net)}</dd>
            </div>
          </dl>

          {error && (
            <p className="flex items-start gap-2 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <p className="text-[12px] leading-relaxed text-ink-mute">
            当前为演示即时记账，按先进先出核对各笔持有时间与费用。权益产品持有不满 7 天的赎回部分收取目录费用；满 7 天的部分不收该项费。款项只回到你本人的储蓄账户。
          </p>
        </div>
      )}
    </Modal>
  )
}
