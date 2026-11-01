/**
 * 模拟消费（/spend 与 POST /api/cards/:id/spend）的回归检查。
 *
 * 覆盖：
 * - 分类器接线：注入假分类器后，分类结果随交易落库（不是前端或目录写死）
 * - 扣款：从卡绑定账户的币种分区扣，余额守恒
 * - 拒绝路径：锁定卡 / 待激活卡 / 未开线上支付 / 未知平台 / 零金额 / 超单笔上限 / 超单日限额 / 余额不足
 * - 卡激活：支付密码错不激活；正确密码把待激活改为使用中
 *
 * 全部在内存 mock 上跑，不触碰数据库。
 */
import assert from 'node:assert/strict'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}
globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() }

const { createMockApi } = await import('../app/src/api/mock/index.ts')
const { loadDb, resetDb, persist, findBalance, CARD_PRODUCTS } = await import('../app/src/api/mock/db.ts')

resetDb()

// 假分类器：按商户名映射，验证分类结果真的被用上（而不是目录里写死）
const FAKE = { 美团外卖: 'dining', 滴滴出行: 'transport', 淘宝: 'shopping' }
const api = createMockApi({
  classify: async (tx) => FAKE[tx.counterparty] ?? 'other',
})

const sms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', sms.demoCode)

let passed = 0
function ok(name) { passed += 1; console.log(`PASS  ${name}`) }
async function rejects(fn, code, name) {
  try { await fn() } catch (error) {
    assert.equal(error.code, code, `${name}：期望 ${code}，实际 ${error.code ?? error.message}`)
    ok(name); return
  }
  throw new Error(`${name}：没有按预期拒绝`)
}

const db = loadDb()
const card = db.cards.find(c => c.status === 'active')
assert.ok(card, '演示档案应有使用中的卡')

/** 等后台分类落地（mock 里是异步任务），超时报错 */
async function waitClassified(txId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const row = loadDb().transactions.find(t => t.id === txId)
    if (row && row.classificationState !== 'pending') return row
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`分类超时：${txId} 仍为 pending`)
}

// 1. 分类器接线 + 扣款守恒：响应先回（pending），分类后台完成
const before = findBalance(loadDb(), card.accountId).available
const receipt = await api.spendOnCard(card.id, { platform: 'meituan', amount: 3850 })
assert.equal(receipt.classificationState, 'pending', '记账不等分类：响应应是 pending')
assert.equal(receipt.category, 'other', '分类未完成前先按 other 落账')
assert.equal(receipt.available, before - 3850, '响应里余额已经扣好，不用等分类')
const classifiedTx = await waitClassified(receipt.transaction.id)
assert.equal(classifiedTx.category, 'dining', '注入的分类器结果应回写到流水')
assert.equal(classifiedTx.classificationState, 'done')
assert.equal(classifiedTx.detail.channel, 'card')
assert.equal(classifiedTx.detail.cardId, card.id, '明细应记录卡 id，供单日限额累计')
assert.equal(findBalance(loadDb(), card.accountId).available, before - 3850)
ok('先记账后分类：响应即 pending、余额立减，分类完成回写 dining')

// 2. 不同平台走不同分类
const didi = await api.spendOnCard(card.id, { platform: 'didi', amount: 2680 })
const didiTx = await waitClassified(didi.transaction.id)
assert.equal(didiTx.category, 'transport')
ok('分类随商户变化（didi → transport）')

// 2b. 账单详情：写进摘要与明细，空详情回落到默认摘要
const detailed = await api.spendOnCard(card.id, { platform: 'meituan', amount: 1150, note: '  嗉泰面（大朗店）· 猪扒包  ' })
assert.equal(detailed.transaction.memo, '美团外卖 · 嗉泰面（大朗店）· 猪扒包', '详情应去首尾空白后写进摘要')
assert.equal(detailed.transaction.detail.merchantNote, '嗉泰面（大朗店）· 猪扒包', '详情应落明细供回单展示')
const plain = await api.spendOnCard(card.id, { platform: 'meituan', amount: 1150 })
assert.equal(plain.transaction.memo, '美团外卖 消费', '未填详情时用默认摘要')
await rejects(() => api.spendOnCard(card.id, { platform: 'meituan', amount: 100, note: '第一行\n第二行' }), 'INVALID_NOTE', '含换行的详情被拒')
await rejects(() => api.spendOnCard(card.id, { platform: 'meituan', amount: 100, note: 'x'.repeat(81) }), 'INVALID_NOTE', '超长详情被拒')
ok('账单详情：去空白写入摘要与明细，换行/超长被拒')

// 2c. 自由商家：自定义收单 / Stripe 收单
const custom = await api.spendOnCard(card.id, { platform: 'custom', merchant: '街角咖啡', amount: 1800 })
assert.equal(custom.transaction.counterparty, '街角咖啡', '自定义商家名即对方户名')
assert.equal(custom.transaction.detail.counterpartyBank, '自定义收单')
const stripe = await api.spendOnCard(card.id, { platform: 'stripe', merchant: 'OpenAI', amount: 2000 })
assert.equal(stripe.transaction.counterparty, 'OpenAI')
assert.equal(stripe.transaction.detail.counterpartyBank, 'Stripe Payments', 'Stripe 收单记 Stripe Payments')
assert.equal(stripe.transaction.memo, 'OpenAI 消费')
await rejects(() => api.spendOnCard(card.id, { platform: 'stripe', amount: 100 }), 'INVALID_MERCHANT', 'Stripe 未填商户名被拒')
await rejects(() => api.spendOnCard(card.id, { platform: 'custom', merchant: 'x', amount: 100 }), 'INVALID_MERCHANT', '商户名过短被拒')
await rejects(() => api.spendOnCard(card.id, { platform: 'custom', merchant: '第一行\n第二行', amount: 100 }), 'INVALID_MERCHANT', '含换行的商户名被拒')
ok('自由商家：自定义/Stripe 收单元数据正确，缺失/过短/换行商户名被拒')

// 3. 拒绝路径
await rejects(() => api.spendOnCard('card_nope', { platform: 'meituan', amount: 100 }), 'CARD_NOT_FOUND', '不存在的卡被拒')
await rejects(() => api.spendOnCard(card.id, { platform: 'nope', amount: 100 }), 'SPEND_PLATFORM_NOT_FOUND', '未知平台被拒')
await rejects(() => api.spendOnCard(card.id, { platform: 'meituan', amount: 0 }), 'INVALID_AMOUNT', '零金额被拒')
await rejects(() => api.spendOnCard(card.id, { platform: 'meituan', amount: 5_000_001 }), 'LIMIT_EXCEEDED', '超单笔上限被拒')

const row = loadDb().cards.find(c => c.id === card.id)
row.status = 'locked'; persist()
await rejects(() => api.spendOnCard(row.id, { platform: 'meituan', amount: 100 }), 'CARD_LOCKED', '锁定卡被拒')
row.status = 'active'; persist()

row.onlinePayment = false; persist()
await rejects(() => api.spendOnCard(row.id, { platform: 'meituan', amount: 100 }), 'CARD_ONLINE_PAYMENT_DISABLED', '未开线上支付被拒')
row.onlinePayment = true; persist()

const usedToday = loadDb().transactions
  .filter(t => t.detail?.cardId === row.id && t.direction === 'out' && t.status === 'success')
  .reduce((sum, t) => sum + t.amount, 0)
// 限额按「今日已用 + 1000」设，再花 1001：与前面用例的消费额无关，不会退化成金额非法
row.dailyLimit = usedToday + 1_000; persist()
await rejects(() => api.spendOnCard(row.id, { platform: 'meituan', amount: 1_001 }), 'DAILY_LIMIT_EXCEEDED', '超单日限额被拒')
row.dailyLimit = 2_000_000; persist()
ok('限额恢复后不影响后续消费')

// 余额不足：把余额压到 1 分
const balanceRow = findBalance(loadDb(), row.accountId)
const keep = balanceRow.available
balanceRow.available = 1; balanceRow.balance = 1; persist()
await rejects(() => api.spendOnCard(row.id, { platform: 'meituan', amount: 100 }), 'INSUFFICIENT_FUNDS', '余额不足被拒')
balanceRow.available = keep; balanceRow.balance = keep; persist()

// 4. 卡激活：密码错不激活，密码对才改为使用中（演示档案没有待激活卡，就地造一张）
const pendingRow = loadDb().cards.find(c => c.id === card.id)
pendingRow.status = 'pending'; persist()
await rejects(() => api.activateCard(pendingRow.id, '000000'), 'BAD_PAY_PASSWORD', '激活时支付密码错误被拒')
const activated = await api.activateCard(pendingRow.id, '888888')
assert.equal(activated.status, 'active')
ok('激活：错误密码拒绝，正确密码改为使用中')
await rejects(() => api.activateCard(activated.id, '888888'), 'CARD_ALREADY_ACTIVE', '已激活的卡重复激活被拒')

// 订阅只在显式开通且刷卡成功后签约；已有合约拒绝重放，普通消费不签约。
const { prepareSpendSubscription } = await import('../shared/spend-subscription.mjs')
const january = prepareSpendSubscription({ platform: 'iqiyi', amount: 2500, subscription: true }, 'CNY', [], Date.parse('2028-01-31T12:00:00+08:00'))
assert.equal(january.contract.nextRunAt, '2028-02-28T16:00:00.000Z')
assert.equal(prepareSpendSubscription({ platform: 'iqiyi', subscription: true }, 'USD', []).contract, null)
assert.ok(prepareSpendSubscription({ platform: 'iqiyi', subscription: 'true' }, 'CNY', []).error)
const contractsBefore = loadDb().autoDebits.length
const beforeSubscription = findBalance(loadDb(), card.accountId).available
const subscribed = await api.spendOnCard(card.id, { platform: 'baidu-drive', amount: 3000, subscription: true })
assert.equal(subscribed.autoDebit.amount, 3000)
assert.equal(subscribed.autoDebit.merchant, '百度网盘')
assert.equal(subscribed.autoDebit.cardId, card.id, '签约应记录扣款卡')
assert.equal(loadDb().autoDebits.length, contractsBefore + 1)
assert.equal((await api.listAutoDebits()).find(item => item.id === subscribed.autoDebit.id).enabled, true)
assert.equal(findBalance(loadDb(), card.accountId).available, beforeSubscription - 3000)
await rejects(() => api.spendOnCard(card.id, { platform: 'baidu-drive', amount: 3000, subscription: true }), 'INVALID_SUBSCRIPTION', '重复签约不扣款')
assert.equal(findBalance(loadDb(), card.accountId).available, beforeSubscription - 3000)
await api.setAutoDebitEnabled(subscribed.autoDebit.id, false)
assert.equal((await api.listAutoDebits()).find(item => item.id === subscribed.autoDebit.id).enabled, false)
await rejects(() => api.spendOnCard(card.id, { platform: 'meituan', amount: 100, subscription: true }), 'INVALID_SUBSCRIPTION', '普通商户不能签订订阅')
const ordinary = await api.spendOnCard(card.id, { platform: 'tencent-video', amount: 100 })
assert.equal(ordinary.autoDebit, undefined)
assert.equal(loadDb().autoDebits.length, contractsBefore + 1)
row.status = 'locked'; persist()
await rejects(() => api.spendOnCard(row.id, { platform: 'tencent-video', amount: 3000, subscription: true }), 'CARD_LOCKED', '消费失败不会留下合约')
assert.equal(loadDb().autoDebits.length, contractsBefore + 1)
row.status = 'active'; persist()
ok('订阅月末日期、首笔扣款签约、查阅停用、重复与失败保护通过')

// 换卡：同一张卡换号，绑定的订阅暂停并要求手动重新绑定
const cardsBeforeSwap = loadDb().cards.length
const unionpay = CARD_PRODUCTS.find(p => p.network === 'unionpay')
const address = { recipient: '林小满', phone: '13800138000', region: '上海市', city: '上海市', detail: '浦东新区世纪大道 100 号', postalCode: '200120' }
const backup = await api.openCard({ productCode: unionpay.code, address, paymentPassword: '888888' })
await api.activateCard(backup.id, '888888')
const swapped = await api.replaceCard(card.id, { address, paymentPassword: '888888' })
assert.equal(swapped.id, card.id, '换卡应更新同一张卡')
assert.equal(swapped.status, 'pending')
assert.equal(loadDb().cards.length, cardsBeforeSwap + 1, '换卡本身不新增卡片（只有新开的备用卡 +1）')
const paused = (await api.listAutoDebits()).find(item => item.id === subscribed.autoDebit.id)
assert.equal(paused.needsRebind, true, '换卡后订阅应待重新绑定')
assert.equal(paused.enabled, false)
await rejects(() => api.setAutoDebitEnabled(paused.id, true), 'AUTODEBIT_REBIND_REQUIRED', '换卡后不能直接恢复扣款')
await rejects(() => api.bindAutoDebit(paused.id, swapped.id), 'CARD_NOT_ACTIVE', '待激活卡不能作为绑定卡')
const rebound = await api.bindAutoDebit(paused.id, backup.id)
assert.equal(rebound.cardId, backup.id)
assert.equal(rebound.needsRebind, false)
assert.equal(rebound.enabled, true)
ok('换卡原地换号：绑定订阅暂停，手动绑定使用中的卡后恢复')

console.log(`\ncheck-spend: ${passed} 项全部通过`)
