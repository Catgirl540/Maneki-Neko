/** 内存银行规则验证：提交校验及已受理指令的价格条件，不触碰 SQLite/生产。 */
import assert from 'node:assert/strict'
class Storage { data=new Map();getItem(k){return this.data.get(k)??null}setItem(k,v){this.data.set(k,String(v))}removeItem(k){this.data.delete(k)}clear(){this.data.clear()} }
globalThis.window={localStorage:new Storage(),sessionStorage:new Storage()}
const {createMockApi,settleHeldTransfer}=await import('../app/src/api/mock/index.ts')
const {resetDb,loadDb,FX_MID_RATES,persist}=await import('../app/src/api/mock/db.ts')
const api=createMockApi({reviewThreshold:500000,holdWindowMs:300000})
async function request(amount=500000) {
 const account=(await api.listAccounts())[0]
 const body={fromAccountId:account.id,channel:'bank',scope:'overseas',payeeName:'报价测试',payeeAccountNo:'123456789012',payeeBankCode:'004',payeeBankRegion:'HK',payeeCurrency:'HKD',amount,memo:'测试',paymentPassword:'888888'}
 const q=await api.quoteTransfer({...body,bankCode:body.payeeBankCode,bankRegion:body.payeeBankRegion})
 body.confirmedQuote={version:1,fromCurrency:account.currency,fee:q.fee,fx:Object.fromEntries(['fromCurrency','toCurrency','rate','fromAmount','toAmount','spread'].map(k=>[k,q.fx[k]])),submitBefore:Date.now()+30000}
 return {body,account:{...account}}
}
resetDb()
let {body,account}=await request()
const pending=await api.submitTransfer(body)
assert.equal(pending.pendingReason,'inflight')
assert.equal(pending.fx.rate,body.confirmedQuote.fx.rate)
const held=loadDb().transactions.find(t=>t.id===pending.transactionId)
held.heldRequest.confirmedQuote.submitBefore=Date.now()-1;persist()
const paid=await settleHeldTransfer(pending.transactionId,'settled')
assert.equal(paid.fx.rate,body.confirmedQuote.fx.rate)
assert.equal((await api.listAccounts())[0].balance,account.balance-body.amount-body.confirmedQuote.fee)
console.log('PASS 已受理在途指令在报价截止后仍按已确认价格条件结算')
resetDb();({body,account}=await request())
const stale=await api.submitTransfer(body), original=FX_MID_RATES.HKD
try {
 FX_MID_RATES.HKD=original*1.01
 await assert.rejects(settleHeldTransfer(stale.transactionId,'settled'),e=>e.code==='QUOTE_CHANGED')
 assert.equal((await api.listAccounts())[0].balance,account.balance)
 assert.equal((await api.listAccounts())[0].available,account.available)
 assert.equal(loadDb().transactions.find(t=>t.id===stale.transactionId).status,'failed')
} finally {FX_MID_RATES.HKD=original}
console.log('PASS 在途结算价格变化不扣款，标记失败并解冻')
resetDb();({body,account}=await request())
const tooLate=await api.submitTransfer(body)
loadDb().transactions.find(t=>t.id===tooLate.transactionId).holdUntil=new Date(Date.now()-1).toISOString();persist()
await assert.rejects(api.recallTransfer(tooLate.transactionId),e=>e.code==='NOT_RECALLABLE')
console.log('PASS 撤回截止在银行入口校验，不能利用自动结算轮询间隔越过窗口')
