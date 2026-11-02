import test from 'node:test'
import assert from 'node:assert/strict'
import { publicError } from './public-error.mjs'
import { bankError } from './bank-error.mjs'
import { applyHttpSecurity } from './http-security.mjs'

test('internal exceptions and upstream details are not returned to clients', () => {
  const internal=Object.assign(Error('/private/service key=synthetic'),{status:502})
  assert(!JSON.stringify(publicError(internal)).includes('/private'))
  assert(!JSON.stringify(publicError(Object.assign(Error('synthetic-secret'),{status:400}))).includes('synthetic-secret'))
  assert.equal(publicError(bankError('余额不足',400,'BALANCE_LOW')).error,'余额不足')
})
test('CORS permits exact origin only and does not return a wildcard', () => {
  const headers={},res={setHeader:(k,v)=>headers[k]=v},req={headers:{host:'bank.example',origin:'https://bank.example','x-forwarded-proto':'https'},socket:{remoteAddress:'127.0.0.1'}}
  assert(applyHttpSecurity(req,res,''));assert.equal(headers['Access-Control-Allow-Origin'],'https://bank.example')
  assert.equal(applyHttpSecurity({...req,headers:{...req.headers,origin:'https://evil.example'}},res,''),false)
  assert.equal(applyHttpSecurity({...req,headers:{...req.headers,origin:'https://evil.example'}},res,'https://evil.example'),true)
})

test('ops shell and file writes cannot be auto-approved by a permissive model', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path')
  const { createOpsGate } = await import('./ops-gate.mjs')
  const dir = await mkdtemp(join(tmpdir(),'ops-hardening-'))
  const entry={ownerId:'ops-fixture',staff:{name:'fixture',role:'ops'},busy:true,activity:{}}
  const gate=createOpsGate({bankAgent:{current:async()=>entry},workspaceRoot:dir,auditPath:join(dir,'audit.jsonl'),review:async()=>({action:'allow',category:'read_only'})})
  t.after(async()=>{gate.close();await rm(dir,{recursive:true,force:true})})
  assert.equal((await gate.prepare({sessionId:'s',callId:'shell',toolName:'bash',arguments:{command:'date'}})).risk.action,'review')
  assert.equal((await gate.prepare({sessionId:'s',callId:'write',toolName:'write',arguments:{path:'note.txt',content:'fixture'}})).risk.action,'review')
  assert.equal((await gate.prepare({sessionId:'s',callId:'secret',toolName:'read',arguments:{path:'credentials.json'}})).risk.action,'deny')
})
