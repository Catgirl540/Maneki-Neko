import { useState } from 'react'
import { api, ApiError } from '@/api'
import type { WealthHolding, WealthProduct, WealthRedeemResult } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { AlertIcon, CheckIcon } from '@/components/ui/icons'
import { formatAmount } from '@/lib/format'
import { RiskBadge } from './RiskBadge'

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

  const closed = holding.closed
  const shares = sharesText ? Number(sharesText) : holding.shares
  const gross = Math.round((Number.isFinite(shares) ? shares : 0) * product.nav)
  const feeItem = product.transactionFees.find((f) => f.label.startsWith('赎回'))
  const fee = feeItem ? Math.round(gross * feeItem.rate) : 0
  const net = Math.max(0, gross - fee)

  async function submit() {
    setError(null)
    if (!Number.isFinite(shares) || shares <= 0) {
      setError('请输入赎回份额')
      return
    }
    if (shares > holding.shares) {
      setError('赎回份额超过持有份额')
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
      title={result ? '赎回已受理' : '赎回'}
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
          <p className="mt-2 text-[13px] text-ink-mute">预计到账金额</p>
          <dl className="mt-6 flex flex-col gap-3 border-t border-line pt-5 text-left text-[13px]">
            <div className="flex justify-between">
              <dt className="text-ink-soft">赎回份额</dt>
              <dd className="num text-ink">{result.shares.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">受理时间</dt>
              <dd className="num text-ink">{result.acceptedAt.slice(0, 19).replace('T', ' ')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">到账时间</dt>
              <dd className="text-ink">{result.etaText}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">
            实际到账金额按赎回确认日的净值计算，可能与预计金额有差异。款项将划入你申购时使用的储蓄账户。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="rounded-field bg-sunk px-4 py-3.5">
            <p className="text-[14px] font-medium text-ink">{holding.productName}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-mute">
              <RiskBadge risk={holding.risk} showLevel={false} />
              <span className="num">持有 {holding.shares.toFixed(2)} 份</span>
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
                placeholder={holding.shares.toFixed(2)}
                disabled={closed}
                hint={sharesText ? undefined : '留空表示全部赎回'}
              />
            </div>
            <Button
              className="h-14 shrink-0"
              disabled={closed}
              onClick={() => setSharesText(holding.shares.toFixed(2))}
            >
              全部赎回
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
            赎回到账时间以产品说明为准，通常为 T+1 个工作日。赎回不收取支付密码验证，款项只回到你本人的储蓄账户。
          </p>
        </div>
      )}
    </Modal>
  )
}
