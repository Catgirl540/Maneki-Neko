import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { request } from '@/api/http/base'
import { STAFF_AUTH_EXPIRED_EVENT } from '@/api/agent'
import { useSession } from '@/store/session-context'
import { ApiError, type StaffUser } from '@/api'
import './staff-im.css'

type Binding={id:string;label:string;sessionId:string;connected:boolean;notificationReady:boolean}
type Qr={attemptId:string;status:string;qrImage:string;expiresAt:number;verificationRequired:boolean;error?:{message:string};binding?:Binding}
type Preferences={enabled:boolean;quiet_start:string|null;quiet_end:string|null;urgent_override:boolean;version:number;binding:{id:string}|null}
type Rules={csrIds:string[];supervisorIds:string[];start:string;end:string;version:number}
type Notice={id:string;kind:string;resource_type:string;resource_id:string;staff_id:string;status:string;created_at:string;task_status:string;error_code:string|null}
type Notices={items:Notice[];total:number;page:number;waitingRecipients:number}
const labels:Record<string,string>={queued:'等待投递',retry_wait:'等待连接恢复',deferred:'静默期延后',sending:'正在发送',sent:'渠道已确认发送',suppressed:'已停止',expired:'已过期',failed:'未发送',unknown:'投递结果不确定'}
const qrLabels:Record<string,string>={pending:'请用本人微信扫码',waiting:'请用本人微信扫码',scanned:'请在手机上确认',connected:'扫码完成，请核对并确认绑定',needs_verification:'请填写手机扫码流程所需验证码',expired:'二维码已过期，请重新生成',cancelled:'已取消',failed:'连接失败，请重新生成'}
const date=(value:string|number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(value))
/** 旧部署仅在 bindings 探测时兼容路由 404；具体操作的 404 仍需显示原始业务错误。 */
function imUnavailable(error:unknown,legacyBindingsProbe=false):boolean{
  const value=error as {status?:number;code?:string;message?:string}|null
  if(!value)return false
  if(value.code==='IM_DISABLED')return true
  if(legacyBindingsProbe&&value.status===404)return true
  return value.status===503&&/尚未启用|未启用/.test(value.message??'')
}
const imOffNotice='员工微信 IM 尚未启用。请联系运维在员工桥接服务开通后刷新本页；在此之前不会生成二维码，也不会发送任务提醒。'
async function imRequest<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
  try {return await request<T>(`/staff-agent-api/im${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body)})})}
  catch(error){if(error instanceof ApiError&&error.status===401)window.dispatchEvent(new Event(STAFF_AUTH_EXPIRED_EVENT));throw error}
}
export function StaffImPage(){
  const {user}=useSession()
  const [bindings,setBindings]=useState<Binding[]>([]),[qr,setQr]=useState<Qr|null>(null),[code,setCode]=useState('')
  const [prefs,setPrefs]=useState<Preferences|null>(null),[rules,setRules]=useState<Rules|null>(null),[staff,setStaff]=useState<StaffUser[]>([])
  const [notices,setNotices]=useState<Notices|null>(null),[page,setPage]=useState(1),[team,setTeam]=useState(false)
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[revoke,setRevoke]=useState<string|null>(null)
  const [imOff,setImOff]=useState(false)
  const [confirm,setConfirm]=useState<'prefs'|'rules'|null>(null),[now,setNow]=useState(()=>Date.now())
  const epoch=useRef(0)
  const live=import.meta.env.VITE_USE_MOCK==='false'
  const reload=useCallback(async()=>{
    if(!live)return
    const generation=epoch.current
    const jobs=await Promise.allSettled([
      imRequest<Binding[]>('/bindings'),request<Preferences>('/staff-api/im/notification-preferences'),
      request<Notices>(`/staff-api/im/notifications?page=${page}&team=${team}`),
      ...(user?.role==='supervisor'?[request<{rules:Rules;staff:StaffUser[]}>('/staff-api/im/notification-rules')]:[]),
    ])
    if(generation!==epoch.current)return
    if(jobs[0].status==='fulfilled')setBindings(jobs[0].value as Binding[])
    if(jobs[1].status==='fulfilled')setPrefs(jobs[1].value as Preferences)
    if(jobs[2].status==='fulfilled')setNotices(jobs[2].value as Notices)
    if(jobs[3]?.status==='fulfilled'){const data=jobs[3].value as {rules:Rules;staff:StaffUser[]};setRules(data.rules);setStaff(data.staff)}
    const bindingsJob=jobs[0]
    const failed=jobs.find(job=>job.status==='rejected')
    const off=bindingsJob.status==='rejected'&&imUnavailable(bindingsJob.reason,true)
    setImOff(off)
    setError(off||!failed?'':String((failed as PromiseRejectedResult).reason?.message??'连接信息暂不可用，请重试'))
  },[live,page,team,user?.role])
  useEffect(()=>{const currentEpoch=epoch;const generation=++currentEpoch.current;let active=true;queueMicrotask(()=>{if(active)void reload()});return()=>{active=false;currentEpoch.current=generation+1}},[reload,user?.id])
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  const qrId=qr?.attemptId,qrStatus=qr?.status,qrExpiry=qr?.expiresAt
  useEffect(()=>{
    if(!qrId||['connected','cancelled','expired','failed'].includes(qrStatus??'')||(qrExpiry??0)<=Date.now())return
    let stopped=false
    const timer=setInterval(()=>{void imRequest<Qr>(`/weixin/qr/${qrId}`).then(result=>{if(!stopped)setQr(result)}).catch(e=>{if(!stopped){setError(e.message);if(e.status===410)setQr(old=>old?{...old,status:'expired'}:old)}})},2000)
    return()=>{stopped=true;clearInterval(timer)}
  },[qrId,qrStatus,qrExpiry])
  async function act(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await work()}catch(e){if(imUnavailable(e)){setImOff(true);setError('')}else setError(e instanceof Error?e.message:'操作未完成，请重试')}finally{setBusy(false)}}
  async function save(){
    if(confirm==='prefs'&&prefs){await request('/staff-api/im/notification-preferences',{method:'PATCH',body:JSON.stringify({enabled:prefs.enabled,quietStart:prefs.quiet_start,quietEnd:prefs.quiet_end,urgentOverride:prefs.urgent_override,version:prefs.version,confirmed:true})})}
    else if(confirm==='rules'&&rules){await request('/staff-api/im/notification-rules',{method:'PUT',body:JSON.stringify({...rules,confirmed:true})})}
    setConfirm(null);setMessage('设置已保存，后续提醒按新设置处理。');await reload()
  }
  function togglePerson(id:string,role:'csr'|'supervisor'){
    if(!rules)return
    const key=role==='csr'?'csrIds':'supervisorIds',ids=rules[key]
    setRules({...rules,[key]:ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]})
  }
  const expired=qr&&qr.expiresAt<=now
  return <div className="staff-page staff-im-page">
    <PageHeader title="IM 机器人" description="连接本人微信，随时接收任务，在对话中发起处理。" actions={<button className="staff-button" disabled={busy||!live} onClick={()=>void act(reload)}>刷新状态</button>}/>
    {!live&&<div className="staff-im-alert">当前为演示界面。请连接真实银行和员工助手服务后使用微信绑定与提醒。</div>}
    {imOff&&<div className="staff-im-alert" role="status">{imOffNotice}</div>}
    {error&&<div className="staff-im-alert" role="alert">{error} <button onClick={()=>void act(reload)} disabled={busy}>重试</button></div>}
    {message&&<p className="staff-im-status" role="status">{message}</p>}
    <div className="staff-im-grid">
      <section className="staff-im-panel"><span className="staff-eyebrow">01 · 微信连接</span><h2>让任务找到你</h2><p>本人扫码后确认绑定。请再给微信机器人发一条私聊，建立本次登录的投递上下文。</p>
        <div className="staff-im-identity">{user?.name} <span>{user?.role==='supervisor'?'主管':'客服'}</span></div>
        {!qr&&<div className="staff-im-qr-empty"><span>{imOff?'微信连接尚未开通':'微信扫码连接'}</span><small>{imOff?'员工微信 IM 未启用，暂不能生成二维码':'二维码在本页显示，仅供当前员工使用'}</small></div>}
        {qr&&<div className="staff-im-qr">{!expired&&!qr.binding&&<img src={qr.qrImage} alt="本人微信连接二维码"/>}<strong>{qr.binding?'已绑定本人微信':expired?'二维码已过期':qrLabels[qr.status]??qr.status}</strong>{qr.error&&<small>{qr.error.message}</small>}<small>有效至 {date(qr.expiresAt)}（北京时间）</small></div>}
        <button className="staff-button staff-button-primary" disabled={busy||!live||imOff||(!!qr&&!expired&&!['failed','cancelled'].includes(qr.status))} onClick={()=>void act(async()=>{setQr(await imRequest<Qr>('/weixin/qr',{}));setCode('')})}>生成微信连接二维码</button>
        {qr&&!expired&&qr.verificationRequired&&<div className="staff-im-field"><label htmlFor="staff-im-code">手机扫码流程验证码</label><input id="staff-im-code" value={code} onChange={e=>setCode(e.target.value)} maxLength={64} autoComplete="one-time-code"/><button className="staff-button" disabled={busy||!code} onClick={()=>void act(async()=>setQr(await imRequest<Qr>(`/weixin/qr/${qr.attemptId}/verify`,{code})))}>提交验证码</button></div>}
        {qr&&!expired&&qr.status==='connected'&&!qr.binding&&<div className="staff-im-confirm"><p>将此微信绑定到 <strong>{user?.name}</strong>，并开通客户任务提醒。退出网页后仍会提醒，可随时停用或解绑。</p><button className="staff-button staff-button-primary" disabled={busy} onClick={()=>void act(async()=>{const binding=await imRequest<Binding>(`/weixin/qr/${qr.attemptId}/confirm`,{confirmed:true});setQr({...qr,binding});setMessage('绑定成功，请给微信机器人发送一条私聊，再刷新状态。');await reload()})}>绑定本人微信并开通任务提醒</button></div>}
        {qr&&!expired&&!['connected','cancelled','failed'].includes(qr.status)&&<button className="staff-button" disabled={busy} onClick={()=>void act(async()=>{await imRequest(`/weixin/qr/${qr.attemptId}/cancel`,{});setQr(null)})}>取消扫码</button>}
        {!imOff&&<a className="staff-im-link" href="/staff-agent-api/im" target="_blank" rel="noreferrer">使用私聊绑定码或打开业务确认页 ↗</a>}
      </section>
      <section className="staff-im-panel"><span className="staff-eyebrow">02 · 接收设置</span><h2>任务提醒</h2><p>新任务通知值班客服，客户补充通知负责人；转派、审批及超时升级按团队规则通知主管。</p>
        {bindings.length===0&&<div className="staff-im-muted">{imOff?'员工微信 IM 尚未启用，暂无本人连接信息':error?'暂未取得连接信息':'尚未连接本人微信'}</div>}
        {bindings.map(binding=><div className="staff-im-binding" key={binding.id}><strong>{binding.label}</strong><span>{binding.notificationReady?'私聊上下文已建立':'待私聊激活或连接恢复'}</span><small>{binding.connected?'业务登录有效':'业务登录需重新连接；已开通提醒独立保留'}</small><div className="staff-im-inline"><button className="staff-button" disabled={busy||!binding.notificationReady||!prefs?.enabled} onClick={()=>void act(async()=>{await imRequest(`/bindings/${binding.id}/test`,{confirmed:true,requestId:crypto.randomUUID()});setMessage('测试提醒已排队，请查看通知记录与本人微信。');await reload()})}>发送连接测试提醒</button><button className="staff-button" disabled={busy} onClick={()=>void act(async()=>{await imRequest(`/bindings/${binding.id}/reconnect`,{confirmed:true});setMessage('已请求重连；需要时请重新扫码，并向机器人发一条私聊激活。');await reload()})}>重新连接</button><button className="staff-button" disabled={busy} onClick={()=>setRevoke(binding.id)}>解除连接</button></div>{revoke===binding.id&&<div className="staff-im-confirm"><p>解除后，此微信停止接收任务提醒，并失去 IM 业务权限。已提交的业务不会撤销。</p><button className="staff-button" disabled={busy} onClick={()=>void act(async()=>{await imRequest(`/bindings/${binding.id}`,undefined,'DELETE');setRevoke(null);setQr(null);await reload()})}>确认解除本人连接</button><button className="staff-button" onClick={()=>setRevoke(null)}>保留连接</button></div>}</div>)}
        {prefs&&<fieldset disabled={busy||!prefs.binding}><label className="staff-im-check"><input type="checkbox" checked={prefs.enabled} onChange={e=>setPrefs({...prefs,enabled:e.target.checked})}/>开通本人微信任务提醒</label><div className="staff-im-inline"><label>静默开始<input type="time" value={prefs.quiet_start??''} onChange={e=>setPrefs({...prefs,quiet_start:e.target.value||null})}/></label><label>静默结束<input type="time" value={prefs.quiet_end??''} onChange={e=>setPrefs({...prefs,quiet_end:e.target.value||null})}/></label></div><small>北京时间；开始与结束相同表示不设置静默。</small><label className="staff-im-check"><input type="checkbox" checked={prefs.urgent_override} onChange={e=>setPrefs({...prefs,urgent_override:e.target.checked})}/>允许加急 / VIP 提醒在本人静默时段发送</label><button className="staff-button" onClick={()=>setConfirm('prefs')}>核对并保存本人设置</button></fieldset>}
      </section>
    </div>
    {user?.role==='supervisor'&&rules&&<section className="staff-im-panel"><span className="staff-eyebrow">主管管理</span><h2>团队接收规则</h2><p>新工单提醒值班客服；无人可接收或负责人暂不可触达时提醒备用主管。通知升级不会自动转派工单。至少选择一位备用主管。</p><div className="staff-im-grid"><div><h3>值班客服（最多 10 人）</h3>{staff.filter(v=>v.role==='csr').map(v=><label className="staff-im-check" key={v.id}><input type="checkbox" checked={rules.csrIds.includes(v.id)} onChange={()=>togglePerson(v.id,'csr')}/>{v.name}</label>)}</div><div><h3>备用与审批主管</h3>{staff.filter(v=>v.role==='supervisor').map(v=><label className="staff-im-check" key={v.id}><input type="checkbox" checked={rules.supervisorIds.includes(v.id)} onChange={()=>togglePerson(v.id,'supervisor')}/>{v.name}</label>)}</div></div><div className="staff-im-inline"><label>值班开始<input type="time" value={rules.start} onChange={e=>setRules({...rules,start:e.target.value})}/></label><label>值班结束<input type="time" value={rules.end} onChange={e=>setRules({...rules,end:e.target.value})}/></label><button className="staff-button" disabled={busy} onClick={()=>setConfirm('rules')}>核对并保存团队规则</button></div><small>北京时间；开始与结束相同表示全天。普通任务 5 分钟催办、15 分钟升级；加急 / VIP 为 1 分钟与 3 分钟。</small></section>}
    {confirm&&<section className="staff-im-panel staff-im-confirm" role="dialog" aria-label="核对提醒设置"><h2>确认{confirm==='prefs'?'本人提醒设置':'团队接收规则'}</h2><p>{confirm==='prefs'?`提醒${prefs?.enabled?'开通':'停用'}；静默 ${prefs?.quiet_start??'未设置'} — ${prefs?.quiet_end??'未设置'}；加急越过静默${prefs?.urgent_override?'允许':'不允许'}`:`值班客服：${staff.filter(v=>rules?.csrIds.includes(v.id)).map(v=>v.name).join('、')||'未选择'}；备用主管：${staff.filter(v=>rules?.supervisorIds.includes(v.id)).map(v=>v.name).join('、')||'未选择'}；值班 ${rules?.start} — ${rules?.end}`}</p><button className="staff-button staff-button-primary" disabled={busy} onClick={()=>void act(save)}>确认保存</button><button className="staff-button" disabled={busy} onClick={()=>setConfirm(null)}>返回修改</button></section>}
    <section className="staff-im-panel"><div className="staff-im-heading"><div><span className="staff-eyebrow">03 · 通知记录</span><h2>提醒与任务进度</h2></div>{user?.role==='supervisor'&&<label className="staff-im-check"><input type="checkbox" checked={team} onChange={e=>{setTeam(e.target.checked);setPage(1)}}/>查看团队投递摘要</label>}</div><p>“渠道已确认发送”不代表微信已读或已经接手。投递不确定时不会自动重发，办理结果以银行记录为准。</p>{!!notices?.waitingRecipients&&<div className="staff-im-alert">有 {notices.waitingRecipients} 个任务事件尚无合格接收人，请核对值班规则和微信连接。</div>}<div className="staff-table-wrap"><table className="staff-table"><thead><tr><th>任务</th><th>触发时间（北京）</th><th>投递状态</th><th>任务状态</th></tr></thead><tbody>{notices?.items.map(item=><tr key={item.id}><td>{item.kind==='test'?'本人连接测试':<Link to={item.resource_type==='approval'?`/approvals?approval=${encodeURIComponent(item.resource_id)}`:`/tickets?ticket=${encodeURIComponent(item.resource_id)}`}>{item.resource_id}</Link>}</td><td>{date(item.created_at)}</td><td>{labels[item.status]??item.status}{item.error_code&&<small className="staff-im-record-note">{item.error_code==='CHANNEL_NOT_READY'?'需恢复连接或发一条私聊激活':item.error_code==='DELIVERY_UNCONFIRMED'?'请核实本人微信；不会自动重发':item.error_code}</small>}</td><td>{item.task_status??'—'}</td></tr>)}{!notices?.items.length&&<tr><td colSpan={4}>{error?'通知记录暂不可用':'暂无通知记录'}</td></tr>}</tbody></table></div><div className="staff-im-pagination"><button className="staff-button" disabled={busy||page===1} onClick={()=>setPage(v=>v-1)}>上一页</button><span>第 {page} 页 · 共 {notices?.total??'—'} 条</span><button className="staff-button" disabled={busy||!notices||page*30>=notices.total} onClick={()=>setPage(v=>v+1)}>下一页</button></div></section>
  </div>
}
