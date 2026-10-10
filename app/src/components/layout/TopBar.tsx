import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BellIcon, SearchIcon } from '@/components/ui/icons'
import { CatMark } from '@/components/brand/Logo'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatDateTime } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { api } from '@/api'

/** 搜索与通知共用响应式顶栏，通知使用可滚动、可键盘操作的弹窗。 */
export function TopBar() {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [open, setOpen] = useState(false)
  const security = useAsync(() => api.getSecurityOverview(), [])
  const alerts = security.data?.logs.slice(0, 3) ?? []

  return (
    <>
      <header className="sticky top-7 z-30 flex h-16 items-center gap-3 border-b border-line bg-paper/95 px-4 backdrop-blur lg:h-[76px] lg:gap-4 lg:px-8 print:hidden">
        <Link to="/dashboard" aria-label="招财猫银行总览" className="shrink-0 lg:hidden"><CatMark className="size-8 text-gold" /></Link>
        <form role="search" className="flex h-11 min-w-0 max-w-[440px] flex-1 items-center gap-2 rounded-chip border border-line bg-surface px-3 transition-colors focus-within:border-gold sm:gap-3 sm:px-5" onSubmit={(e) => {
          e.preventDefault()
          navigate(keyword.trim() ? `/analysis?q=${encodeURIComponent(keyword.trim())}` : '/analysis')
        }}>
          <SearchIcon size={18} className="shrink-0 text-ink-mute" />
          <input type="search" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索交易、收款人或备注" aria-label="全局搜索" className="h-full min-w-0 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-mute" />
          <button type="submit" className="sr-only">搜索</button>
        </form>
        <span className="ml-auto hidden text-[12px] text-ink-soft xl:block">每一笔收支，都心中有数</span>
        <button type="button" onClick={() => setOpen(true)} aria-label="通知" aria-haspopup="dialog" aria-expanded={open} className="relative ml-auto grid size-11 shrink-0 place-items-center rounded-chip border border-line bg-surface text-ink-soft transition-colors hover:border-line-strong hover:text-ink xl:ml-0">
          <BellIcon size={20} />
          {alerts.length > 0 && <span className="absolute top-2 right-2.5 size-2 rounded-chip bg-coral" />}
        </button>
      </header>
      <Modal open={open} onClose={() => setOpen(false)} title="最新动态" description="最近的账户与安全记录" footer={<Button block onClick={() => { setOpen(false); navigate('/security') }}>查看全部安全日志</Button>}>
        {security.loading && <p className="py-4 text-[14px] text-ink-soft">正在加载通知…</p>}
        {security.error && <div role="alert" className="rounded-field bg-coral-wash p-4 text-[14px] text-ink"><p>{security.error}</p><Button size="sm" className="mt-3" onClick={security.reload}>重新加载</Button></div>}
        {!security.loading && !security.error && alerts.length === 0 && <p className="py-4 text-[14px] text-ink-soft">暂无新动态，账户记录会显示在这里。</p>}
        <ul className="divide-y divide-line">
          {alerts.map(log => <li key={log.id} className="flex items-start gap-3 py-4">
            <span className={`mt-1.5 size-2 shrink-0 rounded-chip ${log.level === 'warn' ? 'bg-coral' : 'bg-blue'}`} />
            <span className="min-w-0"><span className="block text-[14px] font-medium text-ink">{log.action}</span><span className="mt-1 block text-[12px] leading-relaxed break-words text-ink-soft">{formatDateTime(log.createdAt)} · {log.detail}</span></span>
          </li>)}
        </ul>
      </Modal>
    </>
  )
}
