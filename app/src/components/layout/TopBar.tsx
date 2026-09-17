import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellIcon, SearchIcon } from '@/components/ui/icons'
import { formatDateTime } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { api } from '@/api'

/** 顶栏：全局搜索 + 通知。搜索直接跳到流水的关键词筛选。 */
export function TopBar() {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [open, setOpen] = useState(false)
  const security = useAsync(() => api.getSecurityOverview(), [])
  const alerts = security.data?.logs.slice(0, 3) ?? []

  return (
    <header className="sticky top-0 z-30 flex h-[76px] items-center gap-4 border-b border-line bg-paper/85 px-10 backdrop-blur print:hidden">
      <form
        className="flex h-12 max-w-[440px] flex-1 items-center gap-3 rounded-chip border border-line bg-surface px-5 transition-colors focus-within:border-gold"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(keyword.trim() ? `/analysis?q=${encodeURIComponent(keyword.trim())}` : '/analysis')
        }}
      >
        <SearchIcon size={19} className="shrink-0 text-ink-mute" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索交易、收款人或备注"
          aria-label="全局搜索"
          className="h-full w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-mute"
        />
      </form>

      <div className="relative ml-auto">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="通知"
          aria-expanded={open}
          className="relative grid size-12 place-items-center rounded-chip border border-line bg-surface text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <BellIcon size={20} />
          {alerts.length > 0 && (
            <span className="absolute top-2.5 right-3 size-2 rounded-chip bg-coral" />
          )}
        </button>

        {open && (
          <>
            <button
              type="button"
              aria-label="关闭通知"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div className="absolute right-0 z-50 mt-2 w-[330px] rounded-card border border-line bg-surface p-2 shadow-[0_18px_40px_rgba(14,27,38,0.12)]">
              <p className="px-3 py-2 text-[13px] font-medium text-ink-soft">最新动态</p>
              <ul>
                {alerts.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 rounded-tile px-3 py-3 hover:bg-sunk">
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-chip ${
                        log.level === 'warn' ? 'bg-coral' : 'bg-blue'
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-ink">{log.action}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-mute">
                        {formatDateTime(log.createdAt)} · {log.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate('/security')
                }}
                className="mt-1 w-full rounded-tile px-3 py-2.5 text-left text-[13px] font-medium text-gold-deep transition-colors hover:bg-gold-tint"
              >
                查看全部安全日志
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}