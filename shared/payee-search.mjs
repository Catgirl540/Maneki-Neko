export function searchPayees(payees, keyword) {
  if (keyword !== undefined && (typeof keyword !== 'string' || keyword.length > 140)) throw Object.assign(new Error('收款人检索词无效'), { status: 400, code: 'INVALID_KEYWORD' })
  const needle = (keyword ?? '').trim().toLocaleLowerCase()
  return [...payees].filter(row => !needle || [row.name, row.bankName, row.bankCode, row.phone, row.accountNo, row.fpsId, row.remark].filter(value => typeof value === 'string').some(value => value.toLocaleLowerCase().includes(needle))).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
}
export function updatePayeeRemark(payees, id, remark) {
  if (typeof remark !== 'string' || remark.trim().length > 140 || /[\x00-\x1f\x7f]/.test(remark)) throw Object.assign(new Error('收款人备注须为最多 140 字的单行文字'), { status: 400, code: 'INVALID_PAYEE_REMARK' })
  const row = payees.find(payee => payee.id === id)
  if (!row) throw Object.assign(new Error('收款人不存在'), { status: 404, code: 'PAYEE_NOT_FOUND' })
  row.remark = remark.trim()
  return row
}

/** Internal transfers return before the external-clearing branch; save their recipients too. */
export function rememberInternalPayee(db, request, nextId) {
  const number = request.payeeAccountNo.replace(/\D/g, '')
  const existing = db.payees.find(row => row.channel === 'bank' && row.bankCode === request.payeeBankCode && row.bankRegion === request.payeeBankRegion && row.accountNo === number)
  if (existing) { existing.name = request.payeeName.trim(); existing.lastUsedAt = new Date().toISOString(); existing.remark ??= request.memo.trim() }
  else db.payees.push({ id: nextId('pay'), name: request.payeeName.trim(), channel: 'bank', scope: 'domestic', accountNo: number, bankCode: request.payeeBankCode, bankRegion: request.payeeBankRegion, bankName: '招财猫银行', remark: request.memo.trim(), lastUsedAt: new Date().toISOString() })
  db.payees.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)); db.payees.length = Math.min(db.payees.length, 50)
}

/**
 * AA 参与者与转账收款人共用同一份通讯录。
 *
 * 与 [rememberInternalPayee] 的区别：AA 的收款项由「姓名 + 手机号或本行账号」识别，
 * 手机号是成员的主键（转账只认账号），所以这里优先按手机号去重，其次按账号。
 * 同一个人可能先只填手机号、后只填账号，两种情况都补齐到同一条记录上，不让通讯录里出现两个。
 */
export function rememberAaContact(db, { name, phone, accountNo }, nextId) {
  const cleanName = String(name ?? '').trim()
  if (!cleanName) return
  if (!db.payees) db.payees = []
  const now = new Date().toISOString()
  // 同一个人可能有两条线索（手机号 / 账号），也可能历史上被记成了两条。
  // 先把所有指向这个人的记录收集起来，合并成一条，避免下拉里出现重复的同一人。
  // 关联规则：手机号或账号命中；或者同名且**没有冲突的线索**。
  // 同名不同线索（例如两位都叫张伟、手机号不同）不能被合并成一个人，所以只在
  // 「名字相同、且已有记录缺这条线索」时才算同一个人。
  const matches = db.payees.filter(item => item.channel === 'bank' && (
    (phone && item.phone === phone) ||
    (accountNo && item.accountNo === accountNo) ||
    (item.name === cleanName && (
      (!phone && !accountNo) ||
      (phone && !item.phone) ||
      (accountNo && !item.accountNo)
    ))
  ))
  let row = matches[0]
  if (row) {
    for (const extra of matches.slice(1)) {
      row.phone = row.phone ?? extra.phone
      row.accountNo = row.accountNo ?? extra.accountNo
      db.payees.splice(db.payees.indexOf(extra), 1)
    }
    row.name = cleanName
    if (phone) row.phone = phone
    if (accountNo) row.accountNo = accountNo
    row.lastUsedAt = now
  } else {
    db.payees.push({ id: nextId('pay'), name: cleanName, channel: 'bank', scope: 'domestic', bankName: '招财猫银行', ...(phone ? { phone } : {}), ...(accountNo ? { accountNo } : {}), remark: '', lastUsedAt: now })
  }
  db.payees.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
  db.payees.length = Math.min(db.payees.length, 50)
}

/**
 * 手动添加一位收款人。
 *
 * 转账收款人（外行）要银行代码，AA 参与者（本行）要手机号或本行账号；两者共用一张通讯录，
 * 所以这里按「本行/外行」分两支校验。`channel: 'bank'` + 不带 bankCode 即本行账户。
 */
export function addPayee(payees, input, nextId) {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 40) throw Object.assign(new Error('请填写收款人姓名（最多 40 字）'), { status: 400, code: 'INVALID_PAYEE_NAME' })
  const phone = typeof input?.phone === 'string' ? input.phone.replace(/\s+/g, '') : ''
  const accountNo = typeof input?.accountNo === 'string' ? input.accountNo.replace(/\s+/g, '') : ''
  if (!phone && !accountNo) throw Object.assign(new Error('请填写手机号或账号'), { status: 400, code: 'INVALID_PAYEE_IDENTITY' })
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) throw Object.assign(new Error('手机号须为 11 位'), { status: 400, code: 'INVALID_PHONE' })
  if (accountNo && !/^\d{12,19}$/.test(accountNo)) throw Object.assign(new Error('账号须为 12 至 19 位数字'), { status: 400, code: 'INVALID_ACCOUNT_NO' })
  // 去重看**任一线索**：手机号或账号命中都算同一个人。
  // 只按手机号找的话，「同一个账号先只存账号、后来又带上手机号」会被当成新人，通讯录里出现两条。
  const duplicate = payees.find(row => row.channel === 'bank' && (
    (phone && row.phone === phone) || (accountNo && row.accountNo === accountNo)
  ))
  if (duplicate) {
    // 已在通讯录里：把这次新填的线索补上去，而不是直接报错了事。
    // 用户往往先只存了账号，过几天又加上手机号——两条线索合到同一条记录才对。
    //
    // 注意：**改动了数据就必须返回 2xx**。早先这里补完线索仍抛 409，
    // 前端按失败处理，可出现库里其实已经改了，用户看到"失败"却被悄悄改掉了记录。
    const before = `${duplicate.phone ?? ''}|${duplicate.accountNo ?? ''}`
    if (phone && !duplicate.phone) duplicate.phone = phone
    if (accountNo && !duplicate.accountNo) duplicate.accountNo = accountNo
    if (duplicate.name !== name) duplicate.name = name
    duplicate.lastUsedAt = new Date().toISOString()
    const after = `${duplicate.phone ?? ''}|${duplicate.accountNo ?? ''}`
    if (before === after) throw Object.assign(new Error('这位收款人已在通讯录里'), { status: 409, code: 'PAYEE_EXISTS' })
    return duplicate
  }
  if (payees.length >= 50) throw Object.assign(new Error('通讯录最多保存 50 位收款人'), { status: 400, code: 'PAYEE_LIMIT' })
  const row = { id: nextId('pay'), name, channel: 'bank', scope: 'domestic', bankName: '招财猫银行', ...(phone ? { phone } : {}), ...(accountNo ? { accountNo } : {}), remark: '', lastUsedAt: new Date().toISOString() }
  payees.unshift(row)
  payees.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
  return row
}
