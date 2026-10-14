import { useMemo, useState } from 'react'
import { api, ApiError } from '@/api'
import type { Account, CreditOverview, Loan, LoanProduct } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PinInput } from '@/components/ui/PinInput'
import { Segmented, Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { AlertIcon, BoltIcon, CheckIcon, PigIcon, SparkleIcon, WalletIcon } from '@/components/ui/icons'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { parseAmountInput } from '@/lib/amountInput'
import { useToast } from '@/components/ui/toast-context'

function ProgressBar({ ratio }: { ratio: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-chip bg-sunk" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-chip bg-gold transition-[width] duration-[var(--duration-state)] ease-[var(--ease-out-soft)]" style={{ width: `${percent}%` }} />
    </div>
  )
}

export function CreditPage() {
  const toast = useToast()
  const credit = useAsync<CreditOverview>(() => api.getCreditOverview(), [])
  const accounts = useAsync<Account[]>(() => api.listAccounts(), [])

  const [applyFor, setApplyFor] = useState<LoanProduct | null>(null)
  const [amountText, setAmountText] = useState('')
  const [term, setTerm] = useState(12)
  const [purpose, setPurpose] = useState('日常消费')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<Loan | null>(null)

  const payoutAccount = useMemo(() => accounts.data?.find(account => account.currency === 'CNY') ?? null, [accounts.data])

  function openApply(product: LoanProduct) {
    setApplyFor(product)
    setAmountText(String(product.minAmount / 100))
    setTerm(product.minTermMonths)
    setPurpose('日常消费')
    setPassword('')
    setFormError(null)
  }

  async function submitApply() {
    if (!applyFor || !payoutAccount) return
    const amount = parseAmountInput(amountText)
    if (amount === null) return setFormError('请输入有效金额，最多两位小数')
    if (amount < applyFor.minAmount || amount > applyFor.maxAmount) {
      return setFormError(`金额需在 ¥${formatAmount(applyFor.minAmount)}–¥${formatAmount(applyFor.maxAmount)} 之间`)
    }
    if (password.length < 6) return setFormError('请输入 6 位支付密码')
    setBusy(true)
    setFormError(null)
    try {
      const loan = await api.applyLoan({ productId: applyFor.id, amount, termMonths: term, purpose, accountId: payoutAccount.id, paymentPassword: password })
      credit.reload()
      accounts.reload()
      setApplyFor(null)
      setResult(loan)
      toast.show('借款已放款', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BAD_PAY_PASSWORD') setPassword('')
      setFormError(err instanceof ApiError ? err.message : '申请失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  if (!credit.data || !accounts.data) {
    const error = credit.error ?? accounts.error
    return error ? <DataUnavailable message={error} onRetry={() => { credit.reload(); accounts.reload() }} /> : <DataLoading />
  }
  const data = credit.data
  const termOptions = applyFor
    ? Array.from({ length: Math.floor((applyFor.maxTermMonths - applyFor.minTermMonths) / 3) + 1 }, (_, i) => applyFor.minTermMonths + i * 3).map((m) => ({ value: String(m), label: `${m} 期` }))
    : []

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">借款与分期</h1>

      <Card className="float-up">
        <CardHeader title="授信额度" action={<Tag tone="blue">信用良好</Tag>} />
        <div className="mt-4">
          <p className="text-[13px] text-ink-soft">可用额度</p>
          <p className="num mt-1 text-[34px] leading-none font-bold text-ink">¥{formatAmount(data.availableCredit)}</p>
          <ProgressBar ratio={data.availableCredit / data.creditLimit} />
          <p className="mt-2 text-[12px] text-ink-mute">总额度 ¥{formatAmount(data.creditLimit)} · 已用 ¥{formatAmount(data.creditLimit - data.availableCredit)}</p>
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '70ms' }}>
        <CardHeader title="可借产品" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {data.products.map((product) => (
            <div key={product.id} className="flex flex-col rounded-tile border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[16px] font-semibold text-ink">{product.name}</h3>
                <Tag tone="gold">年化 {(product.apr * 100).toFixed(1)}% 起</Tag>
              </div>
              <p className="mt-2 text-[13px] text-ink-soft">{product.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.tags.map((tag) => <Tag key={tag} tone="neutral">{tag}</Tag>)}
              </div>
              <dl className="mt-4 flex flex-col gap-1.5 text-[12px] text-ink-mute">
                <div className="flex justify-between"><dt>额度范围</dt><dd className="num text-ink">¥{formatAmount(product.minAmount)}–¥{formatAmount(product.maxAmount)}</dd></div>
                <div className="flex justify-between"><dt>期限</dt><dd className="num text-ink">{product.minTermMonths}–{product.maxTermMonths} 期</dd></div>
                <div className="flex justify-between"><dt>放款</dt><dd className="text-ink">{product.disbursement}</dd></div>
              </dl>
              <div className="mt-4">
                <Button block variant="primary" size="sm" icon={<BoltIcon size={15} />} disabled={!payoutAccount} onClick={() => openApply(product)}>立即借款</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '140ms' }}>
        <CardHeader title="我的借款" action={<span className="text-[13px] text-ink-mute">{data.loans.length} 笔</span>} />
        <div className="mt-3 divide-y divide-line">
          {data.loans.map((loan) => (
            <div key={loan.id} className="py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-medium text-ink">{loan.productName}</span>
                <span className="num text-[15px] font-semibold text-ink">¥{formatAmount(loan.outstanding)}</span>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-mute">本金 ¥{formatAmount(loan.principal)} · 月供 ¥{formatAmount(loan.monthlyPayment)} · 下期 {formatDate(loan.nextDueDate)}</p>
              <ProgressBar ratio={loan.paidPeriods / loan.totalPeriods} />
              <p className="mt-1 text-[12px] text-ink-mute">已还 {loan.paidPeriods}/{loan.totalPeriods} 期</p>
            </div>
          ))}
          {data.loans.length === 0 && <p className="py-8 text-center text-[13px] text-ink-mute">当前没有进行中的借款。</p>}
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '200ms' }}>
        <CardHeader title="分期计划" action={<span className="text-[13px] text-ink-mute">{data.installments.length} 笔</span>} />
        <div className="mt-3 divide-y divide-line">
          {data.installments.map((plan) => (
            <div key={plan.id} className="py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-medium text-ink">{plan.title}</span>
                <span className="num text-[15px] font-semibold text-ink">¥{formatAmount(plan.monthlyPayment)}/期</span>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-mute">{plan.merchant} · 剩余 ¥{formatAmount(plan.remainingAmount)} · 下期 {formatDate(plan.nextDueDate)}</p>
              <ProgressBar ratio={plan.paidPeriods / plan.periods} />
              <p className="mt-1 text-[12px] text-ink-mute">已还 {plan.paidPeriods}/{plan.periods} 期 · 手续费率 {(plan.feeRate * 100).toFixed(1)}%</p>
            </div>
          ))}
          {data.installments.length === 0 && <p className="py-8 text-center text-[13px] text-ink-mute">暂无分期计划。</p>}
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '260ms' }}>
        <CardHeader title="信用培养" action={<Tag tone="gold">{data.builder.level} · {data.builder.score} 分</Tag>} />
        <div className="mt-4 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-tile bg-gold-tint text-gold-deep"><SparkleIcon size={22} /></span>
          <div>
            <p className="text-[13px] text-ink-soft">连续按时还款</p>
            <p className="num text-[20px] font-semibold text-ink">{data.builder.streakMonths} 个月</p>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-gold-deep">{data.builder.nextMilestone}</p>
        <ul className="mt-3 flex flex-col gap-2">
          {data.builder.tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-[13px] text-ink-soft">
              <span className="mt-0.5 shrink-0 text-blue"><CheckIcon size={16} /></span>{tip}
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={Boolean(applyFor)}
        onClose={() => { if (!busy) setApplyFor(null) }}
        title={applyFor ? `借款 · ${applyFor.name}` : '借款'}
        description="核对金额、期限和收款账户后提交。"
        closeDisabled={busy}
        footer={
          <>
            <Button block variant="secondary" onClick={() => setApplyFor(null)} disabled={busy}>取消</Button>
            <Button block variant="primary" loading={busy} onClick={() => void submitApply()}>确认借款</Button>
          </>
        }
      >
        {applyFor && (
          <div className="flex flex-col gap-4">
            <Field label="借款金额" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} trailing={<span className="text-[13px] text-ink-mute">元</span>} />
            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-soft">借款期限</p>
              <Segmented value={String(term)} options={termOptions} onChange={(next) => setTerm(Number(next))} />
            </div>
            <Field label="借款用途" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={20} />
            <PinInput label="支付密码" value={password} onChange={(next) => { setPassword(next); setFormError(null) }} error={formError && formError.includes('密码') ? formError : undefined} />
            {formError && !formError.includes('密码') && (
              <p role="alert" className="flex items-start gap-2 text-[13px] text-coral"><AlertIcon size={16} className="mt-0.5 shrink-0" />{formError}</p>
            )}
            <p className="text-[12px] text-ink-mute">放款至 {payoutAccount ? payoutAccount.label : '储蓄账户'}；办理结果以返回记录为准。</p>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(result)}
        onClose={() => setResult(null)}
        title="放款成功"
        footer={<Button block variant="primary" onClick={() => setResult(null)}>完成</Button>}
      >
        {result && (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-chip bg-blue-wash text-blue"><WalletIcon size={28} /></span>
            <p className="num mt-4 text-[28px] leading-none font-bold text-ink">¥{formatAmount(result.principal)}</p>
            <p className="mt-2 text-[13px] text-ink-mute">已放款至储蓄账户</p>
            <dl className="mt-6 flex flex-col gap-3 border-t border-line pt-5 text-left text-[13px]">
              <div className="flex justify-between"><dt className="text-ink-soft">分 {result.totalPeriods} 期</dt><dd className="num text-ink">月供 ¥{formatAmount(result.monthlyPayment)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">年化利率</dt><dd className="num text-ink">{(result.apr * 100).toFixed(2)}%</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">下期还款</dt><dd className="num text-ink">{formatDate(result.nextDueDate)}</dd></div>
            </dl>
          </div>
        )}
      </Modal>

      {!payoutAccount && (
        <p className="flex items-start gap-2 text-[12px] text-ink-mute"><PigIcon size={15} className="mt-0.5 shrink-0" />未获取到储蓄账户，无法发起借款，请稍后重试。</p>
      )}
    </div>
  )
}
