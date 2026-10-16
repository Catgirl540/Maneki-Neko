import { Link, useLocation } from 'react-router-dom'
import { WorkbenchBrand } from '@/components/brand/WorkbenchBrand'
import { ChevronRightIcon, GlobalIcon, WalletIcon } from '@/components/ui/icons'
import { useSession } from '@/store/session-context'
import { isNavigationActive, navigationItems } from './navigation'
import { NotificationsButton } from './NotificationsButton'

export function Sidebar() {
  const { user } = useSession()
  const { pathname } = useLocation()
  return <aside className="workbench-sidebar print:hidden">
    <Link to="/dashboard" aria-label="招财猫银行首页" className="workbench-brand-link"><WorkbenchBrand /></Link>
    <nav aria-label="桌面主导航" className="workbench-nav">
      {navigationItems.map(({ to, label, Icon, paths }) => <Link key={to} to={to}
        aria-current={isNavigationActive(pathname, paths) ? 'page' : undefined}>
        <Icon size={18} /><span>{label}</span>
      </Link>)}
    </nav>
    <nav aria-label="其他服务" className="workbench-nav workbench-nav-secondary">
      <Link to="/accounts" aria-current={pathname === '/accounts' ? 'page' : undefined}><WalletIcon size={18} /><span>账户资产</span></Link>
      <Link to="/services" aria-current={pathname === '/services' ? 'page' : undefined}><GlobalIcon size={18} /><span>全部服务</span></Link>
    </nav>
    <div className="workbench-profile">
      <Link to="/security" aria-label={`${user?.name ?? ''}个人与安全设置`} aria-current={pathname.startsWith('/security') ? 'page' : undefined}>
        <span className="workbench-avatar">{user?.avatarInitial ?? '喵'}</span>
        <span className="workbench-profile-copy">{user?.name}<small>个人账户</small></span>
        <ChevronRightIcon size={15} />
      </Link>
      <NotificationsButton collapsed />
    </div>
  </aside>
}
