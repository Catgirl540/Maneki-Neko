import { useEffect, useState } from 'react'
import { api, ApiError, type AuditLog } from '@/api'

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

export function WorkbenchPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-[var(--color-ink)]">工作台</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        新工单与待办会出现在这里（3 秒轮询在 Phase 1 接上）。
      </p>
    </div>
  )
}

export function CustomersPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-[var(--color-ink)]">客户查询</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        搜索与客户 360 页在 Phase 1 由乙实现（评审后降 P1，P0 留最小查询）。
      </p>
    </div>
  )
}

export function ActionsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-[var(--color-ink)]">代客办理</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        白名单动作 Phase 1 接通；未核验禁止解锁卡/调高限额（清单 §2 P1）。
      </p>
    </div>
  )
}

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
