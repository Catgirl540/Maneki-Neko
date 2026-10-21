import { CardIcon, ChatIcon, GlobalIcon, LockIcon, PiggyBankIcon, ReceiptIcon, ShieldIcon, TransferIcon, TrendUpIcon, WalletIcon } from '@/components/ui/icons'

export const smartServices = [
  { id: 'transfer', label: '智能转账', Icon: TransferIcon, paths: ['/transfer', '/receiving'] },
  { id: 'wealth', label: '理财顾问', Icon: TrendUpIcon, paths: ['/wealth', '/wealth/products', '/wealth/holdings', '/wealth/records', '/wealth/cash-management', '/wealth/investments'] },
  { id: 'analysis', label: '账单分析', Icon: ReceiptIcon, paths: ['/analysis', '/analysis/statistics', '/analysis/autodebits', '/transactions'] },
  { id: 'cards', label: '银行卡管家', Icon: CardIcon, paths: ['/cards'] },
  { id: 'exchange', label: '换汇助手', Icon: GlobalIcon, paths: ['/exchange'] },
  { id: 'savings', label: '储蓄规划', Icon: PiggyBankIcon, paths: ['/dashboard/savings', '/wealth/plans'] },
  { id: 'credit', label: '借款测算', Icon: WalletIcon, paths: ['/credit', '/cashflow'] },
  { id: 'insurance', label: '保险咨询', Icon: ShieldIcon, paths: ['/wealth/insurance'] },
  { id: 'security', label: '安全助手', Icon: LockIcon, paths: ['/security'] },
  { id: 'support', label: '智能客服', Icon: ChatIcon, paths: [] },
] as const

export type SmartServiceId = typeof smartServices[number]['id']
export function serviceForPath(pathname: string, search = '') {
  if (pathname === '/wealth/plans' && new URLSearchParams(search).get('tab') === 'invest') return smartServices.find(service => service.id === 'wealth')
  return smartServices.find(service => service.paths.some(path => pathname === path))
    ?? (pathname.startsWith('/transactions/') ? smartServices.find(service => service.id === 'analysis') : undefined)
}
