import { PageHeader } from '@/components/PageHeader'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { api, type OperationsOverview } from '@/api'

const OpsTerminal = lazy(() => import('./terminal/OpsTerminal').then(module => ({ default: module.OpsTerminal })))

const time = (value: string) => new Date(value).toLocaleString('zh-CN')
const size = (value: number | null) => value === null ? '未知' : `${(value / 1024 / 1024).toFixed(2)} MB`
const SERVICE: Record<string, string> = { bank: '银行后端', staff: '工作人员端', settlement: '自动结算' }
const EVENT: Record<string, string> = { 'http-error': '服务请求失败', startup: '服务启动', 'settlement-error': '自动结算失败' }
const panel = 'rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5'

export function OperationsPage() {
  const [view, setView] = useState<'overview' | 'terminal'>('overview')
  const [terminalOpened, setTerminalOpened] = useState(false)
  function openTerminal() { setTerminalOpened(true); setView('terminal') }
  const [data, setData] = useState<OperationsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const refresh = useCallback(async () => {
    setBusy(true)
    try { setData(await api.getOperationsOverview()); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : '运维信息加载失败') }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const events = data?.events.filter(event => showAll || event.level === 'error') ?? []
  const unhealthy = data?.services.filter(service => service.status !== 'up').length ?? 0
  return (
    <div className="staff-page staff-ops-page">
      <PageHeader title="运维监控" description="服务、运行事件、备份与版本。" actions={<><button type="button" className="staff-button" onClick={openTerminal}>打开终端</button><button disabled={busy} onClick={() => void refresh()} className="staff-button staff-button-primary">{busy ? '检查中…' : '刷新状态'}</button></>} />
      <div className="staff-ops-tabs" role="tablist" aria-label="运维视图">
        <button type="button" role="tab" id="ops-overview-tab" aria-controls="ops-overview-panel" aria-selected={view === 'overview'} onClick={() => setView('overview')}>概览</button>
        <button type="button" role="tab" id="ops-terminal-tab" aria-controls="ops-terminal-panel" aria-selected={view === 'terminal'} onClick={openTerminal}>终端</button>
      </div>
      <div id="ops-terminal-panel" role="tabpanel" aria-labelledby="ops-terminal-tab" hidden={view !== 'terminal'}>{terminalOpened && <Suspense fallback={<p role="status">正在加载终端…</p>}><OpsTerminal visible={view === 'terminal'} /></Suspense>}</div>
      <div id="ops-overview-panel" role="tabpanel" aria-labelledby="ops-overview-tab" hidden={view !== 'overview'} className="space-y-6">
      {error && <div role="alert" className="rounded-lg bg-[var(--color-coral-wash)] p-4 text-[var(--color-coral)]">{error}{data && ' · 当前保留上次检查结果'}</div>}
      {!data && !error && <div role="status" className={panel}>正在检查运行环境…</div>}
      {data && <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['服务状态', unhealthy ? `${unhealthy} 项需关注` : '全部可访问'],
            ['近 24 小时错误', String(data.errors24h)],
            ['当前运行时长', `${Math.floor(data.uptimeSeconds / 3600)} 小时 ${Math.floor(data.uptimeSeconds % 3600 / 60)} 分钟`],
            ['最近备份', ({ ready: '校验通过', stale: '超过 24 小时', invalid: '校验失败', missing: '尚无备份' } as Record<string, string>)[data.backups.status] ?? '未知'],
          ].map(([label, value]) => <div key={label} className={panel}><p className="text-sm text-[var(--color-ink-mute)]">{label}</p><p className="mt-3 text-2xl font-semibold">{value}</p></div>)}
        </div>
        <section className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">服务状态</h2><span className="text-xs text-[var(--color-ink-mute)]">检查时间 {time(data.checkedAt)}</span></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.services.map(service => <div key={service.id} className="rounded-[var(--radius-card)] border border-[var(--color-line)] p-4">
            <div className="flex items-center justify-between"><span className="font-medium">{service.name}</span><span className={`rounded-full px-2.5 py-1 text-xs ${service.status === 'up' ? 'bg-[var(--color-blue-wash)] text-[var(--color-blue-deep)]' : 'bg-[var(--color-coral-wash)] text-[var(--color-coral)]'}`}>{service.status === 'up' ? '正常' : service.status === 'down' ? '不可访问' : '未知'}</span></div>
            <p className="mt-3 text-sm text-[var(--color-ink-mute)]">{service.detail}</p>{service.latencyMs !== null && <p className="mt-1 text-xs text-[var(--color-ink-mute)]">检查耗时 {service.latencyMs} ms</p>}
          </div>)}</div>
        </section>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={panel}><h2 className="text-lg font-semibold">备份状态</h2><p className="mt-2 text-sm text-[var(--color-ink-mute)]">{data.backups.detail}</p>
            <p className="mt-2 text-xs text-[var(--color-ink-mute)]">校验文件结构与完整性；恢复演练结果尚未接入。</p>
            {!data.backups.items.length ? <div className="mt-5 rounded-lg bg-[var(--color-paper)] p-4 text-sm">备份目录中没有银行数据库快照。</div> : <ul className="mt-4 divide-y divide-[var(--color-line)]">{data.backups.items.map(item => <li key={item.name} className="py-3"><div className="flex justify-between gap-3 text-sm"><span className="break-all font-medium">{item.name}</span><span>{item.valid ? '有效' : '无效'}</span></div><p className="mt-1 text-xs text-[var(--color-ink-mute)]">{time(item.createdAt)} · {size(item.sizeBytes)}</p></li>)}</ul>}
          </section>
          <section className={panel}><h2 className="text-lg font-semibold">运行版本</h2><dl className="mt-4 space-y-3 text-sm">{[
            ['启动时提交', data.version.revision ?? '未取得版本号'], ['工作区状态', data.version.localChanges === null ? '未知' : data.version.localChanges ? '含未提交修改' : '已提交'], ['Node.js', data.version.node], ['运行环境', data.version.environment === 'production' ? '生产环境' : '开发环境'], ['服务启动', time(data.startedAt)], ['数据库文件', size(data.database.sizeBytes)],
          ].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-[var(--color-ink-mute)]">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl><p className="mt-4 text-xs text-[var(--color-ink-mute)]">开发环境可能包含未提交修改。发布记录与回滚尚未接入。</p></section>
        </div>
        <section className={panel}><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">运行事件</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />包含启动记录</label></div>
          <p className="mt-2 text-xs text-[var(--color-ink-mute)]">监控自 {time(data.version.telemetrySince)} 接入，保留最近 1,000 条，当前展示最多 100 条。记录错误类别与状态码。</p>
          {!events.length ? <div className="mt-5 rounded-lg bg-[var(--color-paper)] p-5 text-center text-sm text-[var(--color-ink-mute)]">{showAll ? '暂无运行事件' : '当前展示范围内没有错误记录'}</div> : <div className="mt-4 overflow-x-auto"><table className="staff-table w-full"><thead><tr><th>时间</th><th>服务</th><th>事件</th><th>状态</th><th>错误码</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td className="whitespace-nowrap">{time(event.createdAt)}</td><td>{SERVICE[event.service] ?? event.service}</td><td>{EVENT[event.kind] ?? event.kind}</td><td>{event.status ?? '—'}</td><td>{event.code}</td></tr>)}</tbody></table></div>}
        </section>
      </>}
      </div>
    </div>
  )
}
