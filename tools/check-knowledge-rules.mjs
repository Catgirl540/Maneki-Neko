/** 隔离内存数据直接运行服务器复用的银行规则，不连接生产、不写客户数据库。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { summarizeRiskAssessment } from '../framework/bridge/wealth-risk.mjs'
class Storage {
  data = new Map()
  getItem(k) { return this.data.get(k) ?? null }
  setItem(k, v) { this.data.set(k, String(v)) }
  removeItem(k) { this.data.delete(k) }
  clear() { this.data.clear() }
}
globalThis.window = { localStorage: new Storage(), sessionStorage: new Storage() }
const { createMockApi } = await import('../app/src/api/mock/index.ts')
const { resetDb, loadDb, persist } = await import('../app/src/api/mock/db.ts')
const { WEALTH_INVESTMENT_AGREEMENT, RISK_ACKNOWLEDGEMENT } = await import('../app/src/lib/wealth.ts')
const corpus = JSON.parse(readFileSync(new URL('../framework/.generated/knowledge/corpus.json', import.meta.url)))
const text = id => corpus.documents.flatMap(d => d.sections.map(s => ({ key: `${d.id}#${s.id}`, text: s.text }))).find(s => s.key === id).text
const api = createMockApi()
resetDb()
const account = (await api.listAccounts())[0]
assert.equal((await api.listAccounts()).length, 1)
assert.match(text('kb-accounts#relations'), /只有一个储蓄资金账户/)
assert((await api.listCards()).every(card => card.accountId === account.id))
const quote = patch => api.quoteTransfer({ fromAccountId: account.id, amount: 100000, scope: 'domestic', channel: 'bank', bankCode: 'LCB', bankRegion: 'CN', ...patch })
const domestic = await quote({})
assert.match(text('kb-accounts#deposit'), /暂不展示或分享 FPS 手机号、ID/)
assert.equal(domestic.fee, 0); assert.equal(domestic.singleLimit, 100000000); assert.equal(domestic.etaText, '实时到账')
assert.equal((await quote({ bankCode: '102' })).etaText, '预计 2 小时内到账')
const fps = await quote({ channel: 'fps' })
assert.equal(fps.fee, 0); assert.equal(fps.singleLimit, 60000000); assert.equal(fps.etaText, '预计 5 秒内到账')
const overseas = await quote({ scope: 'overseas' })
assert.equal(overseas.fee, 5000); assert.equal(overseas.etaText, '预计 1 个工作日到账')
// 报价函数单独核对数学规则；报价不代表提交或到账成功。
assert.equal((await quote({ scope: 'overseas', amount: 10000000 })).fee, 10000)
assert.match(text('kb-transfers#fees'), /最低费用为付款币种的 50 单位/)
assert.match(text('kb-transfers#fees'), /不是费用上限/)
assert.match(text('kb-transfers#limits'), /一百万单位/)
assert.match(text('kb-transfers#limits'), /六十万单位/)
loadDb().accounts[0].balance = 1200; loadDb().accounts[0].available = 1200; persist()
assert.equal((await quote({})).maxAmount, 1200)
console.log('PASS 境内/FPS 免费、跨境千分之一且最低50、通道限额/余额约束、四类预计到账')
resetDb()
const db = loadDb(), card = (await api.listCards())[0]
const before = (await api.listAccounts())[0].available
await api.setCardLock(card.id, true)
assert.equal(card.status, 'locked'); assert.equal(card.onlinePayment, false); assert.equal(card.overseasPayment, false)
assert.equal((await api.listAccounts())[0].available, before)
await assert.rejects(api.updateCardSettings(card.id, { onlinePayment: true }), e => e.code === 'CARD_LOCKED')
await api.setCardLock(card.id, false)
assert.equal(card.status, 'active'); assert.equal(card.onlinePayment, false)
const address = { recipient: '测试用户', phone: '13900139000', region: '上海市', city: '上海市', detail: '测试路一号101室', postalCode: '200000' }
const product = (await api.listCardProducts())[0]
const newCard = await api.openCard({ productCode: product.code, address, paymentPassword: '888888' })
assert.equal(newCard.status, 'pending'); assert.equal(newCard.dailyLimit, 200000)
assert.equal(newCard.issuingFee, product.issuingFee + product.deliveryFee)
await assert.rejects(api.revealCardSecrets(newCard.id, '888888'), e => e.code === 'CARD_NOT_DELIVERED')
const replacement = await api.replaceCard(card.id, { address, paymentPassword: '888888' })
assert.equal(card.status, 'replaced'); assert.equal(replacement.status, 'pending')
assert.notEqual(db.cardSecrets[replacement.id].pan, db.cardSecrets[card.id].pan)
await assert.rejects(api.revealCardSecrets(card.id, '888888'), e => e.code === 'CARD_REPLACED')
assert.match(text('kb-cards#lost'), /不等于冻结整个资金账户/)
console.log('PASS 锁卡不冻结资金账户、开关与换卡状态、新卡日限额、寄送中/旧卡敏感信息限制')
resetDb()
loadDb().wealthAccount.opened = false; loadDb().riskAssessment.done = false; persist()
const unassessed = (await api.getWealthOverview()).risk
assert.equal(unassessed.done, false)
assert.equal(unassessed.expired, false)
assert.equal(unassessed.level, null)
assert.equal(unassessed.score, null)
assert.equal(summarizeRiskAssessment(unassessed).status, 'unassessed')
assert.equal(summarizeRiskAssessment(unassessed).level, null)
const wp = (await api.listWealthProducts())[0]
await assert.rejects(api.subscribeWealth({ productCode: wp.code, amount: wp.minAmount, paymentPassword: '888888', riskAcknowledgement: RISK_ACKNOWLEDGEMENT }), e => e.code === 'WEALTH_ACCOUNT_REQUIRED')
const phone = (await api.profile()).phone
const sms = await api.sendSmsCode(phone), face = await api.verifyIdentity('face')
const opening = { smsCode: sms.demoCode, faceTicket: face.ticket, agreement: WEALTH_INVESTMENT_AGREEMENT, settlementAccountId: (await api.listAccounts())[0].id }
await assert.rejects(api.openWealthAccount(opening), e => e.code === 'RISK_ASSESSMENT_REQUIRED')
const questions = await api.listRiskQuestions()
const risk = await api.submitRiskAssessment(questions.map(q => q.options.reduce((best, o, i, all) => o.score > all[best].score ? i : best, 0)))
assert.equal(summarizeRiskAssessment(risk).status, 'valid')
assert.equal(new Date(risk.expiresAt).getFullYear() - new Date(risk.assessedAt).getFullYear(), 1)
const opened = await api.openWealthAccount(opening)
assert(opened.opened, '不提交重复姓名/身份证即可开理财账户')
loadDb().riskAssessment.expiresAt = '2000-01-01T00:00:00Z'; persist()
assert.equal(summarizeRiskAssessment((await api.getWealthOverview()).risk).status, 'expired')
await assert.rejects(api.subscribeWealth({ productCode: wp.code, amount: wp.minAmount, paymentPassword: '888888', riskAcknowledgement: RISK_ACKNOWLEDGEMENT }), e => e.code === 'RISK_ASSESSMENT_REQUIRED')
assert.match(text('kb-wealth#opening'), /不用重新填写/)
assert.match(text('kb-wealth#subscribe'), /完整抄录/)
assert.match(text('kb-wealth#risk'), /未完成测评不等于测评过期/)
assert.match(text('kb-wealth#risk'), /个人状态必须以工具查询为准/)
console.log('PASS 理财开户复用实名、测评前置/一年有效、过期禁止申购、风险确认抄录说明')
