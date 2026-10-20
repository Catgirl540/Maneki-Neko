import { fixture as bankFixture } from '../server/testing/http-fixture.mjs'
import { createPgClient } from '../server/pg-client.mjs'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
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
const sessionUrl = process.env.LUCKYCAT_SESSION_TEST_DATABASE_URL
if (!sessionUrl || !/^postgres(?:ql)?:$/.test(new URL(sessionUrl).protocol)) throw new Error('LUCKYCAT_SESSION_TEST_DATABASE_URL must specify its dedicated disposable PostgreSQL database')
assert.match(new URL(sessionUrl).pathname, /^\/maneki_ai_sessions_test(?:_[a-z0-9_]+)?$/, 'Agent regression requires its dedicated disposable session database')
const sessionDb = createPgClient(sessionUrl)
const backend = await bankFixture()
assert.match((await sessionDb.query('SELECT current_database() AS name')).rows[0].name, /^maneki_ai_sessions_test(?:_[a-z0-9_]+)?$/)
await sessionDb.query('DROP SCHEMA IF EXISTS ai_sessions CASCADE')
await sessionDb.query(await readFile(new URL('../framework/bridge/session-schema.sql', import.meta.url), 'utf8'))
const sessionKey = randomBytes(32).toString('base64')
const agentPort = await free(), providerPort = await free()
const processes=[]; let agentLog='';let modelRequests=[];let fixtures={};const counters={}; let vite, browser
const provider=http(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);modelRequests.push(data)
 const content=JSON.stringify(data.messages); const which=Object.keys(fixtures).find(x=>content.includes(x))
 if(!which){res.writeHead(400);res.end(JSON.stringify({error:{message:'unknown fixture'}}));return}
 const first=(counters[which]=(counters[which]??0)+1)===1
 const tool=fixtures[which]
 if (tool.failAlways || tool.failAt?.includes(counters[which])) {
   if (tool.failDelayMs) await new Promise(r=>setTimeout(r,tool.failDelayMs))
   res.writeHead(tool.status ?? 503, {'content-type':'application/json'})
   res.end(JSON.stringify({error:{message:'fixture transient failure',type:'server_error'}}));return
 }
 res.writeHead(200,{'content-type':'text/event-stream'})
 const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:1,model:'luckycat-test',choices:[{index:0,delta,finish_reason}]})}\n\n`)
 const useTool = first && !!tool.name
 send({role:'assistant',...(useTool?{tool_calls:[{index:0,id:`call_${which}`,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]}:{content:'已根据账户服务返回的结果'})})
 if (!useTool) { await new Promise(r => setTimeout(r, 100)); send({content:'完成处理。'}) }
 send({},useTool?'tool_calls':'stop');res.end('data: [DONE]\n\n')
}); await new Promise(r=>provider.listen(providerPort,'127.0.0.1',r))
const start=(file,env)=>{const c=spawn(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});processes.push(c);c.stdout.on('data',x=>agentLog+=x);c.stderr.on('data',x=>agentLog+=x);return c}
const bank=backend.base, agent=`http://127.0.0.1:${agentPort}`
const api=async(base,path,token,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()}}
const ready=async(base,path,token)=>{for(let n=0;n<100;n++){try{if((await api(base,path,token)).status===200)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error(agentLog)}
const controllers=[]
try{
 await ready(bank,'/health')
 const login=async phone=>{const sms=(await api(bank,'/api/auth/sms-code',null,{phone})).data;return (await api(bank,'/api/auth/login',null,{phone,password:'123456',smsCode:sms.demoCode})).data}
 const a=await login('13800138000'),b=await login('13600136000');const accounts=(await api(bank,'/api/accounts',a.token)).data,other=(await api(bank,'/api/accounts',b.token)).data
 fixtures={fixture_balance:{name:'bank_get_balance',args:{}},fixture_transfer:{name:'bank_transfer',args:{fromAccountId:accounts[0].id,payeeName:b.user.name,payeeAccountNo:other[0].accountNo,payeeBankCode:'LCB',payeeBankRegion:'CN',amountCents:500,memo:'runtime check'}},fixture_question:{name:'ask_user_question',args:{questions:[{id:'purpose',question:'请选择用途',options:[{label:'生活',description:'日常支出'},{label:'其他',description:'其他用途'}]}]}}}
 const patch=join(tmp,'provider.yml');await writeFile(patch,`- id: llm-pi-ai\n  config:\n    providers:\n      test:\n        apiKeyEnv: LUCKYCAT_TEST_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${providerPort}/v1\n        retryPolicy:\n          mode: normal\n          maxRetries: 3\n          retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]\n          backoff:\n            initialDelayMs: 250\n            maxDelayMs: 500\n            jitterRatio: 0\n        models:\n          - id: luckycat-test\n            name: Test\n            input: [text, image]\n            contextWindow: 128000\n- id: luckycat-rag\n  disabled: true\n- id: luckycat-embedding\n  disabled: true\n`)
 start('framework/bridge/demo-server.mjs',{LUCKYCAT_DEMO_PORT:String(agentPort),LUCKYCAT_BANK_URL:bank,LUCKYCAT_SESSION_DATABASE_URL:sessionUrl,LUCKYCAT_SESSION_DATA_KEY:sessionKey,LUCKYCAT_PROVIDER:'test',LUCKYCAT_MODEL:'luckycat-test',LUCKYCAT_TEST_KEY:'test-only',LUCKYCAT_PATCHES:patch,LUCKYCAT_DISABLE_VOICE:'1',LUCKYCAT_SESSION_DIR:join(tmp,'context')})
 await ready(agent,'/agent-api/health',a.token);assert.equal((await api(agent,'/agent-api/health')).status,401);assert.equal((await api(agent,'/consent/challenge',null,{})).status,403)
 if (!process.argv.includes('--browser-only')) {
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
 await wait(e=>e.type==='status'&&e.status==='idle');assert(events.some(e=>e.type==='assistant-update'&&e.text));console.log('PASS 实际 Harness → 确认卡 → HTTP 工具 → SSE 流式返回账户数据')
 // Product comparison uses the actual catalog and risk snapshot and never submits a purchase.
 const comparisonProducts = (await api(bank, '/api/wealth/products', a.token)).data
 assert(comparisonProducts.length >= 2)
 fixtures.fixture_compare_products = { name: 'bank_wealth_compare', args: { firstProductCode: comparisonProducts[0].code, secondProductCode: comparisonProducts[1].code, amountCents: 1000000 } }
 const compareSession = (await api(agent, '/agent-api/sessions', a.token, {})).data.sessionId
 const holdingsBeforeCompare = (await api(bank, '/api/wealth/overview', a.token)).data.holdings
 await api(agent, `/agent-api/sessions/${compareSession}/messages`, a.token, { text: 'fixture_compare_products', serviceIds: ['wealth'] })
 let compareCursor = '0', compareApproved = false
 const compareEvents = []
 for (let i = 0; i < 150; i++) {
   const batch = (await api(agent, `/agent-api/sessions/${compareSession}/events?after=${compareCursor}`, a.token)).data
   compareCursor = batch.cursor; compareEvents.push(...batch.events)
   const card = compareEvents.find(e => e.type === 'consent')
   if (card && !compareApproved) {
     assert.equal(card.challenge.toolName, 'bank_wealth_compare')
     assert.equal(card.challenge.verification, undefined)
     assert.equal((await api(agent, `/agent-api/consent/${card.challenge.challengeId}`, a.token, { decision: 'approve' })).status, 200)
     compareApproved = true
   }
   if (compareEvents.some(e => e.type === 'tool-result') && compareEvents.some(e => e.type === 'status' && e.status === 'idle')) break
   await new Promise(r => setTimeout(r, 100))
 }
 const comparedTool = compareEvents.find(e => e.type === 'tool-result')
 assert(comparedTool && !comparedTool.isError, JSON.stringify(compareEvents))
 const comparison = JSON.parse(comparedTool.text).result
 assert.deepEqual(comparison.products.map(p => p.code), comparisonProducts.slice(0, 2).map(p => p.code))
 assert.deepEqual(comparison.products[0].transactionFees, comparisonProducts[0].transactionFees)
 assert.deepEqual(comparison.riskAssessment, summarizeRiskAssessment((await api(bank, '/api/wealth/overview', a.token)).data.risk))
 assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, accounts[0].balance)
 assert.deepEqual((await api(bank, '/api/wealth/overview', a.token)).data.holdings, holdingsBeforeCompare)
 console.log('PASS Harness 理财对比返回真实产品、费率与适当性，未申购或扣款')
 // Renewal analysis uses the current customer's actual contracts and creates no reminder/write.
 const contractsBefore = (await api(bank, '/api/autodebits', a.token)).data
 fixtures.fixture_renewals = { name: 'bank_analyze_autodebits', args: { days: 30 } }
 const renewalSession = (await api(agent, '/agent-api/sessions', a.token, {})).data.sessionId
 await api(agent, `/agent-api/sessions/${renewalSession}/messages`, a.token, { text: 'fixture_renewals', serviceIds: ['analysis'] })
 let renewalCursor = '0', renewalApproved = false
 const renewalEvents = []
 for (let i = 0; i < 150; i++) {
   const batch = (await api(agent, `/agent-api/sessions/${renewalSession}/events?after=${renewalCursor}`, a.token)).data
   renewalCursor = batch.cursor; renewalEvents.push(...batch.events)
   const card = renewalEvents.find(e => e.type === 'consent')
   if (card && !renewalApproved) {
     assert.equal(card.challenge.toolName, 'bank_analyze_autodebits')
     assert.equal(card.challenge.verification, undefined)
     assert.equal((await api(agent, `/agent-api/consent/${card.challenge.challengeId}`, b.token, { decision: 'approve' })).status, 404)
     assert.equal((await api(agent, `/agent-api/consent/${card.challenge.challengeId}`, a.token, { decision: 'approve' })).status, 200)
     renewalApproved = true
   }
   if (renewalEvents.some(e => e.type === 'tool-result') && renewalEvents.some(e => e.type === 'status' && e.status === 'idle')) break
   await new Promise(r => setTimeout(r, 100))
 }
 const renewalTool = renewalEvents.find(e => e.type === 'tool-result')
 assert(renewalTool && !renewalTool.isError, JSON.stringify(renewalEvents))
 const renewals = JSON.parse(renewalTool.text).result
 assert.equal(renewals.scope, 'owned-bank-autodebit-contracts')
 assert.equal(renewals.timeZone, 'Asia/Shanghai')
 assert.equal(renewals.reminderCreated, false)
 assert.deepEqual(renewals.items.map(item => item.id).sort(), contractsBefore.map(item => item.id).sort())
 for (const item of renewals.items) {
   const source = contractsBefore.find(row => row.id === item.id)
   assert.equal(item.merchant, source.merchant); assert.equal(item.amountCents, source.amount)
   assert.equal(item.enabled, source.enabled); assert.equal(item.nextRunAt, source.nextRunAt)
   if (!source.enabled) assert.equal(item.status, 'disabled')
 }
 assert.deepEqual((await api(bank, '/api/autodebits', a.token)).data, contractsBefore)
 assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, accounts[0].balance)
 console.log('PASS Harness 续费清单返回本人真实合约、启停和日期，跨客户确认被拒绝，未改合约或扣款')
 // Review an actual bounded bank page without manufacturing transaction evidence.
 fixtures.fixture_review = { name: 'bank_review_transactions', args: { accountId: accounts[0].id, limit: 20 } }
 const reviewSource = (await api(bank, `/api/accounts/${accounts[0].id}/transactions?page=1&size=20`, a.token)).data
 const reviewSession = (await api(agent, '/agent-api/sessions', a.token, {})).data.sessionId
 await api(agent, `/agent-api/sessions/${reviewSession}/messages`, a.token, { text: 'fixture_review', serviceIds: ['analysis'] })
 let reviewCursor = '0', reviewApproved = false
 const reviewEvents = []
 for (let i = 0; i < 150; i++) {
   const batch = (await api(agent, `/agent-api/sessions/${reviewSession}/events?after=${reviewCursor}`, a.token)).data
   reviewCursor = batch.cursor; reviewEvents.push(...batch.events)
   const card = reviewEvents.find(event => event.type === 'consent')
   if (card && !reviewApproved) {
     assert.equal(card.challenge.toolName, 'bank_review_transactions')
     assert.equal(card.challenge.verification, undefined)
     assert.equal((await api(agent, `/agent-api/consent/${card.challenge.challengeId}`, b.token, { decision: 'approve' })).status, 404)
     assert.equal((await api(agent, `/agent-api/consent/${card.challenge.challengeId}`, a.token, { decision: 'approve' })).status, 200)
     reviewApproved = true
   }
   if (reviewEvents.some(event => event.type === 'tool-result') && reviewEvents.some(event => event.type === 'status' && event.status === 'idle')) break
   await new Promise(resolve => setTimeout(resolve, 100))
 }
 const reviewTool = reviewEvents.find(event => event.type === 'tool-result')
 assert(reviewTool && !reviewTool.isError, JSON.stringify(reviewEvents))
 const reviewed = JSON.parse(reviewTool.text).result
 assert.equal(reviewed.scope, 'owned-account-transaction-sample')
 assert.equal(reviewed.accountId, accounts[0].id); assert.equal(reviewed.currency, accounts[0].currency)
 assert.equal(reviewed.coverage.returnedCount, reviewSource.items.length)
 assert.equal(reviewed.coverage.bankTotal, reviewSource.total)
 assert.equal(reviewed.coverage.truncated, reviewSource.items.length < reviewSource.total)
 const allEvidence = [...reviewed.duplicateCandidates.flatMap(group => group.transactions), ...reviewed.amountSpikeCandidates.flatMap(item => [item.transaction, ...item.priorEvidence])]
 for (const item of allEvidence) {
   const source = reviewSource.items.find(row => row.id === item.transactionId)
   assert(source); assert.equal(item.amountCents, source.amount); assert.equal(item.createdAt, source.createdAt)
 }
 assert.deepEqual((await api(bank, `/api/accounts/${accounts[0].id}/transactions?page=1&size=20`, a.token)).data, reviewSource)
 assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, accounts[0].balance)
 console.log('PASS Harness 流水核查返回实际样本范围和交易依据，跨客户确认被拒，无流水或余额变更')
 // Exercise the full plan-only lifecycle through real Harness and authenticated bank HTTP.
 let originalRisk, originalWealthAccount
 await backend.editCustomer(a.user.id, profile => {
   originalRisk = structuredClone(profile.riskAssessment); originalWealthAccount = structuredClone(profile.wealthAccount)
   profile.wealthAccount.opened = true
   profile.riskAssessment = { done: true, level: 'C3', score: 50, assessedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }
 })
 const investmentBefore = (await api(bank, '/api/wealth/investments', a.token)).data
 const invokeBankTool = async (name, toolName, args, password, serviceIds = ['wealth']) => {
   fixtures[name] = { name: toolName, args }
   const sid = (await api(agent, '/agent-api/sessions', a.token, {})).data.sessionId
   const collected = []; let cursor = '0', approved = false
   await api(agent, `/agent-api/sessions/${sid}/messages`, a.token, { text: name, serviceIds })
   for (let i = 0; i < 150; i++) {
     const batch = (await api(agent, `/agent-api/sessions/${sid}/events?after=${cursor}`, a.token)).data
     cursor = batch.cursor; collected.push(...batch.events)
     const card = collected.find(event => event.type === 'consent')
     if (card && !approved) {
       assert.equal(card.challenge.toolName, toolName)
       assert.equal(card.challenge.verification, password ? 'payment-password' : undefined)
       assert.equal((await api(agent, `/agent-api/consent/${card.challenge.challengeId}`, b.token, { decision: 'approve' })).status, 404)
       assert.equal((await api(agent, `/agent-api/consent/${card.challenge.challengeId}`, a.token, { decision: 'approve', ...(password ? { paymentPassword: password } : {}) })).status, 200)
       approved = true
     }
     if (collected.some(event => event.type === 'tool-result') && collected.some(event => event.type === 'status' && event.status === 'idle')) break
     await new Promise(resolve => setTimeout(resolve, 100))
   }
   const result = collected.find(event => event.type === 'tool-result')
   assert(result && !result.isError, JSON.stringify(collected))
   return JSON.parse(result.text)
 }
 const planCatalog = await invokeBankTool('fixture_plan_catalog', 'bank_list_investments', {})
 assert.equal(planCatalog.result.executionMode, 'plan-only')
 const planProduct = investmentBefore.products.find(product => product.risk === 'low')
 assert(planProduct)
 const createdPlan = await invokeBankTool('fixture_plan_create', 'bank_create_invest_plan', { productCode: planProduct.code, accountId: accounts[0].id, amountCents: planProduct.minAmount, cycle: '每周' }, '888888')
 assert.equal(createdPlan.result.status, 'active'); assert.match(createdPlan.notice, /自动扣款尚未开放/)
 const planId = createdPlan.result.id
 assert.equal((await invokeBankTool('fixture_plan_pause', 'bank_update_invest_plan', { planId, status: 'paused' })).result.status, 'paused')
 assert.equal((await invokeBankTool('fixture_plan_resume', 'bank_update_invest_plan', { planId, status: 'active' }, '888888')).result.status, 'active')
 assert.equal((await invokeBankTool('fixture_plan_cancel', 'bank_update_invest_plan', { planId, status: 'cancelled' })).result.status, 'cancelled')
 const plansAfter = (await api(bank, '/api/wealth/investments', a.token)).data.plans
 assert.equal(plansAfter.length, investmentBefore.plans.length + 1)
 assert.equal(plansAfter.find(plan => plan.id === planId).executedRuns, 0)
 assert.equal(plansAfter.find(plan => plan.id === planId).totalInvested, 0)
 assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, accounts[0].balance)
 await backend.editCustomer(a.user.id, profile => { profile.riskAssessment = originalRisk; profile.wealthAccount = originalWealthAccount })
 console.log('PASS Harness 定投目录 → 验密保存 → 暂停 → 验密恢复 → 取消，跨客户确认被拒，无扣款或虚构执行')
 for (const [marker, tool, args, path] of [
   ['fixture_stats_month', 'bank_get_spending', { month: '2025-12' }, '/api/analysis/spending?month=2025-12'],
   ['fixture_stats_flow', 'bank_get_cashflow', { days: 30 }, '/api/analysis/cashflow?days=30'],
 ]) {
   const actual = (await invokeBankTool(marker, tool, args, undefined, ['analysis'])).result
   const source = (await api(bank, path, a.token)).data
   assert.equal(actual.timeZone, 'Asia/Shanghai')
   assert(!Number.isNaN(Date.parse(actual.asOf)))
   const withoutAsOf = value => JSON.parse(JSON.stringify(value), (key, child) => key === 'asOf' ? undefined : child)
   assert.deepEqual(withoutAsOf(actual), withoutAsOf(source))
   if (tool === 'bank_get_spending') {
     assert.equal(actual.previousMonth, '2025-11'); assert.equal(actual.trend.at(-1).month, '2025-12')
     assert.equal(actual.byCurrency.USD.monthOverMonthComparable, false)
   } else assert.equal(actual.points.length, 30)
 }
 assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, accounts[0].balance)
 console.log('PASS Harness 历史月份与现金流返回真实分币种统计、北京时间和无基数状态，查询不扣款')
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
 const { amountCents: _omittedAmount, ...withoutAmount } = fixtures.fixture_transfer.args
 fixtures.fixture_missing_amount = { name: 'bank_transfer', args: withoutAmount }
 fixtures.fixture_quote_failure = { name: 'bank_transfer', args: { ...withoutAmount, amountCents: 200000000 } }
 fixtures.fixture_cancel_transfer = { name: 'bank_transfer', args: { ...withoutAmount, amountCents: 500 } }
 fixtures.fixture_cross_review = { name: 'bank_review_transactions', args: { accountId: other[0].id, limit: 20 } }
 const unchanged = (await api(bank, '/api/accounts', a.token)).data[0].balance
 for (const [name, expected] of [['fixture_missing_amount', /amountCents/], ['fixture_quote_failure', /单笔上限/], ['fixture_cancel_transfer', /用户取消了这次操作/], ['fixture_cross_review', /账户|不存在/]]) {
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
 console.log('PASS 缺金额、准备失败、用户取消和跨客户流水请求均拒绝，失败原因真实且未扣款')
 fixtures.fixture_auto_recover = { failAt: [1, 2] }
 fixtures.fixture_auto_exhaust = { failAlways: true }
 fixtures.fixture_auth_failure = { failAlways: true, status: 401 }
 fixtures.fixture_auto_payment = { ...fixtures.fixture_transfer, args: { ...withoutAmount, amountCents: 700 }, failAt: [2, 3] }
 fixtures.fixture_auto_cancel = { failAlways: true, failDelayMs: 500 }
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
 fixtures.fixture_image = {}
 const imageSession = (await api(agent, '/agent-api/sessions', a.token, {})).data.sessionId
 const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAn0lEQVRoge2SQQkAQRDDKqJiT1gEroh7hIFCBKSh6cdpoht0A9ArdhfiLtENugHoFbsLcZfoBt0A9IrdhbhLdINuAHrF7kLcJbpBNwC9Ynch7hLdoBuAXrG7EHeJbtANQK/YXYi7RDfoBqBX7C7EXaIbdAPQK3YX4i7RDboB6BW7C3GX6AbdAPSK3YW4S3SDbgB6xe5C3CW6QTcAveIfHnbOAS1j/WHTAAAAAElFTkSuQmCC' }
 assert.equal((await api(agent, `/agent-api/sessions/${imageSession}/messages`, b.token, { text: 'fixture_image', image })).status, 404)
 assert.equal((await api(agent, `/agent-api/sessions/${imageSession}/messages`, a.token, { text: 'fixture_image', image })).status, 202)
 let imageEvents
 for (let n=0;n<200;n++) {
   imageEvents = (await api(agent, `/agent-api/sessions/${imageSession}/events?after=0`, a.token)).data.events
   if (imageEvents.some(e=>e.type==='status'&&e.status==='idle')) break
   await new Promise(r=>setTimeout(r,50))
 }
 assert(!imageEvents.some(e=>e.type==='error'), JSON.stringify(imageEvents))
 assert(imageEvents.some(e=>e.type==='assistant'&&e.text))
 assert(modelRequests.some(req=>req.messages.some(message=>Array.isArray(message.content)&&message.content.some(block=>block.type==='image_url'&&block.image_url.url.includes(image.data)))))
 assert(!JSON.stringify(modelRequests).includes(a.token))
 console.log('PASS 图片内联进入模型上下文，跨客户发送被拒，流式结果持久化')
 }
 if (process.argv.includes('--browser') || process.argv.includes('--browser-only')) {
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
   await gotoInApp(page, '/accounts')
   const accountSummary = page.getByRole('region', { name: '账户余额', exact: true })
   await accountSummary.waitFor()
   await accountSummary.getByRole('button', { name: '显示', exact: true }).click()
   const value = ((bankBalance-700)/100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
   assert((await accountSummary.innerText()).includes(value))
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
   let smsResponse = await api(bank, '/api/auth/sms-code', a.token, { phone: a.user.phone })
   if (smsResponse.status === 429 && smsResponse.data.code === 'SMS_TOO_FREQUENT') {
     // Login consumed its code; respect the bank's resend interval before wealth opening.
     await new Promise(resolve => setTimeout(resolve, 60000))
     smsResponse = await api(bank, '/api/auth/sms-code', a.token, { phone: a.user.phone })
   }
   assert.equal(smsResponse.status, 200)
   const sms = smsResponse.data
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

   await page.setViewportSize({ width: 1280, height: 900 })
   await gotoInApp(page, '/wealth/investments')
   await page.getByRole('heading', { name: '投资与定投', exact: true }).waitFor()
   await page.getByText(/当前仅保存和管理计划/).waitFor()
   const uiPlansBefore = (await api(bank, '/api/wealth/investments', a.token)).data.plans
   const planProduct = (await api(bank, '/api/wealth/investments', a.token)).data.products.find(product => product.risk === 'low')
   assert(planProduct)
   const uiBalanceBefore = (await api(bank, '/api/accounts', a.token)).data[0].balance
   await page.getByRole('heading', { name: planProduct.name, exact: true }).locator('../..').getByRole('button', { name: '新建计划', exact: true }).click()
   const fillPlanPin = async value => { for (let i = 0; i < 6; i++) await page.getByRole('dialog').locator('input[type="password"]').nth(i).fill(value) }
   await fillPlanPin('0')
   await page.getByRole('button', { name: '确认创建', exact: true }).click()
   await page.getByRole('alert').filter({ hasText: /支付密码不正确/ }).waitFor()
   assert.equal((await api(bank, '/api/wealth/investments', a.token)).data.plans.length, uiPlansBefore.length)
   await fillPlanPin('8')
   await page.getByRole('button', { name: '确认创建', exact: true }).click()
   await page.getByRole('heading', { name: '计划已保存', exact: true }).waitFor()
   await page.getByRole('button', { name: '完成', exact: true }).click()
   const uiPlan = (await api(bank, '/api/wealth/investments', a.token)).data.plans.find(plan => !uiPlansBefore.some(previous => previous.id === plan.id))
   assert(uiPlan)
   const planRow = action => page.locator('div.flex.items-center.gap-4.py-4').filter({ has: page.getByText(planProduct.name, { exact: true }) }).filter({ has: page.getByRole('button', { name: action, exact: true }) })
   const waitPlanStatus = async status => {
     for (let i = 0; i < 100; i++) {
       if ((await api(bank, '/api/wealth/investments', a.token)).data.plans.find(plan => plan.id === uiPlan.id)?.status === status) return
       await new Promise(resolve => setTimeout(resolve, 100))
     }
     throw new Error(`UI plan did not reach ${status}`)
   }
   await planRow('暂停').getByRole('button', { name: '暂停', exact: true }).click()
   await page.getByRole('button', { name: '确认暂停', exact: true }).click()
   await waitPlanStatus('paused')
   await planRow('恢复').getByRole('button', { name: '恢复', exact: true }).click()
   await page.getByRole('button', { name: '确认恢复', exact: true }).click()
   await page.getByRole('alert').filter({ hasText: /请输入 6 位支付密码/ }).waitFor()
   await fillPlanPin('8')
   await page.getByRole('button', { name: '确认恢复', exact: true }).click()
   await waitPlanStatus('active')
   await planRow('暂停').getByRole('button', { name: '取消计划', exact: true }).click()
   await page.getByText(/取消后不可恢复/).waitFor()
   await page.getByRole('button', { name: '确认取消计划', exact: true }).click()
   await waitPlanStatus('cancelled')
   await page.getByRole('dialog').waitFor({ state: 'hidden' })
   assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, uiBalanceBefore)
   assert.deepEqual(pageErrors, [])
   await page.getByRole('heading', { name: '投资与定投', exact: true }).scrollIntoViewIfNeeded()
   await page.screenshot({ path: join(root, '.generated/local-postgres/invest-plans-20261020.png'), fullPage: true })
   console.log('PASS 桌面定投页面错密码拒绝 → 保存 → 暂停 → 恢复验密 → 取消，余额不变且无页面异常')

   await gotoInApp(page, '/analysis/statistics')
   await page.getByRole('heading', { name: '收支分析', exact: true }).waitFor()
   const stats = (await api(bank, '/api/analysis/spending', a.token)).data
   const spendRegion = () => page.getByRole('region', { name: `${stats.month} CNY 支出统计`, exact: true })
   const money = (amount, symbol) => symbol + (amount / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
   await spendRegion().getByText(money(stats.total, '¥'), { exact: true }).first().waitFor()
   assert(await spendRegion().getByText(money(stats.total, '¥'), { exact: true }).count() >= 1)
   await page.getByRole('tab', { name: '美元 USD', exact: true }).click()
   const usd = page.getByRole('region', { name: `${stats.month} USD 支出统计`, exact: true })
   await usd.getByText('上月无可比支出基数', { exact: true }).waitFor()
   assert(await usd.getByText(money(stats.byCurrency.USD.total, 'US$'), { exact: true }).count() >= 1)
   assert(!(await usd.innerText()).includes('¥'))
   await page.getByRole('tab', { name: '近 30 天', exact: true }).click()
   const chart = page.getByRole('group', { name: /USD 现金流图，共 30 天/ })
   await chart.waitFor(); await chart.focus(); await chart.press('ArrowRight')
   assert((await chart.innerText()).includes('US$'))
   await page.getByRole('tab', { name: '港币 HKD', exact: true }).click()
   await page.getByRole('region', { name: `${stats.month} HKD 支出统计`, exact: true }).getByText(money(stats.byCurrency.HKD.total, 'HK$'), { exact: true }).first().waitFor()
   await page.getByLabel('支出月份', { exact: true }).fill('2025-12')
   const old = page.getByRole('region', { name: '2025-12 HKD 支出统计', exact: true })
   await old.waitFor(); await old.getByText('上月无可比支出基数', { exact: true }).waitFor()
   await page.route('**/api/analysis/spending?month=2025-11', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'statistics fixture unavailable', code: 'TEST_UNAVAILABLE' }) }))
   await page.getByLabel('支出月份', { exact: true }).fill('2025-11')
   await page.getByRole('alert').filter({ hasText: '数据暂时无法加载' }).waitFor()
   assert.equal(await old.count(), 0)
   assert.equal(await page.getByRole('region', { name: /2025-11 HKD 支出统计/ }).count(), 0)
   await page.unroute('**/api/analysis/spending?month=2025-11')
   await page.getByRole('button', { name: '重新加载', exact: true }).click()
   await page.getByRole('region', { name: '2025-11 HKD 支出统计', exact: true }).waitFor()
   assert.equal((await api(bank, '/api/accounts', a.token)).data[0].balance, uiBalanceBefore)
   assert.deepEqual(pageErrors, [])
   await page.getByRole('heading', { name: '收支分析', exact: true }).scrollIntoViewIfNeeded()
   await page.screenshot({ path: join(root, '.generated/local-postgres/statistics-20261020.png'), fullPage: true })
   console.log('PASS 统计页真实月份/币种切换、外币图表和无基数提示，接口失败不冒充旧月份或零金额，重试恢复且无资金变动')

 }
 console.log(process.argv.includes('--browser-only') ? 'ALL PASS (browser scope only)' : 'ALL PASS')
}catch(error){console.error(agentLog);throw error}finally{await browser?.close();await vite?.close();controllers.forEach(c=>c.abort());processes.reverse().forEach(c=>c.kill('SIGTERM'));await Promise.all(processes.map(c=>new Promise(r=>c.exitCode===null?c.once('exit',r):r())));provider.closeAllConnections();await new Promise(r=>provider.close(r));await backend.close();await sessionDb.query('DROP SCHEMA IF EXISTS ai_sessions CASCADE');await sessionDb.close();await rm(tmp,{recursive:true,force:true})}
