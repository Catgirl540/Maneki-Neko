import { Link, useSearchParams } from 'react-router-dom'
import { WealthHeader } from '@/components/wealth/WealthHeader'
import { InvestPage } from './InvestPage'
import { SavingsPage } from './SavingsPage'

export function WealthPlansPage() {
  const [params] = useSearchParams()
  const investing = params.get('tab') === 'invest'
  return <div className="wealth-workspace">
    <WealthHeader title="储蓄与计划" />
    <nav className="wealth-plan-switch" aria-label="选择计划类型">
      <Link to="/wealth/plans" aria-current={!investing ? 'page' : undefined}>存钱目标</Link>
      <Link to="/wealth/plans?tab=invest" aria-current={investing ? 'page' : undefined}>定投计划</Link>
    </nav>
    {investing ? <InvestPage embedded /> : <SavingsPage embedded />}
  </div>
}
