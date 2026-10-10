/** 本地 SSE fixture 验证对话切换释放连接，不调用外部模型。 */
import assert from 'node:assert/strict'
import {createServer as http} from 'node:http'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {createServer} from '../app/node_modules/vite/dist/node/index.js'
import {chromium} from 'playwright-core'
import {login} from './lib/session.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const sessions=new Map();let failNext=false;let streamRequests=0
const server=http(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname
 const json=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))}
 if(path==='/agent-api/health')return json({ok:true,bankDataSource:'http'})
 if(path==='/agent-api/sessions'){const id=randomUUID();sessions.set(id,new Set());return json({sessionId:id})}
 const [, , ,id,action]=path.split('/')
 if(!sessions.has(id))return json({error:'missing'},404)
 if(action==='stream'){
  streamRequests++
  if(failNext){failNext=false;return json({error:'fixture unavailable'},503)}
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'})
  const streams=sessions.get(id);streams.add(res);res.on('close',()=>streams.delete(res))
  res.write(`data: ${JSON.stringify({type:'hello',sessionId:id})}\n\n`)
 }else if(action==='messages'){
  for await(const chunk of req){void chunk}
  for(const stream of sessions.get(id)){
   for(const event of [{type:'status',status:'running'},{type:'assistant',text:'连接测试回复'},{type:'status',status:'idle'}])stream.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  json({accepted:true},202)
 }else json({known:true,started:true,busy:false})
})
let vite,browser
const count=()=>[...sessions.values()].reduce((n,s)=>n+s.size,0)
const wait=async(condition,label)=>{for(let n=0;n<50;n++){if(condition())return;await new Promise(r=>setTimeout(r,50))}assert.fail(label)}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 process.env.VITE_USE_MOCK='true';process.env.VITE_AGENT_TARGET=`http://127.0.0.1:${server.address().port}`
 vite=await createServer({root:root+'app',appType:'spa',server:{host:'127.0.0.1',port:0}});await vite.listen()
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH})
 const page=await browser.newPage();await login(page,`http://127.0.0.1:${vite.httpServer.address().port}`,{to:'/support'})
 await page.locator('[data-agent-status="ready"]').waitFor()
 for(let n=0;n<8;n++){
  await page.getByLabel('聊天消息').fill(`连接测试 ${n}`);await page.getByRole('button',{name:'发送',exact:true}).click()
  await page.locator('[data-message-kind="assistant"]').waitFor()
  await wait(()=>count()===1,'当前对话应只有一条连接')
  await page.getByRole('button',{name:'新对话',exact:true}).click()
  await wait(()=>count()===0,'新建对话没有关闭旧事件流')
 }
 console.log('PASS 连续八次发消息和新建对话均释放旧连接')
 failNext=true
 await page.getByLabel('聊天消息').fill('失败重试');await page.getByRole('button',{name:'发送',exact:true}).click()
 await page.getByText('发送失败：事件流连接失败',{exact:true}).waitFor()
 const afterFailure=streamRequests;await page.waitForTimeout(1800)
 assert.equal(streamRequests,afterFailure,'握手失败后不应继续后台重连')
 await page.getByLabel('聊天消息').fill('重试成功');await page.getByRole('button',{name:'发送',exact:true}).click()
 await page.locator('[data-message-kind="assistant"]').waitFor()
 await page.getByRole('navigation',{name:'桌面主导航'}).getByRole('link',{name:'账户',exact:true}).click()
 await wait(()=>count()===0,'离开助手未释放连接')
 console.log('PASS 失败停止后台重连，重试成功且离开页面释放连接')
}finally{
 await browser?.close();await vite?.close();server.closeAllConnections();await new Promise(r=>server.close(r))
}
