import { PageHeader } from '@/components/PageHeader'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ApiError,
  INTERCEPT_REASONS,
  api,
  type Approval,
  type ApprovalStatus,
  type InterceptReason,
} from '@/api'
import { useSession } from '@/store/session-context'
import { formatTime } from '../tickets/labels'
import { ThresholdPanel } from './ThresholdPanel'
import {
  APPROVAL_STATUS_CLASS,
  APPROVAL_STATUS_LABEL,
  BIZ_TYPE_LABEL,
  EXECUTION_CLASS,
  EXECUTION_LABEL,
  countdownText,
  extractHoldUntil,
  formatCents,
} from './labels'

/**
 * 处置中心（清单 §9）。
 * 大额转账是「延迟到账 + 拦截窗口」：窗口到点自动到账，默认放行；
 * 员工只有**一票否决**（拦截），且必须选枚举理由 —— 不是审批放行。
 * - 列表 3 秒轮询：agent 提审后不刷新也能看到
 * - 倒计时 1 秒刷新，和后端自动到账扫账对齐
 * - 裁决与**资金执行**分开显示：「已到账但执行失败」要能一眼看出来
 * - 参数快照建单后冻结，这里只读展示
 */

/** 从 payload 里取在途窗口截止时刻；非 transfer 或没冻结就返回 null */
function holdUntilOf(a: Approval): string | null {
  return a.bizType === 'transfer' ? extractHoldUntil(a.payload as Record<string, unknown>) : null
}

function ExecutionCell({ a }: { a: Approval }) {
  // 拦截 / 用户撤销后 executionStatus='failed' 的语义是「指令从未执行」（§9.4），
  // 不是执行出了错。标红「执行失败」会被误读成拦截本身失败了，这里改中性文案。
  if (a.status === 'intercepted') {
    return (
      <span className="rounded-full bg-[var(--color-sunk)] px-2 py-0.5 text-xs text-[var(--color-ink-mute)]">
        未执行（已拦截）
      </span>
    )
  }
  if (a.status === 'recalled') {
    return (
      <span className="rounded-full bg-[var(--color-sunk)] px-2 py-0.5 text-xs text-[var(--color-ink-mute)]">
        未执行（用户已撤销）
      </span>
    )
  }
  // 已到账但执行失败：单独一句话，别埋在 tooltip 里（验收必测）
  if (a.status === 'settled' && a.executionStatus === 'failed') {
    return (
      <span className="text-[var(--color-coral)]">
        窗口已收口、执行失败{a.executionError ? `：${a.executionError}` : ''}
      </span>
    )
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${EXECUTION_CLASS[a.executionStatus]}`}>
      {EXECUTION_LABEL[a.executionStatus]}
      {a.executionStatus === 'failed' && a.executionError ? `：${a.executionError}` : ''}
    </span>
  )
}

/** 参数快照：转账类把关键字段摊平成人话，其余原样 JSON */
function PayloadView({ a }: { a: Approval }) {
  const p = a.payload as Record<string, unknown>
  const request = (p.request ?? {}) as Record<string, unknown>
  if (a.bizType === 'transfer') {
    return (
      <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
        <dt className="text-[var(--color-ink-mute)]">转账金额</dt>
        <dd className="font-medium text-[var(--color-ink)]">{formatCents(p.amount ?? request.amount) ?? '—'}</dd>
        <dt className="text-[var(--color-ink-mute)]">收款人</dt>
        <dd>{String(request.payeeName ?? '—')}</dd>
        <dt className="text-[var(--color-ink-mute)]">收款标识</dt>
        <dd className="font-mono text-xs">
          {String(request.payeeAccountNo ?? request.fpsId ?? '—')}
        </dd>
        <dt className="text-[var(--color-ink-mute)]">附言</dt>
        <dd>{String(request.memo ?? '—') || '（无）'}</dd>
        <dt className="text-[var(--color-ink-mute)]">指令号</dt>
        <dd className="font-mono text-xs">{String(p.transactionId ?? '—')}</dd>
        <dt className="text-[var(--color-ink-mute)]">客户号</dt>
        <dd className="font-mono text-xs">{String(p.customerId ?? '—')}</dd>
      </dl>
    )
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-[var(--radius-tile)] bg-[var(--color-sunk)] p-3 text-xs">
      {JSON.stringify(a.payload, null, 2)}
    </pre>
  )
}

export function ApprovalsPage() {
  const { user } = useSession()
  // 处置（settle / intercept / approved / rejected）只允许主管（清单 §5）；
  // 客服点按钮只会吃 403，界面上先说清楚，别让人以为是功能坏了
  const isSupervisor = user?.role === 'supervisor'
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searchParams]=useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('approval'))
  const [statusFilter, setStatusFilter] = useState<'all' | ApprovalStatus>('all')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  /** 拦截理由：只收枚举，补充说明可选（§9.1） */
  const [interceptReason, setInterceptReason] = useState<InterceptReason>(INTERCEPT_REASONS[0])
  const [interceptDetail, setInterceptDetail] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [confirming, setConfirming] = useState<'settle' | 'intercept' | 'approved' | 'rejected' | null>(null)
  /** 倒计时用的本地时钟，1 秒一跳 */
  const [nowMs, setNowMs] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      const items=await api.listApprovals(),linkedId=searchParams.get('approval')
      if(linkedId&&!items.some(item=>item.approvalId===linkedId))items.unshift(await api.getApproval(linkedId))
      setApprovals(items)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '处置列表加载失败，请检查后端是否已启动')
    }
  }, [searchParams])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const selected = approvals.find((a) => a.approvalId === selectedId) ?? null
  const filtered =
    statusFilter === 'all' ? approvals : approvals.filter((a) => a.status === statusFilter)

  function resetActionState() {
    setConfirming(null)
    setRejectReason('')
    setInterceptReason(INTERCEPT_REASONS[0])
    setInterceptDetail('')
    setActionError(null)
  }

  async function decide(decision: 'settle' | 'intercept' | 'approved' | 'rejected') {
    if (!selected) return
    if (decision === 'intercept' && !interceptReason) {
      setActionError('拦截必须选择理由')
      return
    }
    if (decision === 'rejected' && !rejectReason.trim()) {
      setActionError('驳回必须填写理由')
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const updated = await api.decideApproval(selected.approvalId, {
        decision,
        reasonCode: decision === 'intercept' ? interceptReason : undefined,
        reasonDetail: decision === 'intercept' && interceptDetail.trim() ? interceptDetail.trim() : undefined,
        reason: decision === 'rejected' ? rejectReason.trim() : undefined,
      })
      setApprovals((list) =>
        list.map((a) => (a.approvalId === updated.approvalId ? updated : a)),
      )
      resetActionState()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '操作失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="staff-page">
      <PageHeader title="处置中心" description="核对在途交易与待审批业务。" actions={<button
          onClick={refresh}
          className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
        >
          刷新
        </button>} />
      <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
        大额转账默认在窗口到点自动到账；员工只有拦截权（一票否决），拦截须选理由。
      </p>

      <ThresholdPanel />

      {error && (
        <div className="mt-4 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
          {error}
        </div>
      )}

      <div className="staff-toolbar">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
        >
          <option value="all">全部状态</option>
          {(Object.keys(APPROVAL_STATUS_LABEL) as ApprovalStatus[]).map((s) => (
            <option key={s} value={s}>
              {APPROVAL_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="text-xs text-[var(--color-ink-mute)]">
          共 {filtered.length} 单；处置结果与资金执行结果分开显示
        </span>
      </div>

      <div className="staff-table-wrap mt-4"><table className="staff-table">
        <thead>
          <tr>
            <th>单号</th>
            <th>类型</th>
            <th>风险摘要</th>
            <th>状态</th>
            <th>窗口倒计时</th>
            <th>执行</th>
            <th>发起时间</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => {
            const holdUntil = holdUntilOf(a)
            const countdown = a.status === 'pending' ? countdownText(holdUntil, nowMs) : null
            return (
              <tr
                key={a.approvalId}
                tabIndex={0}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(a.approvalId); resetActionState() } }}
                onClick={() => {
                  setSelectedId(a.approvalId)
                  resetActionState()
                }}
                className="cursor-pointer hover:bg-[var(--color-paper)]"
              >
                <td className="font-mono text-xs">{a.approvalId}</td>
                <td>{BIZ_TYPE_LABEL[a.bizType] ?? a.bizType}</td>
                <td className="max-w-md truncate">{a.riskSummary}</td>
                <td>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${APPROVAL_STATUS_CLASS[a.status]}`}>
                    {APPROVAL_STATUS_LABEL[a.status]}
                  </span>
                </td>
                <td className="text-xs text-[var(--color-gold-deep)]">{countdown ?? '—'}</td>
                <td>
                  <ExecutionCell a={a} />
                </td>
                <td className="text-xs text-[var(--color-ink-mute)]">{formatTime(a.createdAt)}</td>
              </tr>
            )
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="py-8 text-center text-sm text-[var(--color-ink-mute)]">
                暂无待处置记录
              </td>
            </tr>
          )}
        </tbody>
      </table></div>

      {/* 详情抽屉：参数快照 + 倒计时 + 拦截/立即到账（结构对齐 TicketDrawer） */}
      {selected && (
        <div className="staff-drawer-overlay fixed inset-0 z-30 flex justify-end">
          <div className="flex-1 bg-black/20" onClick={() => setSelectedId(null)} />
          <div className="staff-drawer flex h-full w-[480px] flex-col overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-ink)]">
                  {BIZ_TYPE_LABEL[selected.bizType] ?? selected.bizType}
                </h2>
                <p className="mt-1 font-mono text-xs text-[var(--color-ink-mute)]">{selected.approvalId}</p>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="rounded-[var(--radius-tile)] px-2 py-1 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-sunk)]"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 rounded-[var(--radius-tile)] bg-[var(--color-gold-wash)] px-3 py-2 text-sm text-[var(--color-ink)]">
              {selected.riskSummary}
            </div>

            {selected.status === 'pending' && holdUntilOf(selected) && (
              <div className="mt-3 rounded-[var(--radius-tile)] border border-[var(--color-gold-deep)]/30 px-3 py-2">
                <p className="text-xs text-[var(--color-ink-mute)]">在途窗口</p>
                <p className="mt-0.5 text-lg font-semibold text-[var(--color-gold-deep)]">
                  {countdownText(holdUntilOf(selected), nowMs) ?? '—'}
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
                  到点自动到账，无需员工放行。要叫停请点「拦截」。
                </p>
              </div>
            )}

            <h3 className="mt-5 text-sm font-medium text-[var(--color-ink)]">参数快照（建单后冻结）</h3>
            <div className="mt-2">
              <PayloadView a={selected} />
            </div>

            <h3 className="mt-5 text-sm font-medium text-[var(--color-ink)]">状态</h3>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-ink-mute)]">处置</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${APPROVAL_STATUS_CLASS[selected.status]}`}>
                  {APPROVAL_STATUS_LABEL[selected.status]}
                </span>
                {selected.decidedBy && (
                  <span className="text-xs text-[var(--color-ink-mute)]">
                    {selected.decidedBy} · {selected.decidedAt ? formatTime(selected.decidedAt) : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-ink-mute)]">资金执行</span>
                <ExecutionCell a={selected} />
              </div>
              {selected.reason && (
                <p className="text-xs text-[var(--color-ink-soft)]">处置理由：{selected.reason}</p>
              )}
            </div>

            {selected.status === 'pending' && (
              <div className="mt-6 border-t border-[var(--color-line-strong)] pt-4">
                {actionError && (
                  <div className="mb-3 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-3 py-2 text-sm text-[var(--color-coral)]">
                    {actionError}
                  </div>
                )}
                {!isSupervisor && (
                  <div className="rounded-[var(--radius-tile)] border border-[var(--color-line)] bg-[var(--color-sunk)] px-3 py-2 text-sm text-[var(--color-ink-soft)]">
                    处置（{selected.bizType === 'transfer' ? '立即到账 / 拦截' : '通过 / 驳回'}）仅主管可执行。
                    当前登录：{user?.name ?? '—'}（{user?.role === 'supervisor' ? '主管' : '客服'}）。
                    请用主管账号登录后操作。
                  </div>
                )}
                {isSupervisor &&
                  (confirming === 'intercept' ? (
                    <div>
                      <label className="text-sm text-[var(--color-ink-soft)]">
                        拦截理由（必选枚举）
                        <select
                          value={interceptReason}
                          onChange={(e) => setInterceptReason(e.target.value as InterceptReason)}
                          className="mt-1 w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-2 text-sm"
                        >
                          {INTERCEPT_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="mt-2 block text-sm text-[var(--color-ink-soft)]">
                        补充说明（可选）
                        <textarea
                          value={interceptDetail}
                          onChange={(e) => setInterceptDetail(e.target.value)}
                          rows={2}
                          placeholder="例如：客户称本人未发起该笔转账"
                          className="mt-1 w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-2 text-sm"
                        />
                      </label>
                      <p className="mt-2 text-xs text-[var(--color-coral)]">
                        拦截后本金退回客户可用余额，指令不再执行。不可恢复。
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => decide('intercept')}
                          className="rounded-[var(--radius-tile)] bg-[var(--color-coral)] px-4 py-2 text-sm text-white disabled:opacity-50"
                        >
                          确认拦截
                        </button>
                        <button
                          disabled={busy}
                          onClick={resetActionState}
                          className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-4 py-2 text-sm"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : confirming === 'settle' ? (
                    <div>
                      <p className="text-sm text-[var(--color-ink)]">
                        确认立即到账？将跳过剩余窗口时间，马上执行扣款并入账收款方。
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => decide('settle')}
                          className="rounded-[var(--radius-tile)] bg-[var(--color-ink)] px-4 py-2 text-sm text-white disabled:opacity-50"
                        >
                          确认立即到账
                        </button>
                        <button
                          disabled={busy}
                          onClick={resetActionState}
                          className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-4 py-2 text-sm"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : confirming === 'rejected' ? (
                    <div>
                      <label className="text-sm text-[var(--color-ink-soft)]">
                        驳回理由（必填）
                        <textarea
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          rows={3}
                          placeholder="例如：收款方信息与客户描述不一致"
                          className="mt-1 w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-2 text-sm"
                        />
                      </label>
                      <div className="mt-2 flex gap-2">
                        <button
                          disabled={busy || !rejectReason.trim()}
                          onClick={() => decide('rejected')}
                          className="rounded-[var(--radius-tile)] bg-[var(--color-coral)] px-4 py-2 text-sm text-white disabled:opacity-50"
                        >
                          确认驳回
                        </button>
                        <button
                          disabled={busy}
                          onClick={resetActionState}
                          className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-4 py-2 text-sm"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : confirming === 'approved' ? (
                    <div>
                      <p className="text-sm text-[var(--color-ink)]">
                        确认通过？将通过共用业务入口执行，不可撤销。
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => decide('approved')}
                          className="rounded-[var(--radius-tile)] bg-[var(--color-ink)] px-4 py-2 text-sm text-white disabled:opacity-50"
                        >
                          确认通过
                        </button>
                        <button
                          disabled={busy}
                          onClick={resetActionState}
                          className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-4 py-2 text-sm"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : selected.bizType === 'transfer' ? (
                    <div className="flex gap-2">
                      <button
                        disabled={busy}
                        onClick={() => setConfirming('settle')}
                        className="rounded-[var(--radius-tile)] bg-[var(--color-ink)] px-4 py-2 text-sm text-white disabled:opacity-50"
                      >
                        立即到账
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setConfirming('intercept')}
                        className="rounded-[var(--radius-tile)] border border-[var(--color-coral)] px-4 py-2 text-sm text-[var(--color-coral)] disabled:opacity-50"
                      >
                        拦截
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        disabled={busy}
                        onClick={() => setConfirming('approved')}
                        className="rounded-[var(--radius-tile)] bg-[var(--color-ink)] px-4 py-2 text-sm text-white disabled:opacity-50"
                      >
                        通过
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setConfirming('rejected')}
                        className="rounded-[var(--radius-tile)] border border-[var(--color-coral)] px-4 py-2 text-sm text-[var(--color-coral)] disabled:opacity-50"
                      >
                        驳回
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
