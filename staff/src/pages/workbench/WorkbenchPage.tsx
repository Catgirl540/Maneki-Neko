import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api, type Ticket } from '@/api'
import { useSession } from '@/store/session-context'
import { STATUS_CLASS, TICKET_STATUS_LABEL, formatTime } from '@/pages/tickets/labels'

/**
 * 工作台（登录后落地页，甲模块）。
 * 3 秒轮询拉最新工单，突出「待处理」的新单——demo §7 第 2 步：agent 建单后
 * 这里不刷新也能冒出，点单进工单中心处理。
 */
export function WorkbenchPage() {
  const navigate = useNavigate()
  const { user } = useSession()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setTickets(await api.listTickets())
      setError(null)
    } catch (e) {
      // 后端没起时不白屏，顶部给一句人话（验收 §8）
      setError(e instanceof ApiError ? e.message : '工单列表加载失败，请检查后端是否已启动')
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  const pending = tickets.filter((t) => t.status === 'open')
  const mine = tickets.filter(
    (t) => (t.status === 'processing' || t.status === 'waiting') && t.assigneeId === user?.id,
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">工作台</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-mute)]">新工单与待办，3 秒自动刷新</p>
        </div>
        <button
          onClick={() => navigate('/tickets')}
          className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
        >
          查看全部工单
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
          {error}
        </div>
      )}

      {/* 概览 */}
      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="rounded-[var(--radius-tile)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <div className="text-sm text-[var(--color-ink-mute)]">待处理工单</div>
          <div className="mt-1 text-3xl font-semibold text-[var(--color-ink)]">{pending.length}</div>
        </div>
        <div className="rounded-[var(--radius-tile)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <div className="text-sm text-[var(--color-ink-mute)]">我的待办</div>
          <div className="mt-1 text-3xl font-semibold text-[var(--color-ink)]">{mine.length}</div>
        </div>
      </div>

      {/* 最新待处理 */}
      <h2 className="mt-6 text-sm font-medium text-[var(--color-ink-soft)]">最新待处理</h2>
      <table className="staff-table mt-3">
        <thead>
          <tr>
            <th>状态</th>
            <th>客户</th>
            <th>事由</th>
            <th>创建</th>
          </tr>
        </thead>
        <tbody>
          {pending.slice(0, 8).map((t) => (
            <tr
              key={t.ticketId}
              onClick={() => navigate('/tickets')}
              className="cursor-pointer hover:bg-[var(--color-gold-tint)]"
            >
              <td>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[t.status]}`}
                >
                  {TICKET_STATUS_LABEL[t.status]}
                </span>
              </td>
              <td>{t.customerName ?? t.customerId}</td>
              <td className="max-w-64 truncate">{t.reason}</td>
              <td className="text-xs text-[var(--color-ink-mute)]">{formatTime(t.createdAt)}</td>
            </tr>
          ))}
          {pending.length === 0 && !error && (
            <tr>
              <td colSpan={4} className="py-8 text-center text-sm text-[var(--color-ink-mute)]">
                暂无待处理工单
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
