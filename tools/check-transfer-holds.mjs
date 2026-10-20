/** 在途转账回归：独立客户各持一个资金账户，仅写内存，不连接服务器或模型。 */
import assert from 'node:assert/strict'
class Storage {
  data = new Map()
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { this.data.set(key, String(value)) }
  removeItem(key) { this.data.delete(key) }
}
globalThis.window = { localStorage: new Storage(), sessionStorage: new Storage() }
const { createMockApi, settleHeldTransfer, settleClearingTransactions } = await import('../app/src/api/mock/index.ts')
const { resetDb, loadDb, persist, findProfileByPhone } = await import('../app/src/api/mock/db.ts')
const api = createMockApi({ reviewThreshold: 500_000 })
const plain = createMockApi()
function request(patch = {}) {
  return {
    fromAccountId: loadDb().accounts[0].id, channel: 'bank', scope: 'overseas',
    payeeName: '回归收款人', payeeAccountNo: '123456789012',
    payeeBankCode: '004', payeeBankRegion: 'HK', amount: 500_000, memo: 'issue4', ...patch,
  }
}
function recipient() {
  const profile = findProfileByPhone('13600136000')
  assert(profile && profile.user.id !== loadDb().user.id)
  assert.equal(profile.accounts.length, 1)
  assert.equal(loadDb().accounts.length, 1)
  return profile
}
function internalRequest(amount) {
  const payee = recipient()
  return request({ scope: 'domestic', payeeName: payee.user.name,
    payeeAccountNo: payee.accounts[0].accountNo,
    payeeBankCode: 'LCB', payeeBankRegion: 'CN', amount })
}

resetDb()
let account = loadDb().accounts[0]
account.balance = account.available = 506_000
persist()
const held = await api.submitTransfer(request())
assert.equal(held.fee, 5000)
assert.equal(account.balance, 506_000)
assert.equal(account.available, 1000, '手续费必须一并预留')
const pendingReceipt = await api.getTransaction(held.transactionId)
assert.equal(pendingReceipt.detail.balanceBefore, pendingReceipt.detail.balanceAfter)
const firstRecipientBalance = recipient().accounts[0].balance
await plain.submitTransfer(internalRequest(1000))
assert.equal(recipient().accounts[0].balance, firstRecipientBalance + 1000)
assert.equal(account.available, 0)
const paid = await settleHeldTransfer(held.transactionId, 'settled')
assert.equal(paid.transactionId, held.transactionId)
assert.equal(paid.referenceNo, held.referenceNo)
assert.equal((await api.getTransaction(held.transactionId)).status, 'success')
assert.equal(account.balance, 0)
assert.equal(account.available, 0)
assert.equal(loadDb().transactions.filter(tx => tx.id === held.transactionId).length, 1)
await assert.rejects(settleHeldTransfer(held.transactionId, 'settled'), e => e.code === 'HELD_TRANSFER_NOT_FOUND')
console.log('PASS 本金与费用一起预留，剩余资金用完仍能到账；原编号可查，重复结算不扣款')

for (const outcome of ['recalled', 'intercepted']) {
  resetDb()
  account = loadDb().accounts[0]
  const before = { balance: account.balance, available: account.available }
  const pending = await api.submitTransfer(request())
  const other = await api.submitTransfer(request({ memo: '另一笔' }))
  await settleHeldTransfer(pending.transactionId, outcome, '回归')
  assert.equal(account.balance, before.balance)
  assert.equal(account.available, before.available - other.amount - other.fee)
  const row = await api.getTransaction(pending.transactionId)
  assert.equal(row.status, 'failed')
  assert.equal(row.heldFrozenAmount, undefined)
  assert.equal(row.detail.balanceBefore, row.detail.balanceAfter)
  await settleHeldTransfer(other.transactionId, 'recalled')
  assert.equal(account.available, before.available)
}
console.log('PASS 撤销/拦截解冻本金和费用，不释放其他指令的冻结，不污染回单余额')

resetDb()
account = loadDb().accounts[0]
const beforeLegacy = account.available
const legacy = await api.submitTransfer(request())
const legacyRow = loadDb().transactions.find(tx => tx.id === legacy.transactionId)
account.available += legacy.fee
delete legacyRow.heldFrozenAmount
persist()
await settleHeldTransfer(legacy.transactionId, 'recalled')
assert.equal(account.available, beforeLegacy)
console.log('PASS 旧版只冻结本金的指令继续按原金额解冻')

resetDb()
account = loadDb().accounts[0]
const recipientBefore = recipient().accounts[0].balance
const senderBefore = account.balance
const internal = await api.submitTransfer(internalRequest(500_000))
const internalPaid = await settleHeldTransfer(internal.transactionId, 'settled')
assert.equal(internalPaid.transactionId, internal.transactionId)
assert.equal(internalPaid.referenceNo, internal.referenceNo)
assert.equal((await api.getTransaction(internal.transactionId)).status, 'success')
assert.equal(recipient().accounts[0].balance, recipientBefore + 500_000)
assert.equal(account.balance, senderBefore - 500_000)
assert.equal(account.balance + recipient().accounts[0].balance, senderBefore + recipientBefore)
console.log('PASS 两个独立客户各一个资金账户，本行到账守恒并沿用原编号')

resetDb()
let threshold = 600_000
const live = createMockApi({ reviewThreshold: () => threshold })
const first = await live.submitTransfer(internalRequest(500_000))
assert.equal(first.settlementStatus, 'success')
threshold = 500_000
const second = await live.submitTransfer(internalRequest(500_000))
assert.equal(second.pendingReason, 'inflight')
const snapshot = structuredClone(loadDb().accounts)
assert(!settleClearingTransactions(0).includes(second.transactionId))
assert.deepEqual(loadDb().accounts, snapshot)
await live.recallTransfer(second.transactionId)
console.log('PASS 阈值函数每笔现读，清算扫描不会误结在途指令')

resetDb()
const boundary = createMockApi({ reviewThreshold: 500_000 })
for (const amount of [499_999, 500_000, 500_001]) {
  const value = await boundary.submitTransfer(internalRequest(amount))
  assert.equal(value.pendingReason === 'inflight', amount >= 500_000)
  if (value.pendingReason === 'inflight') await boundary.recallTransfer(value.transactionId)
}
const failureBefore = structuredClone(loadDb().accounts)
const recipientFailureBefore = structuredClone(recipient())
const invalidHeld = await boundary.submitTransfer(internalRequest(500_000))
loadDb().transactions.find(t => t.id === invalidHeld.transactionId).heldRequest.payeeName = '已变更的户名'
persist()
await assert.rejects(settleHeldTransfer(invalidHeld.transactionId, 'settled'), e => e.code === 'PAYEE_NAME_MISMATCH')
assert.deepEqual(loadDb().accounts, failureBefore)
assert.deepEqual(recipient(), recipientFailureBefore)
assert.equal((await boundary.getTransaction(invalidHeld.transactionId)).status, 'failed')
console.log('PASS 阈值下方/等于/上方明确受控，结算失败解冻且不改变双方余额')

resetDb()
const beforeClearing = loadDb().accounts[0].balance
const clearing = await api.submitTransfer(request({ scope: 'domestic', amount: 20_000 }))
assert.equal(clearing.pendingReason, 'clearing')
assert.equal(loadDb().accounts[0].balance, beforeClearing - 20_000)
assert(!settleClearingTransactions().includes(clearing.transactionId))
assert(settleClearingTransactions(0).includes(clearing.transactionId))
assert.equal((await api.getTransaction(clearing.transactionId)).status, 'success')
assert.equal(loadDb().accounts[0].balance, beforeClearing - 20_000)
assert.deepEqual(settleClearingTransactions(0), [])
console.log('PASS 清算仅更新状态，不重复扣款，正常延迟保留')

resetDb()
loadDb().accounts[0].balance = loadDb().accounts[0].available = 200_000_000
persist()
for (const [channel, limit] of [['bank', 100_000_000], ['fps', 60_000_000]]) {
  const body = request({ channel, fpsMethod: 'account', amount: limit })
  const quote = await api.quoteTransfer({ ...body, bankCode: body.payeeBankCode, bankRegion: body.payeeBankRegion })
  assert.equal(quote.singleLimit, limit)
  await assert.rejects(api.submitTransfer({ ...body, amount: limit + 1 }), e => e.code === 'LIMIT_EXCEEDED')
  const allowed = await api.submitTransfer(body)
  assert.equal(allowed.pendingReason, 'inflight')
  await api.recallTransfer(allowed.transactionId)
}
console.log('PASS 银行100万元/FPS60万元边界可提交，超1分被银行入口拒绝')
