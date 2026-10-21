import type { RiskAssessment, WealthCategory, WealthProduct, WealthHolding } from '@/api/types'
import { canBuyRisk } from './wealth'

export interface WealthFilters {
  category: WealthCategory | 'all'
  keyword: string
  risk: string
  liquidity: 'all' | 'open' | 'closed'
  maxMinimum: number | null
  matchedOnly: boolean
}

export const DEFAULT_WEALTH_FILTERS: WealthFilters = {
  category: 'all', keyword: '', risk: 'all', liquidity: 'all', maxMinimum: null, matchedOnly: false,
}
export function hasValidWealthRisk(risk: RiskAssessment) {
  return risk.done && !risk.expired && risk.level !== null
}
export function filterWealthProducts(products: WealthProduct[], filters: WealthFilters, risk: RiskAssessment) {
  const keyword = filters.keyword.trim().toLocaleLowerCase()
  return products.filter(product =>
    (filters.category === 'all' || product.category === filters.category) &&
    (!keyword || `${product.name} ${product.code} ${product.issuer}`.toLocaleLowerCase().includes(keyword)) &&
    (filters.risk === 'all' || product.risk === filters.risk) &&
    (filters.liquidity === 'all' || product.openEnded === (filters.liquidity === 'open')) &&
    (filters.maxMinimum === null || product.minAmount <= filters.maxMinimum) &&
    (!filters.matchedOnly || (hasValidWealthRisk(risk) && canBuyRisk(risk.level, product.risk))),
  )
}
export function filterWealthHoldings(holdings: WealthHolding[], filter: 'all' | 'open' | 'closed') {
  return holdings.filter(holding => filter === 'all' || holding.closed === (filter === 'closed'))
}

/** 既有接口没有理财订单源；按银行当前记账标题查询申赎资金流水，不能推断委托状态。 */
export function wealthRecordQuery(kind: 'subscribe' | 'redeem', page: number) {
  return { category: 'other' as const, keyword: kind === 'subscribe' ? '申购 · ' : '赎回 · ', page, size: 10 }
}
export const WEALTH_ROUTES = [
  { to: '/wealth', label: '理财总览' },
  { to: '/wealth/products', label: '理财产品' },
  { to: '/wealth/holdings', label: '我的持仓' },
  { to: '/wealth/plans', label: '储蓄与计划' },
  { to: '/wealth/records', label: '交易记录' },
] as const
