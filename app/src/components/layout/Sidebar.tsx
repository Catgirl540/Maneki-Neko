import { Link, useLocation } from 'react-router-dom'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@/components/ui/icons'
import { CatMark, Logo } from '@/components/brand/Logo'
import { useSession } from '@/store/session-context'
import { cn } from '@/lib/cn'
import { isNavigationActive, navigationItems } from './navigation'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user } = useSession()
  const { pathname } = useLocation()
  return (
    <aside className={cn('sticky top-7 hidden h-[calc(100svh-28px)] shrink-0 flex-col border-r border-line bg-surface py-6 lg:flex print:hidden',
      'transition-[width,padding] duration-200', collapsed ? 'w-[84px] px-3.5' : 'w-[252px] px-6')}>
      <div className={cn('flex shrink-0', collapsed ? 'flex-col items-center gap-3' : 'items-center justify-between')}>
        <div aria-label="招财猫银行" className="min-w-0">
          {collapsed ? <CatMark className="size-9 text-gold" /> : <Logo markClass="h-10 w-10" wordClass="text-[23px]" />}
        </div>
        <button type="button" onClick={onToggle} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed}
          className="grid size-9 shrink-0 place-items-center rounded-tile text-ink-mute transition-colors hover:bg-paper hover:text-ink">
          {collapsed ? <SidebarExpandIcon size={20} /> : <SidebarCollapseIcon size={20} />}
        </button>
      </div>
      {!collapsed && <p className="mt-8 px-3.5 text-[12px] text-ink-mute">我的银行</p>}
      <nav aria-label="桌面主导航" className={cn('mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto',
        collapsed ? '-mx-3.5 px-3.5' : '-mx-6 px-6')}>
        {navigationItems.map(({ to, label, Icon, paths }) => {
          const active = isNavigationActive(pathname, paths)
          return (
            <Link key={to} to={to} aria-current={active ? 'page' : undefined} aria-label={label} title={collapsed ? label : undefined}
              className={cn('relative flex h-12 shrink-0 items-center rounded-tile text-[15px] transition-colors duration-200',
                collapsed ? 'justify-center' : 'gap-3 px-3.5', active ? 'bg-gold-tint font-semibold text-gold-deep' : 'text-ink-soft hover:bg-paper hover:text-ink')}>
              <Icon size={20} className={active ? 'text-gold' : 'text-ink-mute'} />
              {!collapsed && label}
              {active && <span className={cn('nav-marker absolute top-1/2 h-7 w-[3px] rounded-l-full bg-gold', collapsed ? '-right-3.5' : '-right-6')} />}
            </Link>
          )
        })}
      </nav>
      <div className={cn('flex shrink-0 items-center gap-3 border-t border-line pt-4', collapsed && 'justify-center')}>
        <span title={collapsed ? user?.name : undefined} className="grid size-9 shrink-0 place-items-center rounded-chip bg-gold-wash text-[13px] font-semibold text-gold-deep">
          {user?.avatarInitial ?? '喵'}
        </span>
        {!collapsed && <span className="min-w-0"><span className="block truncate text-[14px] font-medium text-ink">{user?.name}</span>
          <span className="block truncate text-[12px] text-ink-mute">{user?.memberLevel}</span></span>}
      </div>
    </aside>
  )
}
