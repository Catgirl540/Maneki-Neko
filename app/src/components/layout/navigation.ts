import { CardIcon, ChartIcon, PigIcon, TransferIcon, WalletIcon } from '@/components/ui/icons'

export const navigationItems = [
  { to: '/dashboard', label: '账户总览', Icon: WalletIcon, paths: ['/dashboard', '/support'] },
  { to: '/transfer', label: '转账与支付', Icon: TransferIcon, paths: ['/transfer', '/receiving'] },
  { to: '/cards', label: '银行卡', Icon: CardIcon, paths: ['/cards'] },
  { to: '/analysis', label: '账单与交易', Icon: ChartIcon, paths: ['/analysis', '/transactions'] },
  { to: '/wealth', label: '理财与储蓄', Icon: PigIcon, paths: ['/wealth', '/dashboard/savings'] },
]

export function isNavigationActive(pathname: string, paths: readonly string[]) {
  return paths.some(path => pathname === path || (path !== '/dashboard' && pathname.startsWith(`${path}/`)))
}
