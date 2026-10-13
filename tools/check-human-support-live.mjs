/** Opt-in real model smoke: only temporary customer data and a non-financial support ticket. */
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
if (!process.env.OPENROUTER_API_KEY) throw Error('请配置进程环境 OPENROUTER_API_KEY')
const root = fileURLToPath(new URL('../', import.meta.url)), dir = await mkdtemp(join(tmpdir(), 'human-support-live-')), children = []
const secrets = Object.entries(process.env).filter(([key, value])=>/KEY|TOKEN|PASSWORD|SECRET/.test(key)&&value.length>8).map(([,value])=>value)
const safe = value => secrets.reduce((value,secret)=>value.replaceAll(secret,'[已隐藏]'),String(value))
const pause = ms=>new Promise(resolve=>setTimeout(resolve,ms))
const free=async()=>{const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
const [bankPort,agentPort]=await Promise.all([free(),free()]),bank=`http://127.0.0.1:${bankPort}`,agent=`http://127.0.0.1:${agentPort}`
let logs=''
const start=(file,env)=>{const child=spawn(process.execPath,[join(root,file)],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});child.stdout.on('data',value=>logs=(logs+safe(value)).slice(-6000));child.stderr.on('data',value=>logs=(logs+safe(value)).slice(-6000));children.push(child)}
const api=async(base,path,token,body)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok)throw Error(safe(`${response.status}: ${result.message??result.error}`));return result}
const ready=async(base,path,token)=>{for(let i=0;i<100;i++){try{return await api(base,path,token)}catch{await pause(100)}}throw Error('本地服务未就绪')}
try {
  start('server/index.mjs',{BANK_PORT:String(bankPort),BANK_DB_FILE:join(dir,'bank.sqlite'),BANK_STATE_FILE:join(dir,'empty.json')});await ready(bank,'/health')
  const phone='13800138000',sms=await api(bank,'/api/auth/sms-code',null,{phone}),customer=await api(bank,'/api/auth/login',null,{phone,password:'123456',smsCode:sms.demoCode})
  secrets.push(customer.token)
  start('framework/bridge/demo-server.mjs',{LUCKYCAT_DEMO_PORT:String(agentPort),LUCKYCAT_BANK_URL:bank,LUCKYCAT_PROVIDER:'openrouter',LUCKYCAT_MODEL:process.env.LUCKYCAT_MODEL??'qwen/qwen3.8-flash',LUCKYCAT_PATCHES:'',LUCKYCAT_FALLBACK_MODELS:'',LUCKYCAT_SESSION_DIR:join(dir,'context'),LUCKYCAT_DISABLE_VOICE:'1'})
  await ready(agent,'/agent-api/health',customer.token)
  const {sessionId}=await api(agent,'/agent-api/sessions',customer.token,{})
  await api(agent,`/agent-api/sessions/${sessionId}/messages`,customer.token,{text:'本地验收：我需要人工客服帮我核实一笔转账是否到账。请直接提交人工工单，问题摘要是“核实转账到账情况”。不要查询账户或执行转账。'})
  let cursor='0',running=false,done=false,confirmed=false;const seen=[]
  for(let i=0;i<400&&!done;i++) {
    const batch=await api(agent,`/agent-api/sessions/${sessionId}/events?after=${cursor}`,customer.token);cursor=batch.cursor
    for(const event of batch.events) {
      seen.push({type:event.type,...event.type==='assistant'?{text:event.text}:{},...event.type==='question'?{questions:event.question.questions}:{}})
      if(event.type==='error')throw Error(safe(event.message))
      if(event.type==='question'){await api(agent,`/agent-api/sessions/${sessionId}/stop`,customer.token,{});throw Error('问题摘要已完整，模型不应再用问题卡重复确认转人工')}
      if(event.type==='status'){if(event.status==='running')running=true;else if(running)done=true}
      if(event.type==='consent') {
        const challenge=event.challenge
        if(challenge.toolName!=='bank_request_human_support') {await api(agent,`/agent-api/consent/${challenge.challengeId}`,customer.token,{decision:'reject'});throw Error(`模型发起了非验收工具 ${challenge.toolName}`)}
        assert.equal((await api(bank,'/api/support/tickets',customer.token)).total,0,'用户确认前已建单')
        assert.equal(challenge.verification,undefined)
        await api(agent,`/agent-api/consent/${challenge.challengeId}`,customer.token,{decision:'approve'});confirmed=true
      }
    }
    if(!done)await pause(250)
  }
  assert(done&&confirmed,safe(`模型未完成确认建单：${JSON.stringify({done,confirmed,seen})}\n${logs}`))
  const tickets=await api(bank,'/api/support/tickets',customer.token)
  assert.equal(tickets.total,1);assert.equal(tickets.items[0].status,'open')
  const employee=await api(bank,'/staff-api/login',null,{name:'王小明',password:'123456'});secrets.push(employee.token)
  const detail=await api(bank,`/staff-api/tickets/${tickets.items[0].ticketId}`,employee.token)
  assert.equal(detail.customerId,customer.user.id)
  console.log('PASS 真实模型选择转人工工具 → 客户确认 → 只创建一张工单 → 员工可见；无转账或其他业务工具执行')
} catch(error) {console.error(safe(error instanceof Error?error.message:error));process.exitCode=1}
finally {for(const child of children.reverse())if(child.exitCode===null&&child.signalCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve))};await rm(dir,{recursive:true,force:true})}
