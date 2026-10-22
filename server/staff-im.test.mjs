import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes,randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { createPgClient } from './pg-client.mjs'
import { createStaffApi } from './staff-api.mjs'
import { createStaffIm,inStaffImWindow } from './staff-im.mjs'
import { staffImHeaders } from '../shared/staff-im-service.mjs'
const databaseUrl=process.env.BANK_HTTP_TEST_DATABASE_URL
test('Beijing duty/quiet windows support midnight and equal-time all-day',()=>{
  const now=Date.parse('2026-10-21T23:30:00+08:00')
  assert.equal(inStaffImWindow('22:00','06:00',now),true)
  assert.equal(inStaffImWindow('09:00','18:00',now),false)
  assert.equal(inStaffImWindow('00:00','00:00',now),true)
})
test('staff IM PostgreSQL: transactional events, routing, revocation, leases and role checks',{skip:!databaseUrl,timeout:60000},async t=>{
  assert(/^maneki_http_test(?:_[a-z0-9_]+)?$/.test(new URL(databaseUrl).pathname.slice(1)))
  const schema=`staff_im_${randomUUID().replaceAll('-','')}`,admin=createPgClient(databaseUrl),secret=randomBytes(32).toString('hex')
  await admin.query(`CREATE SCHEMA ${schema}`)
  const db=createPgClient(databaseUrl,{schema}),api=await createStaffApi({db}),im=createStaffIm({db,auth:api.auth,writeAudit:api.writeAudit,serviceKey:secret,publicUrl:'https://bank.test'})
  await db.exec('CREATE TABLE customers(id TEXT PRIMARY KEY,name TEXT NOT NULL)')
  const csr=await api.auth.login('王小明','123456'),sup=await api.auth.login('李主管','123456'),ops=await api.auth.login('运维人员','123456')
  async function call(path,{method='POST',value={},token,signed=false}={}){
    const raw=JSON.stringify(value),headers={'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{}) ,...(signed?staffImHeaders(secret,path,raw):{})}
    const req=Object.assign(Readable.from(method==='GET'?[]:[Buffer.from(raw)]),{headers,method,url:path,socket:{remoteAddress:'127.0.0.1'}})
    const res={status:200,writableEnded:false,writeHead(status){this.status=status},end(data){this.value=JSON.parse(data);this.writableEnded=true}}
    try{if(!await im.handle(req,res,new URL(path,'https://bank.test')))await api.handle(req,res,new URL(path,'https://bank.test'))}catch(e){res.status=e.status??500;res.value={message:e.message,code:e.code}}
    return res
  }
  const internal=(action,value={},token)=>call(`/internal/staff-im-notifications/${action}`,{value,token,signed:true})
  const bind=(who,id)=>internal('bind',{bindingId:id,revision:randomUUID(),recipientHash:randomBytes(32).toString('hex')},who.token)
  const insert=async id=>db.prepare("INSERT INTO tickets(id,customer_id,channel,reason,status,created_by,created_at,updated_at) VALUES(?,'c1','web','private raw customer text','open','customer:c1',?,?)").run(id,new Date().toISOString(),new Date().toISOString())
  try{
    await t.test('service requires signatures and binding requires current business identity',async()=>{
      assert.equal((await call('/internal/staff-im-notifications/claim')).status,403)
      assert.equal((await bind(ops,'im-ops')).status,403)
      assert.equal((await bind(csr,'im-csr')).status,200);assert.equal((await bind(sup,'im-sup')).status,200)
      assert.equal((await call('/staff-api/im/notification-rules',{token:csr.token,method:'GET'})).status,403)
      const result=await call('/staff-api/im/notification-rules',{token:sup.token,method:'PUT',value:{confirmed:true,version:1,csrIds:[csr.staff.id],supervisorIds:[sup.staff.id],start:'00:00',end:'00:00'}})
      assert.equal(result.status,200,JSON.stringify(result.value))
    })
    await t.test('rolled-back business changes cannot produce notification events',async()=>{
      await assert.rejects(db.transaction(async()=>{await insert('T_rolled_back');throw Error('rollback')}))
      assert.equal((await db.prepare("SELECT count(*) AS n FROM staff_im_outbox WHERE resource_id='T_rolled_back'").get()).n,0)
    })
    await t.test('employee internal tasks do not broadcast client-task reminders',async()=>{
      await db.prepare("INSERT INTO tickets(id,customer_id,channel,reason,status,created_by,created_at,updated_at) VALUES('T_internal','c1','web','internal','open',?,?,?)").run(csr.staff.id,new Date().toISOString(),new Date().toISOString())
      await im.sweep()
      assert.equal((await db.prepare("SELECT routing_status FROM staff_im_outbox WHERE resource_id='T_internal'").get()).routing_status,'suppressed')
      assert.equal((await db.prepare("SELECT count(*) AS n FROM staff_im_cycles WHERE ticket_id='T_internal'").get()).n,0)
    })
    await t.test('new client task routes without employee login; sending outcome is separate from task state',async()=>{
      await insert('T_new')
      const claimed=await internal('claim');assert.equal(claimed.status,200,JSON.stringify(claimed.value));assert.equal(claimed.value.staffId,csr.staff.id)
      assert(!claimed.value.text.includes('private raw'));assert(!claimed.value.text.includes('Bearer'))
      const begun=await internal('begin-send',claimed.value);assert.equal(begun.value.text,claimed.value.text)
      const done=await internal('complete',{...begun.value,outcome:'sent',receiptId:'fixture-ack'});assert.equal(done.value.status,'sent')
      assert.equal((await db.prepare("SELECT status FROM tickets WHERE id='T_new'").get()).status,'open')
      await im.sweep();assert.equal((await db.prepare("SELECT count(*) AS n FROM staff_im_notifications WHERE resource_id='T_new'").get()).n,1)
    })
    await t.test('concurrent confirmations cannot both take the same task',async()=>{
      const request=who=>call('/staff-api/tickets/T_new/status',{method:'PATCH',token:who.token,value:{status:'processing',expectedVersion:1}})
      const results=await Promise.all([request(csr),request(sup)])
      assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));assert.equal(results.filter(r=>r.status===409).length,1,JSON.stringify(results))
      const ticket=await db.prepare("SELECT * FROM tickets WHERE id='T_new'").get()
      assert.equal(Number(ticket.version),2)
      const invalid=await call('/staff-api/tickets/T_new/status',{method:'PATCH',token:sup.token,value:{status:'processing',assigneeId:ops.staff.id,expectedVersion:2}})
      assert.equal(invalid.status,400)
    })
    await t.test('customer supplement cycle is fixed and batches are persistent',async()=>{
      for(const id of ['m1','m2'])await db.prepare("INSERT INTO ticket_messages(id,ticket_id,sender,text,created_at)VALUES(?,'T_new','customer','private message',?)").run(id,new Date().toISOString())
      const cycle=await db.prepare("SELECT * FROM staff_im_cycles WHERE ticket_id='T_new' AND kind='response'").get();assert.equal(cycle.cycle_id,'m1')
      await im.sweep();await im.sweep()
      assert.equal((await db.prepare("SELECT count(*) AS n FROM staff_im_notifications WHERE kind='customer_message'").get()).n,1)
      await db.prepare("UPDATE staff_im_cycles SET started_at=now()-interval '20 minutes' WHERE ticket_id='T_new' AND kind='response'").run()
      await im.sweep();await im.sweep()
      assert.equal((await db.prepare("SELECT count(*) AS n FROM staff_im_outbox WHERE kind='cycle_response_escalation'").get()).n,1)
    })
    await t.test('sending process loss becomes unknown, never a new channel attempt',async()=>{
      await db.prepare("UPDATE staff_im_notifications SET status='suppressed' WHERE status IN ('queued','retry_wait','deferred')").run()
      await insert('T_crash')
      const claim=await internal('claim'),begin=await internal('begin-send',claim.value)
      assert(begin.value.attemptId)
      await db.prepare("UPDATE staff_im_notifications SET lease_until=now()-interval '1 second' WHERE id=?").run(begin.value.id)
      await im.sweep()
      assert.equal((await db.prepare('SELECT status FROM staff_im_notifications WHERE id=?').get(begin.value.id)).status,'unknown')
      assert.equal((await internal('complete',{...begin.value,outcome:'sent'})).value.status,'unknown')
    })
    await t.test('unbinding suppresses queued messages and task completion makes old packets unusable',async()=>{
      await insert('T_revoke');await im.sweep()
      const binding=await db.prepare("SELECT * FROM staff_im_bindings WHERE id='im-csr'").get()
      assert.equal((await internal('revoke',{bindingId:binding.id,revision:binding.revision})).status,200)
      const pending=await db.prepare("SELECT count(*) AS n FROM staff_im_notifications WHERE binding_id='im-csr' AND status IN ('queued','retry_wait','deferred')").get();assert.equal(pending.n,0)
      await db.prepare("UPDATE tickets SET status='resolved' WHERE id='T_revoke'").run();await im.sweep()
      assert.equal((await db.prepare("SELECT count(*) AS n FROM staff_im_notifications WHERE resource_id='T_revoke' AND status IN ('queued','retry_wait','deferred')").get()).n,0)
    })
    await t.test('employee role changes invalidate cached business login and supervisor notification eligibility',async()=>{
      await db.prepare("UPDATE staff_users SET role='ops' WHERE id=?").run(sup.staff.id)
      await assert.rejects(api.auth.resolveCurrent({headers:{authorization:`Bearer ${sup.token}`}}),e=>e.status===401)
      await insert('T_no_recipient');await im.sweep()
      assert.equal((await db.prepare("SELECT routing_status FROM staff_im_outbox WHERE resource_id='T_no_recipient'").get()).routing_status,'waiting_recipient')
    })
  }finally{await db.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.close()}
})
