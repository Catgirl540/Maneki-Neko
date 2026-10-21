import { PageHeader } from '@/components/PageHeader'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '@/store/session-context'
import { ApiError, api, type Ticket, type TicketChannel, type TicketStatus } from '@/api'
import { CHANNEL_LABEL, STATUS_CLASS, TICKET_STATUS_LABEL, formatTime } from './labels'
import { TicketDrawer } from './TicketDrawer'

/**
 * 工单中心（清单 §2 P0）。
 * 列表 3 秒轮询：agent 建单后不刷新也能看到（验收 §8）。
 * 筛选先在前端做（数据量是 demo 级）；后端筛选参数在工单后端步骤补。
 */

export function TicketsPage() {
  const [params, setParams] = useSearchParams()
  const { user } = useSession()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [error, setError] = useState<string | null>(null)
  const selectedId = params.get('ticket')
  const statusParam = params.get('status')
  const statusFilter: 'all' | TicketStatus = statusParam && Object.hasOwn(TICKET_STATUS_LABEL, statusParam) ? statusParam as TicketStatus : 'all'
  const [channelFilter, setChannelFilter] = useState<'all' | TicketChannel>('all')
  const [keyword, setKeyword] = useState('')
  const mineOnly = params.get('assignee') === 'me'
  function setSelectedId(id: string | null) {
    setParams(current => { const next = new URLSearchParams(current); if (id) next.set('ticket', id); else next.delete('ticket'); return next })
  }
  function setStatusFilter(status: 'all' | TicketStatus) {
    setParams(current => { const next = new URLSearchParams(current); if (status === 'all') next.delete('status'); else next.set('status', status); return next })
  }

  const refresh = useCallback(async () => {
    try {
      const list = await api.listTickets()
      setTickets(list)
      setError(null)
    } catch (e) {
      // 后端没起时不白屏，顶部给一句人话（验收 §8）
      setError(e instanceof ApiError ? e.message : '工单列表加载失败，请检查后端是否已启动')
    }
  }, [])

  useEffect(() => {
    // 拉远端数据的 effect：setState 都在 await 之后，不是同步级联渲染
    // oxlint-disable-next-line react/set-state-in-effect
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  const filtered = tickets.filter((t) => {
    if (mineOnly && (t.assigneeId !== user?.id || !['processing', 'waiting'].includes(t.status))) return false
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (channelFilter !== 'all' && t.channel !== channelFilter) return false
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase()
      const hay = `${t.ticketId} ${t.customerName ?? ''} ${t.customerId} ${t.reason}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })

  return (
    <div className="staff-page">
      <PageHeader title="工单中心" description="跟进客户请求与人工服务记录。" actions={<button
          onClick={refresh}
          className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
        >
          刷新
        </button>} />

      {error && (
        <div className="mt-4 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
          {error}
        </div>
      )}

      {/* 筛选：状态 / 渠道 / 关键词（清单 §2 工单中心） */}
      <div className="staff-toolbar">
        {mineOnly && <button type="button" className="staff-button" onClick={() => setParams(current => { const next = new URLSearchParams(current); next.delete('assignee'); return next })}>我的待办 ×</button>}
        <select
          aria-label="工单状态"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
        >
          <option value="all">全部状态</option>
          {(Object.keys(TICKET_STATUS_LABEL) as TicketStatus[]).map((s) => (
            <option key={s} value={s}>
              {TICKET_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="工单渠道"
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value as typeof channelFilter)}
          className="rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
        >
          <option value="all">全部渠道</option>
          {(Object.keys(CHANNEL_LABEL) as TicketChannel[]).map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜单号 / 客户 / 事由"
          className="w-56 rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
        />
      </div>

      <div className="staff-table-wrap mt-4"><table className="staff-table">
        <thead>
          <tr>
            <th>状态</th>
            <th>单号</th>
            <th>客户</th>
            <th>来源</th>
            <th>事由</th>
            <th>创建</th>
            <th>负责人</th>
            <th>关联</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((t) => (
            <tr
              key={t.ticketId}
              tabIndex={0}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(t.ticketId) } }}
              onClick={() => setSelectedId(t.ticketId)}
              className="cursor-pointer hover:bg-[var(--color-gold-tint)]"
            >
              <td>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[t.status]}`}
                >
                  {TICKET_STATUS_LABEL[t.status]}
                </span>
                {t.priority === 'vip' ? (
                  <span className="ml-1 text-xs text-[var(--color-gold-deep)]">VIP</span>
                ) : t.priority === 'high' ? (
                  <span className="ml-1 text-xs text-[var(--color-coral)]">急</span>
                ) : null}
              </td>
              <td className="font-mono text-xs">{t.ticketId}</td>
              <td>{t.customerName ?? t.customerId}</td>
              <td>{CHANNEL_LABEL[t.channel]}</td>
              <td className="max-w-64 truncate">{t.reason}</td>
              <td className="text-xs text-[var(--color-ink-mute)]">{formatTime(t.createdAt)}</td>
              <td>{t.assigneeId ?? '—'}</td>
              <td className="font-mono text-xs">{t.transferId ?? '—'}</td>
            </tr>
          ))}
          {filtered.length === 0 && !error && (
            <tr>
              <td colSpan={8} className="py-8 text-center text-sm text-[var(--color-ink-mute)]">
                没有匹配的工单
              </td>
            </tr>
          )}
        </tbody>
      </table></div>

      {selectedId && (
        <TicketDrawer
          key={selectedId}
          ticketId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  )
}
