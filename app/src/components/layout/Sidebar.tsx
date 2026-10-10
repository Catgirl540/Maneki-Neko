import { NavLink } from 'react-router-dom'
import {
  LogoutIcon,
  ShieldIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
} from '@/components/ui/icons'
import { CatMark, Logo } from '@/components/brand/Logo'
import { useSession } from '@/store/session-context'
import { cn } from '@/lib/cn'
import { greeting } from '@/lib/format'
import { navigationItems } from './navigation'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, logout } = useSession()

  return (
    // h-svh + sticky：侧栏永远只有一屏高，内容再长也不会被拉长、底部用户区不会跑出屏幕
    <aside
      className={cn(
        'sticky top-7 hidden h-[calc(100svh-28px)] shrink-0 flex-col border-r border-line bg-surface py-6 lg:flex print:hidden',
        'transition-[width,padding] duration-200 ease-[cubic-bezier(.4,0,.2,1)]',
        collapsed ? 'w-[84px] px-3.5' : 'w-[252px] px-6',
      )}
    >
      {/* 头部：品牌 + 收起/展开 */}
      <div
        className={cn(
          'flex shrink-0',
          collapsed ? 'flex-col items-center gap-3' : 'items-center justify-between',
        )}
      >
        <NavLink to="/dashboard" title="招财猫银行" className="min-w-0">
          {collapsed ? (
            <CatMark className="size-9 text-gold" />
          ) : (
            <Logo markClass="h-10 w-10" wordClass="text-[23px]" />
          )}
        </NavLink>

        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-expanded={!collapsed}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          className="grid size-9 shrink-0 place-items-center rounded-tile text-ink-mute transition-colors hover:bg-paper hover:text-ink"
        >
          {collapsed ? <SidebarExpandIcon size={20} /> : <SidebarCollapseIcon size={20} />}
        </button>
      </div>

      {/* 问候块：收起时隐藏 */}
      {!collapsed && (
        <div className="mt-8 shrink-0 px-1">
          <p className="text-[19px] leading-snug font-bold tracking-[-0.01em] text-ink">
            {greeting()}，{user?.name ?? '朋友'}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-mute">
            这是您今天的财务概览
          </p>
        </div>
      )}

      {/* 导航：占满剩余高度并独立滚动，保证底部区域不被挤出屏幕。
          负边距 + 等量内边距把滚动容器的可见区补到侧栏边缘，
          否则外挂在边缘的金色指示条会被 overflow 裁掉。 */}
      <nav
        aria-label="桌面主导航"
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto',
          collapsed ? 'mt-6 -mx-3.5 px-3.5' : 'mt-7 -mx-6 px-6',
        )}
      >
        {navigationItems.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={collapsed ? label : undefined}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                'relative flex h-12 shrink-0 items-center rounded-tile text-[15px] transition-colors duration-200',
                collapsed ? 'justify-center' : 'gap-3 px-3.5',
                isActive
                  ? 'bg-gold-tint font-semibold text-gold-deep'
                  : 'text-ink-soft hover:bg-paper hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={20} className={isActive ? 'text-gold' : 'text-ink-mute'} />
                {!collapsed && label}
                {/* 右侧金色指示条，落在侧栏描边上。
                    用 `.nav-marker` 滑进来而不是直接出现：切路由时它是整页唯一
                    "跟着走"的东西，硬切会显得页面是跳过去的。
                    定中的 `translateY(-50%)` 写在关键帧里（见 global.css），
                    所以这里**不能**再挂 Tailwind 的 `-translate-y-1/2`——
                    两处都写会被后者覆盖掉。 */}
                {isActive && (
                  <span
                    className={cn(
                      'nav-marker absolute top-1/2 h-7 w-[3px] rounded-l-full bg-gold',
                      collapsed ? '-right-3.5' : '-right-6',
                    )}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* 底部：收起时只留头像与退出 */}
      <div className="shrink-0 border-t border-line pt-4">
        {!collapsed && (
          <div className="mb-4 flex gap-3 rounded-field border border-gold-wash bg-gold-tint p-3.5">
            <ShieldIcon size={20} className="mt-0.5 shrink-0 text-gold-deep" />
            <span>
              <span className="block text-[13px] font-medium text-ink">操作先确认</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">
                涉及资金的操作由您确认
              </span>
            </span>
          </div>
        )}

        <div className={cn('flex items-center gap-3', collapsed && 'flex-col gap-2.5')}>
          <span
            title={collapsed ? `${user?.name ?? '未登录'} · ${user?.memberLevel ?? ''}` : undefined}
            className="grid size-9 shrink-0 place-items-center rounded-chip bg-gold-wash text-[13px] font-semibold text-gold-deep"
          >
            {user?.avatarInitial ?? '喵'}
          </span>

          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">
                {user?.name ?? '未登录'}
              </span>
              <span className="block truncate text-[12px] text-ink-mute">
                {user?.memberLevel ?? '—'}
              </span>
            </span>
          )}

          <button
            type="button"
            onClick={() => void logout()}
            title="退出登录"
            aria-label="退出登录"
            className="grid size-8 shrink-0 place-items-center rounded-tile text-ink-mute transition-colors hover:bg-paper hover:text-ink"
          >
            <LogoutIcon size={18} />
          </button>
        </div>
      </div>
    </aside>
  )
}
