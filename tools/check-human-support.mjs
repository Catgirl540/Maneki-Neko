/** Isolated bank + local model protocol + both browser clients. No remote models/customer data. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { login as browserLogin } from './lib/session.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'human-support-')), children = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const free = async () => { const s = netServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p }
const [bankPort, agentPort] = await Promise.all([free(), free()])
const bank = `http://127.0.0.1:${bankPort}`, agent = `http://127.0.0.1:${agentPort}`
const fixtures = {}, counters = {}, modelRequests = []
let log = '', browser, customerVite, staffVite, bankChild
const start = (file, env) => {
  const child = spawn(process.execPath, [join(root, file)], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore','pipe','pipe'] })
  child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data); children.push(child); return child
}
const kill = async child => { if (child.exitCode !== null || child.signalCode !== null) return; child.kill(); await new Promise(resolve => child.once('exit', resolve)) }
const api = async (base, path, token, body, method = body === undefined ? 'GET' : 'POST') => {
  const res = await fetch(base + path, { method, headers: { 'content-type':'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
  return { status: res.status, data: await res.json() }
}
const ok = async (...args) => { const result = await api(...args); assert(result.status < 300, JSON.stringify(result)); return result.data }
const ready = async () => { for (let i = 0; i < 100; i++) { try { await ok(bank, '/health'); return } catch {} await sleep(100) }; throw Error(log) }
const customerLogin = async phone => { const sms = await ok(bank, '/api/auth/sms-code', null, { phone }); return ok(bank, '/api/auth/login', null, { phone, password: '123456', smsCode: sms.demoCode }) }
const provider = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const request = JSON.parse(raw); modelRequests.push(request)
  const marker = Object.keys(fixtures).reverse().find(key => JSON.stringify(request.messages).includes(key))
  if (!marker) { res.writeHead(400); res.end(JSON.stringify({ error: { message: 'unknown fixture' } })); return }
  const tool = fixtures[marker], first = (counters[marker] = (counters[marker] ?? 0) + 1) === 1
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const frame = (delta, reason = null) => res.write(`data: ${JSON.stringify({ id:'support-test',object:'chat.completion.chunk',created:1,model:'support-test',choices:[{index:0,delta,finish_reason:reason}] })}\n\n`)
  frame({ role:'assistant', ...(first ? { tool_calls:[{index:0,id:`call_${marker}`,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}] } : { content:'工单结果已返回，请在人工工单查看实际状态。' }) })
  frame({}, first ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n')
})
try {
  bankChild = start('server/index.mjs', { BANK_PORT:String(bankPort), BANK_DB_FILE:join(dir,'bank.sqlite'), BANK_STATE_FILE:join(dir,'empty.json') }); await ready()
  let a = await customerLogin('13800138000'), b = await customerLogin('13600136000')
  let staff = await ok(bank, '/staff-api/login', null, { name:'王小明',password:'123456' })
  assert.equal((await api(bank,'/api/support/tickets')).status,401)
  assert.equal((await api(bank,'/api/support/tickets',staff.token)).status,401)
  const request = { requestId:'manual_request_000001', reason:'转账问题需要人工核实', transcript:[{role:'user',text:'验证码 654321，手机号 13800138000'}] }
  const ticket = await ok(bank,'/api/support/tickets',a.token,request)
  const repeated = await api(bank,'/api/support/tickets',a.token,request)
  assert.equal(repeated.status,200); assert.equal(repeated.data.ticketId,ticket.ticketId)
  assert.equal((await api(bank,'/api/support/tickets',a.token,{...request,reason:'换了描述'})).status,409)
  assert.equal((await api(bank,'/api/support/tickets',a.token,{...request,customerId:b.user.id})).status,400)
  assert.equal((await api(bank,`/api/support/tickets/${ticket.ticketId}`,b.token)).status,404)
  assert.equal((await api(bank,`/api/support/tickets/${ticket.ticketId}/messages`,b.token,{requestId:'cross_owner_request_001',text:'越权回复'})).status,404)
  assert.equal((await ok(bank,'/api/support/tickets',b.token)).total,0)
  const internal = await ok(bank,'/staff-api/tickets',staff.token,{customerId:a.user.id,channel:'web',reason:'内部处理资料，不向客户发布'})
  assert.equal((await api(bank,`/api/support/tickets/${internal.ticketId}`,a.token)).status,404)
  assert.equal((await ok(bank,'/api/support/tickets',a.token)).total,1)
  const staffDetail = await ok(bank,`/staff-api/tickets/${ticket.ticketId}`,staff.token)
  assert.equal(staffDetail.customerId,a.user.id); assert(!JSON.stringify(staffDetail.agentTranscript).includes('654321'))
  assert(!JSON.stringify(staffDetail.agentTranscript).includes('13800138000'))
  assert.equal((await api(bank,'/api/support/tickets',a.token,{requestId:'too_large_request_0001',reason:'x'.repeat(300000)})).status,413)
  console.log('PASS 客户身份绑定、跨客户读写隔离、内部工单隔离、重复提交去重和摘要脱敏')
  await ok(bank,`/staff-api/tickets/${ticket.ticketId}/status`,staff.token,{status:'processing'},'PATCH')
  await ok(bank,`/staff-api/tickets/${ticket.ticketId}/status`,staff.token,{status:'waiting'},'PATCH')
  await ok(bank,`/staff-api/tickets/${ticket.ticketId}/messages`,staff.token,{text:'请补充交易发生时间'})
  const reply = { requestId:'manual_reply_request_001',text:'今天上午十点左右' }
  await ok(bank,`/api/support/tickets/${ticket.ticketId}/messages`,a.token,reply)
  await ok(bank,`/api/support/tickets/${ticket.ticketId}/messages`,a.token,reply)
  assert.equal((await api(bank,`/api/support/tickets/${ticket.ticketId}/messages`,a.token,{...reply,sender:'staff'})).status,400)
  let detail = await ok(bank,`/api/support/tickets/${ticket.ticketId}`,a.token)
  assert.equal(detail.status,'processing'); assert.equal(detail.messages.length,2)
  assert.deepEqual(detail.messages.map(m=>m.sender),['staff','customer'])
  assert(!('customerId' in detail)); assert(!('assigneeId' in detail)); assert(!('agentTranscript' in detail))
  await ok(bank,`/staff-api/tickets/${ticket.ticketId}/status`,staff.token,{status:'resolved'},'PATCH')
  assert.equal((await api(bank,`/api/support/tickets/${ticket.ticketId}/messages`,a.token,{requestId:'closed_reply_request_001',text:'不要写入'})).status,409)
  console.log('PASS 员工受理与回复、客户补充触发继续处理、留言防重与已解决工单只读')

  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve))
  const patch = join(dir,'provider.yml')
  await writeFile(patch,JSON.stringify([{id:'llm-pi-ai',config:{providers:{test:{apiKeyEnv:'LUCKYCAT_TEST_KEY',api:'openai-completions',baseURL:`http://127.0.0.1:${provider.address().port}/v1`,models:[{id:'support-test',name:'Test',contextWindow:128000}]}}}},{id:'luckycat-rag',disabled:true},{id:'luckycat-embedding',disabled:true}]))
  start('framework/bridge/demo-server.mjs',{LUCKYCAT_DEMO_PORT:String(agentPort),LUCKYCAT_BANK_URL:bank,LUCKYCAT_PROVIDER:'test',LUCKYCAT_MODEL:'support-test',LUCKYCAT_TEST_KEY:'test-only',LUCKYCAT_PATCHES:patch,LUCKYCAT_SESSION_DIR:join(dir,'context'),LUCKYCAT_DISABLE_VOICE:'1'})
  for(let i=0;i<100;i++){try{await ok(agent,'/agent-api/health',a.token);break}catch{await sleep(100)}}
  async function toolTurn(marker, tool, decision='approve') {
    fixtures[marker]=tool
    const {sessionId}=await ok(agent,'/agent-api/sessions',a.token,{})
    const before=(await ok(bank,'/api/support/tickets',a.token)).total
    await ok(agent,`/agent-api/sessions/${sessionId}/messages`,a.token,{text:marker})
    const events=[];let cursor='0', challenge, running=false, done=false
    for(let i=0;i<400&&!done;i++) {
      const batch=await ok(agent,`/agent-api/sessions/${sessionId}/events?after=${cursor}`,a.token);cursor=batch.cursor
      for(const event of batch.events){
        events.push(event)
        if(event.type==='error')throw Error(JSON.stringify(events)+'\n'+log.slice(-3000))
        if(event.type==='status'){if(event.status==='running')running=true;else if(running)done=true}
        if(event.type==='consent'){
          challenge=event.challenge
          assert.equal(challenge.verification,undefined)
          if(tool.name==='bank_request_human_support') assert.equal((await ok(bank,'/api/support/tickets',a.token)).total,before,'确认前已创建工单')
          await ok(agent,`/agent-api/consent/${challenge.challengeId}`,a.token,{decision})
        }
      }
      if(!done)await sleep(100)
    }
    assert(done,'Agent 超时');assert(challenge,'没有出现授权卡')
    assert(!JSON.stringify(modelRequests).includes(a.token))
    return events
  }
  await toolTurn('fixture_human_cancel',{name:'bank_request_human_support',args:{reason:'取消转人工测试'}},'reject')
  assert.equal((await ok(bank,'/api/support/tickets',a.token)).total,1)
  const createdEvents=await toolTurn('fixture_human_create',{name:'bank_request_human_support',args:{reason:'Agent 转人工测试问题'}})
  const all=await ok(bank,'/api/support/tickets',a.token), agentTicket=all.items.find(t=>t.reason==='Agent 转人工测试问题')
  assert(agentTicket);assert(createdEvents.some(event=>event.type==='tool-result'&&!event.isError))
  await toolTurn('fixture_human_list',{name:'bank_list_support_tickets',args:{}})
  await toolTurn('fixture_human_detail',{name:'bank_get_support_ticket',args:{ticketId:agentTicket.ticketId}})
  await toolTurn('fixture_human_reply',{name:'bank_reply_support_ticket',args:{ticketId:agentTicket.ticketId,text:'Agent 代客户补充的问题'}})
  assert.equal((await ok(bank,`/api/support/tickets/${agentTicket.ticketId}`,a.token)).messages.length,1)
  const names=modelRequests[0].tools.map(t=>t.function.name)
  for(const name of ['bank_request_human_support','bank_list_support_tickets','bank_get_support_ticket','bank_reply_support_ticket']) assert(names.includes(name))
  console.log('PASS 真实 Harness 四项人工服务工具、确认前不建单、取消不建单、查询和补充闭环')

  for(let index=0;index<21;index++) await ok(bank,'/api/support/tickets',b.token,{requestId:`page_fixture_request_${String(index).padStart(4,'0')}`,reason:`分页验收问题 ${index}`})
  assert.equal((await ok(bank,'/api/support/tickets',b.token)).items.length,20)
  assert.equal((await ok(bank,'/api/support/tickets',b.token)).size,20)
  assert.equal((await ok(bank,'/api/support/tickets?page=2',b.token)).items.length,1)
  assert.equal((await ok(bank,'/api/support/tickets?page=2',b.token)).total,21)
  assert.equal((await api(bank,'/api/support/tickets?page=Infinity',b.token)).status,400)
  console.log('PASS 工单分页完整、非法页码拒绝，其他客户工单不会混入')

  if(process.argv.includes('--browser')) {
    const {chromium}=await import('playwright-core')
    const {createServer:createVite}=await import('../app/node_modules/vite/dist/node/index.js')
    const {createServer:createStaffVite}=await import('../staff/node_modules/vite/dist/node/index.js')
    process.env.VITE_USE_MOCK='false';process.env.VITE_BASE_PATH='/';process.env.VITE_API_BASE_URL='';process.env.VITE_AGENT_URL='/agent-api'
    customerVite=await createVite({root:join(root,'app'),configFile:join(root,'app/vite.config.ts'),server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:bank},'/agent-api':{target:agent}}}});await customerVite.listen()
    process.env.VITE_BASE_PATH='/staff/'
    staffVite=await createStaffVite({root:join(root,'staff'),configFile:join(root,'staff/vite.config.ts'),server:{host:'127.0.0.1',port:0,proxy:{'/staff-api':{target:bank}}}});await staffVite.listen()
    browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true})
    const page=await browser.newPage({viewport:{width:1440,height:1000}}), staffPage=await browser.newPage({viewport:{width:1280,height:900}}), errors=[]
    page.on('pageerror',error=>errors.push(error.message));staffPage.on('pageerror',error=>errors.push(error.message))
    await browserLogin(page,`http://127.0.0.1:${customerVite.httpServer.address().port}`,{to:'/support'})
    await page.getByRole('button',{name:'转人工',exact:true}).click()
    await page.getByLabel('问题描述').fill('浏览器人工客服联调')
    await page.getByRole('button',{name:'提交请求',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'人工工单',exact:true})
    await dialog.getByText('已提交，等待客服受理。',{exact:true}).waitFor()
    const browserTicket=(await ok(bank,'/api/support/tickets',a.token)).items.find(t=>t.reason==='浏览器人工客服联调')
    assert(browserTicket)
    await staffPage.goto(`http://127.0.0.1:${staffVite.httpServer.address().port}/staff/tickets`)
    await staffPage.getByLabel('员工姓名').fill('王小明');await staffPage.getByLabel('密码',{exact:true}).fill('123456');await staffPage.getByRole('button',{name:'登录',exact:true}).click()
    await staffPage.getByText('浏览器人工客服联调',{exact:true}).click()
    await staffPage.getByRole('button',{name:'接手',exact:true}).click()
    await staffPage.getByLabel('给客户留言').fill('人工客服浏览器回复已送达')
    await staffPage.route('**/staff-api/tickets/*/messages',route=>route.fulfill({status:503,json:{message:'员工留言失败夹具'}}),{times:1})
    await staffPage.getByRole('button',{name:'发送',exact:true}).click()
    await staffPage.getByRole('alert').filter({hasText:'员工留言失败夹具'}).waitFor()
    await staffPage.waitForTimeout(3500)
    assert(await staffPage.getByRole('alert').filter({hasText:'员工留言失败夹具'}).isVisible())
    assert.equal(await staffPage.getByLabel('给客户留言').inputValue(),'人工客服浏览器回复已送达')
    await staffPage.getByRole('button',{name:'发送',exact:true}).click()
    await page.bringToFront()
    await dialog.getByText('人工客服浏览器回复已送达',{exact:true}).waitFor({timeout:15000})
    await dialog.getByLabel('补充留言').fill('客户浏览器补充已送达')
    await page.route('**/api/support/tickets/*/messages',route=>route.fulfill({status:503,json:{message:'客户留言失败夹具'}}),{times:1})
    await dialog.getByRole('button',{name:'发送留言',exact:true}).click()
    await dialog.getByRole('alert').filter({hasText:'客户留言失败夹具'}).waitFor()
    await page.waitForTimeout(3500)
    assert(await dialog.getByRole('alert').filter({hasText:'客户留言失败夹具'}).isVisible())
    assert.equal(await dialog.getByLabel('补充留言').inputValue(),'客户浏览器补充已送达')
    await dialog.getByRole('button',{name:'发送留言',exact:true}).click()
    await staffPage.bringToFront()
    await staffPage.getByText('客户浏览器补充已送达',{exact:true}).waitFor({timeout:15000})
    await staffPage.getByRole('button',{name:'解决',exact:true}).click()
    await page.bringToFront()
    await dialog.getByText('工单已解决。仍需帮助时，可重新提交转人工请求。',{exact:true}).waitFor({timeout:15000})
    console.log('PASS 两端真实浏览器：手动转人工 → 员工接手并回复 → 客户补充 → 员工解决')
    await dialog.getByRole('button',{name:'关闭弹窗',exact:true}).click()
    fixtures.fixture_browser_human={name:'bank_request_human_support',args:{reason:'浏览器 Agent 转人工'}}
    await page.getByLabel('聊天消息').fill('fixture_browser_human');await page.getByRole('button',{name:'发送',exact:true}).click()
    const confirmation=page.locator('[data-consent-card]');await confirmation.waitFor({timeout:30000})
    assert((await confirmation.innerText()).includes('浏览器 Agent 转人工'))
    assert.equal(await confirmation.locator('input[type="password"]').count(),0)
    await confirmation.getByRole('button',{name:/确认/,exact:false}).click()
    await confirmation.waitFor({state:'hidden'})
    await page.getByRole('button',{name:'人工工单',exact:true}).click()
    await page.getByRole('button',{name:/浏览器 Agent 转人工/}).waitFor({timeout:15000})
    await page.getByRole('button',{name:/浏览器 Agent 转人工/}).click()
    for(const width of [1440,390,320]) {
      await page.setViewportSize({width,height:900})
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`人工工单 ${width}px 溢出`)
      const bounds=await page.getByRole('dialog',{name:'人工工单',exact:true}).boundingBox()
      assert(bounds.x>=0&&bounds.x+bounds.width<=width,`弹窗 ${width}px 溢出`)
    }
    await page.screenshot({path:join(root,'server/data/human-support-mobile-preview.png'),fullPage:true})
    await dialog.getByRole('button',{name:'关闭弹窗',exact:true}).click()
    await page.setViewportSize({width:1440,height:900})
    await page.route('**/agent-api/health',route=>route.fulfill({status:503,json:{error:'离线夹具'}}))
    await page.reload()
    await page.getByRole('button',{name:'转人工',exact:true}).waitFor()
    await page.getByRole('button',{name:'转人工',exact:true}).click()
    await page.getByLabel('问题描述').fill('Agent 离线也能转人工')
    await page.getByRole('button',{name:'提交请求',exact:true}).click()
    await page.getByText('已提交，等待客服受理。',{exact:true}).waitFor()
    assert.deepEqual(errors,[])
    console.log('PASS 浏览器 Agent 转人工与人工工单入口、320/390/1440 布局及 Agent 离线手动兜底')
  }
  await browser?.close();browser=undefined;await customerVite?.close();customerVite=undefined;await staffVite?.close();staffVite=undefined
  await kill(bankChild)
  const db=new DatabaseSync(join(dir,'bank.sqlite'),{readOnly:true})
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE actor_type='customer' AND action='ticket.create' AND target_id=?").get(ticket.ticketId).count,1)
  db.close()
  bankChild=start('server/index.mjs',{BANK_PORT:String(bankPort),BANK_DB_FILE:join(dir,'bank.sqlite'),BANK_STATE_FILE:join(dir,'empty.json')});await ready()
  a=await customerLogin('13800138000')
  detail=await ok(bank,`/api/support/tickets/${ticket.ticketId}`,a.token)
  assert.equal(detail.status,'resolved');assert.equal(detail.messages.length,2)
  const retryAfterRestart=await ok(bank,'/api/support/tickets',a.token,request)
  assert.equal(retryAfterRestart.ticketId,ticket.ticketId)
  console.log('PASS 工单、双向留言、审计及请求去重在银行服务重启后保留')
} catch(error) { console.error(error);console.error(log.slice(-4500));process.exitCode=1 }
finally {
  await browser?.close();await customerVite?.close();await staffVite?.close()
  await new Promise(resolve=>provider.close(resolve))
  for(const child of children.reverse())await kill(child)
  await rm(dir,{recursive:true,force:true})
}
