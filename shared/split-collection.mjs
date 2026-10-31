const fail = message => Object.assign(new Error(message), { status: 400, code: 'INVALID_SPLIT_PARTICIPANTS' })
const nameOf = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw fail('请提供有效的参与者完整姓名')
  return value.trim()
}
const cents = value => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000000) throw Object.assign(fail('金额须为 1 至 100000000 整数分'), { code: 'INVALID_AMOUNT' })
  return value
}
const namesOf = (values, minimum) => {
  if (!Array.isArray(values) || values.length < minimum || values.length > 30) throw fail(`参与人数须为 ${minimum} 至 30 人`)
  const names = values.map(nameOf)
  if (new Set(names).size !== names.length) throw fail('参与者姓名不能重复')
  return names
}
const sharesOf = (amount, names) => {
  if (amount < names.length) throw fail('每人至少分摊 1 分')
  return names.map((name, i) => ({ name, amount: Math.floor(amount / names.length) + (i < amount % names.length ? 1 : 0) }))
}

/** Round each activity independently, then aggregate only the activities each person attended. */
export function calculateSplitCollection(input) {
  if (input.expenses === undefined) {
    const amount = cents(input.amount), names = namesOf(input.participants, 2)
    return { amount, participants: sharesOf(amount, names) }
  }
  if (input.amount !== undefined || input.participants !== undefined) throw fail('分项 AA 请仅提供各项消费金额及名单，不要混入待收总额或统一名单')
  const collectorName = nameOf(input.collectorName)
  if (!Array.isArray(input.expenses) || !input.expenses.length || input.expenses.length > 30) throw fail('请提供 1 至 30 项消费')
  let expenseTotal = 0, selfAmount = 0
  const totals = new Map()
  const expenses = input.expenses.map(item => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 80) throw fail('请填写有效的分项事由')
    const amount = cents(item.amount), participants = namesOf(item.participants, 2)
    expenseTotal += amount
    if (expenseTotal > 100000000) throw fail('消费合计不能超过 100000000 分')
    const shares = sharesOf(amount, participants)
    for (const share of shares) {
      if (share.name === collectorName) selfAmount += share.amount
      else totals.set(share.name, (totals.get(share.name) ?? 0) + share.amount)
    }
    return { title: item.title.trim(), amount, participants, shares }
  })
  if (!totals.size || new Set([collectorName, ...totals.keys()]).size > 30) throw fail('参与总人数不能超过 30 人，且须有其他付款人')
  return { amount: expenseTotal - selfAmount, collectorName, expenseTotal, selfAmount, expenses, participants: [...totals].map(([name, amount]) => ({ name, amount })) }
}
