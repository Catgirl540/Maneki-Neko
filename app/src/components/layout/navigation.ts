import { CardIcon, ChartIcon, ChatIcon, HomeIcon, PigIcon, ShieldIcon, TransferIcon } from '@/components/ui/icons'

export const navigationItems = [
  { to: '/dashboard', label: '总览', Icon: HomeIcon },
  { to: '/transfer', label: '转账', Icon: TransferIcon },
  { to: '/cards', label: '银行卡', Icon: CardIcon },
  { to: '/analysis', label: '消费分析', Icon: ChartIcon },
  { to: '/wealth', label: '理财', Icon: PigIcon },
  { to: '/security', label: '安全中心', Icon: ShieldIcon },
  { to: '/support', label: '智能客服', Icon: ChatIcon },
]
