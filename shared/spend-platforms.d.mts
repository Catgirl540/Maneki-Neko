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
  /** 图标字形（一个汉字），网页与回单上显示 */
  glyph: string
  /** 图标底色（品牌色） */
  tone: string
  /** 字形颜色；省略表示白色 */
  ink?: string
  /** 账单详情输入示例（按平台给出更贴近真实的提示） */
  noteHint: string
}

export const SPEND_MAX_CENTS: number
export const SPEND_PLATFORMS: SpendPlatform[]
export function findSpendPlatform(id: unknown): SpendPlatform | null
