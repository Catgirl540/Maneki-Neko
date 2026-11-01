/** Browser fixture for staff IM: no external model, real customer data or WeChat delivery. */
import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { createServer } from '../staff/node_modules/vite/dist/node/index.js'
import { chromium } from 'playwright-core'
import { loadImVendor } from '../framework/bridge/im-channels.mjs'
const root=resolve(import.meta.dirname,'..'),output=join(root,'.generated/staff-im-checks')
await mkdir(output,{recursive:true})
Object.assign(process.env,{VITE_USE_MOCK:'false',VITE_API_BASE_URL:'',VITE_BASE_PATH:'/'})
const web=await createServer({root:join(root,'staff'),configFile:join(root,'staff/vite.config.ts'),logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false}})
const qrImage=await(await loadImVendor()).qrImage('fixture:staff-im-only')
const staff=[{id:'staff_wang',name:'王小明',role:'csr'},{id:'staff_li',name:'李主管',role:'supervisor'}]
const state={bindings:[],qr:null,claims:0,tests:0,prefs:{enabled:true,quiet_start:null,quiet_end:null,urgent_override:false,version:1,binding:null},rules:{csrIds:[],supervisorIds:['staff_li'],start:'00:00',end:'00:00',version:1},writes:[],confirmed:false,disabled:false,disabledStatus:503,qrFailure:null}
const imOffNotice='员工微信 IM 尚未启用。请联系运维在员工桥接服务开通后刷新本页；在此之前不会生成二维码，也不会发送任务提醒。'
const errors=[];let browser
async function install(page){
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/staff-api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,body=req.postDataJSON(),method=req.method()
    let data,status=200
    if(path==='/staff-api/me'){status=401;data={message:'fixture logged out'}}
    else if(path==='/staff-api/login'){const person=staff.find(v=>v.name===body.name);data={token:'fixture-'+person.id,staff:person}}
    else if(path==='/staff-api/logout')data={ok:true}
    else if(path==='/staff-api/tickets')data=[]
    else if(path==='/staff-api/workbench')data={pending:0,mine:0,waiting:0,resolved:0,asOf:new Date().toISOString(),scope:'fixture'}
    else if(path==='/staff-api/im/notification-preferences'){
      if(method==='PATCH'){assert.equal(body.confirmed,true);state.writes.push('prefs');state.prefs={...state.prefs,enabled:body.enabled,quiet_start:body.quietStart,quiet_end:body.quietEnd,urgent_override:body.urgentOverride,version:state.prefs.version+1};data={ok:true}}
      else data=state.prefs
    }else if(path==='/staff-api/im/notification-rules'){
      if(method==='PUT'){assert.equal(body.confirmed,true);state.writes.push('rules');state.rules={...body,version:state.rules.version+1};data={ok:true}}
      else data={rules:state.rules,staff}
    }else if(path==='/staff-api/im/notifications')data={items:state.bindings.length?[{id:'notice-1',kind:'customer_message',resource_type:'ticket',resource_id:'T_fixture',staff_id:'staff_wang',status:'unknown',created_at:new Date().toISOString(),task_status:'processing',error_code:'DELIVERY_UNCONFIRMED'}]:[],total:state.bindings.length?1:0,page:1,waitingRecipients:0}
    else{status=404;data={message:'fixture route missing: '+path}}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  })
  await page.route('**/staff-agent-api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),body=req.postDataJSON()
    let data,status=200
    if(state.disabled&&path.startsWith('/staff-agent-api/im/')){await route.fulfill({status:state.disabledStatus,contentType:'application/json',body:JSON.stringify(state.disabledStatus===404?{error:'未知路径：GET /agent-api/im/bindings'}:{error:'员工微信 IM 尚未启用',code:'IM_DISABLED'})});return}
    if(state.qrFailure&&path==='/staff-agent-api/im/weixin/qr'&&method==='POST'){const {status,...body}=state.qrFailure;await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});return}
    if(path==='/staff-agent-api/im'){
      const html=(await readFile(join(root,'framework/bridge/im-portal.html'),'utf8')).replace('<html lang="zh-CN">','<html lang="zh-CN" data-audience="staff">').replace('src="/agent-api/im/portal.js"','src="/staff-agent-api/im/portal.js"')
      await route.fulfill({contentType:'text/html',body:html});return
    }
    if(path==='/staff-agent-api/im/portal.js'){await route.fulfill({contentType:'text/javascript',body:await readFile(join(root,'framework/bridge/im-portal.js'),'utf8')});return}
    if(path==='/staff-agent-api/im/auth/login')data={token:'fixture-staff',name:'王小明',role:'csr'}
    else if(path==='/staff-agent-api/im/bindings')data=state.bindings
    else if(path==='/staff-agent-api/im/weixin/qr'&&method==='POST'){state.qr={attemptId:'fixture-qr',status:'pending',qrImage,expiresAt:Date.now()+300000};data=state.qr}
    else if(path.endsWith('/confirm')){assert.equal(body.confirmed,true);state.claims++;const binding={id:'im-fixture',sessionId:'staff-session',label:'微信私聊 · 夹具',connected:true,notificationReady:false};state.bindings=[binding];state.prefs.binding={id:binding.id};data=binding}
    else if(path.endsWith('/cancel')){state.qr.status='cancelled';data=state.qr}
    else if(path==='/staff-agent-api/im/weixin/qr/fixture-qr')data=state.qr
    else if(path.endsWith('/test')){assert.equal(body.confirmed,true);state.tests++;data={ok:true}}
    else if(path==='/staff-agent-api/im/bindings/im-fixture'&&method==='DELETE'){state.writes.push('revoke');state.bindings=[];state.prefs.binding=null;data={ok:true}}
    else if(path==='/staff-agent-api/sessions/staff-session/events')data={cursor:state.confirmed?'2':'1',busy:false,events:state.confirmed?[]:[{type:'consent',challenge:{challengeId:'staff-confirm',kind:'代客锁卡',expiresAt:Date.now()+60000,requiresCustomerVerification:true,fields:[{label:'操作员工',value:'王小明 · 客服'},{label:'工单',value:'T_fixture'},{label:'回复正文',value:'<img src=x onerror=alert(1)>仅作为文字显示'}],consequence:'确认后提交员工后台'}}]}
    else if(path==='/staff-agent-api/sessions/staff-session')data={sessionId:'staff-session',known:true,busy:false}
    else if(path==='/staff-agent-api/consent/staff-confirm'){assert.equal(body.customerVerification.result,'passed');assert.equal(body.customerVerification.method,'phone');assert(!Object.hasOwn(body,'paymentPassword'));state.confirmed=true;data={ok:true}}
    else{status=404;data={message:'fixture route missing: '+path}}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  })
}
try{
  await web.listen();const base=`http://127.0.0.1:${web.httpServer.address().port}`
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??process.env.CHROME_BIN??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:1100}});await install(page)
  page.setDefaultTimeout(12000)
  await page.goto(base+'/im');await page.getByLabel('密码',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'登录',exact:true}).click()
  await page.getByRole('heading',{name:'IM 机器人',exact:true}).waitFor()
  assert.equal(await page.getByRole('heading',{name:'团队接收规则',exact:true}).count(),0)
  // IM 已启用时，具体操作的 404 不能把整页误判为未开通。
  state.qrFailure={status:404,error:'扫码任务不存在或不属于当前账户'}
  await page.getByRole('button',{name:'生成微信连接二维码',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'扫码任务不存在或不属于当前账户'}).waitFor()
  assert.equal(await page.getByText(imOffNotice,{exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'生成微信连接二维码',exact:true}).isDisabled(),false)
  assert.equal(await page.getByRole('link',{name:'使用私聊绑定码或打开业务确认页 ↗',exact:true}).count(),1)
  state.qrFailure=null
  await page.getByRole('button',{name:'生成微信连接二维码',exact:true}).click()
  await page.getByRole('img',{name:'本人微信连接二维码'}).waitFor();assert.equal(state.claims,0)
  await page.screenshot({path:join(output,'staff-im-qr.png'),fullPage:true,animations:'disabled'})
  state.qr.status='connected'
  await page.getByRole('button',{name:'绑定本人微信并开通任务提醒',exact:true}).waitFor();assert.equal(state.claims,0)
  await page.getByRole('button',{name:'绑定本人微信并开通任务提醒',exact:true}).click()
  await page.getByText('待私聊激活或连接恢复',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'发送连接测试提醒'}).isDisabled(),true)
  state.bindings[0].notificationReady=true
  await page.getByRole('button',{name:'刷新状态',exact:true}).click();await page.getByText('私聊上下文已建立',{exact:true}).waitFor()
  await page.getByRole('button',{name:'发送连接测试提醒'}).click();assert.equal(state.tests,1)
  await page.getByLabel('开通本人微信任务提醒',{exact:true}).uncheck()
  await page.getByRole('button',{name:'核对并保存本人设置'}).click();assert.equal(state.writes.length,0)
  await page.getByRole('button',{name:'确认保存',exact:true}).click();assert.deepEqual(state.writes,['prefs']);assert.equal(state.prefs.enabled,false)
  await page.getByRole('cell').filter({hasText:'投递结果不确定'}).waitFor()
  await page.screenshot({path:join(output,'staff-im-bound.png'),fullPage:true,animations:'disabled'})
  await page.getByRole('button',{name:'解除连接',exact:true}).click();assert.equal(state.bindings.length,1)
  await page.getByRole('button',{name:'确认解除本人连接'}).click();assert.equal(state.bindings.length,0)
  await page.close()
  const supervisor=await browser.newPage({viewport:{width:1440,height:1100}});await install(supervisor);await supervisor.goto(base+'/im')
  await supervisor.getByLabel('员工姓名',{exact:true}).fill('李主管');await supervisor.getByLabel('密码',{exact:true}).fill('fixture-password');await supervisor.getByRole('button',{name:'登录',exact:true}).click()
  await supervisor.getByRole('heading',{name:'团队接收规则',exact:true}).waitFor();await supervisor.getByLabel('王小明',{exact:true}).check()
  await supervisor.getByRole('button',{name:'核对并保存团队规则'}).click();assert(!state.writes.includes('rules'))
  await supervisor.getByRole('button',{name:'确认保存',exact:true}).click();assert(state.writes.includes('rules'));assert.deepEqual(state.rules.csrIds,['staff_wang'])
  await supervisor.screenshot({path:join(output,'staff-im-supervisor.png'),fullPage:true,animations:'disabled'})
  // 新部署的 503 和旧部署 bindings 探测的 404 都应显示开通指引。
  for(const status of [503,404]){
    state.disabled=true;state.disabledStatus=status
    const disabled=await browser.newPage({viewport:{width:1440,height:1100}});await install(disabled);await disabled.goto(base+'/im')
    await disabled.getByLabel('员工姓名',{exact:true}).fill('王小明');await disabled.getByLabel('密码',{exact:true}).fill('fixture-password');await disabled.getByRole('button',{name:'登录',exact:true}).click()
    await disabled.getByText(imOffNotice,{exact:true}).waitFor()
    assert.equal(await disabled.getByRole('button',{name:'生成微信连接二维码',exact:true}).isDisabled(),true)
    assert.equal(await disabled.getByText(/未知路径|staff-agent-api|agent-api/).count(),0)
    await disabled.screenshot({path:join(output,status===503?'staff-im-disabled.png':'staff-im-legacy-disabled.png'),fullPage:true,animations:'disabled'})
    state.disabled=false
    await disabled.getByRole('button',{name:'刷新状态',exact:true}).click()
    await disabled.getByText(imOffNotice,{exact:true}).waitFor({state:'hidden'})
    assert.equal(await disabled.getByRole('button',{name:'生成微信连接二维码',exact:true}).isDisabled(),false)
    if(status===503){
      // 操作途中真实停用的 503 IM_DISABLED 仍应切换为未开通状态。
      state.qrFailure={status:503,error:'员工微信 IM 尚未启用',code:'IM_DISABLED'}
      await disabled.getByRole('button',{name:'生成微信连接二维码',exact:true}).click()
      await disabled.getByText(imOffNotice,{exact:true}).waitFor()
      assert.equal(await disabled.getByRole('button',{name:'生成微信连接二维码',exact:true}).isDisabled(),true)
      state.qrFailure=null
    }
    await disabled.close()
  }
  const mobile=await browser.newPage({viewport:{width:390,height:844}});await install(mobile)
  state.bindings=[{id:'im-fixture',sessionId:'staff-session',label:'微信私聊 · 夹具',connected:true,notificationReady:true}]
  await mobile.goto(base+'/staff-agent-api/im#session=staff-session')
  await mobile.getByLabel('员工账号',{exact:true}).fill('王小明');await mobile.getByLabel('登录密码',{exact:true}).fill('fixture-password');await mobile.getByRole('button',{name:'登录',exact:true}).click()
  await mobile.getByRole('heading',{name:'代客锁卡',exact:true}).waitFor();await mobile.getByRole('button',{name:'确认操作',exact:true}).click();assert.equal(state.confirmed,false)
  await mobile.getByText('请由员工独立完成客户身份核验并选择方式。',{exact:true}).waitFor()
  await mobile.locator('#pending select').selectOption('phone');await mobile.getByRole('checkbox').check()
  await mobile.screenshot({path:join(output,'staff-im-mobile-consent.png'),fullPage:true,animations:'disabled'})
  await mobile.getByRole('button',{name:'确认操作',exact:true}).click();assert.equal(state.confirmed,true)
  assert.equal(await mobile.locator('body').evaluate(el=>el.scrollWidth>window.innerWidth),false)
  assert.deepEqual(errors,[])
  console.log('PASS staff IM browser: QR/manual confirmation, operation 404, disabled 503/legacy bindings 404 and recovery, activation, reminder settings, supervisor rules, revoke, unknown state and mobile customer-verification card; no real bank, model or WeChat used.')
}finally{await browser?.close();await web.close()}
