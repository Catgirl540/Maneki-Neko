import { useState } from 'react'
import { api, ApiError } from '@/api'
import type { InsuranceOverview, InsurancePolicy, InsuranceProduct } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PinInput } from '@/components/ui/PinInput'
import { Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { AlertIcon, CheckIcon, ShieldIcon, UserIcon } from '@/components/ui/icons'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'

/** 健康告知 3 问：任一为「是」→ 拒绝在线投保并引导转人工（与 challenge 侧同一口径）。 */
const HEALTH_QUESTIONS = [
  { key: 'hospital', label: '近 5 年是否曾因疾病或意外住院、手术？' },
  { key: 'chronic', label: '是否曾被医生诊断高血压、糖尿病等慢性疾病？' },
  { key: 'tumor', label: '是否曾被诊断恶性肿瘤、结节或相关占位性病变？' },
] as const

const DISCLAIMER_SUMMARY =
  '投保前请仔细阅读保险条款。犹豫期后退保可能产生损失。本产品不保证续保。既往症及条款列明的除外责任不在保障范围内。'
const WAITING_PERIOD_SUMMARY =
  '重疾险 90 天 / 医疗险 30 天 / 意外险 0 天，具体以条款为准。等待期内出险不承担赔付责任。'

type HealthAnswer = 'yes' | 'no' | null

export function InsurancePage() {
  const toast = useToast()
  const insurance = useAsync<InsuranceOverview>(() => api.getInsurance(), [])
  const [target, setTarget] = useState<InsuranceProduct | null>(null)
  const [insuredName, setInsuredName] = useState('')
  const [health, setHealth] = useState<HealthAnswer[]>([null, null, null])
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<InsurancePolicy | null>(null)

  function openEnroll(product: InsuranceProduct) {
    setTarget(product)
    setInsuredName('')
    setHealth([null, null, null])
    setPassword('')
    setFormError(null)
  }

  const healthDeclined = health.some((v) => v === 'yes')
  const healthReady = health.every((v) => v !== null)

  async function submitEnroll() {
    if (!target) return
    if (!insuredName.trim()) return setFormError('请填写被保人姓名')
    if (!healthReady) return setFormError('请完整回答健康告知 3 个问题')
    if (healthDeclined) return setFormError('健康告知中存在异常项，无法在线投保，请转人工客服咨询。')
    if (password.length < 6) return setFormError('请输入 6 位支付密码')
    setBusy(true)
    setFormError(null)
    try {
      const policy = await api.enrollInsurance({
        productId: target.id,
        insuredName: insuredName.trim(),
        healthAnswers: health.map((v) => v ?? 'no').join(','),
        paymentPassword: password,
      })
      insurance.reload()
      setTarget(null)
      setResult(policy)
      toast.show('投保成功', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BAD_PAY_PASSWORD') setPassword('')
      setFormError(err instanceof ApiError ? err.message : '投保失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  if (!insurance.data) return insurance.error ? <DataUnavailable message={insurance.error} onRetry={insurance.reload} /> : <DataLoading />
  const data = insurance.data
  const policyTone = (status: InsurancePolicy['status']) => (status === 'active' ? 'gold' : status === 'pending' ? 'blue' : 'neutral')

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">保险保障</h1>

      <Card className="float-up">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[13px] text-ink-soft">总保额</p>
            <p className="num mt-1 text-[34px] leading-none font-bold text-ink">¥{formatAmount(data.totalCoverage)}</p>
            <p className="mt-2 text-[13px] text-ink-mute">共 {data.policies.length} 份保单</p>
          </div>
          <span className="grid size-12 place-items-center rounded-tile bg-gold-tint text-gold-deep"><ShieldIcon size={22} /></span>
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '70ms' }}>
        <CardHeader title="我的保单" />
        <div className="mt-3 divide-y divide-line">
          {data.policies.map((policy) => (
            <div key={policy.id} className="flex items-center gap-4 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep"><ShieldIcon size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">{policy.productName}</span>
                <span className="mt-0.5 block text-[13px] text-ink-mute">{policy.insurer} · 被保人 {policy.insuredName}</span>
                <span className="mt-0.5 block text-[12px] text-ink-mute">保障期至 {formatDate(policy.expireAt)}</span>
              </span>
              <span className="shrink-0 text-right">
                <Tag tone={policyTone(policy.status)}>{policy.status === 'active' ? '保障中' : policy.status === 'pending' ? '待生效' : '已过期'}</Tag>
                <span className="num mt-1 block text-[13px] text-ink-mute">保额 ¥{formatAmount(policy.coverage)}</span>
              </span>
            </div>
          ))}
          {data.policies.length === 0 && <p className="py-8 text-center text-[13px] text-ink-mute">还没有保单，选择一款保障为家人添一份安心。</p>}
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '140ms' }}>
        <CardHeader title="可投保产品" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {data.products.map((product) => (
            <div key={product.id} className="flex flex-col rounded-tile border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[16px] font-semibold text-ink">{product.name}</h3>
                <Tag tone="neutral">{product.category}</Tag>
              </div>
              <p className="mt-2 text-[13px] text-ink-soft">{product.highlight}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.tags.map((tag) => <Tag key={tag} tone="gold">{tag}</Tag>)}
              </div>
              <dl className="mt-4 flex flex-col gap-1.5 text-[12px] text-ink-mute">
                <div className="flex justify-between"><dt>保额</dt><dd className="num text-ink">¥{formatAmount(product.coverage)}</dd></div>
                <div className="flex justify-between"><dt>年缴保费</dt><dd className="num text-ink">¥{formatAmount(product.premiumPerYear)}</dd></div>
                <div className="flex justify-between"><dt>承保方</dt><dd className="text-ink">{product.insurer}</dd></div>
              </dl>
              <div className="mt-4">
                <Button block variant="primary" size="sm" icon={<ShieldIcon size={15} />} onClick={() => openEnroll(product)}>立即投保</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-[12px] leading-relaxed text-ink-mute">保险条款、等待期与免责范围以保单及产品条款为准。投保后可在「我的保单」查看保障详情。</p>

      <Modal
        open={Boolean(target)}
        onClose={() => { if (!busy) setTarget(null) }}
        title={target ? `投保 · ${target.name}` : '投保'}
        description="确认被保人信息并用支付密码完成投保。"
        closeDisabled={busy}
        footer={
          <>
            <Button block variant="secondary" onClick={() => setTarget(null)} disabled={busy}>取消</Button>
            <Button block variant="primary" loading={busy} onClick={() => void submitEnroll()}>确认投保</Button>
          </>
        }
      >
        {target && (
          <div className="flex flex-col gap-4">
            <Field label="被保人姓名" value={insuredName} onChange={(e) => { setInsuredName(e.target.value); setFormError(null) }} maxLength={20} />

            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-soft">健康告知</p>
              <div className="flex flex-col gap-2.5">
                {HEALTH_QUESTIONS.map((q, i) => (
                  <div key={q.key} className="rounded-field border border-line px-4 py-3">
                    <p className="text-[13px] leading-relaxed text-ink">{q.label}</p>
                    <div className="mt-2 flex gap-2">
                      {(['no', 'yes'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={health[i] === v}
                          disabled={busy}
                          onClick={() => {
                            setHealth((prev) => prev.map((old, idx) => (idx === i ? v : old)))
                            setFormError(null)
                          }}
                          className={`min-h-9 rounded-chip border px-4 text-[13px] font-medium transition-colors ${
                            health[i] === v
                              ? 'border-gold-wash bg-gold-wash text-gold-deep'
                              : 'border-line bg-surface text-ink-soft hover:text-ink'
                          }`}
                        >
                          {v === 'no' ? '否' : '是'}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {healthDeclined && (
                <p role="alert" className="mt-2 flex items-start gap-2 text-[12px] leading-relaxed text-coral">
                  <AlertIcon size={15} className="mt-0.5 shrink-0" />
                  健康告知中存在异常项，无法在线投保。可联系人工客服进一步核实。
                </p>
              )}
            </div>

            <div className="rounded-field bg-sunk px-4 py-3.5 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-soft">保额</span><span className="num text-ink">¥{formatAmount(target.coverage)}</span></div>
              <div className="mt-2 flex justify-between"><span className="text-ink-soft">年缴保费</span><span className="num text-ink">¥{formatAmount(target.premiumPerYear)}</span></div>
            </div>

            <div className="rounded-field border border-line px-4 py-3 text-[12px] leading-relaxed text-ink-mute">
              <p className="font-medium text-ink-soft">免责摘要</p>
              <p className="mt-1">{DISCLAIMER_SUMMARY}</p>
              <p className="mt-2 font-medium text-ink-soft">等待期</p>
              <p className="mt-1">{WAITING_PERIOD_SUMMARY}</p>
            </div>

            <PinInput label="支付密码" value={password} onChange={(next) => { setPassword(next); setFormError(null) }} error={formError && formError.includes('密码') ? formError : undefined} />
            {formError && (
              <p role="alert" className="flex items-start gap-2 text-[13px] text-coral"><AlertIcon size={16} className="mt-0.5 shrink-0" />{formError}</p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(result)}
        onClose={() => setResult(null)}
        title="投保成功"
        footer={<Button block variant="primary" onClick={() => setResult(null)}>完成</Button>}
      >
        {result && (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-chip bg-blue-wash text-blue"><CheckIcon size={28} /></span>
            <p className="mt-4 text-[18px] font-semibold text-ink">{result.productName}</p>
            <p className="num mt-2 text-[13px] text-ink-mute">保额 ¥{formatAmount(result.coverage)}</p>
            <p className="mt-1 flex items-center justify-center gap-1 text-[12px] text-ink-mute"><UserIcon size={13} />被保人 {result.insuredName}</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
