import { Link, useSearchParams } from 'react-router-dom'
import { WealthHeader } from '@/components/wealth/WealthHeader'
import { InvestPage } from './InvestPage'
import { SavingsPage } from './SavingsPage'
import { BirthdayPlans } from '@/components/linked/BirthdayPlans'

export function WealthPlansPage() {
  const [params] = useSearchParams()
  const investing = params.get('tab') === 'invest'
  const birthday = params.get('tab') === 'birthday'
  return <div className="wealth-workspace">
    <WealthHeader title="储蓄与计划" />
    <nav className="wealth-plan-switch" aria-label="选择计划类型">
      <Link to="/wealth/plans" aria-current={!investing && !birthday ? 'page' : undefined}>存钱目标</Link>
      <Link to="/wealth/plans?tab=invest" aria-current={investing ? 'page' : undefined}>定投计划</Link>
      <Link to="/wealth/plans?tab=birthday" aria-current={birthday ? 'page' : undefined}>生日联动</Link>
    </nav>
    {birthday ? <BirthdayPlans /> : investing ? <InvestPage embedded /> : <SavingsPage embedded />}
  </div>
}
