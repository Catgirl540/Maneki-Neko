import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type TicketDetail, type TicketStatus } from '@/api'
import { useSession } from '@/store/session-context'
import { TICKET_STATUS_LABEL, formatTime } from './labels'

/**
 * 工单详情抽屉（清单 §2：客户信息条 + Agent 聊天只读 + 处理区 + 对话区）。
 * 状态流转严格照 §4.1 状态机；非法流转后端会 400，这里只把文案透出来。
 */

// 演示用主管账号（ensureStaffSchema 预置）。转派接口 Phase 1 后端步骤接通后
// 这里改成从员工列表选人；demo 先写死一个转派对象，保证「转给主管」是真改负责人。
const DEMO_SUPERVISOR_ID = 'staff_li'

interface Action {
  label: string
  to: TicketStatus
  /** to 与当前状态相同 = 纯转派 */
  reassignTo?: string
  danger?: boolean
}

function actionsFor(status: TicketStatus): Action[] {
  switch (status) {
    case 'open':
      return [
        { label: '接手', to: 'processing' },
        { label: '挂起', to: 'suspended', danger: true },
        { label: '转给主管', to: status, reassignTo: DEMO_SUPERVISOR_ID },
      ]
    case 'processing':
      return [
        { label: '等客户', to: 'waiting' },
        { label: '解决', to: 'resolved' },
        { label: '挂起', to: 'suspended', danger: true },
        { label: '转给主管', to: status, reassignTo: DEMO_SUPERVISOR_ID },
      ]
    case 'waiting':
      return [
        { label: '继续处理', to: 'processing' },
        { label: '解决', to: 'resolved' },
        { label: '转给主管', to: status, reassignTo: DEMO_SUPERVISOR_ID },
      ]
    case 'suspended':
      return [
        { label: '恢复处理', to: 'processing' },
        { label: '转给主管', to: status, reassignTo: DEMO_SUPERVISOR_ID },
      ]
    case 'resolved':
      return [] // 终态，不可再改（§4.1）
  }
}

export function TicketDrawer({
  ticketId,
  onClose,
  onChanged,
}: {
  ticketId: string
  onClose: () => void
  onChanged: () => void
}) {
  const { user } = useSession()
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loading = useRef(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  // 是否把这条留言额外推送到客户手机端「客服」页顶部（契约 v1.3）。默认不推。
  // 注意：客户自己开的单，对话流本来就整条对客户公开；这个勾只是再推一条提醒。
  // 员工主动开的内部单客户整单看不到，这个勾是唯一能触达客户的通道。
  const [visibleToCustomer, setVisibleToCustomer] = useState(false)

  const load = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      setTicket(await api.getTicket(ticketId))
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : '工单加载失败')
    } finally { loading.current = false }
  }, [ticketId])

  useEffect(() => {
    // 同上：数据加载，setState 在 await 之后
    // oxlint-disable-next-line react/set-state-in-effect
    load()
    const timer = window.setInterval(() => { if (!document.hidden) void load() }, 3000)
    return () => window.clearInterval(timer)
  }, [load])

  async function run(work: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await work()
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  function applyAction(action: Action) {
    return run(() =>
      api.updateTicketStatus(
        ticketId,
        action.to,
        // 接手时负责人 = 当前员工；转派时 = 目标人
        action.reassignTo ?? (action.to === 'processing' ? user?.id : undefined),
      ),
    )
  }

  function send() {
    const text = draft.trim()
    if (!text || busy || ticket?.status === 'resolved') return
    // 发送成功才清草稿：失败要留下原文，不然员工得重打一遍
    return run(async () => {
      await api.postTicketMessage(ticketId, text, { visibleToCustomer })
      setDraft('')
    })
  }

  return (
    // 固定遮罩 + 右侧面板。demo 用组件内联实现，不引第三方抽屉库（不变量 4）
    <div className="staff-drawer-overlay fixed inset-0 z-20 flex justify-end">
      <div className="flex-1 bg-black/20" onClick={() => { if (!busy) onClose() }} />
      <div className="staff-drawer flex h-full w-full max-w-[480px] min-w-0 flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl">
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <div className="font-mono text-sm text-[var(--color-ink-mute)]">{ticketId}</div>
            <div className="mt-0.5 text-base font-semibold text-[var(--color-ink)]">
              {ticket ? TICKET_STATUS_LABEL[ticket.status] : '加载中…'}
              {ticket?.priority === 'vip' ? (
                <span className="ml-2 rounded-full bg-[var(--color-gold-tint)] px-2 py-0.5 text-xs text-[var(--color-gold-deep)]">
                  会员 VIP
                </span>
              ) : ticket?.priority === 'high' ? (
                <span className="ml-2 rounded-full bg-[var(--color-coral-wash)] px-2 py-0.5 text-xs text-[var(--color-coral)]">
                  加急
                </span>
              ) : null}
            </div>
          </div>
          <button
            onClick={() => { if (!busy) onClose() }}
            className="rounded-[var(--radius-tile)] px-2 py-1 text-[var(--color-ink-mute)] hover:bg-[var(--color-paper)]"
          >
            关闭
          </button>
        </header>

        {(error || loadError) && (
          <div role="alert" className="mx-5 mt-3 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-3 py-2 text-sm text-[var(--color-coral)]">
            {error || loadError}
          </div>
        )}

        {ticket && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* 客户信息条 */}
            <section className="rounded-[var(--radius-tile)] bg-[var(--color-sunk)] px-4 py-3 text-sm">
              <div className="font-medium text-[var(--color-ink)]">
                {ticket.customerName ?? ticket.customerId}
                <span className="ml-2 font-mono text-xs text-[var(--color-ink-mute)]">
                  {ticket.customerId}
                </span>
              </div>
              <div className="mt-1 text-[var(--color-ink-soft)]">{ticket.reason}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-mute)]">
                <span>渠道：{ticket.channel}</span>
                <span>负责人：{ticket.assigneeId ?? '未接手'}</span>
                {ticket.transferId && (
                  <span className="font-mono">转账 {ticket.transferId}</span>
                )}
                {ticket.approvalId && (
                  <span className="font-mono">审批 {ticket.approvalId}</span>
                )}
              </div>
            </section>

            {/* Agent 聊天记录：只读（清单 §2） */}
            {ticket.agentTranscript && ticket.agentTranscript.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-[var(--color-ink-soft)]">
                  转人工前的对话（只读）
                </h2>
                <div className="mt-2 space-y-2">
                  {ticket.agentTranscript.map((m, i) => (
                    <div
                      key={i}
                      className={`rounded-[var(--radius-tile)] px-3 py-2 text-sm ${
                        m.role === 'user'
                          ? 'bg-[var(--color-gold-tint)] text-[var(--color-ink)]'
                          : 'bg-[var(--color-sunk)] text-[var(--color-ink-soft)]'
                      }`}
                    >
                      <span className="mr-2 text-xs text-[var(--color-ink-mute)]">
                        {m.role === 'user' ? '客户' : 'AI'}
                      </span>
                      {m.text}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 处理对话区 */}
            <section>
              <h2 className="text-sm font-medium text-[var(--color-ink-soft)]">处理记录</h2>
              <div className="mt-2 space-y-2">
                {ticket.messages.map((m) => (
                  <div key={m.id} className="rounded-[var(--radius-tile)] bg-[var(--color-paper)] px-3 py-2 text-sm">
                    <div className="text-xs text-[var(--color-ink-mute)]">
                      {m.sender === 'staff' ? '员工' : m.sender === 'customer' ? '客户' : '系统'}
                      <span className="ml-2">{formatTime(m.created_at)}</span>
                      {/* 投递到客户手机端的那几条要看得出来，否则员工不知道客户到底收到了哪句 */}
                      {m.visible_to_customer === 1 && (
                        <span className="ml-2 rounded-full bg-[var(--color-blue-wash)] px-2 py-0.5 text-xs text-[var(--color-blue-deep)]">
                          已发给客户
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[var(--color-ink)]">{m.text}</div>
                  </div>
                ))}
                {ticket.messages.length === 0 && (
                  <div className="text-sm text-[var(--color-ink-mute)]">还没有处理记录</div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* 输入 + 动作（固定在抽屉底部） */}
        {ticket && (
          <footer className="border-t border-[var(--color-line)] px-5 py-4 space-y-3">
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                }}
                placeholder={ticket.status === 'resolved' ? '工单已解决' : '写处理记录或给客户留言…'}
                aria-label="写处理记录或给客户留言"
                disabled={busy || ticket.status === 'resolved'}
                maxLength={2000}
                className="min-w-0 flex-1 rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-2 text-sm"
              />
              <button
                onClick={send}
                disabled={busy || !draft.trim() || ticket.status === 'resolved'}
                className="rounded-[var(--radius-field)] bg-[var(--color-gold)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-gold-deep)] disabled:opacity-60"
              >
                发送
              </button>
            </div>
            {/* 外带提醒开关：勾了就在客户「客服」页顶部再推一条 */}
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
              <input
                type="checkbox"
                checked={visibleToCustomer}
                onChange={(e) => setVisibleToCustomer(e.target.checked)}
                className="size-3.5 accent-[var(--color-gold)]"
              />
              同时提醒客户（推送一条到客户手机端「客服」页顶部）
            </label>
            <div className="flex flex-wrap gap-2">
              {actionsFor(ticket.status).map((action) => (
                <button
                  key={action.label}
                  onClick={() => applyAction(action)}
                  disabled={busy}
                  className={`rounded-[var(--radius-field)] border px-3 py-1.5 text-sm disabled:opacity-60 ${
                    action.danger
                      ? 'border-[var(--color-coral)] text-[var(--color-coral)] hover:bg-[var(--color-coral-wash)]'
                      : 'border-[var(--color-line-strong)] text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]'
                  }`}
                >
                  {action.label}
                </button>
              ))}
              {ticket.status === 'resolved' && (
                <span className="self-center text-sm text-[var(--color-ink-mute)]">
                  已解决，工单终态不可再改
                </span>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}
