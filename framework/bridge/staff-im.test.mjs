import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp,rm,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve,dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { openImStore } from './im-store.mjs'
import { createImBank } from './im-bank.mjs'
import { createImHttp } from './im-http.mjs'
test('staff IM isolates credentials, rejects ops, uses staff confirmations and preserves notification binding on login refresh',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'staff-im-isolation-')),key=randomBytes(32).toString('base64'),path=join(directory,'staff.enc.json')
  t.after(async()=>{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));await rm(directory,{recursive:true,force:true})})
  const store=await openImStore(path,key,{audience:'staff'}),sessions=new Map(),claims=[],revocations=[]
  let bank,loggedIn=true,turn=0
  bank=createImBank({store,audience:'staff',portalPath:'/staff-agent-api/im',publicUrl:'https://bank.test',
    createSession:async identity=>{const id=`staff-session-${++turn}`;sessions.set(id,{ownerId:identity.user.id});return id},
    current:async id=>{if(!loggedIn)throw Object.assign(Error('login expired'),{status:401});return sessions.get(id)},cancel:async()=>{},deliver:async()=>{},
    run:async id=>{bank.observe(id,{type:'consent',challenge:{challengeId:'staff-consent'}});bank.observe(id,{type:'assistant',text:'等待员工确认'})},
    onClaim:async(route,identity)=>claims.push({route,staffId:identity.user.id}),onRevoke:async route=>revocations.push(route.id)})
  t.after(()=>bank.close())
  const h=bank.harness('weixin','staff-bot'),id=await h.createSession({conversationKey:'p2p:staff-person'}),chat=h.workspaceSession(id,'p2p:staff-person')
  async function bindingCode(){const reply=await chat.ask('绑定');assert(reply.includes('/staff-agent-api/im#code='));return new URLSearchParams(new URL(reply.match(/https:\/\/[^\s]+/)[0]).hash.slice(1)).get('code')}
  let code=await bindingCode()
  await assert.rejects(bank.claim(code,{user:{id:'ops',role:'ops'}}),e=>e.status===403)
  const identity={user:{id:'employee',role:'csr'},token:'fixture-only-bearer'},bound=await bank.claim(code,identity)
  const revision=store.snapshot().routes[id].bindingRevision
  assert.equal(claims[0].staffId,'employee');assert.equal(store.snapshot().routes[id].audience,'staff')
  assert((await chat.ask('锁卡')).includes('/staff-agent-api/im#session='))
  loggedIn=false;code=await bindingCode();loggedIn=true;await bank.claim(code,identity)
  assert.equal(store.snapshot().routes[id].bindingRevision,revision,'refreshing business login must not revoke persistent reminders')
  assert.notEqual(bank.list('employee')[0].sessionId,bound.sessionId)
  assert.equal((await readFile(path,'utf8')).includes('staff-person'),false)
  await assert.rejects(openImStore(path,key,{audience:'customer'}),/cannot be decrypted/)
  await bank.revoke(id,'employee');assert.deepEqual(revocations,[id]);assert.equal(bank.list('employee').length,0)
})
test('staff IM HTTP uses employee login only, blocks global administration and scopes QR ownership',async t=>{
  const records=new Map(),claims=[],qrImage='data:image/png;base64,iVBORw0KGgo='
  const bank={list:()=>[],reminderRoutes:()=>({}),bindScannedWeixin:async(bot,key,identity)=>{claims.push(identity.user.id);return{id:'im-bound',sessionId:'staff-session'}},preview:()=>({}),claim:async()=>({}),revoke:async()=>{}}
  const channels={
    provision:async()=>{const value={attemptId:`q-${records.size}`,status:'pending',qrImage,expiresAt:Date.now()+60000};records.set(value.attemptId,value);return value},
    registration:(_channel,id)=>records.get(id),status:()=>({channels:{weixin:{bots:[{botId:'staff-bot',connected:true}]}}}),
    privateWeixinRecipient:()=> 'p2p:staff-person',cancelProvision:async()=>{},deliveryReady:()=>false,
  }
  const http=createImHttp({audience:'staff',bank,channels,bankUrl:'https://bank-fixture.test',fetchImpl:async(url,init)=>{
    assert(['/staff-api/login','/staff-api/logout'].includes(url.pathname),'staff login may not call customer authentication')
    const request=JSON.parse(init.body)
    return{ok:true,json:async()=>({token:'staff-token',staff:{id:request.name,role:request.name==='ops'?'ops':'csr',name:request.name}})}
  }})
  const readJson=async req=>{const chunks=[];for await(const part of req)chunks.push(part);return JSON.parse(Buffer.concat(chunks).toString()||'{}')}
  const sendJson=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))}
  const server=createServer(async(req,res)=>{try{const options={pathname:new URL(req.url,'https://bank.test').pathname,readJson,sendJson};if(await http.handle(req,res,options))return;const owner=req.headers.authorization?.slice(7);if(!owner){sendJson(res,401,{});return}await http.handle(req,res,{...options,identity:{user:{id:owner,role:'csr'},token:owner}})}catch(e){sendJson(res,e.status??500,{message:e.message})}})
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>{server.closeAllConnections();server.close(done)}))
  const base=`http://127.0.0.1:${server.address().port}`
  async function call(path,body,token,method=body===undefined?'GET':'POST'){return fetch(base+'/agent-api/im'+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
  const portal=await call('');assert.equal(portal.status,200);const html=await portal.text();assert(html.includes('data-audience="staff"'));assert(html.includes('/staff-agent-api/im/portal.js'));assert(portal.headers.get('content-security-policy').includes("frame-ancestors 'none'"))
  assert.equal((await call('/auth/sms',{phone:'13800138000'})).status,403)
  assert.equal((await call('/auth/login',{name:'ops',password:'fixture'})).status,403)
  assert.equal((await call('/auth/login',{name:'csr',password:'fixture'})).status,200)
  assert.equal((await call('/admin/status',undefined,'csr')).status,403)
  const qr=await(await call('/weixin/qr',{},'alice')).json()
  assert.equal((await call(`/weixin/qr/${qr.attemptId}`,undefined,'bob')).status,404)
  records.get(qr.attemptId).status='connected';records.get(qr.attemptId).botId='staff-bot'
  assert.equal((await call(`/weixin/qr/${qr.attemptId}/confirm`,{confirmed:false},'alice')).status,400)
  assert.equal((await call(`/weixin/qr/${qr.attemptId}/confirm`,{confirmed:true},'alice')).status,200)
  assert.deepEqual(claims,['alice'])
})
