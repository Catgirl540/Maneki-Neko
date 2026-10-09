import { useCallback, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { MobileNavigation } from './MobileNavigation'
import { ChatSolidIcon } from '@/components/ui/icons'
import { STORAGE_KEYS, storage } from '@/lib/storage'

/**
 * 应用外壳：固定侧栏（可收起）+ 顶栏（搜索 / 通知）+ 主内容区。
 * 侧栏宽度变化只影响自身，主区用 flex-1 自动重排。
 */
export function AppShell() {
  const { pathname } = useLocation()
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
    <div className="app-shell flex min-h-[calc(100svh-28px)] bg-paper print:bg-surface">
      <a href="#main-content" className="skip-link">跳到主要内容</a>
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <div className="app-content mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:px-0 print:py-0">
            <Outlet />
          </div>
        </main>
      </div>

      <MobileNavigation />
      {pathname !== '/support' && <Link
        to="/support"
        aria-label="打开智能客服"
        className="fixed right-8 bottom-8 hidden size-14 place-items-center rounded-chip bg-gold text-ink shadow-[0_6px_20px_rgba(200,151,60,0.35)] transition-transform duration-200 hover:scale-105 active:scale-95 lg:grid print:hidden"
      >
        <ChatSolidIcon size={24} />
      </Link>}
    </div>
  )
}
