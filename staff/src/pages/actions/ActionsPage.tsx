import { PageHeader } from '@/components/PageHeader'
import { useCallback, useState } from 'react'
import {
  ApiError,
  api,
  type CustomerActionRequest,
  type CustomerProfile,
  type CustomerSummary,
} from '@/api'
import { CARD_STATUS_LABEL, formatCents } from '../customers/labels'

/**
 * 代客办理（清单 §2 P1，乙模块）。
 * 白名单动作（锁卡/解锁/调限额/关闭代扣），复用客户端既有业务规则；提交前弹确认。
 * 目标字段 cardId/dailyLimit/autoDebitId/enabled 由契约 v1.2 提供（甲 [contract] 补）。
 */

type ActionKey = 'lockCard' | 'unlockCard' | 'updateCardSettings' | 'patchAutodebit'

const ACTIONS: Array<{ key: ActionKey; label: string; highImpact: boolean }> = [
  { key: 'lockCard', label: '锁卡', highImpact: false },
  { key: 'unlockCard', label: '解锁卡', highImpact: true },
  { key: 'updateCardSettings', label: '调整单日限额', highImpact: true },
  { key: 'patchAutodebit', label: '关闭代扣', highImpact: false },
]

const DAILY_LIMIT_OPTIONS = [200_000, 500_000, 1_000_000, 5_000_000]

const VERIFY_METHODS = [
  { value: 'sms', label: '短信核验' },
  { value: 'face', label: '人脸核验' },
  { value: 'phone', label: '电话核验' },
] as const

export function ActionsPage() {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<CustomerSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const [customer, setCustomer] = useState<CustomerSummary | null>(null)
  const [profile, setProfile] = useState<CustomerProfile | null>(null)

  const [action, setAction] = useState<ActionKey>('lockCard')
  const [cardId, setCardId] = useState('')
  const [autoDebitId, setAutoDebitId] = useState('')
  const [dailyLimit, setDailyLimit] = useState(5_000_000)
  const [ticketId, setTicketId] = useState('')
  const [verificationMethod, setVerificationMethod] = useState<'sms' | 'face' | 'phone'>('phone')
  const [verificationResult, setVerificationResult] = useState<'passed' | 'failed'>('failed')
  const [reason, setReason] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const search = useCallback(async (kw: string) => {
    setError(null)
    try {
      setResults(await api.searchCustomers(kw))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '客户查询失败，请检查后端是否已启动')
    }
  }, [])

  async function selectCustomer(c: CustomerSummary) {
    setCustomer(c)
    setProfile(null)
    setCardId('')
    setAutoDebitId('')
    setDone(null)
    setError(null)
    try {
      // 选目标卡/代扣需要读到客户档案，这一步本身是一次敏感查看，落账走 profile 接口
      setProfile(await api.getCustomerProfile(c.customerId, '代客办理（选择目标卡）'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载客户档案失败')
    }
  }

  async function submit() {
    if (!customer || !profile) return
    if (action === 'patchAutodebit') {
      if (!autoDebitId) return setError('请选择代扣协议')
    } else if (!cardId) {
      return setError('请选择目标卡')
    }
    if (!ticketId.trim()) return setError('请填写关联工单号')
    if (!reason.trim()) return setError('请填写办理事由')
    if(verificationResult!=='passed')return setError('请由员工独立完成客户身份核验')

    const req: CustomerActionRequest = {
      ticketId: ticketId.trim(),
      verificationMethod,
      verificationResult,
      reason: reason.trim(),
      ...(action === 'patchAutodebit'
        ? { autoDebitId, enabled: false }
        : action === 'updateCardSettings'
          ? { cardId, dailyLimit }
          : { cardId }),
    }
    setSubmitting(true)
    setError(null)
    setDone(null)
    try {
      await api.performCustomerAction(customer.customerId, action, req)
      setDone(
        `已以员工身份为「${customer.name}」完成「${ACTIONS.find((a) => a.key === action)?.label}」`,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '办理失败')
    } finally {
      setSubmitting(false)
    }
  }

  const selectableCards = (profile?.cards ?? []).filter(
    (c) => c.status === 'active' || c.status === 'locked',
  )
  const selectableAutoDebits = (profile?.autoDebits ?? []).filter((a) => a.enabled)
  const activeAction = ACTIONS.find((a) => a.key === action)

  return (
    <div className="staff-page">
      <PageHeader title="代客办理" description="核验客户身份后，办理卡片与自动扣款业务。" />

      <ol className="staff-action-steps" aria-label="办理进度">{['选择客户', '核验与办理', '完成'].map((label, index) => <li key={label} aria-current={(done ? 2 : customer ? 1 : 0) === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>

      {/* 选客户 */}
      {!customer && (
        <>
          <div className="staff-toolbar">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') search(keyword)
              }}
              placeholder="搜手机号 / 姓名 / 客户号"
              className="w-64 rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
            />
            <button
              onClick={() => search(keyword)}
              className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-4 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
            >
              查询
            </button>
          </div>
          {error && (
            <div className="mt-4 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
              {error}
            </div>
          )}
          <div className="staff-table-wrap mt-4"><table className="staff-table">
            <thead>
              <tr>
                <th>客户</th>
                <th>手机号</th>
                <th>客户号</th>
                <th>风险标签</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((c) => (
                <tr key={c.customerId} className="hover:bg-[var(--color-gold-tint)]">
                  <td className="font-medium">{c.name}</td>
                  <td className="font-mono text-xs">{c.phoneMasked}</td>
                  <td className="font-mono text-xs">{c.customerId}</td>
                  <td>
                    {c.riskTags.length > 0
                      ? c.riskTags.map((t) => (
                          <span
                            key={t}
                            className="mr-1 inline-block rounded-full bg-[var(--color-coral-wash)] px-2 py-0.5 text-xs text-[var(--color-coral)]"
                          >
                            {t}
                          </span>
                        ))
                      : '—'}
                  </td>
                  <td>
                    <button
                      onClick={() => selectCustomer(c)}
                      className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
                    >
                      选择
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-[var(--color-ink-mute)]">
                    没有匹配的客户
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
        </>
      )}

      {/* 办理表单 */}
      {customer && (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--color-ink)]">
              为「{customer.name}」办理 · {customer.phoneMasked}
            </div>
            <button
              onClick={() => {
                setCustomer(null)
                setProfile(null)
                setDone(null)
              }}
              className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
            >
              换客户
            </button>
          </div>

          <div className="mt-4 grid gap-4">
            <div className="flex flex-wrap gap-3">
              {ACTIONS.map((a) => (
                <button
                  key={a.key}
                  onClick={() => {
                    setAction(a.key)
                    setDone(null)
                  }}
                  className={`rounded-[var(--radius-tile)] px-4 py-1.5 text-sm ${
                    action === a.key
                      ? 'bg-[var(--color-gold)] font-medium text-white'
                      : 'border border-[var(--color-line-strong)] text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]'
                  }`}
                >
                  {a.label}
                  {a.highImpact && <span className="ml-1 text-xs opacity-70">需核验</span>}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {action !== 'patchAutodebit' && (
                <label className="text-sm text-[var(--color-ink-soft)]">
                  目标卡
                  <select
                    value={cardId}
                    onChange={(e) => setCardId(e.target.value)}
                    className="mt-1 block w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
                  >
                    <option value="">请选择</option>
                    {selectableCards.map((c) => (
                      <option key={c.id} value={c.id}>
                        尾号 {c.last4}（{CARD_STATUS_LABEL[c.status] ?? c.status}）
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {action === 'patchAutodebit' && (
                <label className="text-sm text-[var(--color-ink-soft)]">
                  代扣协议（关闭后不再自动扣款）
                  <select
                    value={autoDebitId}
                    onChange={(e) => setAutoDebitId(e.target.value)}
                    className="mt-1 block w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
                  >
                    <option value="">请选择</option>
                    {selectableAutoDebits.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.merchant} · {a.cycle} · {formatCents(a.amount)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {action === 'updateCardSettings' && (
                <label className="text-sm text-[var(--color-ink-soft)]">
                  单日限额
                  <select
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                    className="mt-1 block w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
                  >
                    {DAILY_LIMIT_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {formatCents(v)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="text-sm text-[var(--color-ink-soft)]">
                关联工单号
                <input
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                  placeholder="例：T_demo0001"
                  className="mt-1 block w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
                />
              </label>

              <label className="text-sm text-[var(--color-ink-soft)]">
                核验方式
                <select
                  value={verificationMethod}
                  onChange={(e) => setVerificationMethod(e.target.value as typeof verificationMethod)}
                  className="mt-1 block w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
                >
                  {VERIFY_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-[var(--color-ink-soft)]">
                核验结果
                <select
                  value={verificationResult}
                  onChange={(e) => setVerificationResult(e.target.value as 'passed' | 'failed')}
                  className="mt-1 block w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
                >
                  <option value="passed">通过</option>
                  <option value="failed">未通过</option>
                </select>
              </label>

              <label className="text-sm text-[var(--color-ink-soft)]">
                办理事由
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="例：客户来电挂失，要求锁卡"
                  className="mt-1 block w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
                />
              </label>
            </div>

            {activeAction && verificationResult !== 'passed' && (
              <div className="rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
                办理「{activeAction.label}」须先通过身份核验。
              </div>
            )}

            {error && (
              <div className="rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
                {error}
              </div>
            )}
            {done && (
              <div className="rounded-[var(--radius-tile)] bg-[var(--color-blue-wash)] px-4 py-3 text-sm text-[var(--color-blue-deep)]">
                {done}
              </div>
            )}

            <button
              onClick={submit}
              disabled={submitting||verificationResult!=='passed'}
              className="w-fit rounded-[var(--radius-tile)] bg-[var(--color-gold)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--color-gold-deep)] disabled:opacity-50"
            >
              {submitting ? '办理中…' : `确认办理「${activeAction?.label ?? ''}」`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
