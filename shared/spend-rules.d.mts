/** 模拟消费的本地分类兜底（与 spend-rules.mjs 一一对应）。 */

/** 与 CATEGORY_LABEL 的键一致。 */
export type SpendRuleCategory = 'dining' | 'shopping' | 'transport' | 'subscription' | 'housing' | 'other'

export declare const SPEND_PLATFORM_CATEGORIES: Readonly<Record<string, SpendRuleCategory>>

export interface MerchantKeywordRule {
    category: SpendRuleCategory
    words: readonly string[]
}

export declare const MERCHANT_KEYWORDS: readonly MerchantKeywordRule[]

export declare function classifySpendMerchant(input?: {
    platformId?: string
    merchantName?: string
}): SpendRuleCategory | null
