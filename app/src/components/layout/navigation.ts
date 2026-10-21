import { CardIcon, ChartIcon, GlobalIcon, LockIcon, PigIcon, ShieldIcon, TransferIcon, UserIcon, WalletIcon } from '@/components/ui/icons'

export const navigationItems = [
  { to: '/dashboard', label: '账户总览', Icon: WalletIcon, paths: ['/dashboard'] },
  { to: '/transfer', label: '转账与支付', Icon: TransferIcon, paths: ['/transfer', '/receiving'] },
  { to: '/cards', label: '银行卡', Icon: CardIcon, paths: ['/cards'] },
  { to: '/analysis', label: '账单与交易', Icon: ChartIcon, paths: ['/analysis', '/transactions'] },
  { to: '/wealth', label: '理财与储蓄', Icon: PigIcon, paths: ['/wealth', '/dashboard/savings'] },
]

export function isNavigationActive(pathname: string, paths: readonly string[]) {
  return paths.some(path => pathname === path || (path !== '/dashboard' && pathname.startsWith(`${path}/`)))
}

export const serviceGroups = [
  { title: '账户与支付', items: [
    { to: '/accounts', label: '账户资产', Icon: WalletIcon },
    { to: '/transfer', label: '转账与支付', Icon: TransferIcon },
    { to: '/accounts?flow=in', label: '收款与转入', Icon: WalletIcon },
    { to: '/exchange', label: '多币种换汇', Icon: GlobalIcon },
    { to: '/cards', label: '银行卡管理', Icon: CardIcon },
  ] },
  { title: '账单与资金', items: [
    { to: '/analysis', label: '账单与交易', Icon: ChartIcon },
    { to: '/analysis/statistics', label: '消费分析', Icon: ChartIcon },
    { to: '/analysis/autodebits', label: '自动扣款', Icon: CardIcon },
    { to: '/cashflow', label: '工资与备用金', Icon: WalletIcon },
    { to: '/credit', label: '借款与分期', Icon: WalletIcon },
  ] },
  { title: '理财与储蓄', items: [
    { to: '/wealth', label: '理财产品', Icon: ChartIcon },
    { to: '/dashboard/savings', label: '存钱计划', Icon: PigIcon },
    { to: '/wealth/cash-management', label: '现金管理', Icon: WalletIcon },
    { to: '/wealth/investments', label: '投资与定投', Icon: ChartIcon },
    { to: '/wealth/insurance', label: '保险保障', Icon: ShieldIcon },
  ] },
  { title: '个人与安全', items: [
    { to: '/security', label: '安全设置', Icon: LockIcon },
    { to: '/security/identity', label: '身份认证', Icon: UserIcon },
    { to: '/security/invitations', label: '邀请与奖励', Icon: UserIcon },
    { to: '/security/membership', label: '会员与订阅', Icon: UserIcon },
    { to: '/support', label: '智能客服与转人工', Icon: ShieldIcon },
  ] },
]

/** 精确查询参数优先，再匹配最长页面路径，避免总览与子页同时高亮。 */
export function activeServiceTarget(pathname: string, search: string) {
  const entries = serviceGroups.flatMap(group => group.items)
  const query = new URLSearchParams(search)
  return entries.filter(item => {
    const [path, params] = item.to.split('?')
    if (params) return pathname === path && [...new URLSearchParams(params)].every(([key, value]) => query.get(key) === value)
    if (path === '/analysis' && pathname.startsWith('/transactions/')) return true
    return pathname === path || (path !== '/dashboard' && pathname.startsWith(`${path}/`))
  }).sort((a, b) => b.to.length - a.to.length)[0]?.to
}
