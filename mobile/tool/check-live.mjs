// Real bank + real Harness/Agent; only the upstream model protocol is a local fixture.
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root=fileURLToPath(new URL('../../',import.meta.url))
if(!existsSync(join(root,'framework/packages/bank-demo/lib/http-tools.js')))throw Error('请先在 framework/ 执行 bootstrap.sh 与 build.sh')
const temp=await mkdtemp(join(tmpdir(),'luckycat-flutter-live-'))
const free=async()=>{const s=netServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
const bankPort=await free(),agentPort=await free(),providerPort=await free()
const bank=`http://127.0.0.1:${bankPort}`,agent=`http://127.0.0.1:${agentPort}`
let logs='';const children=[]
const start=(file,env)=>{const c=spawn(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});children.push(c);for(const stream of [c.stdout,c.stderr])stream.on('data',d=>{logs=(logs+d).slice(-12000)});return c}
const provider=createServer(async(req,res)=>{
  for await(const _ of req){} // Consume request without persisting model context.
  res.writeHead(200,{'content-type':'text/event-stream'})
  const chunk=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'fixture-response',object:'chat.completion.chunk',created:1,model:'flutter-fixture',choices:[{index:0,delta,finish_reason}]})}\n\n`)
  chunk({role:'assistant'});chunk({content:'你好，'});await new Promise(r=>setTimeout(r,60));chunk({content:'我是招财猫助手。'});chunk({},'stop');res.end('data: [DONE]\n\n')
})
const ready=async(base,path)=>{for(let n=0;n<120;n++){try{if((await fetch(base+path,{signal:AbortSignal.timeout(1000)})).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('测试服务启动失败\n'+logs)}
try{
  await new Promise(r=>provider.listen(providerPort,'127.0.0.1',r))
  start('server/index.mjs',{BANK_PORT:String(bankPort),BANK_DB_FILE:join(temp,'bank.sqlite'),BANK_STATE_FILE:join(temp,'state.json')})
  await ready(bank,'/health')
  const patch=join(temp,'provider.yml')
  await writeFile(patch,`- id: llm-pi-ai\n  config:\n    providers:\n      test:\n        apiKeyEnv: LUCKYCAT_FLUTTER_TEST_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${providerPort}/v1\n        models:\n          - id: flutter-fixture\n            name: Flutter fixture\n            contextWindow: 128000\n- id: luckycat-rag\n  disabled: true\n- id: luckycat-embedding\n  disabled: true\n`)
  start('framework/bridge/demo-server.mjs',{LUCKYCAT_DEMO_PORT:String(agentPort),LUCKYCAT_BANK_URL:bank,LUCKYCAT_PROVIDER:'test',LUCKYCAT_MODEL:'flutter-fixture',LUCKYCAT_FLUTTER_TEST_KEY:'local-fixture',LUCKYCAT_PATCHES:patch,LUCKYCAT_DISABLE_VOICE:'1',LUCKYCAT_SESSION_DIR:join(temp,'sessions')})
  // The public Agent health endpoint must require authentication.
  for(let n=0;n<120;n++){try{if((await fetch(agent+'/agent-api/health',{signal:AbortSignal.timeout(1000)})).status===401)break}catch{}if(n===119)throw Error(logs);await new Promise(r=>setTimeout(r,100))}
  const flutter=process.env.FLUTTER_BIN??'flutter'
  const test=spawn(flutter,['test','test/live_bank_test.dart','test/live_agent_test.dart','--concurrency=1',`--dart-define=LIVE_BANK=${bank}`,`--dart-define=LIVE_AGENT=${agent}`,'--dart-define=LIVE_AGENT_SEND=true','--reporter','expanded'],{cwd:join(root,'mobile'),env:process.env,stdio:'inherit'})
  const code=await new Promise((resolve,reject)=>{test.on('error',reject);test.on('exit',resolve)})
  if(code!==0){console.error(logs);process.exitCode=code??1}
}finally{
  for(const c of children)c.kill('SIGTERM')
  provider.closeAllConnections();await new Promise(r=>provider.close(r))
  await new Promise(r=>setTimeout(r,300));for(const c of children){if(c.exitCode===null)c.kill('SIGKILL')}
  await rm(temp,{recursive:true,force:true})
}
