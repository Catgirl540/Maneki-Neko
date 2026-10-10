import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { LogoutIcon, MenuIcon } from '@/components/ui/icons'
import { useSession } from '@/store/session-context'
import { cn } from '@/lib/cn'
import { navigationItems } from './navigation'

const primary = navigationItems.filter(item => ['/dashboard', '/transfer', '/cards', '/support'].includes(item.to))

export function MobileNavigation() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { user, logout } = useSession()
  const moreActive = navigationItems.some(item => item.to === pathname && !primary.includes(item))

  return (
    <>
      <nav aria-label="移动端主导航" className="mobile-navigation fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface/95 px-2 backdrop-blur-lg lg:hidden print:hidden">
        {primary.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end className={({ isActive }) => cn(
            'flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-tile text-[11px] font-medium transition-colors',
            isActive ? 'text-gold-deep' : 'text-ink-soft hover:bg-sunk',
          )}>
            {({ isActive }) => <><span className={cn('grid h-7 w-12 place-items-center rounded-chip', isActive && 'bg-gold-wash')}><Icon size={21} /></span>{label === '智能客服' ? '客服' : label}</>}
          </NavLink>
        ))}
        <button type="button" aria-label="更多服务" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={cn('flex min-h-16 flex-col items-center justify-center gap-1 rounded-tile text-[11px] font-medium', moreActive ? 'text-gold-deep' : 'text-ink-soft')}>
          <span className={cn('grid h-7 w-12 place-items-center rounded-chip', moreActive && 'bg-gold-wash')}><MenuIcon size={21} /></span>更多
        </button>
      </nav>
      <Modal open={open} onClose={() => setOpen(false)} title="全部服务" description={`${user?.name ?? '朋友'}，选择你需要的服务`}>
        <div className="grid grid-cols-2 gap-3">
          {navigationItems.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => cn('flex min-h-14 items-center gap-3 rounded-field border p-3 text-[14px] font-medium', isActive ? 'border-gold-wash bg-gold-tint text-gold-deep' : 'border-line text-ink hover:bg-sunk')}><Icon size={20} />{label}</NavLink>
          ))}
        </div>
        <Button block variant="ghost" className="mt-5" icon={<LogoutIcon size={18} />} onClick={() => { setOpen(false); void logout() }}>退出登录</Button>
      </Modal>
    </>
  )
}
