import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, api, type AuditLog } from '@/api'

/**
 * 审计日志（清单 §2 P2，乙模块）：仅主管可见（前端拦一道，后端还有 403）。
 * 记录本身由 writeAudit 统一落账（P0 已由甲接好）；本页只做查询展示与筛选。
 * 筛选先在前端做（demo 数据量小），与工单中心的做法一致。
 */

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [error, setError] = useState<string | null>(null)
  const [actorType, setActorType] = useState<'all' | 'staff' | 'agent' | 'customer'>('all')
  const [keyword, setKeyword] = useState('')
  const [window, setWindow] = useState<'all' | '1h' | '24h'>('all')

  const refresh = useCallback(async () => {
    try {
      setLogs(await api.listAuditLogs())
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '审计日志加载失败，请检查后端是否已启动')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const nowMs = Date.now()
    return logs.filter((log) => {
      if (actorType !== 'all' && log.actor_type !== actorType) return false
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase()
        const hay = `${log.action} ${log.actor_id ?? ''} ${log.target_type ?? ''} ${log.target_id ?? ''} ${log.reason ?? ''}`.toLowerCase()
        if (!hay.includes(kw)) return false
      }
      if (window !== 'all') {
        const ms = window === '1h' ? 3_600_000 : 86_400_000
        if (nowMs - new Date(log.created_at).getTime() > ms) return false
      }
      return true
    })
  }, [logs, actorType, keyword, window])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-ink)]">审计日志</h1>
        <button
          onClick={refresh}
          className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
        >
          刷新
        </button>
      </div>
      <p className="mt-1 text-sm text-[var(--color-ink-mute)]">仅主管可见（后端强制 403，不只是藏菜单）。</p>

      {error && (
        <div className="mt-4 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
          {error}
        </div>
      )}

      {/* 筛选：操作者 / 动作关键词 / 时间窗（清单 §2 审计） */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={actorType}
          onChange={(e) => setActorType(e.target.value as typeof actorType)}
          className="rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
        >
          <option value="all">全部操作者</option>
          <option value="staff">员工</option>
          <option value="agent">Agent</option>
          <option value="customer">客户</option>
        </select>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜动作 / 对象 / 操作者 / 事由"
          className="w-64 rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
        />
        <select
          value={window}
          onChange={(e) => setWindow(e.target.value as typeof window)}
          className="rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
        >
          <option value="all">全部时间</option>
          <option value="1h">最近 1 小时</option>
          <option value="24h">最近 24 小时</option>
        </select>
      </div>

      <table className="staff-table mt-4">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作者</th>
            <th>动作</th>
            <th>对象</th>
            <th>事由</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((log) => (
            <tr key={log.id}>
              <td className="text-xs text-[var(--color-ink-mute)]">{formatTime(log.created_at)}</td>
              <td>
                {log.actor_type}
                {log.actor_id ? <span className="font-mono text-xs">/{log.actor_id}</span> : ''}
              </td>
              <td className="font-mono text-xs">{log.action}</td>
              <td className="font-mono text-xs">
                {log.target_type ?? '—'}
                {log.target_id ? ` ${log.target_id}` : ''}
              </td>
              {/* 事由列：客户查询填的「为什么要看」就落在这里（audit_logs.reason），
                  此前只有写入没有展示，员工填完找不到自己填了什么 */}
              <td className="text-xs text-[var(--color-ink-soft)]">{log.reason ?? '—'}</td>
              <td>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    log.result === 'ok'
                      ? 'bg-[var(--color-blue-wash)] text-[var(--color-blue-deep)]'
                      : 'bg-[var(--color-coral-wash)] text-[var(--color-coral)]'
                  }`}
                >
                  {log.result}
                </span>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && !error && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-sm text-[var(--color-ink-mute)]">
                没有匹配的审计记录
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
