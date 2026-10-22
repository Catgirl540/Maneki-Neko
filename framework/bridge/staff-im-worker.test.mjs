import test from 'node:test'
import assert from 'node:assert/strict'
import { createStaffImWorker } from './staff-im-worker.mjs'
import { staffImHeaders,staffImVerifier } from '../../shared/staff-im-service.mjs'
const packet={id:'n1',staffId:'s1',bindingId:'im-1',bindingRevision:'r1',lease:'l1',text:'任务提醒'}
const route={id:'im-1',ownerId:'s1',bindingRevision:'r1',audience:'staff',channel:'weixin',key:'p2p:s1'}
function fixture(options={}){
  const calls=[],deliveries=[],routes={'im-1':structuredClone(route)}
  let queued=true,failComplete=options.failComplete??false
  const service=async(action,value)=>{
    calls.push({action,value})
    if(action==='claim'){if(!queued)return null;queued=false;return packet}
    if(action==='begin-send'){if(options.beforeBegin)await options.beforeBegin(routes);return {...packet,attemptId:'a1'}}
    if(action==='complete'&&failComplete){failComplete=false;throw Error('database unavailable')}
    return {ok:true}
  }
  const worker=createStaffImWorker({service,routes:()=>routes,ready:()=>options.ready!==false,deliver:async(...args)=>{deliveries.push(args);if(options.uncertain)throw Error('timeout after platform acceptance');return {messageId:'receipt-1'}}})
  return{worker,calls,deliveries,routes}
}
test('staff notification signature binds path/body/time and rejects replay',()=>{
  const secret='test-only-'.repeat(5),path='/internal/staff-im-notifications/claim',raw='{}',clock=()=>1792550000000
  const headers=staffImHeaders(secret,path,raw,{now:clock()}),verify=staffImVerifier(secret,clock)
  assert.equal(verify(headers,path,'{"staffId":"other"}'),false)
  assert.equal(verify(headers,path,raw),true);assert.equal(verify(headers,path,raw),false)
  assert.equal(staffImVerifier(secret,()=>clock()+31000)(headers,path,raw),false)
  assert.equal(staffImVerifier(undefined)(headers,path,raw),false)
})
test('worker delivers once without a model or employee token; concurrent ticks share work',async()=>{
  const f=fixture();await Promise.all([f.worker.tick(),f.worker.tick()]);await f.worker.tick();await f.worker.close()
  assert.equal(f.deliveries.length,1);assert.equal(f.calls.filter(v=>v.action==='begin-send').length,1)
  assert.equal(f.calls.find(v=>v.action==='complete').value.outcome,'sent')
  assert(!JSON.stringify(f.calls).includes('Bearer'))
})
test('worker only retries acknowledgements after a completed delivery',async()=>{
  const f=fixture({failComplete:true});await f.worker.tick();await f.worker.tick();await f.worker.close()
  assert.equal(f.deliveries.length,1);assert.equal(f.calls.filter(v=>v.action==='complete').length,2)
  assert(f.calls.filter(v=>v.action==='complete').every(v=>v.value.attemptId==='a1'))
})
test('uncertain channel invocation is recorded unknown and never retried',async()=>{
  const f=fixture({uncertain:true});await f.worker.tick();await f.worker.tick();await f.worker.close()
  assert.equal(f.deliveries.length,1);assert.equal(f.calls.find(v=>v.action==='complete').value.outcome,'unknown')
})
test('offline channels and stale audience cannot invoke a transport',async()=>{
  for(const options of [{ready:false},{}]){
    const f=fixture(options);if(options.ready!==false)f.routes['im-1'].audience='customer'
    await f.worker.tick();await f.worker.close();assert.equal(f.deliveries.length,0)
    assert(f.calls.some(v=>v.action==='not-ready'));assert(!f.calls.some(v=>v.action==='begin-send'))
  }
})
test('revocation between authorization and transport is a strict not-attempted result',async()=>{
  const f=fixture({beforeBegin:routes=>{routes['im-1'].bindingRevision='new'}})
  await f.worker.tick();await f.worker.close();assert.equal(f.deliveries.length,0)
  assert.equal(f.calls.find(v=>v.action==='complete').value.outcome,'not_attempted')
})
