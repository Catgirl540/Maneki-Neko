import { Link } from 'react-router-dom'
import type { Transaction } from '@/api/types'
import { CategoryIcon } from './CategoryIcon'
import { ChevronRightIcon } from './icons'
import { formatDateTime, formatMoneySigned } from '@/lib/format'
import { cn } from '@/lib/cn'

/**
 * 台账行：左侧圆形浅金分类图标 + 商户/时间 + 右侧金额。
 * 整行是链接 —— 点进去看这笔交易的电子回单（交易详情）。
 */
export function TransactionRow({ tx, showAccount }: { tx: Transaction; showAccount?: string }) {
  const income = tx.direction === 'in'
  return (
    <Link
      to={`/transactions/${tx.id}`}
      // 负边距 + 等量内边距：hover 底色铺满一点，文字仍与卡片对齐
      className="-mx-2 flex items-center gap-2 sm:-mx-3 sm:gap-4 rounded-tile px-3 py-4 transition-colors duration-200 hover:bg-sunk"
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-chip',
          income ? 'bg-blue-wash text-blue' : 'bg-gold-tint text-gold-deep',
        )}
      >
        <CategoryIcon category={tx.category} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-ink">
          {tx.counterparty}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-ink-mute">
          {showAccount ? `${showAccount} · ` : ''}
          {formatDateTime(tx.createdAt)}
        </span>
      </span>

      <span
        className={cn(
          'num shrink-0 text-[13px] font-semibold sm:text-[15px]',
          income ? 'text-blue' : 'text-ink',
        )}
      >
        {formatMoneySigned(tx.signedAmount)}
      </span>

      <ChevronRightIcon size={16} className="shrink-0 text-ink-mute/60" />
    </Link>
  )
}
