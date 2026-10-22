import { staffImHeaders } from '../../shared/staff-im-service.mjs'
export function createStaffImService({ baseUrl, secret, fetchImpl = fetch }) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(base.hostname))) throw Error('Staff IM bank service must use HTTPS or loopback')
  return async (action, value = {}, authorization) => {
    const path = `/internal/staff-im-notifications/${action}`, raw = JSON.stringify(value)
    const response = await fetchImpl(new URL(path, base), { method:'POST',redirect:'error',headers:{'content-type':'application/json',...staffImHeaders(secret,path,raw),...(authorization ? {authorization} : {})},body:raw,signal:AbortSignal.timeout(12000) })
    let data
    try { data = await response.json() } catch { throw Object.assign(Error('通知服务响应无效'),{status:502}) }
    if (!response.ok) throw Object.assign(Error(data.message ?? '通知服务暂不可用'),{status:response.status,code:data.code})
    return data
  }
}
/** Model-independent worker. A channel invocation is never retried on an uncertain result. */
export function createStaffImWorker({ service, routes, ready, deliver, intervalMs = 2000, onError = () => {} }) {
  let timer, closed=false, running
  const reports = new Map()
  function routeFor(packet) {
    const route=routes()[packet.bindingId]
    return route?.audience==='staff' && route.ownerId===packet.staffId && route.bindingRevision===packet.bindingRevision ? route : null
  }
  async function report(packet,value) {
    const key=packet.attemptId, payload={id:packet.id,lease:packet.lease,attemptId:key,...value}
    reports.set(key,payload)
    await service('complete',payload)
    reports.delete(key)
  }
  async function tick() {
    if (closed || running) return running
    running=(async()=>{
      for (const [key,value] of reports) { try {await service('complete',value);reports.delete(key)} catch { /* report only: never send again */ } }
      for(let count=0;count<10&&!closed;count++){
        const packet=await service('claim')
        if (!packet || closed) break
        const route=routeFor(packet)
        if (!route || !ready(route)) { await service('not-ready',{id:packet.id,lease:packet.lease});continue }
        const started=await service('begin-send',{id:packet.id,lease:packet.lease})
        if (!started) continue
        const fresh=routeFor(started)
        if (closed || !fresh || !ready(fresh)) {await report(started,{outcome:'not_attempted'});continue}
        let result
        try {result=await deliver(fresh,started.text,{signal:AbortSignal.timeout(15000)})}
        catch {await report(started,{outcome:'unknown'});continue}
        await report(started,{outcome:'sent',receiptId:typeof result?.messageId==='string' ? result.messageId : undefined})
      }
    })().catch(error=>onError(error)).finally(()=>{running=undefined})
    return running
  }
  return {tick,start(){if(!timer&&!closed){timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();void tick()}},async close(){closed=true;clearInterval(timer);await running}}
}
