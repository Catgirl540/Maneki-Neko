import './legacy-sqlite-fixture-disabled.mjs'
/** 使用本机模型协议 fixture 驱动真实 Harness、银行 HTTP 与可选浏览器；不调用外部模型。 */
import { createServer as http } from 'node:http'
import { createServer as net } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { summarizeRiskAssessment } from '../framework/bridge/wealth-risk.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const tmp = await mkdtemp(join(tmpdir(), 'agent-runtime-'))
const free = async () => { const s=net();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p }
const bankPort = await free(), agentPort = await free(), providerPort = await free()
const processes=[]; let agentLog='';let modelRequests=[];let fixtures={};const counters={}; let vite, browser
const provider=http(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);modelRequests.push(data)
 const content=JSON.stringify(data.messages); const which=Object.keys(fixtures).find(x=>content.includes(x))
 if(!which){res.writeHead(400);res.end(JSON.stringify({error:{message:'unknown fixture'}}));return}
 const first=(counters[which]=(counters[which]??0)+1)===1
 const tool=fixtures[which]
 if (tool.failAlways || tool.failAt?.includes(counters[which])) {
   res.writeHead(tool.status ?? 503, {'content-type':'application/json'})
   res.end(JSON.stringify({error:{message:'fixture transient failure',type:'server_error'}}));return
 }
 res.writeHead(200,{'content-type':'text/event-stream'})
 const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:1,model:'luckycat-test',choices:[{index:0,delta,finish_reason}]})}\n\n`)
 const useTool = first && !!tool.name
 send({role:'assistant',...(useTool?{tool_calls:[{index:0,id:`call_${which}`,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]}:{content:'已根据账户服务返回的结果完成处理。'})})
 send({},useTool?'tool_calls':'stop');res.end('data: [DONE]\n\n')
}); await new Promise(r=>provider.listen(providerPort,'127.0.0.1',r))
const start=(file,env)=>{const c=spawn(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});processes.push(c);c.stdout.on('data',x=>agentLog+=x);c.stderr.on('data',x=>agentLog+=x);return c}
const bank=`http://127.0.0.1:${bankPort}`, agent=`http://127.0.0.1:${agentPort}`
const api=async(base,path,token,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()}}
const ready=async(base,path,token)=>{for(let n=0;n<100;n++){try{if((await api(base,path,token)).status===200)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error(agentLog)}
const controllers=[]
try{
 start('server/index.mjs',{BANK_PORT:String(bankPort),BANK_DB_FILE:join(tmp,'bank.sqlite'),BANK_STATE_FILE:join(tmp,'state.json')});await ready(bank,'/health')
 const login=async phone=>{const sms=(await api(bank,'/api/auth/sms-code',null,{phone})).data;return (await api(bank,'/api/auth/login',null,{phone,password:'123456',smsCode:sms.demoCode})).data}
 const a=await login('13800138000'),b=await login('13600136000');const accounts=(await api(bank,'/api/accounts',a.token)).data,other=(await api(bank,'/api/accounts',b.token)).data
 fixtures={fixture_balance:{name:'bank_get_balance',args:{}},fixture_transfer:{name:'bank_transfer',args:{fromAccountId:accounts[0].id,payeeName:b.user.name,payeeAccountNo:other[0].accountNo,payeeBankCode:'LCB',payeeBankRegion:'CN',amountCents:500,memo:'runtime check'}},fixture_question:{name:'ask_user_question',args:{questions:[{id:'purpose',question:'请选择用途',options:[{label:'生活',description:'日常支出'},{label:'其他',description:'其他用途'}]}]}}}
 const patch=join(tmp,'provider.yml');await writeFile(patch,`- id: llm-pi-ai\n  config:\n    providers:\n      test:\n        apiKeyEnv: LUCKYCAT_TEST_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${providerPort}/v1\n        retryPolicy:\n          mode: normal\n          maxRetries: 3\n          retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]\n          backoff:\n            initialDelayMs: 250\n            maxDelayMs: 500\n            jitterRatio: 0\n        models:\n          - id: luckycat-test\n            name: Test\n            contextWindow: 128000\n- id: luckycat-rag\n  disabled: true\n- id: luckycat-embedding\n  disabled: true\n`)
 start('framework/bridge/demo-server.mjs',{LUCKYCAT_DEMO_PORT:String(agentPort),LUCKYCAT_BANK_URL:bank,LUCKYCAT_PROVIDER:'test',LUCKYCAT_MODEL:'luckycat-test',LUCKYCAT_TEST_KEY:'test-only',LUCKYCAT_PATCHES:patch,LUCKYCAT_DISABLE_VOICE:'1'})
 await ready(agent,'/agent-api/health',a.token);assert.equal((await api(agent,'/agent-api/health')).status,401);assert.equal((await api(agent,'/consent/challenge',null,{})).status,403)
 const session=(await api(agent,'/agent-api/sessions',a.token,{})).data.sessionId
 assert.equal((await api(agent,`/agent-api/sessions/${session}`,b.token)).status,404)
 assert.equal((await api(agent,`/agent-api/sessions/${session}/stream`,b.token)).status,404)
 console.log('PASS Agent HTTP 登录与会话归属、内部通道访问限制')
 const events=[];const c=new AbortController();controllers.push(c)
 const stream=await fetch(agent+`/agent-api/sessions/${session}/stream`,{headers:{authorization:`Bearer ${a.token}`},signal:c.signal});const reader=stream.body.getReader();let buffer=''
 const pump=(async()=>{try{for(;;){const {done,value}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);let i;while((i=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,i);buffer=buffer.slice(i+2);const data=block.split('\n').find(x=>x.startsWith('data:'));if(data)events.push(JSON.parse(data.slice(5)))}}}catch(e){if(!c.signal.aborted)throw e}})()
 const wait=async(fn)=>{for(let n=0;n<500;n++){const e=events.find(fn);if(e)return e;if(events.some(e=>e.type==='error'))throw new Error(JSON.stringify(events)+'\n'+agentLog);await new Promise(r=>setTimeout(r,100))}throw new Error('timed out '+JSON.stringify(events)+'\n'+agentLog)}
 await api(agent,`/agent-api/sessions/${session}/messages`,a.token,{text:'fixture_balance'})
 const challenge=(await wait(e=>e.type==='consent')).challenge
 assert.equal(challenge.toolName,'bank_get_balance');assert.equal(challenge.arguments,undefined)
 assert.equal((await api(agent,`/agent-api/consent/${challenge.challengeId}`,b.token,{decision:'approve'})).status,404)
 assert.equal((await api(agent,`/agent-api/consent/${challenge.challengeId}`,a.token,{decision:'approve'})).status,200)
 const result=await wait(e=>e.type==='tool-result');assert.equal(result.isError,false);assert(result.text.includes('http'))
 const riskResult = JSON.parse(result.text).risk
 assert.deepEqual(riskResult, summarizeRiskAssessment((await api(bank, '/api/wealth/overview', a.token)).data.risk))
 await wait(e=>e.type==='status'&&e.status==='idle');console.log('PASS 实际 Harness → 确认卡 → HTTP 工具 → SSE 返回账户数据')
 // Separate session to keep fixture provider deterministic.
 const transferSession=(await api(agent,'/agent-api/sessions',a.token,{})).data.sessionId
 events.length=0;c.abort();await pump
 const tc=new AbortController();controllers.push(tc);const ts=await fetch(agent+`/agent-api/sessions/${transferSession}/stream`,{headers:{authorization:`Bearer ${a.token}`},signal:tc.signal});const tr=ts.body.getReader();buffer=''
 const tp=(async()=>{try{for(;;){const {done,value}=await tr.read();if(done)break;buffer+=new TextDecoder().decode(value);let i;while((i=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,i);buffer=buffer.slice(i+2);const data=block.split('\n').find(x=>x.startsWith('data:'));if(data)events.push(JSON.parse(data.slice(5)))}}}catch(e){if(!tc.signal.aborted)throw e}})()
 await api(agent,`/agent-api/sessions/${transferSession}/messages`,a.token,{text:'fixture_transfer'})
 const t=(await wait(e=>e.type==='consent')).challenge
 assert(t.fields.some(f=>f.value===other[0].accountNo));assert.equal(t.verification,'payment-password')
 assert.equal((await api(agent,`/agent-api/consent/${t.challengeId}`,a.token,{decision:'approve',paymentPassword:'000000'})).status,401)
 assert.equal((await api(bank,'/api/accounts',a.token)).data[0].balance,accounts[0].balance)
 assert.equal((await api(agent,`/agent-api/consent/${t.challengeId}`,a.token,{decision:'approve',paymentPassword:'888888'})).status,200)
 const done=await wait(e=>e.type==='tool-result');assert.equal(done.isError,false);await wait(e=>e.type==='bank-updated')
 assert.equal((await api(bank,'/api/accounts',a.token)).data[0].balance,accounts[0].balance-500)
 assert.equal((await api(bank,'/api/accounts',b.token)).data[0].balance,other[0].balance+500)
 const modelText=JSON.stringify(modelRequests);assert(!modelText.includes(a.token));assert(!modelText.includes('"888888"'));console.log('PASS Harness 转账只在确认验密后入账，银行令牌和支付密码不进入模型请求')
 tc.abort();await tp
 // 参数错误与准备失败必须保持为真实工具错误，不能伪装成用户拒绝。
 const { amountCents: omittedAmount, ...withoutAmount } = fixtures.fixture_transfer.args
 fixtures.fixture_missing_amount = { name: 'bank_transfer', args: withoutAmount }
 fixtures.fixture_quote_failure = { name: 'bank_transfer', args: { ...withoutAmount, amountCents: 200000000 } }
 fixtures.fixture_cancel_transfer = { name: 'bank_transfer', args: { ...withoutAmount, amountCents: 500 } }
 const unchanged = (await api(bank, '/api/accounts', a.token)).data[0].balance
 for (const [name, expected] of [['fixture_missing_amount', /amountCents/], ['fixture_quote_failure', /单笔上限/], ['fixture_cancel_transfer', /用户取消了这次操作/]]) {
   const sid = (await api(agent, '/agent-api/sessions', a.token, {})).data.sessionId
   let cursor = (await api(agent, `/agent-api/sessions/${sid}/events`, a.token)).data.cursor
   const received = []
   let cancelled = false
   await api(agent, `/agent-api/sessions/${sid}/messages`, a.token, { text: name })
   for (let i = 0; i < 150; i++) {
     const batch = (await api(agent, `/agent-api/sessions/${sid}/events?after=${cursor}`, a.token)).data
     cursor = batch.cursor; received.push(...batch.events)
     const card = received.find(e => e.type === 'consent')
     if (name === 'fixture_cancel_transfer' && card && !cancelled) {
       cancelled = true
       assert.equal((await api(agent, `/agent-api/consent/${card.challenge.challengeId}`, a.token, { decision: 'reject' })).status, 200)
     }
     if (received.some(e => e.type === 'tool-result') && received.some(e => e.type === 'status' && e.status === 'idle')) break
     await new Promise(r => setTimeout(r, 100))
   }
   const failed = received.find(e => e.type === 'tool-result')
   assert.equal(failed?.isError, true)
   assert.match(failed.text, expected)
   assert(!failed.text.includes('the user rejected'))
   assert.equal(received.some(e => e.type === 'consent'), name === 'fixture_cancel_transfer', '仅有效参数才生成确认卡')
   assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, unchanged)
   assert(modelRequests.some(req => req.messages.some(message =>
     typeof message.content === 'string' ? message.content.includes(failed.text)
       : Array.isArray(message.content) && message.content.some(block => typeof block.text === 'string' && block.text.includes(failed.text)),
   )), '模型须收到真实失败原因')
 }
 console.log('PASS 缺金额与准备失败返回真实原因；用户取消仍拒绝，三类失败均未扣款')
 fixtures.fixture_auto_recover = { failAt: [1, 2] }
 fixtures.fixture_auto_exhaust = { failAlways: true }
 fixtures.fixture_auth_failure = { failAlways: true, status: 401 }
 fixtures.fixture_auto_payment = { ...fixtures.fixture_transfer, args: { ...withoutAmount, amountCents: 700 }, failAt: [2, 3] }
 fixtures.fixture_auto_cancel = { failAlways: true }
 for (const name of ['fixture_auto_recover', 'fixture_auto_exhaust', 'fixture_auth_failure', 'fixture_auto_payment', 'fixture_auto_cancel']) {
   const sid = (await api(agent, '/agent-api/sessions', a.token, {})).data.sessionId
   let cursor = (await api(agent, `/agent-api/sessions/${sid}/events`, a.token)).data.cursor
   const received = []; let answered = false; let stopped = false; let requestsAtStop
   const before = (await api(bank, '/api/accounts', a.token)).data[0].balance
   await api(agent, `/agent-api/sessions/${sid}/messages`, a.token, { text: name })
   for (let i = 0; i < 500; i++) {
     const batch = (await api(agent, `/agent-api/sessions/${sid}/events?after=${cursor}`, a.token)).data
     cursor = batch.cursor; received.push(...batch.events)
     const card = received.find(e => e.type === 'consent')
     if (card && !answered && name === 'fixture_auto_payment') {
       answered = true
       assert.equal((await api(agent, `/agent-api/consent/${card.challenge.challengeId}`, a.token, { decision:'approve', paymentPassword:'888888' })).status, 200)
     }
     if (name === 'fixture_auto_cancel' && !stopped && received.some(e => e.type === 'model-retry')) {
       stopped = true
       assert.equal((await api(agent, `/agent-api/sessions/${sid}/stop`, a.token, {})).status, 200)
       requestsAtStop = counters[name]
     }
     if (received.some(e => e.type === 'status' && e.status === 'idle')) break
     await new Promise(r => setTimeout(r, 20))
   }
   const progress = received.filter(e => e.type === 'model-retry' && e.phase === 'waiting')
   assert(progress.every(e => e.maxRetries === 3 && !JSON.stringify(e).includes('fixture transient failure')))
   assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, before - (name === 'fixture_auto_payment' ? 700 : 0))
   if (name === 'fixture_auto_recover' || name === 'fixture_auto_payment') {
     assert.equal(progress.length, 2)
     assert(received.some(e => e.type === 'assistant' && e.text))
     assert(!received.some(e => e.type === 'error'))
     assert.equal(counters[name], name === 'fixture_auto_payment' ? 4 : 3)
     if (name === 'fixture_auto_payment') {
       assert.equal(received.filter(e => e.type === 'tool-call' && e.name === 'bank_transfer').length, 1)
       assert.equal(received.filter(e => e.type === 'consent').length, 1)
     }
   } else if (name === 'fixture_auto_exhaust') {
     assert.equal(progress.length, 3); assert.equal(counters[name], 4)
     assert.match(received.find(e => e.type === 'error')?.message ?? '', /已自动重试 3 次/)
   } else if (name === 'fixture_auth_failure') {
     assert.equal(progress.length, 0); assert.equal(counters[name], 1)
     assert.match(received.find(e => e.type === 'error')?.message ?? '', /认证失败/)
   } else {
     assert(stopped && received.some(e => e.type === 'stopped'))
     assert(!received.some(e => e.type === 'error'))
     assert.equal(counters[name], requestsAtStop, '停止生效后不继续请求模型')
     assert(counters[name] < 4, '取消必须先于重试预算耗尽')
   }
 }
 console.log('PASS 自动重试恢复、3次耗尽、认证不重试、停止取消退避；付款后回复重试只扣款一次')
 if (process.argv.includes('--browser')) {
   const { chromium } = await import('playwright-core')
   const { createServer } = await import('../app/node_modules/vite/dist/node/index.js')
   const { login, gotoInApp } = await import('./lib/session.mjs')
   process.env.VITE_USE_MOCK = 'false'
   process.env.VITE_PROXY_TARGET = bank
   process.env.VITE_AGENT_TARGET = agent
   const webPort = await free()
   vite = await createServer({ root: root + '/app', server: { host: '127.0.0.1', port: webPort, strictPort: true } })
   await vite.listen()
   browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
   const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
   const page = await context.newPage(); const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message))
   const base = `http://127.0.0.1:${webPort}`
   fixtures.fixture_browser_transfer = { ...fixtures.fixture_transfer, args: { ...fixtures.fixture_transfer.args, amountCents: 700 } }
   const cards = (await api(bank, '/api/cards', a.token)).data
   fixtures.fixture_browser_card = { name: 'bank_reveal_card_secret', args: { cardId: cards[0].id, field: 'card-number' } }
   await login(page, base, { to: '/support' })
   await page.locator('[data-agent-status="ready"]').waitFor({ timeout: 15000 })
   const bankBalance = (await api(bank, '/api/accounts', a.token)).data[0].balance
   await page.getByRole('textbox', { name: '聊天消息' }).fill('fixture_browser_transfer')
   await page.getByRole('button', { name: '发送', exact: true }).click()
   await page.getByText('需要你确认：转账', { exact: true }).waitFor({ timeout: 30000 })
   assert(await page.getByText(other[0].accountNo, { exact: true }).isVisible())
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
   const approve = page.getByRole('button', { name: '确认并验证', exact: true })
   const pin = page.locator('input[type="password"]')
   for (let i=0;i<6;i++) await pin.nth(i).fill('0')
   await approve.click()
   await page.getByText(/支付密码不正确/).waitFor()
   assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, bankBalance)
   for (let i=0;i<6;i++) await pin.nth(i).fill('8')
   await approve.click()
   await page.getByText('需要你确认：转账', { exact: true }).waitFor({ state: 'detached' })
   for(let n=0;n<100;n++){ if((await api(bank, '/api/accounts', a.token)).data[0].balance===bankBalance-700)break; await new Promise(r=>setTimeout(r,100)) }
   assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, bankBalance-700)
   console.log('PASS 手机网页登录 → Agent SSE → 完整确认卡 → 错密码重试 → 实际转账')
   await page.getByRole('button', { name: '新对话', exact: true }).click()
   await page.getByRole('textbox', { name: '聊天消息' }).fill('fixture_browser_card')
   await page.getByRole('button', { name: '发送', exact: true }).click()
   await page.getByText('需要你确认：查看卡安全信息', { exact: true }).waitFor({ timeout: 30000 })
   for (let i=0;i<6;i++) await page.locator('input[type="password"]').nth(i).fill('8')
   await approve.click()
   const secretDialog = page.getByRole('dialog', { name: '卡安全信息' })
   await secretDialog.waitFor()
   const pan = await secretDialog.locator('p').last().innerText()
   assert(pan.length > 10)
   const saved = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes('agent.sessions')).map(([,v])=>v).join(''))
   assert(!saved.includes(pan))
   await page.keyboard.press('Escape'); await secretDialog.waitFor({ state: 'detached' })
   assert(!await page.getByText(pan, { exact: true }).count())
   await gotoInApp(page, '/dashboard'); await page.getByText('储蓄账户余额', { exact: true }).waitFor()
   await page.getByRole('button', { name: '显示', exact: true }).click()
   const value = ((bankBalance-700)/100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
   assert((await page.locator('main').innerText()).includes(value))
   assert.deepEqual(pageErrors, [])
   console.log('PASS 临时卡信息弹窗与关闭、卡号不写历史、转账后总览刷新且无页面异常')
   await gotoInApp(page, '/support')
   await page.locator('[data-agent-status="ready"]').waitFor()
   fixtures.fixture_browser_question = fixtures.fixture_question
   await page.getByRole('button', { name: '新对话', exact: true }).click()
   await page.getByRole('textbox', { name: '聊天消息' }).fill('fixture_browser_question')
   await page.getByRole('button', { name: '发送', exact: true }).click()
   await page.getByText('请选择用途', { exact: true }).waitFor({ timeout: 30000 })
   await page.getByRole('radio', { name: /生活/ }).click()
   await page.getByRole('button', { name: '提交', exact: true }).click()
   await page.getByText('请选择用途', { exact: true }).waitFor({ state: 'detached' })
   console.log('PASS Agent 问询卡片与用户答复走受认证通道')
   await import('./ts-resolve-hook.mjs')
   const { WEALTH_INVESTMENT_AGREEMENT } = await import('../app/src/lib/wealth.ts')
   const q = (await api(bank, '/api/wealth/risk/questions', a.token)).data
   await api(bank, '/api/wealth/risk/assess', a.token, { answers: q.map(x => x.options.reduce((best, o, i, all) => o.score > all[best].score ? i : best, 0)) })
   const sms = (await api(bank, '/api/auth/sms-code', a.token, { phone: a.user.phone })).data
   const face = (await api(bank, '/api/security/verify', a.token, { channel: 'face' })).data
   const open = await api(bank, '/api/wealth/account/open', a.token, { smsCode: sms.demoCode, faceTicket: face.ticket, settlementAccountId: accounts[0].id, agreement: WEALTH_INVESTMENT_AGREEMENT })
   assert.equal(open.status, 200)
   const products = (await api(bank, '/api/wealth/products', a.token)).data
   const product = products.find(x => x.openEnded)
   fixtures.fixture_browser_wealth = { name: 'bank_wealth_subscribe', args: { productCode: product.code, amountCents: Math.max(product.minAmount, product.stepAmount) } }
   await page.getByRole('button', { name: '新对话', exact: true }).click()
   await page.getByRole('textbox', { name: '聊天消息' }).fill('fixture_browser_wealth')
   await page.getByRole('button', { name: '发送', exact: true }).click()
   await page.getByText('需要你确认：申购理财产品', { exact: true }).waitFor({ timeout: 30000 })
   for (let i=0;i<6;i++) await page.locator('input[type="password"]').nth(i).fill('8')
   assert(await approve.isDisabled())
   const acknowledgement = (await api(bank, '/api/agent/wealth/requirements', a.token)).data.riskAcknowledgementText
   await page.getByRole('textbox', { name: '风险确认语句' }).fill(acknowledgement)
   assert(await approve.isEnabled())
   await approve.click()
   await page.getByText('需要你确认：申购理财产品', { exact: true }).waitFor({ state: 'detached' })
   for (let n=0;n<100;n++) { if((await api(bank, '/api/wealth/overview', a.token)).data.holdings.length>0)break;await new Promise(r=>setTimeout(r,100)) }
   assert((await api(bank, '/api/wealth/overview', a.token)).data.holdings.length>0)
   assert.deepEqual(pageErrors, [])
   console.log('PASS 手机申购卡必须用户抄录且验密，成功后产生后端持仓')

 }
 console.log('ALL PASS')
}catch(error){console.error(agentLog);throw error}finally{await browser?.close();await vite?.close();controllers.forEach(c=>c.abort());processes.reverse().forEach(c=>c.kill('SIGTERM'));await Promise.all(processes.map(c=>new Promise(r=>c.exitCode===null?c.once('exit',r):r())));provider.closeAllConnections();await new Promise(r=>provider.close(r));await rm(tmp,{recursive:true,force:true})}
