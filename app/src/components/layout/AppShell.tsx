import { useCallback, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ChatSolidIcon } from '@/components/ui/icons'
import { STORAGE_KEYS, storage } from '@/lib/storage'

/**
 * 应用外壳：固定侧栏（可收起）+ 顶栏（搜索 / 通知）+ 主内容区。
 * 侧栏宽度变化只影响自身，主区用 flex-1 自动重排。
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(() =>
    storage.get<boolean>(STORAGE_KEYS.sidebarCollapsed, false),
  )

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      storage.set(STORAGE_KEYS.sidebarCollapsed, !prev)
      return !prev
    })
  }, [])

  return (
    <div className="flex min-h-svh bg-paper print:bg-surface">
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1120px] px-10 py-8 print:max-w-none print:px-0 print:py-0">
            <Outlet />
          </div>
        </main>
      </div>

      <Link
        to="/support"
        aria-label="打开智能客服"
        className="fixed right-8 bottom-8 grid size-14 place-items-center rounded-chip bg-gold text-ink shadow-[0_6px_20px_rgba(200,151,60,0.35)] transition-transform duration-200 hover:scale-105 active:scale-95 print:hidden"
      >
        <ChatSolidIcon size={24} />
      </Link>
    </div>
  )
}