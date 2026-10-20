/** Funding identity is stable; currency partitions and retired ledger rows are internal. */
export const ledgerBalances = db => [...db.accounts, ...(db.currencyBalances ?? [])]
export const findBalance = (db, id) => ledgerBalances(db).find(row => row.id === (db.accountAliases?.[id] ?? id))
const fail = (message, code = 'CURRENCY_MISMATCH') => Object.assign(new Error(message), { status: 400, code })
export function requireCurrencyBalance(db, id, currency = 'CNY') {
  const row = findBalance(db, id)
  if (!row) throw fail('资金账户或币种余额不存在', 'ACCOUNT_NOT_FOUND')
  if (row.currency !== currency) throw fail(`此业务仅支持 ${currency} 结算，请先在换汇页兑换`)
  return row
}
export function normalizeFundingAccount(db) {
  const rows = structuredClone(ledgerBalances(db))
  if (!rows.length) { db.currencyBalances = []; return }
  const primary = rows.find(row => row.currency === 'CNY') ?? rows[0]
  const keep = new Map([[primary.currency, primary]])
  const retired = new Map((db.retiredBalances ?? []).map(row => [row.id, row]))
  const aliases = { ...db.accountAliases }, numbers = { ...db.accountNumberAliases }
  for (const row of rows) {
    if (row.id !== primary.id && /^\d+$/.test(row.accountNo)) numbers[row.accountNo] = row.id
    const existing = keep.get(row.currency)
    if (!existing) { keep.set(row.currency, row); continue }
    if (existing.id === row.id) continue
    for (const field of ['balance', 'available']) {
      const sum = existing[field] + row[field]
      if (!Number.isSafeInteger(sum) || sum < 0) throw fail('账户合并金额异常，保留原数据', 'INVALID_AMOUNT')
      existing[field] = sum
    }
    aliases[row.id] = existing.id
    retired.set(row.id, { ...row, balance: 0, available: 0 })
  }
  const resolve = id => {
    const seen = new Set()
    while (aliases[id]) {
      if (seen.has(id)) throw fail('旧账户映射存在循环', 'INVALID_ACCOUNT_ALIAS')
      seen.add(id); id = aliases[id]
    }
    return id
  }
  for (const tx of db.transactions ?? []) if (resolve(tx.accountId) !== tx.accountId) tx.legacyAccountId ??= tx.accountId
  const remap = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (['accountId', 'fromAccountId', 'toAccountId', 'settlementAccountId'].includes(key) && typeof child === 'string') value[key] = resolve(child)
      else remap(child)
    }
  }
  remap(db)
  db.accounts = [primary]
  db.currencyBalances = [...keep.values()].filter(row => row.id !== primary.id)
  db.retiredBalances = [...retired.values()]
  db.accountAliases = Object.fromEntries(Object.keys(aliases).map(id => [id, resolve(id)]))
  db.accountNumberAliases = Object.fromEntries(Object.entries(numbers).map(([number,id]) => [number,resolve(id)]))
  for (const card of db.cards ?? []) card.accountId = primary.id
}
export function validateRoundup(db, update) {
  const rule = { ...db.savings.roundup, ...update }
  if (typeof rule.enabled !== 'boolean' || !Number.isSafeInteger(rule.roundupTo) || rule.roundupTo <= 0 || !Number.isSafeInteger(rule.dailyCap) || rule.dailyCap < 0) throw fail('零钱存入配置无效', 'INVALID_AMOUNT')
  rule.accountId = requireCurrencyBalance(db, rule.accountId).id
  if ((rule.enabled && !rule.goalId) || (rule.goalId && !db.savings.goals.some(goal => goal.id === rule.goalId))) throw fail('请选择本人有效的存钱目标', 'GOAL_NOT_FOUND')
  return rule
}
export function internalExchange(tx) {
  return tx.businessType === 'exchange' || (tx.detail?.channel === 'account' && (tx.detail?.paymentMethod === '账户内换汇' || tx.category === 'transfer'))
}
const currencies = ['CNY', 'USD', 'HKD']
const DAY = 86_400_000, SHANGHAI_OFFSET = 8 * 60 * 60 * 1000
const dateKey = time => new Date(time + SHANGHAI_OFFSET).toISOString().slice(0, 10)
const monthOf = time => dateKey(time).slice(0, 7)
const currencyOf = (db,tx) => findBalance(db,tx.accountId)?.currency ?? tx.detail?.settleCurrency
const sumCents = rows => rows.reduce((sum, tx) => {
  if (!Number.isSafeInteger(tx.amount) || tx.amount < 0 || !Number.isSafeInteger(sum + tx.amount)) throw fail('统计金额无效或超过精确整数范围', 'INVALID_STATISTICS_AMOUNT')
  return sum + tx.amount
}, 0)
function timestamped(rows, now) {
  const included = [], ignored = { invalidDate: 0, futureDate: 0 }
  for (const row of rows) {
    const value = row.createdAt
    const iso = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    const parsed = iso ? Date.parse(value) : NaN
    const time = Number.isFinite(parsed) && new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) === value.slice(0, 10) ? parsed : NaN
    if (!Number.isFinite(time)) { ignored.invalidDate++; continue }
    if (time > now) { ignored.futureDate++; continue }
    included.push({ ...row, time })
  }
  return { included, ignored }
}
export function spendingStatistics(db, month, labels, now = Date.now()) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw fail('统计时间无效', 'INVALID_STATISTICS_DATE')
  month ??= monthOf(now)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail('月份无效', 'INVALID_MONTH')
  const key = offset => {
    const date = new Date(`${month}-01T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + offset)
    return date.toISOString().slice(0, 7)
  }
  const byCurrency = Object.fromEntries(currencies.map(currency => {
    const { included: out, ignored } = timestamped(db.transactions.filter(tx => currencyOf(db,tx) === currency && tx.direction === 'out' && tx.status === 'success' && !internalExchange(tx)), now)
    const rows = out.filter(tx => monthOf(tx.time) === month)
    const total = sumCents(rows)
    const previous = sumCents(out.filter(tx=>monthOf(tx.time)===key(-1)))
    const grouped = new Map()
    for (const tx of rows) grouped.set(tx.category,(grouped.get(tx.category)??0)+tx.amount)
    return [currency,{currency,month,total,monthOverMonth:previous?(total-previous)/previous:0,
      previousMonth: key(-1), previousTotal: previous, monthOverMonthComparable: previous > 0,
      timeZone: 'Asia/Shanghai', asOf: new Date(now).toISOString(), ignoredDates: ignored,
      periodStatus: month < monthOf(now) ? 'complete' : month === monthOf(now) ? 'partial' : 'future',
      categories:[...grouped].sort((a,b)=>b[1]-a[1]).map(([category,amount])=>({key:category,label:labels[category],amount,ratio:total?amount/total:0})),
      trend:Array.from({length:6},(_,i)=>({month:key(i-5),amount:sumCents(out.filter(tx=>monthOf(tx.time)===key(i-5)))}))}]
  }))
  return {...byCurrency.CNY,byCurrency}
}
export function cashFlowStatistics(db, days, now = Date.now()) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 366) throw fail('查询天数须为1至366天', 'INVALID_DAYS')
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw fail('统计时间无效', 'INVALID_STATISTICS_DATE')
  const today = Math.floor((now + SHANGHAI_OFFSET) / DAY) * DAY - SHANGHAI_OFFSET
  const byCurrency = Object.fromEntries(currencies.map(currency => {
    const { included, ignored } = timestamped(db.transactions.filter(tx=>currencyOf(db,tx)===currency && !internalExchange(tx) && (tx.status==='success'||(tx.status==='pending'&&tx.pendingReason==='clearing'))), now)
    const points = Array.from({length:days},(_,i)=>{
      const start = today - (days - 1 - i) * DAY
      const rows = included.filter(tx=>tx.time>=start && tx.time<start+DAY)
      return {date:dateKey(start),income:sumCents(rows.filter(tx=>tx.direction==='in')),expense:sumCents(rows.filter(tx=>tx.direction==='out'))}
    })
    return [currency,{currency,days,points,totalIncome:sumCents(points.map(p=>({amount:p.income}))),totalExpense:sumCents(points.map(p=>({amount:p.expense}))),
      timeZone:'Asia/Shanghai',asOf:new Date(now).toISOString(),ignoredDates:ignored}]
  }))
  return {...byCurrency.CNY,byCurrency}
}
