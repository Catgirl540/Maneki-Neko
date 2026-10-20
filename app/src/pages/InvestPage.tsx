import { useMemo, useState } from 'react'
import { api, ApiError } from '@/api'
import type { Account, InvestPlan, InvestProduct, InvestmentsOverview } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PinInput } from '@/components/ui/PinInput'
import { Segmented, Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { AlertIcon, BoltIcon, ChartIcon, SparkleIcon, WalletIcon } from '@/components/ui/icons'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { parseAmountInput } from '@/lib/amountInput'
import { useToast } from '@/components/ui/toast-context'

const CATEGORY_LABEL: Record<InvestProduct['category'], string> = {
  fund: '基金',
  etf: '指数基金',
  stock: '股票',
  robo: '智能投顾',
}
const RISK_LABEL: Record<InvestProduct['risk'], string> = { low: '低风险', medium: '中风险', high: '高风险' }
const CYCLES = [
  { value: '每周', label: '每周' },
  { value: '每两周', label: '每两周' },
  { value: '每月', label: '每月' },
]

export function InvestPage() {
  const toast = useToast()
  const investments = useAsync<InvestmentsOverview>(() => api.getInvestments(), [])
  const accounts = useAsync<Account[]>(() => api.listAccounts(), [])
  const [target, setTarget] = useState<InvestProduct | null>(null)
  const [planAction, setPlanAction] = useState<{ plan: InvestPlan; status: InvestPlan['status'] } | null>(null)
  const [amountText, setAmountText] = useState('')
  const [cycle, setCycle] = useState('每月')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<InvestPlan | null>(null)

  const account = useMemo(() => accounts.data?.find(account => account.currency === 'CNY') ?? null, [accounts.data])

  function openPlan(product: InvestProduct) {
    setTarget(product)
    setAmountText(String(product.minAmount / 100))
    setCycle('每月')
    setPassword('')
    setFormError(null)
  }

  async function submitPlan() {
    if (!target || !account) return
    const amount = parseAmountInput(amountText)
    if (amount === null) return setFormError('请输入有效金额，最多两位小数')
    if (amount < target.minAmount) return setFormError(`该产品起投 ¥${formatAmount(target.minAmount)}`)
    if (password.length < 6) return setFormError('请输入 6 位支付密码')
    setBusy(true)
    setFormError(null)
    try {
      const plan = await api.createInvestPlan({ productCode: target.code, amount, cycle, accountId: account.id, paymentPassword: password })
      investments.reload()
      setTarget(null)
      setResult(plan)
      toast.show('定投计划已保存', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BAD_PAY_PASSWORD') setPassword('')
      setFormError(err instanceof Error ? err.message : '创建失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  async function submitPlanAction() {
    if (!planAction) return
    if (planAction.status === 'active' && password.length !== 6) return setFormError('请输入 6 位支付密码')
    setBusy(true)
    setFormError(null)
    try {
      await api.updateInvestPlan(planAction.plan.id, { status: planAction.status, expectedRevision: planAction.plan.revision ?? 0,
        ...(planAction.status === 'active' ? { paymentPassword: password } : {}) })
      investments.reload()
      setPlanAction(null)
      setPassword('')
      toast.show(planAction.status === 'cancelled' ? '计划已取消，投资历史保留' : planAction.status === 'paused' ? '计划已暂停' : '计划已恢复保存，自动扣款尚未开放', 'success')
    } catch (err) {
      setPassword('')
      setFormError(err instanceof Error ? err.message : '更新失败，请稍后重试')
      investments.reload()
    } finally { setBusy(false) }
  }

  function openPlanAction(plan: InvestPlan, status: InvestPlan['status']) {
    setPlanAction({ plan, status })
    setPassword('')
    setFormError(null)
  }

  if (!investments.data || !accounts.data) {
    const error = investments.error ?? accounts.error
    return error ? <DataUnavailable message={error} onRetry={() => { investments.reload(); accounts.reload() }} /> : <DataLoading />
  }
  const data = investments.data

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">投资与定投</h1>

      <Card className="float-up">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[13px] text-ink-soft">持有市值</p>
            <p className="num mt-1 text-[34px] leading-none font-bold text-ink">¥{formatAmount(data.holding)}</p>
            <p className="mt-2 text-[13px] text-ink-mute">累计收益 <span className={data.totalReturn >= 0 ? 'text-gold-deep' : 'text-coral'}>{data.totalReturn >= 0 ? '+' : '-'}¥{formatAmount(Math.abs(data.totalReturn))}</span></p>
          </div>
          <span className="grid size-12 place-items-center rounded-tile bg-gold-tint text-gold-deep"><ChartIcon size={22} /></span>
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '70ms' }}>
        <CardHeader title="我的定投" action={<span className="text-[13px] text-ink-mute">{data.plans.length} 个</span>} />
        <div className="mt-3 divide-y divide-line">
          {data.plans.map((plan) => (
            <div key={plan.id} className="flex items-center gap-4 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep"><BoltIcon size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">{plan.productName}</span>
                <span className="mt-0.5 block text-[13px] text-ink-mute">{plan.cycle}定投 ¥{formatAmount(plan.amount)} · 已投 {plan.executedRuns} 次</span>
                <span className="mt-0.5 block text-[12px] text-ink-mute">计划日期 {formatDate(plan.nextRunAt)}</span>
              </span>
              <span className="shrink-0 text-right">
                <Tag tone={plan.status === 'active' ? 'gold' : 'neutral'}>{plan.status === 'active' ? '已保存' : plan.status === 'cancelled' ? '已取消' : '已暂停'}</Tag>
                <span className="num mt-1 block text-[13px] text-ink-mute">累计 ¥{formatAmount(plan.totalInvested)}</span>
                {plan.status !== 'cancelled' && <span className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openPlanAction(plan, plan.status === 'active' ? 'paused' : 'active')}>{plan.status === 'active' ? '暂停' : '恢复'}</Button>
                  <Button size="sm" variant="secondary" onClick={() => openPlanAction(plan, 'cancelled')}>取消计划</Button>
                </span>}
              </span>
            </div>
          ))}
          {data.plans.length === 0 && <p className="py-8 text-center text-[13px] text-ink-mute">还没有定投计划，选择一个产品开始定投。</p>}
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '140ms' }}>
        <CardHeader title="可投产品" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {data.products.map((product) => (
            <div key={product.id} className="flex flex-col rounded-tile border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[16px] font-semibold text-ink">{product.name}</h3>
                <Tag tone="neutral">{CATEGORY_LABEL[product.category]}</Tag>
              </div>
              <div className="mt-3 flex items-center gap-4">
                <span className="num text-[18px] font-semibold text-gold-deep">{product.oneYearReturn >= 0 ? '+' : ''}{(product.oneYearReturn * 100).toFixed(2)}%</span>
                <span className="text-[12px] text-ink-mute">近一年 · {RISK_LABEL[product.risk]}</span>
              </div>
              <dl className="mt-3 flex flex-col gap-1.5 text-[12px] text-ink-mute">
                <div className="flex justify-between"><dt>净值</dt><dd className="num text-ink">{product.nav.toFixed(4)}</dd></div>
                <div className="flex justify-between"><dt>起投</dt><dd className="num text-ink">¥{formatAmount(product.minAmount)}</dd></div>
              </dl>
              <div className="mt-4">
                <Button block variant="primary" size="sm" icon={<SparkleIcon size={15} />} disabled={!account} onClick={() => openPlan(product)}>新建计划</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-[12px] leading-relaxed text-ink-mute">基金投资有风险，过往业绩不代表未来表现。当前仅保存和管理计划，自动扣款暂未开放；计划日期不代表已预约执行，不扣款或冻结资金。</p>

      <Modal open={Boolean(planAction)} onClose={() => { if (!busy) { setPlanAction(null); setPassword('') } }} closeDisabled={busy}
        title={planAction?.status === 'cancelled' ? '取消定投计划' : planAction?.status === 'paused' ? '暂停定投计划' : '恢复定投计划'}
        footer={<><Button block variant="secondary" disabled={busy} onClick={() => { setPlanAction(null); setPassword('') }}>返回</Button><Button block variant="primary" loading={busy} onClick={() => void submitPlanAction()}>确认{planAction?.status === 'cancelled' ? '取消计划' : planAction?.status === 'paused' ? '暂停' : '恢复'}</Button></>}>
        {planAction && <div className="flex flex-col gap-4">
          <p className="text-[15px] text-ink">{planAction.plan.productName} · {planAction.plan.cycle} ¥{formatAmount(planAction.plan.amount)}</p>
          <p className="text-[13px] text-ink-mute">{planAction.status === 'cancelled' ? '取消后不可恢复，已有投资历史保留；不会赎回或退款。' : '仅修改保存的计划状态，当前自动扣款尚未开放。恢复时重新核对测评与产品条件。'}</p>
          {planAction.status === 'active' && <PinInput label="支付密码" value={password} onChange={setPassword} />}
          {formError && <p role="alert" className="text-[13px] text-coral">{formError}</p>}
        </div>}
      </Modal>

      <Modal
        open={Boolean(target)}
        onClose={() => { if (!busy) setTarget(null) }}
        title={target ? `定投 · ${target.name}` : '定投'}
        description="保存产品、金额与周期，不扣款、不创建自动执行任务。"
        closeDisabled={busy}
        footer={
          <>
            <Button block variant="secondary" onClick={() => setTarget(null)} disabled={busy}>取消</Button>
            <Button block variant="primary" loading={busy} onClick={() => void submitPlan()}>确认创建</Button>
          </>
        }
      >
        {target && (
          <div className="flex flex-col gap-4">
            <Field label="每期金额" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} trailing={<span className="text-[13px] text-ink-mute">元</span>} hint={`起投 ¥${formatAmount(target.minAmount)}`} />
            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-soft">定投周期</p>
              <Segmented disabled={busy} value={cycle} options={CYCLES} onChange={setCycle} />
            </div>
            <PinInput label="支付密码" value={password} onChange={(next) => { setPassword(next); setFormError(null) }} error={formError && formError.includes('密码') ? formError : undefined} />
            {formError && !formError.includes('密码') && (
              <p role="alert" className="flex items-start gap-2 text-[13px] text-coral"><AlertIcon size={16} className="mt-0.5 shrink-0" />{formError}</p>
            )}
            <p className="text-[12px] text-ink-mute">计划账户：{account ? account.label : '暂无可用人民币账户'}。</p>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(result)}
        onClose={() => setResult(null)}
        title="计划已保存"
        footer={<Button block variant="primary" onClick={() => setResult(null)}>完成</Button>}
      >
        {result && (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-chip bg-blue-wash text-blue"><WalletIcon size={28} /></span>
            <p className="mt-4 text-[18px] font-semibold text-ink">{result.productName}</p>
            <p className="num mt-2 text-[13px] text-ink-mute">{result.cycle}定投 ¥{formatAmount(result.amount)}</p>
            <p className="mt-1 text-[12px] text-ink-mute">计划日期 {formatDate(result.nextRunAt)}</p>
            <p className="mt-2 text-[12px] text-ink-mute">仅保存计划，自动扣款尚未开放。</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
