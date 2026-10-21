/** 由隔离 SQLite 集成测试调用；不连接生产客户。 */
import assert from 'node:assert/strict'
import { prepareTransfer, refreshTransfer, fpsIdentifier } from '../framework/bridge/transfer-agent.mjs'
export async function checkTransfers({ call, prepare, run, agent, accounts, a, b, other }) {
  const payer = accounts[0]
  const get = p => call(p, a.token), post = (p, body) => call(p, a.token, body)
  for (const [method, value] of [['mobile','91234567'], ['email','ken.ho@example.com'], ['fpsid','8820314'], ['account','004123456789']]) assert.equal(fpsIdentifier(method, value), value)
  for (const [method,value] of [['mobile','1234'],['mobile','12345678'],['email','bad@'],['fpsid','123'],['account','123']]) assert.throws(() => fpsIdentifier(method,value), /格式/)
  const banks = (await run('bank_list_banks', { keyword: '307' })).result.items
  assert(banks.some(x => x.region === 'CN' && x.code === '307'))
  assert((await run('bank_list_banks', {region:'HK',keyword:'004'})).result.items.every(x => x.region === 'HK' && x.code === '004'))
  assert((await run('bank_list_banks', {})).result.truncated)
  const resolved = (await run('bank_resolve_fps', { fpsMethod: 'mobile', fpsIdentifier: '91234567' })).result
  assert(resolved.registered && resolved.bankRegion === 'HK' && resolved.name.includes('*'))
  assert.equal((await run('bank_resolve_fps', { fpsMethod: 'mobile', fpsIdentifier: '90000000' })).result.registered, false)
  assert.equal((await run('bank_verify_recipient', { bankCode:'LCB', bankRegion:'CN',accountNo:other[0].accountNo,payeeName:b.user.name })).result.kind, 'internal')
  await assert.rejects(run('bank_verify_recipient', { bankCode:'LCB',bankRegion:'CN',accountNo:other[0].accountNo,payeeName:'错误户名' }), /姓名|户名/)
  const fps = { fromAccountId:payer.id,amountCents:10000,fpsMethod:'mobile',fpsIdentifier:'91234567',payeeCurrency:'HKD' }
  await assert.rejects(prepare('bank_fps_transfer',{...fps, payeeCurrency:'USD'}), /仅支持/)
  await assert.rejects(prepare('bank_fps_transfer',{...fps, fpsIdentifier:'90000000'}), /登记/)
  await assert.rejects(prepare('bank_fps_transfer',{...fps, payeeBankCode:'012'}), /登记解析/)
  const draft = await prepareTransfer(fps,true,get,post)
  assert.equal(draft.body.confirmedQuote.fee,0); assert(draft.body.confirmedQuote.fx)
  assert.equal(draft.body.payeeName,resolved.name)
  const challenge = await prepare('bank_fps_transfer',fps)
  assert.equal(challenge.challenge.verification,'payment-password')
  assert(challenge.challenge.expiresAt <= Date.now()+30000)
  assert(challenge.challenge.fields.some(f=>f.label==='换汇后收款金额' && f.value.startsWith('HKD ')))
  const before=(await get(`/api/accounts/${payer.id}`)).balance
  await assert.rejects(agent.execute(challenge.input), e=>e.code==='CONSENT_REQUIRED')
  await agent.approve(challenge.challenge,'888888')
  const result=(await agent.execute(challenge.input)).result
  assert.equal(result.settlementStatus,'success');assert.equal(result.fx.toAmount,draft.body.confirmedQuote.fx.toAmount)
  assert.equal((await get(`/api/accounts/${payer.id}`)).balance,before-10000)
  await assert.rejects(agent.execute(challenge.input),e=>e.code==='CONSENT_REQUIRED')
  assert((await run('bank_list_payees',{keyword:'91234567'})).result.items.some(x=>x.fpsId==='91234567'))
  for (const patch of [{fpsMethod:'email',fpsIdentifier:'ken.ho@example.com'},{fpsMethod:'fpsid',fpsIdentifier:'8820314'},{fpsMethod:'account',fpsIdentifier:'004123456789',payeeName:'测试收款人',payeeBankCode:'004'}]) {
    assert.equal((await run('bank_fps_transfer',{...fps,amountCents:100,...patch},'888888')).result.settlementStatus,'success')
  }
  const cross={fromAccountId:payer.id,amountCents:10000,payeeName:'测试收款人',payeeAccountNo:'123456789012',payeeBankCode:'004',payeeBankRegion:'HK',payeeCurrency:'USD'}
  const crossDraft=await prepareTransfer(cross,false,get,post)
  // 演示客户是白金会员：境外转账手续费减免，报价与成交均为 0
  assert.equal(crossDraft.body.confirmedQuote.fee,0)
  const crossBefore=(await get(`/api/accounts/${payer.id}`)).balance
  const crossResult=(await run('bank_transfer',cross,'888888')).result
  assert.equal(crossResult.fee,0);assert.equal(crossResult.fx.toCurrency,'USD')
  assert.equal((await get(`/api/accounts/${payer.id}`)).balance,crossBefore-10000)
  await assert.rejects(prepare('bank_recall_transfer',{transactionId:crossResult.transactionId}),/不能撤回/)
  // 直接请求银行绕过桥接，证明原子条件校验在实际冻结/扣款入口生效。
  const protectedBefore=await get(`/api/accounts/${payer.id}`)
  for (const [patch,code] of [[{fee:1},'QUOTE_CHANGED'],[{fx:{...draft.body.confirmedQuote.fx,rate:99}},'QUOTE_CHANGED'],[{submitBefore:Date.now()-1},'QUOTE_EXPIRED']]) {
    await assert.rejects(post('/api/transfers',{...draft.body,confirmedQuote:{...draft.body.confirmedQuote,...patch}}),e=>e.code===code)
  }
  await assert.rejects(post('/api/transfers',{...draft.body,confirmedRecipient:{...draft.body.confirmedRecipient,name:'错误登记'}}),e=>e.code==='RECIPIENT_CHANGED')
  assert.deepEqual(await get(`/api/accounts/${payer.id}`),protectedBefore)
  // 在桥接重报价后到银行提交之间的竞态由上面的银行原子校验覆盖。
  await assert.rejects(refreshTransfer(draft.body,draft.preview,get,async(p,body)=>{const q=await post(p,body);return p.endsWith('/quote')?{...q,fee:q.fee+1}:q}),e=>e.code==='QUOTE_CHANGED')
  await assert.rejects(refreshTransfer(draft.body,draft.preview,get,async(p,body)=>{const q=await post(p,body);return p.endsWith('/resolve')?{...q,bankCode:'012'}:q}),e=>e.code==='RECIPIENT_CHANGED')
  await assert.rejects(prepareTransfer(fps,true,async p=>p.endsWith('/requirements')?{}:get(p),post),/不支持报价/)
  const heldBefore=await get(`/api/accounts/${payer.id}`)
  const held=(await run('bank_fps_transfer',{...fps,amountCents:500000},'888888')).result
  assert.equal(held.pendingReason,'inflight')
  const frozen=await get(`/api/accounts/${payer.id}`)
  assert.equal(frozen.balance,heldBefore.balance);assert.equal(frozen.available,heldBefore.available-500000)
  await assert.rejects(prepare('bank_recall_transfer',{transactionId:held.transactionId},'b'),e=>e.status===404)
  const recall=await prepare('bank_recall_transfer',{transactionId:held.transactionId})
  assert.equal(recall.challenge.verification,undefined)
  await assert.rejects(agent.execute(recall.input),e=>e.code==='CONSENT_REQUIRED')
  await agent.approve(recall.challenge)
  const recalled=(await agent.execute(recall.input)).result
  assert.equal(recalled.status,'failed');assert.match(recalled.memo,/已撤销/)
  assert.equal((await get(`/api/accounts/${payer.id}`)).available,heldBefore.available)
  assert.equal((await get(`/api/accounts/${payer.id}`)).balance,heldBefore.balance)
  await assert.rejects(agent.execute(recall.input),e=>e.code==='CONSENT_REQUIRED')
  await assert.rejects(prepare('bank_recall_transfer',{transactionId:held.transactionId}),/不能撤回/)
  console.log('PASS 银行/收款人查询、四种 FPS、跨币种实扣、报价与登记原子校验、过期及旧银行拒绝、在途冻结撤回与客户隔离')
}
