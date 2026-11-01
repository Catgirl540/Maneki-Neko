import { findSpendPlatform } from './spend-platforms.mjs'

/** 准备合约，不修改档案；所有校验必须先于刷卡扣款。 */
export function prepareSpendSubscription(input, currency, contracts, now = Date.now()) {
  if (input.subscription === undefined || input.subscription === false) return { contract: null }
  const invalid = message => ({ error: message, contract: null })
  if (input.subscription !== true) return invalid('自动续费选项必须为布尔值')
  const platform = findSpendPlatform(input.platform)
  if (!platform?.subscriptionAmount) return invalid('该商户不支持模拟订阅')
  if (currency !== 'CNY') return invalid('订阅合约仅支持人民币，请选择人民币卡')
  if (contracts.some(item => item.merchant === platform.name))
    return invalid('该商户已有自动扣款合约，请到自动扣款页查看或恢复')
  const date = new Date(now + 8 * 3600_000)
  const year = date.getUTCFullYear(), month = date.getUTCMonth(), day = date.getUTCDate()
  const nextDay = Math.min(day, new Date(Date.UTC(year, month + 2, 0)).getUTCDate())
  const nextRunAt = new Date(Date.UTC(year, month + 1, nextDay) - 8 * 3600_000).toISOString()
  return { contract: { merchant: platform.name, amount: input.amount,
    cycle: `每月 ${day} 日（短月末日）`, nextRunAt, enabled: true, category: 'subscription' } }
}
