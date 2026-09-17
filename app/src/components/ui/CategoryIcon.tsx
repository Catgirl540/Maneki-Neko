import type { TransactionCategory } from '@/api/types'
import {
  BoltIcon,
  CarIcon,
  FoodIcon,
  HouseIcon,
  PlayIcon,
  ShopIcon,
  TransferIcon,
  WalletIcon,
} from '@/components/ui/icons'

const MAP: Record<TransactionCategory, typeof WalletIcon> = {
  salary: WalletIcon,
  transfer: TransferIcon,
  dining: FoodIcon,
  shopping: ShopIcon,
  housing: HouseIcon,
  transport: CarIcon,
  subscription: PlayIcon,
  other: BoltIcon,
}

/** 图表配色：金 → 青 → 灰，循环取用 */
export function CategoryIcon({
  category,
  size = 20,
}: {
  category: TransactionCategory
  size?: number
}) {
  const Cmp = MAP[category] ?? BoltIcon
  return <Cmp size={size} />
}