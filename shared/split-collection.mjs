const fail = message => Object.assign(new Error(message), { status: 400, code: 'INVALID_SPLIT_PARTICIPANTS' })
const cents = value => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000000) throw Object.assign(fail('金额须为 1 至 100000000 整数分'), { code: 'INVALID_AMOUNT' })
  return value
}

/**
 * 一位参与者的身份：姓名 + 手机号或本行账号（二者填一个即可）。
 *
 * 参加者**不能只靠姓名**聚合：同名的两个人会被合并成一个、只算一份钱，而且钱最后发给谁
 * 取决于成员表里的手机号/账号，与算账用的名字可能对不上。所以这里的唯一标识取手机号或账号，
 * 姓名只用于核对户名（后端 `nameMatches` 会再校验一遍）。
 *
 * 手机号与账号都填时，用 `手机号|账号` 联合做主键——两个都写说明用户在意这一对，
 * 后续后端会再校验它们是否指向同一位客户。
 */
const identityOf = person => {
  if (typeof person === 'string' || person === undefined || person === null) throw fail('请以「姓名 + 手机号或本行账号」提供参与者')
  const name = typeof person.name === 'string' ? person.name.trim() : ''
  if (!name || name.length > 40) throw fail('请提供有效的参与者完整姓名')
  const phone = typeof person.phone === 'string' ? person.phone.trim() : ''
  const accountNo = typeof person.accountNo === 'string' ? person.accountNo.trim() : ''
  if (!phone && !accountNo) throw fail(`请填写${name}的手机号或本行账号`)
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) throw fail(`${name}的手机号须为 11 位`)
  if (accountNo && !/^\d{12,19}$/.test(accountNo)) throw fail(`${name}的账号须为 12 至 19 位数字`)
  return { name, ...(phone ? { phone } : {}), ...(accountNo ? { accountNo } : {}), key: phone && accountNo ? `${phone}|${accountNo}` : phone || accountNo }
}

const identitiesOf = (values, minimum) => {
  if (!Array.isArray(values) || values.length < minimum || values.length > 30) throw fail(`参与人数须为 ${minimum} 至 30 人`)
  const people = values.map(identityOf)
  const keys = people.map(person => person.key)
  if (new Set(keys).size !== keys.length) throw fail('同一位参与者不能重复出现')
  return people
}

const sharesOf = (amount, people) => {
  if (amount < people.length) throw fail('每人至少分摊 1 分')
  return people.map((person, i) => ({ ...person, amount: Math.floor(amount / people.length) + (i < amount % people.length ? 1 : 0) }))
}

/**
 * 按身份合并：把若干次分摊里的份额累加到同一个人头上。
 *
 * 主键用手机号/账号，而不是姓名——这正是这次改动的目的：同名的两位张伟是两个人，
 * 而同一个人在不同消费里可以只填手机号或只填账号，靠手机号优先合并。
 */
const mergeInto = (totals, person) => {
  const existingKey = person.phone && totals.get(person.phone) ? person.phone : person.key
  const prior = totals.get(existingKey)
  if (prior) {
    prior.amount += person.amount
    // 补齐先前缺的身份字段，方便界面一次性展示。
    if (!prior.phone && person.phone) prior.phone = person.phone
    if (!prior.accountNo && person.accountNo) prior.accountNo = person.accountNo
    return
  }
  totals.set(existingKey, { ...person })
}

/** Round each activity independently, then aggregate only the activities each person attended. */
export function calculateSplitCollection(input) {
  if (input.expenses === undefined) {
    const amount = cents(input.amount), people = identitiesOf(input.participants, 2)
    return { amount, participants: sharesOf(amount, people) }
  }
  if (input.amount !== undefined || input.participants !== undefined) throw fail('分项 AA 请仅提供各项消费金额及名单，不要混入待收总额或统一名单')
  // 本人身份同样用「姓名 + 手机号或账号」，与参加者同一套规则，便于按身份排除自付份额。
  const collector = identityOf(input.collectorName)
  if (!Array.isArray(input.expenses) || !input.expenses.length || input.expenses.length > 30) throw fail('请提供 1 至 30 项消费')
  let expenseTotal = 0, selfAmount = 0
  const totals = new Map()
  const expenses = input.expenses.map(item => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 80) throw fail('请填写有效的分项事由')
    const amount = cents(item.amount), people = identitiesOf(item.participants, 2)
    expenseTotal += amount
    if (expenseTotal > 100000000) throw fail('消费合计不能超过 100000000 分')
    const shares = sharesOf(amount, people)
    for (const share of shares) {
      if (share.key === collector.key) selfAmount += share.amount
      else mergeInto(totals, share)
    }
    return { title: item.title.trim(), amount, participants: people, shares }
  })
  if (!totals.size) throw fail('参与总人数不能超过 30 人，且须有其他付款人')
  if (new Set([collector.key, ...totals.keys()]).size > 30) throw fail('参与总人数不能超过 30 人，且须有其他付款人')
  return {
    amount: expenseTotal - selfAmount,
    collectorName: collector.name,
    collector: { name: collector.name, ...(collector.phone ? { phone: collector.phone } : {}), ...(collector.accountNo ? { accountNo: collector.accountNo } : {}) },
    expenseTotal,
    selfAmount,
    expenses,
    participants: [...totals.values()].map(({ key, ...person }) => person),
  }
}
