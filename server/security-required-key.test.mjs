import test from 'node:test'
import assert from 'node:assert/strict'
import {createSecurityGateway} from './security-gateway.mjs'
test('financial writes without an idempotency key fail before DB or business access',async()=>{
  const db={exec:async()=>{},prepare:()=>{throw Error('must not access DB')}},auth={identity:async()=>{throw Error('must not authenticate here')}}
  const security=await createSecurityGateway(db,auth)
  await assert.rejects(security.idempotent({headers:{},url:'/api/transfers'},'submitTransfer',{}),{code:'IDEMPOTENCY_KEY_REQUIRED'})
})
