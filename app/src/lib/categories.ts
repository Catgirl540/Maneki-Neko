import type { TransactionCategory } from '@/api/types'

export const CATEGORY_LABEL: Record<TransactionCategory, string> = {
  salary: '工资入账',
  transfer: '转账',
  dining: '餐饮',
  shopping: '购物',
  housing: '房租',
  transport: '交通',
  subscription: '订阅服务',
  other: '其他',
}

/**
 * 环形图 / 图例配色。
 *
 * 用 tokens.css 里的图表色板（`--color-chart-*`），每个分类一个色相：
 * 之前 transport / housing / other 都落在 #eae7ff、#dce4ef 这种极浅色上，
 * 白底上两块弧几乎看不出边界，购物和工资还共用同一个蓝。现在按
 * 「紫 → 蓝 → 玉青 → 琥珀 → 珊瑚 → 石板灰」排开，任意相邻两块都不是同色系。
 */
export const CATEGORY_COLOR: Record<TransactionCategory, string> = {
  dining: 'var(--color-chart-1)',
  shopping: 'var(--color-chart-2)',
  housing: 'var(--color-chart-3)',
  transport: 'var(--color-chart-4)',
  subscription: 'var(--color-chart-5)',
  transfer: 'var(--color-chart-6)',
  other: 'var(--color-chart-7)',
  salary: 'var(--color-chart-8)',
}

/** 后端将来若新增分类，图表也不该画出透明/黑色弧：统一回落到"其他"的浅灰蓝。 */
export function categoryColor(key: string): string {
  return CATEGORY_COLOR[key as TransactionCategory] ?? 'var(--color-chart-7)'
}
