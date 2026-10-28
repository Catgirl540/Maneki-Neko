import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useSession } from '@/store/session-context'
import { staffNavigation, staffRoleLabel } from './navigation'
import { useStaffClock } from './useStaffClock'
import { isDemoStaff, staffEnvironmentLabel } from '@/api/environment'
import { WorkbenchBrand } from '../../../app/src/components/brand/WorkbenchBrand'
import { AlertIcon, ChevronRightIcon, LogoutIcon } from '../../../app/src/components/ui/icons'

/** 菜单保持角色隔离；每个业务接口仍由服务端独立鉴权。 */
export function AppShell() {
  const { user, logout } = useSession()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isChat = pathname === '/assistant'
  const visible = staffNavigation.filter(item => user && item.roles.includes(user.role) && (!isDemoStaff || !['/assistant', '/im', '/operations'].includes(item.to)))
  const current = visible.find(item => item.to === pathname)
  const now = useStaffClock()
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(now)

  return <div className="staff-app">
    <div className="staff-demo"><AlertIcon size={12} />比赛演示作品 · 非真实银行 · {staffEnvironmentLabel}</div>
    <div className={`staff-shell ${isChat ? 'staff-shell-chat' : ''}`}>
      <a href="#staff-main" className="staff-skip-link">跳到主要内容</a>
      <aside className="staff-sidebar">
        <NavLink className="staff-brand" to={user?.role === 'ops' ? '/operations' : '/workbench'} aria-label="招财猫银行工作人员首页"><WorkbenchBrand /></NavLink>
        <span className="staff-workspace-label">工作人员工作空间</span>
        <nav aria-label="工作人员导航">
          {['工作空间', '业务处理', '管理与运维'].map(group => {
            const items = visible.filter(item => item.group === group)
            return items.length ? <div className="staff-nav-group" key={group}>
              <p>{group}</p>
              {items.map(({ to, label, Icon }) => <NavLink key={to} to={to} className="staff-nav-link"><Icon size={18} /><span>{label}</span></NavLink>)}
            </div> : null
          })}
        </nav>
        <div className="staff-profile">
          <span className="staff-avatar" aria-hidden="true">{user?.name.slice(0, 1)}</span>
          <span className="staff-profile-copy"><strong>{user?.name}</strong><small>{user && staffRoleLabel[user.role]}</small></span>
          <button type="button" aria-label="退出" title="退出登录" onClick={async () => { await logout(); navigate('/login') }}><LogoutIcon size={18} /></button>
        </div>
      </aside>
      <div className="staff-body">
        <header className="staff-topbar">
          <div className="staff-breadcrumb"><span>{current?.group ?? '工作空间'}</span><ChevronRightIcon size={13} /><strong>{current?.label ?? '工作台'}</strong></div>
          <div className="staff-topbar-meta"><time>{date}</time><span className="staff-role-badge">{user && staffRoleLabel[user.role]}</span></div>
        </header>
        <main id="staff-main" tabIndex={-1} className={isChat ? 'staff-main staff-main-chat' : 'staff-main'}>
          <div className={isChat ? 'staff-assistant-container' : 'staff-page-container'}><Outlet /></div>
        </main>
      </div>
    </div>
  </div>
}
