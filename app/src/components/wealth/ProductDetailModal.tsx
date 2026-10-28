import { useState } from 'react'
import { api, ApiError } from '@/api'
import type { RiskAssessment, WealthProduct, WealthSubscribeResult } from '@/api/types'
import { Sparkline } from '@/components/charts/Sparkline'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PinInput } from '@/components/ui/PinInput'
import { Segmented } from '@/components/ui/Segmented'
import { AlertIcon, CheckIcon } from '@/components/ui/icons'
import { formatAmount, toCents } from '@/lib/format'
import {
  BENCHMARK_DISCLAIMER,
  CATEGORY_LABEL,
  RISK_ACKNOWLEDGEMENT,
  RISK_DEFINITION,
  RISK_PLAIN_LABEL,
  WEALTH_DEPOSIT_WARNING,
  benchmarkLabel,
  canBuyRisk,
  rateLabel,
  suitabilityMessage,
} from '@/lib/wealth'
import { RiskBadge } from './RiskBadge'

type View = 'detail' | 'subscribe' | 'done'

const PERCENT = (v: number) => `${v >= 0 ? '' : '-'}${Math.abs(v * 100).toFixed(2)}%`

/**
 * 理财产品详情 + 申购。
 *
 * 页面顺序是按披露要求排的，不是按营销逻辑：
 *   风险等级（通俗说法在前）→ 业绩比较基准 + 测算依据 + 免责声明 → 净值走势
 *   → 费用（按日计提 / 一次性，两类分开）→ 穿透前后前十大资产 → 风险揭示
 */
export function ProductDetailModal({
  product,
  risk,
  accountOpened,
  onClose,
  onSubscribed,
  onNeedAssessment,
  onNeedAccount,
}: {
  product: WealthProduct
  risk: RiskAssessment
  /** 是否已开立理财账户。没开的话连申购入口都不给 */
  accountOpened: boolean
  onClose: () => void
  onSubscribed: () => void
  onNeedAssessment: () => void
  onNeedAccount: () => void
}) {
  const [view, setView] = useState<View>('detail')
  const [detailSection, setDetailSection] = useState<'overview' | 'performance' | 'fees' | 'risk'>('overview')
  const [amountText, setAmountText] = useState('')
  const [amountEditing, setAmountEditing] = useState(false)
  const [acknowledgement, setAcknowledgement] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<WealthSubscribeResult | null>(null)

  const amount = toCents(amountText || '0')
  const assessable = risk.done && !risk.expired
  const matched = assessable && canBuyRisk(risk.level, product.risk)
  const feeItem = product.transactionFees.find((f) => f.label.startsWith('申购'))
  const fee = feeItem ? Math.round(amount * feeItem.rate) : 0
  const estimatedShares = amount > 0 ? (amount - fee) / product.nav : 0

  const quick = [product.minAmount, product.minAmount * 2, product.minAmount * 5].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  )

  async function submit() {
    setError(null)
    if (amount < product.minAmount) {
      setError(`起购金额 ¥${formatAmount(product.minAmount)}`)
      return
    }
    if (amount % product.stepAmount !== 0) {
      setError(`追加金额需为 ¥${formatAmount(product.stepAmount)} 的整数倍`)
      return
    }
    if (acknowledgement.trim() !== RISK_ACKNOWLEDGEMENT) {
      setError(`请完整抄录风险确认语句：${RISK_ACKNOWLEDGEMENT}`)
      return
    }
    if (!/^\d{6}$/.test(password)) {
      setError('请输入 6 位数字支付密码')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.subscribeWealth({
        productCode: product.code,
        amount,
        paymentPassword: password,
        riskAcknowledgement: acknowledgement.trim(),
      })
      setResult(res)
      setView('done')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '申购失败，请稍后重试')
      if (err instanceof ApiError && err.code?.includes('PAY_PASSWORD')) setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeDisabled={submitting}
      width="max-w-[600px]"
      title={view === 'detail' ? product.name : view === 'subscribe' ? '确认申购' : '申购已受理'}
      description={view === 'detail' ? `${product.issuer} · ${CATEGORY_LABEL[product.category]}` : undefined}
      footer={
        view === 'detail' ? (
          <>
            <Button block onClick={onClose}>
              关闭
            </Button>
            {!accountOpened ? (
              <Button block variant="primary" onClick={onNeedAccount}>
                先开立理财账户
              </Button>
            ) : !assessable ? (
              <Button block variant="primary" onClick={onNeedAssessment}>
                先完成风险测评
              </Button>
            ) : (
              <Button
                block
                variant="primary"
                disabled={!matched}
                onClick={() => setView('subscribe')}
              >
                {matched ? '立即申购' : '风险等级不匹配'}
              </Button>
            )}
          </>
        ) : view === 'subscribe' ? (
          <>
            <Button block onClick={() => setView('detail')} disabled={submitting}>
              返回
            </Button>
            <Button block variant="primary" loading={submitting}
              disabled={!matched || !Number.isSafeInteger(amount) || amount < product.minAmount || amount % product.stepAmount !== 0 || acknowledgement.trim() !== RISK_ACKNOWLEDGEMENT || !/^\d{6}$/.test(password)}
              onClick={() => void submit()}>
              {amount > 0 ? `支付 ¥${formatAmount(amount)} 并申购` : '确认申购'}
            </Button>
          </>
        ) : (
          <Button
            block
            variant="primary"
            onClick={() => {
              onSubscribed()
            }}
          >
            完成
          </Button>
        )
      }
    >
      <div className="flex max-h-[62vh] flex-col gap-5 overflow-y-auto pr-1">
        {view === 'detail' && (
          <>
            <Segmented value={detailSection} onChange={setDetailSection} options={[
              { value: 'overview', label: '产品概况' }, { value: 'performance', label: '净值走势' },
              { value: 'fees', label: '费用规则' }, { value: 'risk', label: '资产与风险' },
            ]} />
            <div className="flex flex-wrap items-center gap-2.5">
              <RiskBadge risk={product.risk} />
              <span className="inline-flex h-7 items-center rounded-chip border border-line bg-surface px-2.5 text-[12px] text-ink-soft">
                {product.term}
              </span>
              <span className="num inline-flex h-7 items-center rounded-chip border border-line bg-surface px-2.5 text-[12px] text-ink-soft">
                {formatAmount(product.minAmount)} 元起购
              </span>
            </div>

            {/* 关键数字 */}
            <dl className="grid grid-cols-2 gap-4 rounded-field bg-sunk px-4 py-4 sm:grid-cols-4">
              <div>
                <dt className="text-[12px] text-ink-mute">单位净值</dt>
                <dd className="num mt-1 text-[17px] font-semibold text-ink">
                  {product.nav.toFixed(4)}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-mute">
                  {product.sevenDayYield != null ? '七日年化' : '成立以来年化'}
                </dt>
                <dd className="num mt-1 text-[17px] font-semibold text-ink">
                  {PERCENT(product.sevenDayYield ?? product.sinceInception)}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-mute">近一月年化波动率</dt>
                <dd className="num mt-1 text-[17px] font-semibold text-ink">
                  {PERCENT(product.volatility)}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-mute">净值日期</dt>
                <dd className="num mt-1 text-[17px] font-semibold text-ink">{product.navDate}</dd>
              </div>
            </dl>

            {/* 业绩比较基准 */}
            <section hidden={detailSection !== 'overview'} className="rounded-field border border-line px-4 py-4">
              <p className="text-[12px] text-ink-mute">业绩比较基准</p>
              <p className="num mt-1.5 text-[15px] leading-relaxed font-medium text-ink">
                {benchmarkLabel(product.benchmark)}
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-mute">
                测算依据：{product.benchmark.basis}
              </p>
              <p className="mt-3 rounded-[8px] bg-coral-wash px-3 py-2.5 text-[12px] leading-relaxed text-coral">
                {BENCHMARK_DISCLAIMER}
              </p>
            </section>

            {/* 净值走势 */}
            <section hidden={detailSection !== 'performance'}>
              <p className="mb-3 text-[13px] font-medium text-ink-soft">近 30 个交易日净值</p>
              <Sparkline points={product.navHistory} />
            </section>

            {/* 费用：两类分开列 —— 承担方式完全不同 */}
            <section hidden={detailSection !== 'fees'}>
              <p className="mb-3 text-[13px] font-medium text-ink-soft">费用</p>
              <div className="flex flex-col gap-3">
                <div className="rounded-field bg-sunk px-4 py-3.5">
                  <p className="text-[12px] font-medium text-ink">按日计提（已体现在净值里）</p>
                  <dl className="mt-2.5 flex flex-col gap-2 text-[13px]">
                    {product.ongoingFees.map((f) => (
                      <div key={f.label} className="flex justify-between">
                        <dt className="text-ink-soft">{f.label}</dt>
                        <dd className="num text-ink">{rateLabel(f.rate)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-mute">
                    这几项直接从产品资产中计提，你看到的净值已经是扣除后的结果，不额外向你收费。
                  </p>
                </div>

                <div className="rounded-field bg-sunk px-4 py-3.5">
                  <p className="text-[12px] font-medium text-ink">一次性收取（你额外承担）</p>
                  {product.transactionFees.length === 0 ? (
                    <p className="mt-2 text-[13px] text-ink-soft">本产品申购、赎回均免费</p>
                  ) : (
                    <dl className="mt-2.5 flex flex-col gap-2 text-[13px]">
                      {product.transactionFees.map((f) => (
                        <div key={f.label} className="flex justify-between">
                          <dt className="text-ink-soft">{f.label}</dt>
                          <dd className="num text-ink">{(f.rate * 100).toFixed(2)}%</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
            </section>

            {/* 前十大资产：穿透前 / 穿透后 */}
            <section hidden={detailSection !== 'risk'}>
              <p className="mb-3 text-[13px] font-medium text-ink-soft">前十大资产</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {[false, true].map((lookThrough) => (
                  <div key={String(lookThrough)} className="rounded-field border border-line px-4 py-3.5">
                    <p className="text-[12px] font-medium text-ink">
                      {lookThrough ? '穿透后' : '穿透前'}
                    </p>
                    <ul className="mt-2.5 flex flex-col gap-2 text-[13px]">
                      {product.topHoldings
                        .filter((h) => h.lookThrough === lookThrough)
                        .map((h) => (
                          <li key={h.name} className="flex justify-between gap-3">
                            <span className="min-w-0 flex-1 truncate text-ink-soft">{h.name}</span>
                            <span className="num shrink-0 text-ink">
                              {(h.weight * 100).toFixed(2)}%
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {/* 风险揭示 */}
            <section className="rounded-field border border-coral-wash bg-coral-wash/40 px-4 py-4">
              <p className="text-[13px] font-semibold text-coral">{WEALTH_DEPOSIT_WARNING}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                <span className="font-medium text-ink">
                  {product.risk} {RISK_PLAIN_LABEL[product.risk]}
                </span>
                ：{RISK_DEFINITION[product.risk]}。
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                本产品不保证本金和收益，最不利情况下可能损失全部本金。以上展示的净值与收益率均为历史数据，
                不代表未来表现。
              </p>
            </section>
          </>
        )}

        {view === 'subscribe' && (
          <>
            {!matched && assessable && (
              <p className="rounded-field bg-coral-wash px-4 py-3.5 text-[13px] leading-relaxed text-coral">
                {suitabilityMessage(risk.level, product.risk)}
              </p>
            )}

            <div className="rounded-field bg-sunk px-4 py-3.5">
              <p className="text-[14px] font-medium text-ink">{product.name}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-mute">
                <RiskBadge risk={product.risk} showLevel={false} />
                <span className="num">单位净值 {product.nav.toFixed(4)}</span>
                <span className="num">
                  起购 ¥{formatAmount(product.minAmount)} · 递增 ¥{formatAmount(product.stepAmount)}
                </span>
              </p>
            </div>

            <Field
              label="申购金额（元）"
              id="wealth-subscribe-amount"
              type="number"
              min={product.minAmount / 100}
              step="0.01"
              name="wealth-subscribe-amount"
              autoComplete="off"
              readOnly={!amountEditing}
              onFocus={() => setAmountEditing(true)}
              value={amountText}
              inputMode="decimal"
              onChange={(e) => { if (amountEditing) setAmountText(e.target.value.replace(/[^\d.]/g, '')) }}
              placeholder={formatAmount(product.minAmount)}
            />
            <div className="flex flex-wrap gap-2">
              {quick.map((cents) => (
                <button
                  key={cents}
                  type="button"
                  onClick={() => setAmountText(String(cents / 100))}
                  className="h-9 rounded-chip border border-line px-3.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
                >
                  ¥{formatAmount(cents)}
                </button>
              ))}
            </div>

            <dl className="flex flex-col gap-3 rounded-field bg-sunk px-4 py-3.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-soft">申购费</dt>
                <dd className="num text-ink">{fee > 0 ? `¥${formatAmount(fee)}（内扣）` : '免费'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">预计确认份额</dt>
                <dd className="num text-ink">
                  {estimatedShares > 0 ? estimatedShares.toFixed(2) : '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="text-ink-soft">从储蓄账户扣除</dt>
                <dd className="num text-[15px] font-semibold text-ink">¥{formatAmount(amount)}</dd>
              </div>
            </dl>

            {/* 风险确认语句：监管要求投资者完整抄录，不是一个勾选框 */}
            <section>
              <p className="mb-2 text-[13px] font-medium text-ink-soft">风险确认</p>
              <p className="rounded-field border border-line bg-sunk px-4 py-3 text-[13px] leading-relaxed text-ink">
                {RISK_ACKNOWLEDGEMENT}
              </p>
              <label className="mt-3 block text-[12px] text-ink-soft" htmlFor="wealth-risk-acknowledgement">请本人完整抄录上方语句</label>
              <textarea
                id="wealth-risk-acknowledgement"
                name="wealth-risk-acknowledgement"
                autoComplete="off"
                rows={2}
                value={acknowledgement}
                onChange={event => setAcknowledgement(event.target.value)}
                placeholder="请完整抄录上面这句话"
                aria-label="抄录风险确认语句"
                aria-invalid={acknowledgement.length > 0 && acknowledgement.trim() !== RISK_ACKNOWLEDGEMENT}
                className="mt-2 w-full resize-none rounded-field border border-line bg-surface p-3 text-[14px] text-ink outline-none focus:border-gold"
              />
              {acknowledgement.length > 0 && acknowledgement.trim() !== RISK_ACKNOWLEDGEMENT && <p role="alert" className="mt-2 text-[12px] text-coral">与要求语句不一致</p>}
            </section>

            <PinInput
              label="支付密码"
              value={password}
              onChange={setPassword}
              disabled={submitting}
              error={error && error.includes('支付密码') ? error : undefined}
            />
            <p className="text-[12px] leading-relaxed text-ink-mute">
              连续输错 5 次会冻结账号，需联系工作人员解冻。
            </p>

            {error && !error.includes('支付密码') && (
              <p className="flex items-start gap-2 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
                <AlertIcon size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
          </>
        )}

        {view === 'done' && result && (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-chip bg-blue-wash text-blue">
              <CheckIcon size={28} />
            </span>
            <p className="mt-4 text-[18px] font-semibold text-ink">申购已受理</p>
            <p className="num mt-3 text-[30px] leading-none font-bold text-ink">
              {result.shares.toFixed(2)}
            </p>
            <p className="mt-2 text-[13px] text-ink-mute">确认份额</p>

            <dl className="mt-6 flex flex-col gap-3 border-t border-line pt-5 text-left text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-soft">产品</dt>
                <dd className="text-ink">{product.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">确认金额</dt>
                <dd className="num text-ink">¥{formatAmount(amount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">确认净值</dt>
                <dd className="num text-ink">{result.nav.toFixed(4)}</dd>
              </div>
              {result.fees > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-soft">申购费</dt>
                  <dd className="num text-ink">¥{formatAmount(result.fees)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-soft">确认时间</dt>
                <dd className="num text-ink">{result.confirmedAt.slice(0, 19).replace('T', ' ')}</dd>
              </div>
            </dl>

            <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">
              确认信息以理财公司发出的确认为准。份额与收益可在「我的持仓」查看。
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
