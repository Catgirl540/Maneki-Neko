export function searchPayees(payees, keyword) {
  if (keyword !== undefined && (typeof keyword !== 'string' || keyword.length > 140)) throw Object.assign(new Error('收款人检索词无效'), { status: 400, code: 'INVALID_KEYWORD' })
  const needle = (keyword ?? '').trim().toLocaleLowerCase()
  return [...payees].filter(row => !needle || [row.name, row.bankName, row.bankCode, row.accountNo, row.fpsId, row.remark].filter(value => typeof value === 'string').some(value => value.toLocaleLowerCase().includes(needle))).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
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
