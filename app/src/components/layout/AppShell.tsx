import { useCallback, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { MobileNavigation } from './MobileNavigation'
import { STORAGE_KEYS, storage } from '@/lib/storage'
import { cn } from '@/lib/cn'

/**
 * 应用外壳：固定侧栏（可收起）+ 顶栏（搜索 / 通知）+ 主内容区。
 * 侧栏宽度变化只影响自身，主区用 flex-1 自动重排。
 */
export function AppShell() {
  const chat = useLocation().pathname === '/support'
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
    <div className={cn('app-shell flex min-h-[calc(100svh-28px)] bg-paper print:bg-surface', chat && 'chat-workspace')}>
      <a href="#main-content" className="skip-link">跳到主要内容</a>
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!chat && <TopBar />}
        <main id="main-content" tabIndex={-1} className={cn('min-w-0 flex-1 outline-none', chat && 'flex min-h-0')}>
          <div className={cn('app-content mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:px-0 print:py-0', chat && 'app-content-chat')}>
            <Outlet />
          </div>
        </main>
      </div>

      <MobileNavigation />
    </div>
  )
}
