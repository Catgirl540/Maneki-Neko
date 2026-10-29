/**
 * 会员制新方案（docs/product/membership-rules.md，2026-10-20 用户定稿）；
 * 仅内存夹具，不触碰客户数据库。
 *
 * 覆盖：四档门槛与 label、AUM 全口径（储蓄 + 理财 + 现金管理）、演示档案评白金、
 * 新客 standard、升级即时、连续 2 期不达标才降级、entitlements 各档、贵宾厅核销与
 * 409、旧权益（制卡费减免 / 换汇点差）仍生效、转账费减免与 quote→submit 一致、
 * VIP 工单、理财优先购窗口、日终快照存 AUM、旧档案迁移。
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
const { loadDb, resetDb, CARD_PRODUCTS, FX_SPREAD, FX_MID_RATES } = await import('../app/src/api/mock/db.ts')
const { ACCOUNT_OPENING_PLEDGE } = await import('../app/src/lib/account-opening.ts')
const {
  aumAssets,
  applyRealtimeUpgrade,
  beijingMonth,
  cardFeeQuote,
  daysInMonth,
  entitlements,
  evaluateMembership,
  freshMembership,
  memberBenefits,
  membershipOverview,
  MEMBER_TIER_RULES,
  MEMBER_TIERS,
  normalizeMembership,
  recordAssetSnapshot,
  redeemLoungePass,
  transferFee,
  wealthPriorityGate,
} = await import('../shared/membership.mjs')

const CNY = { CNY: 1, USD: 7.1562, HKD: 0.91547 }
const TIER_INDEX = (tier) => MEMBER_TIERS.indexOf(tier)

function profile(overrides = {}) {
  const db = {
    user: { id: 'u_fixture', name: '夹具客户', phone: '13900000000', memberTier: 'standard', avatarInitial: '夹' },
    accounts: [{ balance: 0 }],
    currencyBalances: [],
    holdings: [],
    cashManagement: { balance: 0 },
    membership: freshMembership(),
    assetSnapshots: [],
    ...overrides,
  }
  return db
}

function monthSnapshots(month, assets) {
  return Array.from({ length: daysInMonth(month) }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    assets,
  }))
}

resetDb()
const api = createMockApi()
const sms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', sms.demoCode)

/* ── 1. 四档门槛与 label ─────────────────────────────────────────── */
assert.deepEqual(MEMBER_TIERS, ['standard', 'gold', 'platinum', 'diamond'])
assert.equal(MEMBER_TIER_RULES.standard.label, '普通会员')
assert.equal(MEMBER_TIER_RULES.standard.threshold, 0)
assert.equal(MEMBER_TIER_RULES.gold.label, '金卡会员')
assert.equal(MEMBER_TIER_RULES.gold.threshold, 10_000_000)
assert.equal(MEMBER_TIER_RULES.platinum.label, '白金会员')
assert.equal(MEMBER_TIER_RULES.platinum.threshold, 50_000_000)
assert.equal(MEMBER_TIER_RULES.diamond.label, '钻石会员')
assert.equal(MEMBER_TIER_RULES.diamond.threshold, 300_000_000)
console.log('PASS 四档门槛（0 / ¥10 万 / ¥50 万 / ¥300 万）与 label 正确')

/* ── 2. AUM 全口径：储蓄 + 理财持仓 + 现金管理，不含授信 ────────── */
const aumDb = profile({
  accounts: [{ balance: 1_000_000 }],
  currencyBalances: [{ currency: 'USD', balance: 100 }],
  holdings: [{ marketValue: 2_000_000 }],
  cashManagement: { balance: 500_000 },
  credit: { creditLimit: 99_999_999 },
})
assert.equal(aumAssets(aumDb, CNY), 1_000_000 + 716 + 2_000_000 + 500_000)
assert.equal(aumAssets(profile({ wealthAccount: { holdings: [{ marketValue: 3_000_000 }] } }), CNY), 3_000_000)
assert.equal(aumAssets(profile({ currencyBalances: [{ currency: 'USD', balance: 100 }] }), CNY), 716)
console.log('PASS AUM = 资金账户折人民币 + 理财持仓市值 + 现金管理余额（不含授信）')

/* ── 3. entitlements 各档布尔值与贵宾厅次数 ───────────────────── */
const ent = (tier) => entitlements(tier)
assert.deepEqual(
  Object.fromEntries(['standard', 'gold', 'platinum', 'diamond'].map((t) => [t, {
    freeTransferFee: ent(t).freeTransferFee,
    freeOverseasRemit: ent(t).freeOverseasRemit,
    vipChannel: ent(t).vipChannel,
    birthdayGift: ent(t).birthdayGift,
    dedicatedManager: ent(t).dedicatedManager,
    dedicatedAdvisor: ent(t).dedicatedAdvisor,
    wealthPriority: ent(t).wealthPriority,
    lounge: ent(t).loungePassesPerYear,
  }])),
  {
    standard: { freeTransferFee: false, freeOverseasRemit: false, vipChannel: false, birthdayGift: false, dedicatedManager: false, dedicatedAdvisor: false, wealthPriority: false, lounge: 0 },
    gold: { freeTransferFee: true, freeOverseasRemit: false, vipChannel: true, birthdayGift: false, dedicatedManager: false, dedicatedAdvisor: false, wealthPriority: false, lounge: 0 },
    platinum: { freeTransferFee: true, freeOverseasRemit: false, vipChannel: true, birthdayGift: false, dedicatedManager: true, dedicatedAdvisor: false, wealthPriority: true, lounge: 2 },
    diamond: { freeTransferFee: true, freeOverseasRemit: true, vipChannel: true, birthdayGift: false, dedicatedManager: true, dedicatedAdvisor: true, wealthPriority: true, lounge: 6 },
  },
)
// 旧权益字段并存
assert.equal(ent('gold').cardFeeWaiversPerYear, 1)
assert.equal(ent('gold').cardFeeRate, 0.5)
assert.equal(ent('platinum').cardFeeRate, 0)
assert.equal(ent('diamond').includeShipping, true)
assert.equal(ent('diamond').cardFeeWaiversPerYear, 2)
assert.equal(ent('gold').fxFeeRate, 0.9)
assert.equal(ent('platinum').fxFeeRate, 0.8)
assert.equal(ent('diamond').fxFeeRate, 0.7)
// 生日礼遇「规划中」：字段保留但恒为 false，且展示为规划中
assert.equal(ent('diamond').birthdayGift, false)
assert(memberBenefits('gold').some((line) => line.includes('生日礼遇（规划中）')))
assert(!memberBenefits('standard').some((line) => line.includes('生日礼遇')))
console.log('PASS entitlements 四档布尔值、贵宾厅 0/0/2/6、旧权益字段与生日礼遇规划中')

/* ── 4. 演示档案（林小满）评白金；AUM 含现金管理 ──────────────── */
const m = await api.getMembership()
const db = loadDb()
assert.equal(m.tier, 'platinum')
assert.equal(m.tierLabel, '白金会员')
assert.equal(m.nextTier, 'diamond')
assert.equal(m.nextThreshold, 300_000_000)
assert.equal(m.aum, m.evaluation.avgAssets)
const currentAum = aumAssets(db, FX_MID_RATES)
assert(Math.abs(m.aum - currentAum) < currentAum * 0.03, `月均 ${m.aum} 应接近当前 AUM ${currentAum}`)
assert(m.aum > 50_000_000 && m.aum < 300_000_000, `演示日均 AUM ${m.aum} 应落在白金区间`)
assert(m.evaluation.coveredDays > 0)
assert.equal(m.entitlements.dedicatedManager, true)
assert.equal(m.entitlements.dedicatedAdvisor, false)
assert.equal(m.entitlements.loungePassesPerYear, 2)
assert.deepEqual(m.lounge, { year: Number(beijingMonth().slice(0, 4)), perYear: 2, used: 0, remaining: 2 })
assert(m.benefits.includes('专属客户经理'))
assert(m.benefits.includes('机场 / 高铁贵宾厅 2 次 / 年'))
assert(m.benefits.includes('理财产品优先申购'))
assert(!('legacy' in m), '会员概览不得再有 legacy 订阅残留')
assert.equal(db.user.memberTier, 'platinum')
assert.equal((await api.profile()).memberTier, 'platinum')
console.log('PASS 演示档案按月均 AUM 评白金：¥128 万储蓄 + 现金管理，无 legacy 残留，memberTier 同源')

/* ── 5. 升级即时：实时 AUM 跨档当天就升 ────────────────────────── */
const liveDb = profile({ accounts: [{ balance: 9_999_999 }] }) // ¥9.99 万：未达金卡
assert.equal(applyRealtimeUpgrade(liveDb, CNY), false)
liveDb.accounts[0].balance = 50_000_000 // ¥50 万 → 白金
assert.equal(applyRealtimeUpgrade(liveDb, CNY), true)
assert.equal(liveDb.membership.tier, 'platinum')
assert.equal(liveDb.user.memberTier, 'platinum')
assert(liveDb.membership.records.some((r) => r.label.includes('会员升级') && r.label.includes('实时 AUM')))
// 已达标更高档时不再重复写升级记录
assert.equal(applyRealtimeUpgrade(liveDb, CNY), false)
assert.equal(liveDb.membership.records.filter((r) => r.label.includes('会员升级')).length, 1)
console.log('PASS 升级即时：实时 AUM 达 ¥50 万当天升白金，重复检查不刷记录')

/* ── 6. 降级需连续 2 个评定周期不达标 ─────────────────────────── */
const dropDb = profile({
  membership: { ...freshMembership(), tier: 'platinum' },
  assetSnapshots: monthSnapshots('2026-09', 10_000_000), // 金卡档
})
dropDb.user.memberTier = 'platinum'
const oct = Date.UTC(2026, 9, 15, 4) // 北京时间 2026-10-15
assert.equal(evaluateMembership(dropDb, oct), true)
assert.equal(dropDb.membership.tier, 'platinum', '第 1 期不达标只进入缓冲')
assert.equal(dropDb.membership.belowPeriods, 1)
assert(dropDb.membership.evaluation.avgAssets < 50_000_000)
const warning = membershipOverview(dropDb, CNY).downgradeWarning
assert(warning && warning.includes('白金会员') && warning.includes('金卡会员') && warning.includes('连续 2 个月'))
// 第 2 期仍不达标 → 降级到金卡
dropDb.assetSnapshots.push(...monthSnapshots('2026-10', 10_000_000))
const nov = Date.UTC(2026, 10, 15, 4)
assert.equal(evaluateMembership(dropDb, nov), true)
assert.equal(dropDb.membership.tier, 'gold')
assert.equal(dropDb.membership.belowPeriods, 0)
assert(dropDb.membership.records.some((r) => r.label.includes('会员降级') && r.label.includes('连续 2 期')))
assert.equal(membershipOverview(dropDb, CNY).downgradeWarning, null)
// 缓冲期内回到门槛之上：计数清零、不降级
const recoverDb = profile({
  membership: { ...freshMembership(), tier: 'platinum' },
  assetSnapshots: monthSnapshots('2026-09', 10_000_000),
})
recoverDb.user.memberTier = 'platinum'
evaluateMembership(recoverDb, oct)
assert.equal(recoverDb.membership.belowPeriods, 1)
recoverDb.assetSnapshots.push(...monthSnapshots('2026-10', 60_000_000))
evaluateMembership(recoverDb, nov)
assert.equal(recoverDb.membership.tier, 'platinum')
assert.equal(recoverDb.membership.belowPeriods, 0)
console.log('PASS 降级缓冲：连续 2 期低于当前档门槛才降；中途达标清零并保持原等级')

/* ── 7. 新客户 standard：零权益、标准点差、旧权益不生效 ───────── */
const newSms = await api.sendSmsCode('13900139098')
const face = await api.verifyIdentity('face')
await api.register({ phone: '13900139098', password: 'SafeBank!123', paymentPassword: '888888', holderName: '新客测试', idNumber: '310101199001011234', smsCode: newSms.demoCode, faceTicket: face.ticket, pledge: ACCOUNT_OPENING_PLEDGE })
const fresh = await api.getMembership()
assert.equal(fresh.tier, 'standard')
assert.equal(fresh.tierLabel, '普通会员')
assert.equal(fresh.aum, 0)
assert.equal(fresh.nextTier, 'gold')
assert.equal(fresh.nextThreshold, 10_000_000)
assert.equal(fresh.entitlements.freeTransferFee, false)
assert.equal(fresh.entitlements.vipChannel, false)
assert.equal(fresh.entitlements.dedicatedManager, false)
assert.equal(fresh.entitlements.wealthPriority, false)
assert.equal(fresh.lounge.perYear, 0)
assert.equal(fresh.lounge.remaining, 0)
assert.deepEqual(fresh.benefits, ['基础银行服务'])
assert.equal((await api.profile()).memberTier, 'standard')
const freshAccount = (await api.listAccounts())[0]
const visa = CARD_PRODUCTS.find((p) => p.network === 'visa')
const freshFee = cardFeeQuote(loadDb(), visa)
assert.equal(freshFee.waived, 0)
assert.equal(freshFee.payable, visa.issuingFee + visa.deliveryFee)
await api.deposit(freshAccount.id, 200_000, 'manual')
const freshQuote = await api.quoteExchange({ fromAccountId: freshAccount.id, toCurrency: 'USD', amount: 10_000 })
assert.equal(freshQuote.fx.spread, FX_SPREAD)
// 普通客户转人工 → normal 优先级（VIP 标识只给金卡+）
const standardTicket = await api.requestHumanSupport({ requestId: 'req-std-0001', reason: '普通客户转人工' })
assert.equal(standardTicket.priority, 'normal')
console.log('PASS 新客户 standard：无减免、标准点差、零贵宾厅额度，memberTier 同步')

/* ── 8. 转账费减免：金卡+ 为 0 且 feeWaived；standard 仍收费 ─── */
function overseas(amount, fromAccountId) {
  return {
    fromAccountId, channel: 'bank', scope: 'overseas', amount,
    payeeName: '境外收款人', payeeAccountNo: '123456789012',
    payeeBankCode: '004', payeeBankRegion: 'HK', payeeCurrency: 'CNY', memo: '会员转账费',
  }
}
const standardAccount = (await api.listAccounts())[0]
const standardQuote = await api.quoteTransfer(overseas(100_000, standardAccount.id))
assert.equal(standardQuote.fee, 5_000, 'standard 境外转账按最低 ¥50 收费')
assert.equal(standardQuote.feeWaived, undefined)
// quote → submit 同口径：standard 实付本金 + 手续费
const standardBefore = standardAccount.balance
await api.submitTransfer({ ...overseas(100_000, standardAccount.id), paymentPassword: '888888' })
assert.equal(loadDb().accounts[0].balance, standardBefore - 100_000 - 5_000)
console.log('PASS standard 境外转账收费 ¥50，quote 与 submit 同口径')

// 切回演示档案（林小满，白金）
const backSms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', backSms.demoCode)
assert.equal((await api.profile()).memberTier, 'platinum')
// 切回演示档案（白金）：境外转账费全免
const demoAccount = loadDb().accounts[0]
const demoQuote = await api.quoteTransfer(overseas(100_000, demoAccount.id))
assert.equal(demoQuote.fee, 0)
assert.equal(demoQuote.feeWaived, true)
const demoBefore = demoAccount.balance
await api.submitTransfer({
  ...overseas(100_000, demoAccount.id),
  confirmedQuote: { version: 1, fromCurrency: 'CNY', fee: demoQuote.fee, fx: null, submitBefore: Date.now() + 30_000 },
  paymentPassword: '888888',
})
assert.equal(loadDb().accounts[0].balance, demoBefore - 100_000, '白金免手续费，只扣本金')
// 直接调用共享规则也一致
assert.equal(transferFee(loadDb(), { amount: 100_000, scope: 'overseas' }), 0)
assert.equal(transferFee(loadDb(), { amount: 100_000, scope: 'domestic' }), 0)
console.log('PASS 白金境外转账 fee=0 且 feeWaived=true；submit 确认报价一致，只扣本金')

/* ── 9. 旧权益仍生效：制卡费减免、换汇点差折扣 ────────────────── */
const platinumCardFee = cardFeeQuote(loadDb(), visa)
assert.equal(platinumCardFee.listFee, visa.issuingFee + visa.deliveryFee)
assert.equal(platinumCardFee.payable, visa.deliveryFee, '白金制卡费全免，寄送费另计')
assert.equal(platinumCardFee.waived, visa.issuingFee)
const demoFx = await api.quoteExchange({ fromAccountId: loadDb().accounts[0].id, toCurrency: 'USD', amount: 10_000 })
assert.equal(demoFx.fx.spread, FX_SPREAD * 0.8)
console.log('PASS 旧权益并存：白金制卡费全免、换汇点差 8 折')

/* ── 10. 贵宾厅核销与额度耗尽 409 ─────────────────────────────── */
const afterOne = await api.redeemLoungePass()
assert.equal(afterOne.lounge.used, 1)
assert.equal(afterOne.lounge.remaining, 1)
assert(afterOne.records.some((r) => r.label.includes('机场/高铁贵宾厅')))
const afterTwo = await api.redeemLoungePass()
assert.equal(afterTwo.lounge.remaining, 0)
await assert.rejects(api.redeemLoungePass(), (e) => e.status === 409 && e.code === 'LOUNGE_QUOTA_EXHAUSTED')
assert.equal((await api.getMembership()).lounge.used, 2)
// 年度清零：跨年后额度恢复
const yearDb = profile({ membership: { ...freshMembership(), tier: 'platinum' } })
yearDb.membership.benefitUsage = { year: 2000, cardFeeWaiversUsed: 1, loungePassesUsed: 2 }
assert.equal(redeemLoungePass(yearDb, Date.UTC(2026, 0, 5)), true)
assert.equal(yearDb.membership.benefitUsage.loungePassesUsed, 1)
assert.equal(yearDb.membership.benefitUsage.cardFeeWaiversUsed, 0)
console.log('PASS 贵宾厅核销计数、额度耗尽 409 LOUNGE_QUOTA_EXHAUSTED、跨年清零')

/* ── 11. VIP 工单优先 ─────────────────────────────────────────── */
const vipTicket = await api.requestHumanSupport({ requestId: 'req-vip-0001', reason: '白金客户转人工' })
assert.equal(vipTicket.priority, 'vip')
assert.equal(entitlements('standard').vipChannel, false)
assert.equal(entitlements('gold').vipChannel, true)
console.log('PASS 金卡+ 工单 priority=vip，普通客户 normal')

/* ── 12. 理财优先购窗口 ───────────────────────────────────────── */
const open = new Date(Date.now() + 5 * 86_400_000).toISOString()
const closed = new Date(Date.now() - 86_400_000).toISOString()
const hot = { priorityOpenAt: open, priorityTier: 'platinum' }
assert(wealthPriorityGate(hot, 'standard', Date.now()))
assert(wealthPriorityGate(hot, 'gold', Date.now()))
assert.equal(wealthPriorityGate(hot, 'platinum', Date.now()), null)
assert.equal(wealthPriorityGate(hot, 'diamond', Date.now()), null)
assert.equal(wealthPriorityGate({ priorityOpenAt: closed, priorityTier: 'diamond' }, 'standard', Date.now()), null)
assert.equal(wealthPriorityGate({}, 'standard', Date.now()), null)
const products = await api.listWealthProducts()
assert(products.some((p) => p.priorityTier === 'platinum' && p.priorityOpenAt > new Date().toISOString()))
assert(products.some((p) => p.priorityTier === 'diamond' && p.priorityOpenAt > new Date().toISOString()))
console.log('PASS 理财优先购：窗口内仅白金+（或钻石）可申购，窗口结束全员开放，目录带未来窗口')

/* ── 13. 日终快照存当日 AUM（不是仅储蓄） ────────────────────── */
const snapDb = profile({
  accounts: [{ balance: 1_000_000 }],
  holdings: [{ marketValue: 2_000_000 }],
  cashManagement: { balance: 500_000 },
})
recordAssetSnapshot(snapDb, CNY, Date.now())
assert.equal(snapDb.assetSnapshots.length, 1)
assert.equal(snapDb.assetSnapshots[0].assets, 3_500_000)
console.log('PASS 日终快照写入当日 AUM（储蓄 + 理财 + 现金管理）')

/* ── 14. 旧档案迁移：删订阅残留、silver → standard、幂等 ──────── */
const legacyDb = profile({
  membership: {
    current: { planId: 'gold', planName: '招财金卡会员', status: 'active' },
    plans: [{ id: 'gold', name: '招财金卡会员', price: 1900 }],
    records: [],
    tier: 'silver',
    legacy: { current: null, plans: [] },
  },
})
normalizeMembership(legacyDb)
assert.equal(legacyDb.membership.tier, 'standard')
assert.equal(legacyDb.membership.belowPeriods, 0)
assert.equal(legacyDb.membership.benefitUsage.loungePassesUsed, 0)
assert(!('legacy' in legacyDb.membership))
assert(!('current' in legacyDb.membership))
assert(!('plans' in legacyDb.membership))
assert.equal(legacyDb.user.memberTier, 'standard')
const once = structuredClone(legacyDb.membership)
normalizeMembership(legacyDb)
assert.deepEqual(legacyDb.membership, once)
console.log('PASS 旧订阅档案迁移：订阅字段与 legacy 删除、silver 归并 standard、幂等')

/* ── 15. 概览字段完整性 ──────────────────────────────────────── */
const overview = membershipOverview(loadDb(), FX_MID_RATES)
for (const key of ['tier', 'tierLabel', 'aum', 'nextTier', 'nextThreshold', 'benefits', 'entitlements', 'since', 'evaluation', 'downgradeWarning', 'lounge', 'records']) {
  assert(key in overview, `MembershipOverview 缺字段 ${key}`)
}
assert.equal(overview.downgradeWarning, null)
assert.equal(TIER_INDEX(overview.tier), 2)
console.log('PASS 会员概览字段与文档 §7.2 一致')

console.log('\ncheck-membership: 全部通过 ✅')
