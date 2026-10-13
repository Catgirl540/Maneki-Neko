import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import type { StaffRole } from '@/api'
import { useSession } from '@/store/session-context'

/**
 * 员工端外壳：左侧菜单 + 顶栏。
 * 菜单按角色显隐——但记住这只是 UX，**后端每个接口都独立校验角色**（清单 §1）。
 */
const NAV: Array<{ to: string; label: string; roles: StaffRole[] }> = [
  { to: '/assistant', label: '工作人员助手', roles: ['csr', 'supervisor', 'ops'] },
  { to: '/operations', label: '运维监控', roles: ['ops'] },
  { to: '/workbench', label: '工作台', roles: ['csr', 'supervisor'] },
  { to: '/tickets', label: '工单中心', roles: ['csr', 'supervisor'] },
  { to: '/approvals', label: '处置中心', roles: ['csr', 'supervisor'] },
  { to: '/customers', label: '客户查询', roles: ['csr', 'supervisor'] },
  { to: '/actions', label: '代客办理', roles: ['csr', 'supervisor'] },
  { to: '/audit', label: '审计日志', roles: ['supervisor'] },
]

export function AppShell() {
  const { user, logout } = useSession()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isChat = pathname === '/assistant'

  return (
    <div className={`staff-shell flex min-w-0 flex-col lg:flex-row ${isChat ? 'staff-shell-chat' : 'min-h-screen'}`}>
      <aside className="staff-sidebar w-full shrink-0 lg:w-56 bg-[var(--color-sunk)] border-b lg:border-b-0 lg:border-r border-[var(--color-line)] p-4">
        <div className="mb-3 lg:mb-6">
          <div className="text-lg font-semibold text-[var(--color-ink)]">招财猫银行</div>
          <div className="hidden text-xs text-[var(--color-ink-mute)] lg:block">工作人员端</div>
        </div>
        <nav aria-label="工作人员导航" className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
          {NAV.filter((item) => user && item.roles.includes(user.role)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block shrink-0 whitespace-nowrap rounded-[var(--radius-tile)] px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-[var(--color-gold-wash)] text-[var(--color-gold-deep)] font-medium'
                    : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-gold-tint)]'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-3">
          <div className="text-sm text-[var(--color-ink-soft)]">
            {user?.name}
            <span className="ml-2 rounded-full bg-[var(--color-blue-wash)] px-2 py-0.5 text-xs text-[var(--color-blue-deep)]">
              {user?.role === 'ops' ? '运维人员' : user?.role === 'supervisor' ? '主管' : '客服专员'}
            </span>
          </div>
          <button
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
            className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
          >
            退出
          </button>
        </header>

        <main className={isChat ? 'flex min-h-0 min-w-0 flex-1 overflow-hidden' : 'min-w-0 flex-1 p-4 sm:p-6'}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
