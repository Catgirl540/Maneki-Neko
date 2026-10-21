import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { WorkbenchBrand } from '@/components/brand/WorkbenchBrand'
import { BellIcon, ChatIcon, ChevronRightIcon, GlobalIcon, WalletIcon } from '@/components/ui/icons'
import { MEMBER_TIER_RULES } from '../../../../shared/membership.mjs'
import { useSession } from '@/store/session-context'
import { activeServiceTarget, serviceGroups } from './navigation'
import { NotificationsButton } from './NotificationsButton'

export function Sidebar() {
  const { user } = useSession()
  const { pathname, search } = useLocation()
  const activeTarget = activeServiceTarget(pathname, search)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  useEffect(() => {
    const group = serviceGroups.find(group => group.items.some(item => item.to === activeTarget))
    if (group) setExpanded(previous => ({ ...previous, [group.title]: true }))
  }, [pathname, search, activeTarget])
  return <aside className="workbench-sidebar print:hidden">
    <Link to="/dashboard" aria-label="招财猫银行首页" className="workbench-brand-link"><WorkbenchBrand /></Link>
    <div className="workbench-nav-scroll">
      <nav aria-label="桌面主导航" className="workbench-nav">
        <Link to="/dashboard" aria-current={pathname === '/dashboard' ? 'page' : undefined}>
          <WalletIcon size={18} /><span>总览</span>
        </Link>
        <Link to="/assistant" aria-current={pathname === '/assistant' ? 'page' : undefined}>
          <ChatIcon size={18} /><span>智能助手</span>
        </Link>
        {/* 一级入口：IM 绑定与提醒独立成页，不进服务分组，避免重复目录。 */}
        <Link to="/reminders" aria-current={pathname === '/reminders' ? 'page' : undefined}>
          <BellIcon size={18} /><span>IM 连接</span>
        </Link>
        {serviceGroups.map((group, index) => {
          const active = group.items.some(item => item.to === activeTarget)
          const open = expanded[group.title] ?? (active || (index === 0 && !activeTarget))
          const Icon = group.items[0].Icon
          return <div key={group.title} className="workbench-nav-group">
            <button type="button" className="workbench-nav-heading" data-active={active || undefined}
              aria-expanded={open} aria-controls={`service-nav-${index}`}
              onClick={() => setExpanded(previous => ({ ...previous, [group.title]: !open }))}>
              <Icon size={18} /><span>{group.title}</span><ChevronRightIcon size={14} />
            </button>
            <div id={`service-nav-${index}`} className="workbench-nav-collapse" data-open={open}
              aria-hidden={!open} inert={!open}>
              <div><div className="workbench-nav-children">
                {group.items.map(({ to, label }) => <Link key={to} to={to}
                  aria-current={activeTarget === to ? 'page' : undefined}>{label}</Link>)}
              </div></div>
            </div>
          </div>
        })}
      </nav>
      <nav aria-label="其他服务" className="workbench-nav workbench-nav-secondary">
        <Link to="/services" aria-current={pathname === '/services' ? 'page' : undefined}><GlobalIcon size={18} /><span>全部服务</span></Link>
      </nav>
    </div>
    <div className="workbench-profile">
      <Link to="/security" aria-label={`${user?.name ?? ''}个人与安全设置`} aria-current={pathname.startsWith('/security') ? 'page' : undefined}>
        <span className="workbench-avatar">{user?.avatarInitial ?? '喵'}</span>
        <span className="workbench-profile-copy">{user?.name}<small>{MEMBER_TIER_RULES[user?.memberTier ?? 'standard'].label}</small></span>
        <ChevronRightIcon size={15} />
      </Link>
      <NotificationsButton collapsed />
    </div>
  </aside>
}
