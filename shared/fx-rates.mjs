import { effectiveSpread, fxRateFor } from './membership.mjs'

/** Published sandbox reference table, not a market feed or a locked deal quote. */
export function referenceExchangeRates(profile, midRates, baseSpread, now = Date.now()) {
  const currencies = ['CNY', 'USD', 'HKD']
  return {
    source: 'sandbox-reference', asOf: new Date(now).toISOString(), marketAsOf: null,
    notice: '演示固定基准牌价，非实时市场行情；asOf 为查询时间。已含本人会员点差，无单独换汇手续费；成交须重新取得有效金额报价。',
    rates: currencies.flatMap(fromCurrency => currencies.filter(to => to !== fromCurrency).map(toCurrency => ({
      fromCurrency, toCurrency, midRate: midRates[fromCurrency] / midRates[toCurrency],
      rate: fxRateFor(profile, fromCurrency, toCurrency, midRates, baseSpread), spread: effectiveSpread(profile, baseSpread),
    }))),
  }
}
