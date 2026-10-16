import { Link, useLocation } from 'react-router-dom'
import { isNavigationActive, navigationItems } from './navigation'

export function MobileNavigation() {
  const { pathname } = useLocation()
  return <nav aria-label="移动端主导航" className="workbench-mobile-nav">
    {navigationItems.map(({ to, label, Icon, paths }) => <Link key={to} to={to}
      aria-current={isNavigationActive(pathname, paths) ? 'page' : undefined}>
      <Icon size={15} /><span>{label}</span>
    </Link>)}
    <Link to="/services" aria-current={pathname === '/services' ? 'page' : undefined}>全部服务</Link>
  </nav>
}
