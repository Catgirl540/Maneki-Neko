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
const monthOf = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
const currencyOf = (db,tx) => findBalance(db,tx.accountId)?.currency ?? tx.detail?.settleCurrency
export function spendingStatistics(db, month, labels) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail('月份无效', 'INVALID_MONTH')
  const base = new Date(`${month}-01T12:00:00`)
  const key = offset => monthOf(new Date(base.getFullYear(),base.getMonth()+offset,1))
  const byCurrency = Object.fromEntries(currencies.map(currency => {
    const out = db.transactions.filter(tx => currencyOf(db,tx) === currency && tx.direction === 'out' && tx.status === 'success' && !internalExchange(tx))
    const rows = out.filter(tx => monthOf(tx.createdAt) === month)
    const total = rows.reduce((sum,tx)=>sum+tx.amount,0)
    const previous = out.filter(tx=>monthOf(tx.createdAt)===key(-1)).reduce((sum,tx)=>sum+tx.amount,0)
    const grouped = new Map()
    for (const tx of rows) grouped.set(tx.category,(grouped.get(tx.category)??0)+tx.amount)
    return [currency,{currency,month,total,monthOverMonth:previous?(total-previous)/previous:0,
      categories:[...grouped].sort((a,b)=>b[1]-a[1]).map(([category,amount])=>({key:category,label:labels[category],amount,ratio:total?amount/total:0})),
      trend:Array.from({length:6},(_,i)=>({month:key(i-5),amount:out.filter(tx=>monthOf(tx.createdAt)===key(i-5)).reduce((sum,tx)=>sum+tx.amount,0)}))}]
  }))
  return {...byCurrency.CNY,byCurrency}
}
export function cashFlowStatistics(db, days) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 366) throw fail('查询天数须为1至366天', 'INVALID_DAYS')
  const byCurrency = Object.fromEntries(currencies.map(currency => {
    const points = Array.from({length:days},(_,i)=>{
      const start = new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()-days+1+i)
      const end = new Date(start);end.setDate(end.getDate()+1)
      const rows = db.transactions.filter(tx=>currencyOf(db,tx)===currency && !internalExchange(tx) && (tx.status==='success'||(tx.status==='pending'&&tx.pendingReason==='clearing')) && Date.parse(tx.createdAt)>=+start && Date.parse(tx.createdAt)<+end)
      return {date:`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`,income:rows.filter(tx=>tx.direction==='in').reduce((sum,tx)=>sum+tx.amount,0),expense:rows.filter(tx=>tx.direction==='out').reduce((sum,tx)=>sum+tx.amount,0)}
    })
    return [currency,{currency,days,points,totalIncome:points.reduce((sum,p)=>sum+p.income,0),totalExpense:points.reduce((sum,p)=>sum+p.expense,0)}]
  }))
  return {...byCurrency.CNY,byCurrency}
}
