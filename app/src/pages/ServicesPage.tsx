import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { CardIcon, ChartIcon, GlobalIcon, LockIcon, PigIcon, ShieldIcon, TransferIcon, UserIcon, WalletIcon } from '@/components/ui/icons'

const groups = [
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
    { to: '/dashboard', label: '智能客服与转人工', Icon: ShieldIcon },
  ] },
]

export function ServicesPage() {
  return <div className="page-stack"><PageHeader title="全部服务" />
    <div className="service-directory">{groups.map(group => <section key={group.title}>
      <h2>{group.title}</h2>{group.items.map(({ to, label, Icon }) => <Link key={to} to={to}><Icon size={19} /><span>{label}</span><span aria-hidden="true">↗</span></Link>)}
    </section>)}</div>
  </div>
}
