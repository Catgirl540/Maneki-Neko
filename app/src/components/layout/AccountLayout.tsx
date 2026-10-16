import { Link, Outlet, useLocation } from 'react-router-dom'
import { ArrowLeftIcon } from '@/components/ui/icons'

/** 账户子页保留返回入口，概览不再展示横排标签。 */
export function AccountLayout() {
  const { pathname } = useLocation()
  const inBill = pathname.startsWith('/analysis/')
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {(inBill || pathname === '/dashboard/savings') && <Link to={inBill ? '/analysis' : '/wealth'} className="inline-flex min-h-10 items-center gap-2 self-start text-[13px] text-ink-soft hover:text-ink">
        <ArrowLeftIcon size={16} />{inBill ? '返回账单' : '返回理财与储蓄'}
      </Link>}
      <Outlet />
    </div>
  )
}
