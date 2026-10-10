import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { isNavigationActive, navigationItems } from './navigation'

export function MobileNavigation() {
  const { pathname } = useLocation()
  return (
    <nav aria-label="移动端主导航" className="mobile-navigation fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface/95 px-2 backdrop-blur-lg lg:hidden print:hidden">
      {navigationItems.map(({ to, label, Icon, paths }) => {
        const active = isNavigationActive(pathname, paths)
        return (
          <Link key={to} to={to} aria-current={active ? 'page' : undefined}
            className={cn('flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-tile text-[11px] font-medium transition-colors',
              active ? 'text-gold-deep' : 'text-ink-soft hover:bg-sunk')}>
            <span className={cn('grid h-7 w-12 place-items-center rounded-chip', active && 'bg-gold-wash')}><Icon size={21} /></span>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
