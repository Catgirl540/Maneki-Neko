import test from 'node:test'
import assert from 'node:assert/strict'
import { toCsv } from './csv.mjs'
import { createClientOperations } from './client-idempotency.mjs'
import { hasExplicitCredential } from './credential-guard.mjs'

test('CSV neutralizes formula prefixes, including leading whitespace, while preserving numeric values', () => {
  for (const value of ['=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(A1)', '\t=1', ' \r=1']) {
    const csv = toCsv([{key:'x',label:'x'}],[{x:value}]); assert(csv.includes("'"+value) || csv.includes("'"+value.replace(/"/g,'""')))
  }
  assert(toCsv([{key:'x',label:'x'}],[{x:-120}]).includes('\r\n-120\r\n'))
  assert(toCsv([{key:'x',label:'=title'}],[{x:'normal'}]).includes("'=title"))
})
test('unknown requests retain operation IDs across reload and do not persist credentials', async () => {
  const entries=new Map(), storage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)}
  const client=createClientOperations(storage)
  const first=await client.begin('customer','POST','/api/transfers',{amount:123,paymentPassword:'synthetic-pin'})
  assert(!JSON.stringify([...entries.values()]).includes('synthetic-pin'))
  const reopened=createClientOperations(storage)
  assert.deepEqual(await reopened.begin('customer','POST','/api/transfers',{amount:123,paymentPassword:'different-pin'}),first)
  await assert.rejects(reopened.begin('customer','POST','/api/transfers',{amount:456}),{code:'OPERATION_UNRESOLVED'})
  reopened.finish(first)
  assert.notEqual((await reopened.begin('customer','POST','/api/transfers',{amount:123})).key,first.key)
  assert.notEqual((await reopened.begin('different-customer','POST','/api/transfers',{amount:123})).key,first.key)
})
test('local credential rules catch generic labels and spaced secrets without blocking password questions', () => {
  for(const text of ['密码是abc123!','支付密码 123456','password abc123!'])assert(hasExplicitCredential(text))
  for(const text of ['忘记密码怎么办','订单号 123456','支付密码要几位'])assert(!hasExplicitCredential(text))
})
