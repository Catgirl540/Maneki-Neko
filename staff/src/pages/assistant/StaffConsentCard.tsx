import { useEffect, useState } from 'react'
import type { CustomerVerification } from '../../../../app/src/api/agent'
import type { PendingConsent } from '../../../../app/src/lib/useAgentChat'
import { Button } from '../../../../app/src/components/ui/Button'

/** 员工身份核验不能套用客户支付密码流程；核验结果仅提交给员工 Agent。 */
export function StaffConsentCard({ pending, onApprove, onReject }: {
  pending: PendingConsent
  onApprove: (verification?: CustomerVerification) => void
  onReject: () => void
}) {
  const { challenge, submitting, error } = pending
  const [checked, setChecked] = useState(false)
  const [method, setMethod] = useState('phone')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const expired = now >= challenge.expiresAt
  const disabled = submitting || expired
  return <section className="mx-auto w-full max-w-2xl rounded-card border border-gold bg-gold-tint p-5 sm:p-6" aria-label="操作确认">
    <h3 className="mb-4 font-semibold text-ink">{challenge.kind} · 待确认</h3>
    <dl className="space-y-3 text-sm">{challenge.fields.map((field, i) => <div key={i} className="grid grid-cols-[minmax(80px,100px)_minmax(0,1fr)] gap-3">
      <dt className="text-ink-soft">{field.label}</dt>
      <dd className={`whitespace-pre-wrap break-all text-ink ${field.emphasis ? 'font-semibold' : ''}`}>{field.value}</dd>
    </div>)}</dl>
    {challenge.consequence && <p className="my-4 text-sm text-ink-soft">{challenge.consequence}</p>}
    {challenge.requiresCustomerVerification && <fieldset disabled={disabled} className="my-4 space-y-3 rounded-field bg-surface p-4">
      <label className="block text-sm text-ink">已完成的客户核验方式
        <select className="mt-2 w-full rounded-tile border border-line-strong bg-surface p-3 text-sm focus:outline-gold" value={method} onChange={e => setMethod(e.target.value)}>
          <option value="phone">电话核验</option><option value="sms">短信核验</option><option value="face">人脸核验</option>
        </select>
      </label>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" className="mt-0.5 shrink-0 accent-gold" checked={checked} onChange={e => setChecked(e.target.checked)} />
        我已按业务流程完成客户身份核验，结果通过
      </label>
    </fieldset>}
    {error && <p role="alert" className="mb-3 text-sm text-coral">{error}</p>}
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={disabled} onClick={onReject}>取消</Button>
      <Button variant="primary" disabled={disabled || (challenge.requiresCustomerVerification && !checked)} loading={submitting}
        onClick={() => onApprove(challenge.requiresCustomerVerification ? { method, result: 'passed' } : undefined)}>
        {challenge.requiresCustomerVerification ? '确认并办理' : '确认'}
      </Button>
      <span role="timer" className="text-xs text-ink-soft">{expired ? '已过期，请重新发起' : `${Math.ceil((challenge.expiresAt - now) / 1000)} 秒内有效`}</span>
    </div>
  </section>
}
