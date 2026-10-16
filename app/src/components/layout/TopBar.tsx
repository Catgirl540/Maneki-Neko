import { Link } from 'react-router-dom'
import { WorkbenchBrand } from '@/components/brand/WorkbenchBrand'
import { useSession } from '@/store/session-context'
import { NotificationsButton } from './NotificationsButton'
import { MobileNavigation } from './MobileNavigation'

export function TopBar() {
  const { user } = useSession()
  return <header className="workbench-mobile-header print:hidden">
    <div className="workbench-mobile-brand">
      <Link to="/dashboard" aria-label="招财猫银行首页"><WorkbenchBrand /></Link>
      <NotificationsButton collapsed />
      <Link to="/security" aria-label="个人与安全设置" className="workbench-avatar">{user?.avatarInitial ?? '喵'}</Link>
    </div>
    <MobileNavigation />
  </header>
}
