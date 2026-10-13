import { ChatIcon, PigIcon, UserIcon, WalletIcon } from '@/components/ui/icons'

export const navigationItems = [
  { to: '/dashboard', label: '账户', Icon: WalletIcon, paths: ['/dashboard', '/cards', '/receiving', '/transfer', '/analysis', '/transactions', '/cashflow', '/credit', '/exchange'] },
  { to: '/wealth', label: '理财', Icon: PigIcon, paths: ['/wealth'] },
  { to: '/support', label: '助手', Icon: ChatIcon, paths: ['/support'] },
  { to: '/security', label: '我的', Icon: UserIcon, paths: ['/security'] },
]

/** 一级导航按业务归属匹配，详情页也只高亮所属的一项。 */
export function isNavigationActive(pathname: string, paths: readonly string[]) {
  return paths.some(path => pathname === path || pathname.startsWith(`${path}/`))
}
