import { useEffect, useState } from 'react'
import { ApiError, api, type AuditLog } from '@/api'

/** 统一的「后端没起」回落提示，不白屏（验收 §8） */
function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="mb-4 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
      {message}
    </div>
  )
}

function useAsync<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loader().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { data, error }
}

/**
 * 审计日志（乙模块）：仅主管可见，后端还有一道 403（不只是藏菜单）。
 * 这里给最小表格；按员工/动作/时间筛选在 Phase 1。
 */
export function AuditPage() {
  const { data, error } = useAsync<AuditLog[]>(() => api.listAuditLogs())
  return (
    <div>
      <h1 className="text-xl font-semibold text-[var(--color-ink)]">审计日志</h1>
      <p className="text-sm text-[var(--color-ink-mute)]">仅主管可见（后端强制 403，不只是藏菜单）。</p>
      <ErrorNote message={error} />
      <table className="staff-table mt-4">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作者</th>
            <th>动作</th>
            <th>对象</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((log) => (
            <tr key={log.id}>
              <td className="text-xs">{log.created_at}</td>
              <td>
                {log.actor_type}/{log.actor_id ?? '—'}
              </td>
              <td className="font-mono text-xs">{log.action}</td>
              <td className="font-mono text-xs">
                {log.target_type ?? '—'}
                {log.target_id ? ` ${log.target_id}` : ''}
              </td>
              <td>{log.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
