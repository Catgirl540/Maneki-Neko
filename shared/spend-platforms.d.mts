export interface SpendPlatform {
  id: string
  /** 商户名（回单对方户名） */
  name: string
  /** 收单机构分配的商户编号 */
  merchantId: string
  country: string
  city: string
  /** 交易发生地点（回单展示） */
  location: string
  /** 收单机构 */
  counterpartyBank: string
}

export const SPEND_MAX_CENTS: number
export const SPEND_PLATFORMS: SpendPlatform[]
export function findSpendPlatform(id: unknown): SpendPlatform | null
