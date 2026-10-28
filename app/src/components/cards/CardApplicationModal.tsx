import { useState } from 'react'
import { api, ApiError } from '@/api'
import type { BankCard, CardProduct, MailingAddress } from '@/api/types'
import { BrandMark } from '@/components/brand/BrandMark'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PinInput } from '@/components/ui/PinInput'
import { AlertIcon, CheckIcon } from '@/components/ui/icons'
import {
  EMPTY_ADDRESS,
  formatAddress,
  validateAddress,
  validateAddressField,
} from '@/lib/address'
import { cn } from '@/lib/cn'
import { formatAmount } from '@/lib/format'

export type ApplicationMode = 'open' | 'replace'

const ALL_FIELDS: (keyof MailingAddress)[] = [
  'recipient',
  'phone',
  'region',
  'city',
  'detail',
  'postalCode',
]

/**
 * 申卡 / 换卡弹层。
 *
 * 两件事共用一套流程，因为它们本质相同：都要**扣制卡费**、都要**寄实体卡**、
 * 都得**输支付密码**。差别只是换卡多一步「旧卡作废」。
 *
 * 由调用方在 open 时才挂载（不是常驻 + 清空），这样表单状态天然是干净的，
 * 不需要在 effect 里 setState 去重置 —— 那正是 react-hooks 里最容易出错的地方。
 */
export function CardApplicationModal({
  mode,
  card,
  products,
  onClose,
  onDone,
}: {
  mode: ApplicationMode
  /** mode === 'replace' 时必填 */
  card?: BankCard
  products: CardProduct[]
  onClose: () => void
  onDone: (created: BankCard) => void
}) {
  const [productCode, setProductCode] = useState(() => {
    if (mode === 'replace' && card) {
      return products.find((p) => p.network === card.network)?.code ?? products[0]?.code ?? ''
    }
    // 默认选首个未持有对应卡组织的产品；已占名额的产品只在列表里作提示
    return products.find((p) => !p.held)?.code ?? products[0]?.code ?? ''
  })
  const [address, setAddress] = useState<MailingAddress>({ ...EMPTY_ADDRESS })
  const [touched, setTouched] = useState<Partial<Record<keyof MailingAddress, boolean>>>({})
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const product = products.find((p) => p.code === productCode) ?? null
  // 实付以后端报价为准（含会员减免），退化为标价合计兜底
  const fee = product ? (product.feeQuote?.payable ?? product.issuingFee + product.deliveryFee) : 0
  const blocked = mode === 'open' && product?.held === true

  function setField(field: keyof MailingAddress, value: string) {
    setAddress((prev) => ({ ...prev, [field]: value }))
  }

  function markTouched(field: keyof MailingAddress) {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  /** 只有碰过的字段才报错，不然一打开满屏红 */
  function fieldError(field: keyof MailingAddress) {
    return touched[field] ? (validateAddressField(field, address) ?? undefined) : undefined
  }

  async function submit() {
    setError(null)
    if (!product) {
      setError('请选择卡种')
      return
    }
    const addressError = validateAddress(address)
    if (addressError) {
      setTouched(Object.fromEntries(ALL_FIELDS.map((f) => [f, true])))
      setError(addressError)
      return
    }
    if (!/^\d{6}$/.test(password)) {
      setError('请输入 6 位数字支付密码')
      return
    }

    setSubmitting(true)
    try {
      const created =
        mode === 'open'
          ? await api.openCard({ productCode: product.code, address, paymentPassword: password })
          : await api.replaceCard(card!.id, { address, paymentPassword: password })
      onDone(created)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '提交失败，请稍后重试'
      setError(message)
      // 密码类错误就清空让用户重输；余额不足之类的清空密码没意义
      if (err instanceof ApiError && err.code?.includes('PAY_PASSWORD')) {
        setPassword('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-[560px]"
      title={mode === 'open' ? '申请新卡' : '换卡'}
      description={
        mode === 'open'
          ? '实体卡将寄送到你填写的地址，制卡费用从储蓄账户扣除。'
          : '换卡后旧卡立即失效、卡号变更，已绑定的自动扣款需要重新签约；新卡寄到填写的地址。'
      }
      footer={
        <>
          <Button block onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button block variant="primary" loading={submitting} disabled={blocked} onClick={() => void submit()}>
            {blocked ? '该卡组织已有在用卡' : mode === 'open' ? `支付 ¥${formatAmount(fee)} 并申请` : `支付 ¥${formatAmount(fee)} 并换卡`}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-6 overflow-y-auto pr-1">
        {/* —— 卡种 —— */}
        {mode === 'open' ? (
          <section>
            <h3 className="mb-3 text-[13px] font-medium text-ink-soft">选择卡种</h3>
            <div className="flex flex-col gap-3">
              {products.map((item) => {
                const active = item.code === productCode
                const quote = item.feeQuote
                const payable = quote?.payable ?? item.issuingFee + item.deliveryFee
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => !item.held && setProductCode(item.code)}
                    disabled={item.held}
                    aria-pressed={active}
                    aria-disabled={item.held}
                    className={cn(
                      'rounded-field border p-4 text-left transition-colors',
                      item.held
                        ? 'cursor-not-allowed border-line bg-sunk opacity-70'
                        : active
                          ? 'border-gold bg-gold-tint'
                          : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <BrandMark network={item.network} />
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-[15px] font-medium',
                          active ? 'text-gold-deep' : 'text-ink',
                        )}
                      >
                        {item.name}
                      </span>
                      {item.held ? (
                        <span className="shrink-0 text-[13px] font-medium text-ink-mute">已持有同组织卡</span>
                      ) : quote && quote.waived > 0 ? (
                        <span className="shrink-0 text-right">
                          <span className="num mr-1.5 text-[13px] text-ink-mute line-through">¥{formatAmount(quote.listFee)}</span>
                          <span className="num text-[15px] font-semibold text-gold-deep">¥{formatAmount(payable)}</span>
                        </span>
                      ) : (
                        <span className="num shrink-0 text-[15px] font-semibold text-ink">¥{formatAmount(payable)}</span>
                      )}
                      {active && !item.held && <CheckIcon size={18} className="shrink-0 text-gold-deep" />}
                    </span>
                    <span className="mt-2 block text-[12px] leading-relaxed text-ink-mute">
                      {item.perks.join(' · ')}
                    </span>
                    <span className="num mt-1.5 block text-[12px] text-ink-mute">
                      {item.held
                        ? '每个卡组织至多一张；如需新卡可在卡片列表办理换卡'
                        : `制卡费 ¥${formatAmount(item.issuingFee)}${item.deliveryFee > 0 ? ` + 寄送费 ¥${formatAmount(item.deliveryFee)}` : ' · 挂号信寄送免费'} · 预计 ${item.deliveryDays} 个工作日寄达${quote && quote.waived > 0 ? ' · 会员减免已计入' : ''}`}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ) : (
          <section className="flex items-center gap-3 rounded-field bg-sunk px-4 py-3.5">
            <BrandMark network={card?.network ?? 'visa'} />
            <span className="min-w-0 flex-1 text-[14px] text-ink">
              {card?.productName} · 尾号 {card?.last4}
            </span>
          </section>
        )}

        {/* —— 邮寄地址 —— */}
        <section className="flex flex-col gap-4">
          <h3 className="text-[13px] font-medium text-ink-soft">邮寄地址</h3>
          <Field
            label="收件人"
            value={address.recipient}
            onChange={(e) => setField('recipient', e.target.value)}
            onBlur={() => markTouched('recipient')}
            placeholder="请输入收件人姓名"
            autoComplete="name"
            error={fieldError('recipient')}
          />
          <Field
            label="手机号"
            value={address.phone}
            inputMode="numeric"
            onChange={(e) => setField('phone', e.target.value.replace(/\D/g, '').slice(0, 11))}
            onBlur={() => markTouched('phone')}
            placeholder="快递联系用，11 位手机号"
            autoComplete="tel"
            error={fieldError('phone')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="省 / 直辖市"
              value={address.region}
              onChange={(e) => setField('region', e.target.value)}
              onBlur={() => markTouched('region')}
              placeholder="例如：上海市"
              autoComplete="address-level1"
              error={fieldError('region')}
            />
            <Field
              label="城市"
              value={address.city}
              onChange={(e) => setField('city', e.target.value)}
              onBlur={() => markTouched('city')}
              placeholder="例如：上海市"
              autoComplete="address-level2"
              error={fieldError('city')}
            />
          </div>
          <Field
            label="详细地址"
            value={address.detail}
            onChange={(e) => setField('detail', e.target.value)}
            onBlur={() => markTouched('detail')}
            placeholder="街道、门牌号、楼层房号"
            autoComplete="street-address"
            error={fieldError('detail')}
          />
          <Field
            label="邮政编码（选填）"
            value={address.postalCode ?? ''}
            inputMode="numeric"
            onChange={(e) => setField('postalCode', e.target.value.replace(/\D/g, '').slice(0, 6))}
            onBlur={() => markTouched('postalCode')}
            placeholder="6 位数字"
            autoComplete="postal-code"
            error={fieldError('postalCode')}
          />
          {formatAddress(address).trim() && (
            <p className="text-[12px] leading-relaxed text-ink-mute">
              寄送地址：{address.recipient || '—'} · {formatAddress(address) || '—'}
            </p>
          )}
        </section>

        {/* —— 费用 —— */}
        {product && (
          <section>
            <h3 className="mb-3 text-[13px] font-medium text-ink-soft">费用</h3>
            <dl className="flex flex-col gap-3 rounded-field bg-sunk px-4 py-3.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-soft">制卡工本费</dt>
                <dd className="num text-ink">¥{formatAmount(product.issuingFee)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">寄送费</dt>
                <dd className="num text-ink">
                  {product.deliveryFee > 0 ? `¥${formatAmount(product.deliveryFee)}` : '免费'}
                </dd>
              </div>
              {product.feeQuote && product.feeQuote.waived > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-soft">会员等级减免</dt>
                  <dd className="num text-gold-deep">−¥{formatAmount(product.feeQuote.waived)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="text-ink-soft">合计（从储蓄账户扣除）</dt>
                <dd className="num text-[15px] font-semibold text-ink">
                  {product.feeQuote && product.feeQuote.waived > 0 && (
                    <span className="mr-1.5 text-[13px] font-normal text-ink-mute line-through">¥{formatAmount(product.feeQuote.listFee)}</span>
                  )}
                  ¥{formatAmount(fee)}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {/* —— 支付密码 —— */}
        <section>
          <PinInput
            label="支付密码"
            value={password}
            onChange={setPassword}
            disabled={submitting}
            error={
              error && (error.includes('支付密码') || error.includes('6 位')) ? error : undefined
            }
          />
          <p className="mt-3 text-[12px] leading-relaxed text-ink-mute">
            支付密码用于扣款验证，与登录密码不同。连续输错 5 次会冻结账号，需联系工作人员解冻。
          </p>
        </section>

        {error && !error.includes('支付密码') && !error.includes('6 位') && (
          <p className="flex items-start gap-2 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
            <AlertIcon size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
