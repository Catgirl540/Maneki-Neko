/** 本地模型协议 + 真实 Harness/确认通道 + 临时 SQLite；验证助手能实际申请银行卡。 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { HTTP_OPERATIONS } from '../framework/packages/bank-demo/lib/http-tools.js'
import { checkPolicy } from '../framework/scripts/check-bank-tool-policy.mjs'
const root=resolve(import.meta.dirname,'..'),tmp=await mkdtemp(join(tmpdir(),'agent-tool-access-'))
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)))
async function freePort(){const s=createServer();const p=await listen(s);await new Promise(r=>s.close(r));return p}
const children=[], requests=[],issues=[]
let product,auth,bank,bridge,modelCalls=0
const expected=HTTP_OPERATIONS.map(x=>x.toolName)
const cleanEnv={...process.env}
for(const key of Object.keys(cleanEnv)) if(/TOKEN|API_KEY|ACCESS_KEY|SECRET/.test(key)) delete cleanEnv[key]
function start(file,env){const p=spawn(process.execPath,[file],{cwd:root,env:{...cleanEnv,...env},stdio:['ignore','pipe','pipe']});let log='';p.stdout.on('data',x=>log+=x);p.stderr.on('data',x=>log+=x);children.push(p);return {p,log:()=>log}}
async function call(base,path,token,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const result=await r.json();assert(r.ok,`${path}: ${JSON.stringify(result)}`);return result}
async function healthy(child,url,token){for(let n=0;n<100;n++){assert(child.p.exitCode===null,child.log());try{if((await fetch(url,{headers:token?{authorization:`Bearer ${token}`}:{}})).ok)return}catch{}await sleep(100)}throw Error(child.log())}
const address={recipient:'模拟测试收件人',phone:'13900139000',region:'广东省',city:'深圳市',detail:'测试路一号楼 101 室',postalCode:'518000'}
const provider=createServer(async(req,res)=>{
 try {
  let data='';for await(const chunk of req)data+=chunk
  const payload=JSON.parse(data);requests.push(payload)
  const names=new Set(payload.tools.map(t=>t.function.name))
  for(const name of expected)assert(names.has(name),`模型请求缺少银行工具 ${name}`)
  assert(!data.includes('888888'),'支付密码不得进入模型请求')
  assert(!data.includes(auth.token),'银行令牌不得进入模型请求')
  modelCalls++
  res.writeHead(200,{'content-type':'text/event-stream'})
  const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'card-'+modelCalls,object:'chat.completion.chunk',created:1,model:'tool-access-test',choices:[{index:0,delta,finish_reason}]})}\n\n`)
  send({role:'assistant'})
  if(modelCalls<=2){
   const name=modelCalls===1?'bank_card_products':'bank_apply_card'
   const args=modelCalls===1?{}:{productCode:product.code,...address}
   if(modelCalls===2){assert(payload.messages.some(m=>m.role==='tool'&&JSON.stringify(m.content).includes(product.code)),'第二步必须收到真实卡产品结果')}
   send({tool_calls:[{index:0,id:'apply-call-'+modelCalls,type:'function',function:{name,arguments:JSON.stringify(args)}}]})
   send({},'tool_calls')
  }else{
   assert(payload.messages.some(m=>m.role==='tool'&&JSON.stringify(m.content).includes('pending')),'模型必须收到寄送中新卡回执')
   send({content:'新卡申请已受理，卡片正在寄送中。'});send({},'stop')
  }
  res.end('data: [DONE]\n\n')
 }catch(e){issues.push(e);if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'local fixture assertion failed'}))}
})
try{
 // 回归校验器本身：不能漏任何已注册工具，也不能引入未注册银行工具。
 const base=await import('node:fs/promises').then(fs=>fs.readFile(join(root,'framework/profiles/luckycat/cordis.patch.yml'),'utf8'))
 for(const [name,text] of [['missing',base.replace('      - bank_apply_card\n','')],['extra',base.replace('      - bank_apply_card\n','      - bank_apply_card\n      - bank_unregistered\n')]]){
  const p=join(tmp,name+'.yml');await writeFile(p,text);assert.throws(()=>checkPolicy(p),/工具策略与注册不一致/)
 }
 const bankPort=await freePort();bank=`http://127.0.0.1:${bankPort}`
 const b=start('server/index.mjs',{BANK_PORT:String(bankPort),BANK_DB_FILE:join(tmp,'bank.sqlite'),BANK_STATE_FILE:join(tmp,'none.json')})
 await healthy(b,bank+'/health')
 const sms=await call(bank,'/api/auth/sms-code',null,{phone:'13800138000'})
 auth=await call(bank,'/api/auth/login',null,{phone:'13800138000',password:'123456',smsCode:sms.demoCode})
 const token=auth.token
 product=(await call(bank,'/api/cards/products',token))[0]
 const beforeCards=await call(bank,'/api/cards',token),before=(await call(bank,'/api/accounts',token))[0]
 const modelPort=await listen(provider),bridgePort=await freePort();bridge=`http://127.0.0.1:${bridgePort}`
 const overlay=join(tmp,'local-model.yml')
 await writeFile(overlay,`- id: llm-pi-ai\n  config:\n    providers:\n      test:\n        apiKeyEnv: LUCKYCAT_TEST_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${modelPort}/v1\n        models:\n          - id: tool-access-test\n            name: Test\n            contextWindow: 128000\n- id: luckycat-rag\n  disabled: true\n- id: luckycat-embedding\n  disabled: true\n`)
 const c=start('framework/bridge/demo-server.mjs',{LUCKYCAT_DEMO_PORT:String(bridgePort),LUCKYCAT_BANK_URL:bank,LUCKYCAT_PROVIDER:'test',LUCKYCAT_MODEL:'tool-access-test',LUCKYCAT_TEST_KEY:'local-test-only',LUCKYCAT_PATCHES:overlay,LUCKYCAT_DISABLE_VOICE:'1',LUCKYCAT_DEMO_TOKEN:''})
 await healthy(c,bridge+'/agent-api/health',token)
 const {sessionId}=await call(bridge,'/agent-api/sessions',token,{})
 await call(bridge,`/agent-api/sessions/${sessionId}/messages`,token,{text:'请帮我申请一张新银行卡，先查看可申请卡产品。寄送地址使用以下模拟资料：'+JSON.stringify(address)})
 let cursor='0',done=false,answer='',deadline=Date.now()+45000,application=false,queried=false;const approved=new Set()
 while(Date.now()<deadline&&!done){
  if(issues.length)throw issues[0]
  const batch=await call(bridge,`/agent-api/sessions/${sessionId}/events?after=${cursor}`,token);cursor=batch.cursor
  for(const e of batch.events){
   if(e.type==='error')throw Error(e.message)
   if(e.type==='tool-result')assert(!e.isError,e.text)
   if(e.type==='assistant')answer=e.text
   if(e.type==='consent'&&!approved.has(e.challenge.challengeId)){
    const ch=e.challenge
    assert(['bank_card_products','bank_apply_card'].includes(ch.toolName))
    assert.equal((await call(bank,'/api/cards',token)).length,beforeCards.length,'同意前不能开卡')
    if(ch.toolName==='bank_card_products')queried=true
    else{
     application=true;assert(queried,'必须先查产品')
     assert.equal(ch.verification,'payment-password')
     assert(ch.fields.some(f=>f.label==='寄送地址'&&f.value.includes(address.detail)))
     assert(ch.fields.some(f=>f.label==='费用合计'&&f.value===`CNY ${((product.issuingFee+product.deliveryFee)/100).toFixed(2)}`))
     const denied=await fetch(bridge+`/agent-api/consent/${ch.challengeId}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({decision:'approve'})})
     assert(!denied.ok,'未验证支付密码不能开卡')
     assert.equal((await call(bank,'/api/cards',token)).length,beforeCards.length)
    }
    approved.add(ch.challengeId)
    await call(bridge,`/agent-api/consent/${ch.challengeId}`,token,{decision:'approve',...(ch.verification?{paymentPassword:'888888'}:{})})
   }
   if(e.type==='status'&&e.status==='idle')done=true
  }
  if(!done)await sleep(100)
 }
 assert(done,c.log());assert(application,'未到达开卡确认');assert.equal(approved.size,2);assert.equal(modelCalls,3)
 const after=await call(bank,'/api/cards',token),accounts=await call(bank,'/api/accounts',token)
 assert.equal(after.length,beforeCards.length+1)
 assert.equal(after.find(card=>!beforeCards.some(old=>old.id===card.id)).status,'pending')
 assert.equal(accounts[0].balance,before.balance-product.issuingFee-product.deliveryFee)
 assert.match(answer,/受理|寄送/)
 console.log(`PASS 模型侧实际提供全部 ${expected.length} 个银行工具，未泄露银行令牌或支付密码`)
 console.log('PASS 真实 Harness 完成查卡产品→开卡确认→支付验证→临时银行扣费及新卡回执；未确认/无密码不能开卡')
}finally{
 for(const p of children.reverse()){if(p.exitCode!==null)continue;p.kill('SIGTERM');await Promise.race([once(p,'exit'),sleep(5000)]);if(p.exitCode===null)p.kill('SIGKILL')}
 await new Promise(r=>provider.close(r));await rm(tmp,{recursive:true,force:true})
}
