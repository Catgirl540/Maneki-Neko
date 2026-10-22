import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { staffImVerifier } from '../shared/staff-im-service.mjs'

const fail = (status, message, code = 'INVALID_REQUEST') => Object.assign(Error(message), { status, code })
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }
const internalPrefix = '/internal/staff-im-notifications/'
const iso = ms => new Date(ms).toISOString()
const time = value => new Date(value).getTime()
const approvalPayload = task => { try { return JSON.parse(task.biz_payload) } catch { return {} } }
export function inStaffImWindow(start, end, now = Date.now()) {
  if (!start || !end || start === end) return true
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  return start < end ? hm >= start && hm < end : hm >= start || hm < end
}
async function body(req) {
  const chunks = []; let size = 0
  for await (const part of req) { size += part.length; if (size > 32768) throw fail(413, '请求过大'); chunks.push(part) }
  const raw = Buffer.concat(chunks).toString('utf8')
  let value
  try { value = JSON.parse(raw || '{}') } catch { throw fail(400, '请求不是有效 JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, '需要 JSON 对象')
  return { raw, value }
}
export async function ensureStaffImSchema(db) {
  if (process.env.BANK_AUTO_MIGRATE !== 'false') await db.exec(await readFile(new URL('./staff-im-schema.sql', import.meta.url), 'utf8'))
}
/** PostgreSQL is authoritative; the transport worker receives only eligible short notifications. */
export function createStaffIm({ db, auth, writeAudit, clock = Date.now, serviceKey = process.env.LUCKYCAT_STAFF_IM_SERVICE_KEY, publicUrl = process.env.LUCKYCAT_STAFF_IM_PUBLIC_URL ?? process.env.LUCKYCAT_IM_PUBLIC_URL ?? 'http://127.0.0.1:5180' }) {
  const verify = staffImVerifier(serviceKey, clock)
  const origin = new URL(publicUrl)
  if (origin.username || origin.password || origin.search || origin.hash || !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw Error('Staff IM public URL must use HTTPS or loopback')
  const one = (sql, ...args) => db.prepare(sql).get(...args)
  const all = (sql, ...args) => db.prepare(sql).all(...args)
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  const rules = async () => { const row = await one('SELECT * FROM staff_im_rules WHERE id=1'); return { ...row.config, version: Number(row.version) } }
  async function person(id) {
    return one(`SELECT s.id,s.role,s.auth_version,b.id AS binding_id,b.revision AS binding_revision,b.enabled AS binding_enabled,
      COALESCE(p.enabled,true) AS enabled,p.quiet_start,p.quiet_end,COALESCE(p.urgent_override,false) AS urgent_override
      FROM staff_users s LEFT JOIN staff_im_bindings b ON b.staff_id=s.id AND b.revoked_at IS NULL
      LEFT JOIN staff_im_preferences p ON p.staff_id=s.id WHERE s.id=?`, id)
  }
  const qualifies = p => p && ['csr', 'supervisor'].includes(p.role) && p.enabled && p.binding_enabled && p.binding_id
  async function resource(type, id) {
    return one(type === 'approval' ? 'SELECT * FROM approvals WHERE id=?' : 'SELECT * FROM tickets WHERE id=?', id)
  }
  async function recipients(event, task, config) {
    if (event.kind === 'test') return [await person(event.staff_id)].filter(qualifies)
    if (event.resource_type === 'approval') {
      if (task.status !== 'pending') return []
      return (await Promise.all(config.supervisorIds.map(person))).filter(p => qualifies(p) && p.role === 'supervisor' && p.id !== task.applicant_id && inStaffImWindow(config.start, config.end, clock()))
    }
    if (['resolved', 'suspended'].includes(task.status)) return []
    if (event.kind === 'ticket_created' && !String(task.created_by ?? '').startsWith('customer:') && task.created_by !== 'agent') return []
    if (event.kind === 'ticket_state') return []
    const supervisors = async () => (await Promise.all(config.supervisorIds.map(person))).filter(p => qualifies(p) && p.role === 'supervisor')
    if (event.stage === 'escalation' || event.kind === 'delivery_unavailable') return supervisors()
    if (task.assignee_id) {
      const assigned = await person(task.assignee_id)
      return qualifies(assigned) ? [assigned] : supervisors()
    }
    const pool = (await Promise.all(config.csrIds.map(person))).filter(p => qualifies(p) && p.role === 'csr' && inStaffImWindow(config.start, config.end, clock()))
    return pool.length ? pool : supervisors()
  }
  async function enqueue(event, config) {
    const task = await resource(event.resource_type, event.resource_id)
    if (!task) {await run("UPDATE staff_im_outbox SET routed_at=now(),routing_status='suppressed' WHERE id=?",event.id);return}
    if(event.kind==='ticket_created'&&!String(task.created_by??'').startsWith('customer:')&&task.created_by!=='agent'){
      await run("UPDATE staff_im_outbox SET routed_at=now(),routing_status='suppressed' WHERE id=?",event.id);return
    }
    if (event.kind === 'ticket_state' && !['resolved','suspended'].includes(task.status)) {
      for(const pending of await all("SELECT * FROM staff_im_notifications WHERE resource_type='ticket' AND resource_id=? AND status IN ('queued','retry_wait','deferred')",task.id)) await prepare(pending)
      await run("UPDATE staff_im_outbox SET routed_at=now(),routing_status='routed' WHERE id=?",event.id);return
    }
    if (event.kind === 'approval_state' || ['resolved', 'suspended'].includes(task.status) || (event.resource_type === 'approval' && task.status !== 'pending')) {
      await run("UPDATE staff_im_notifications SET status='suppressed',error_code='TASK_CHANGED' WHERE resource_type=? AND resource_id=? AND status IN ('queued','retry_wait','deferred')", event.resource_type, event.resource_id)
      await run("UPDATE staff_im_outbox SET routed_at=now(),routing_status='suppressed' WHERE id=?", event.id)
      return
    }
    let eventId = event.id, cycleId = event.cycle_id ?? null, available = clock()
    if (event.kind === 'customer_message') {
      const cycle = await one("SELECT * FROM staff_im_cycles WHERE ticket_id=? AND kind='response' AND closed_at IS NULL", task.id)
      if (!cycle) { await run("UPDATE staff_im_outbox SET routed_at=now(),routing_status='suppressed' WHERE id=?", event.id); return }
      const batch = Math.max(0, Math.floor((time(event.occurred_at) - time(cycle.started_at)) / 30000))
      eventId = `batch:${cycle.cycle_id}:${batch}`; cycleId = cycle.cycle_id
      available = time(cycle.started_at) + (batch + 1) * 30000
    }
    const people = await recipients(event, task, config)
    let expiry = time(event.occurred_at) + 24 * 3600000
    if (event.resource_type === 'approval' && task.biz_type === 'transfer') expiry = time(approvalPayload(task).holdUntil)
    if (!Number.isFinite(expiry) || expiry <= clock()) {
      await run("UPDATE staff_im_outbox SET routed_at=now(),routing_status='expired' WHERE id=?", event.id); return
    }
    for (const p of people) {
      await run(`INSERT INTO staff_im_notifications(id,event_id,cycle_id,kind,stage,resource_type,resource_id,staff_id,binding_id,binding_revision,rule_version,available_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,staff_id,kind,stage) DO UPDATE SET rule_version=EXCLUDED.rule_version,
        status=CASE WHEN staff_im_notifications.status='suppressed' THEN 'queued' ELSE staff_im_notifications.status END,
        error_code=CASE WHEN staff_im_notifications.status='suppressed' THEN NULL ELSE staff_im_notifications.error_code END
        WHERE staff_im_notifications.status IN ('queued','retry_wait','deferred') OR (staff_im_notifications.status='suppressed' AND staff_im_notifications.error_code='RECIPIENT_CHANGED'
          AND staff_im_notifications.attempt_id IS NULL AND staff_im_notifications.binding_id=EXCLUDED.binding_id AND staff_im_notifications.binding_revision=EXCLUDED.binding_revision)`,
      `sn_${randomUUID()}`, eventId, cycleId, event.kind, event.stage ?? 'initial', event.resource_type, task.id, p.id, p.binding_id, p.binding_revision, config.version, iso(available), iso(expiry))
    }
    await run('UPDATE staff_im_outbox SET routed_at=?,routing_status=?,next_route_at=? WHERE id=?', people.length ? iso(clock()) : null, people.length ? 'routed' : 'waiting_recipient',iso(clock()+60000), event.id)
  }
  async function sweep() {
    await run("UPDATE staff_im_notifications SET status='unknown',error_code='DELIVERY_UNCONFIRMED',lease=NULL,lease_until=NULL WHERE status='sending' AND lease_until < now()")
    await run("UPDATE staff_im_attempts SET status='unknown',completed_at=now(),error_code='DELIVERY_UNCONFIRMED' WHERE status='sending' AND notification_id IN (SELECT id FROM staff_im_notifications WHERE status='unknown')")
    const config = await rules()
    for(const approval of await all("SELECT * FROM approvals WHERE biz_type='transfer' AND status='pending' ORDER BY created_at LIMIT 200")) {
      const cutoff=time(approvalPayload(approval).holdUntil)
      if(Number.isFinite(cutoff)&&cutoff>clock()&&cutoff-clock()<=60000)await run("INSERT INTO staff_im_outbox(id,kind,resource_type,resource_id) VALUES(?,'approval_due','approval',?) ON CONFLICT DO NOTHING",`approval-due:${approval.id}`,approval.id)
    }
    // Stable cycle+stage event keys prevent each scan producing another reminder.
    for (const c of await all(`SELECT c.*,t.priority FROM staff_im_cycles c JOIN tickets t ON t.id=c.ticket_id
      WHERE c.closed_at IS NULL AND c.started_at>now()-interval '24 hours' AND t.status IN ('open','processing') ORDER BY c.started_at LIMIT 200`)) {
      const elapsed = clock() - time(c.started_at), urgent = ['high', 'vip'].includes(c.priority)
      for (const [stage, ms] of [['reminder', urgent ? 60000 : 300000], ['escalation', urgent ? 180000 : 900000]]) if (elapsed >= ms) {
        await run(`INSERT INTO staff_im_outbox(id,kind,resource_type,resource_id,occurred_at) VALUES(?,?, 'ticket',?,?) ON CONFLICT DO NOTHING`,
          `cycle:${c.kind}:${c.cycle_id}:${stage}`, `cycle_${c.kind}_${stage}`, c.ticket_id, iso(time(c.started_at) + ms))
      }
    }
    for (const e of await all('SELECT * FROM staff_im_outbox WHERE routed_at IS NULL AND next_route_at<=? ORDER BY occurred_at LIMIT 200',iso(clock()))) {
      if (e.kind.startsWith('cycle_')) { e.stage = e.kind.endsWith('_escalation') ? 'escalation' : 'reminder'; e.cycle_id = e.id.slice(`cycle:${e.kind.includes('assignment') ? 'assignment' : 'response'}:`.length, -(e.stage.length + 1)) }
      await enqueue(e, config)
    }
  }
  async function prepare(row) {
    const p = await person(row.staff_id), task = row.kind === 'test' ? { id: row.resource_id, status: 'open' } : await resource(row.resource_type, row.resource_id)
    const config = await rules()
    let reason
    if (time(row.expires_at) <= clock()) reason = 'EXPIRED'
    else if(row.kind==='ticket_created'&&task?.status!=='open')reason='TASK_CHANGED'
    else if (!qualifies(p) || p.binding_id !== row.binding_id || p.binding_revision !== row.binding_revision) reason = 'BINDING_CHANGED'
    else if (!task || ['resolved', 'suspended'].includes(task.status) || (row.resource_type === 'approval' && task.status !== 'pending')) reason = 'TASK_CHANGED'
    else if (row.kind !== 'test' && !(await recipients(row, task, config)).some(v => v.id === p.id)) reason = 'RECIPIENT_CHANGED'
    if (!reason && row.cycle_id) {
      const cycle = await one('SELECT * FROM staff_im_cycles WHERE ticket_id=? AND cycle_id=? AND closed_at IS NULL', task.id, row.cycle_id)
      if (!cycle) reason = 'TASK_CHANGED'
    }
    if (reason) {
      await run('UPDATE staff_im_notifications SET status=?,error_code=?,lease=NULL,lease_until=NULL WHERE id=? AND status IN (\'queued\',\'retry_wait\',\'deferred\')', reason === 'EXPIRED' ? 'expired' : 'suppressed', reason, row.id)
      return null
    }
    const urgent = ['high', 'vip'].includes(task.priority)
    if (p.quiet_start && p.quiet_start !== p.quiet_end && inStaffImWindow(p.quiet_start, p.quiet_end, clock()) && !(urgent && p.urgent_override)) {
      await run("UPDATE staff_im_notifications SET status='deferred',available_at=?,lease=NULL,lease_until=NULL WHERE id=? AND status IN ('queued','retry_wait','deferred')", iso(clock() + 60000), row.id)
      return null
    }
    const title = row.kind === 'test' ? '连接测试' : row.resource_type === 'approval' ? '主管待处置任务' : row.stage === 'escalation' ? '客户任务超时升级' : row.kind === 'customer_message' ? '客户有新补充' : row.kind === 'ticket_assigned' ? '工单已转派给你' : row.kind === 'delivery_unavailable' ? '负责人暂不可微信触达' : row.kind.startsWith('cycle_') ? '客户任务待处理' : '新客户任务'
    const url = new URL(row.resource_type === 'approval' ? '/staff/approvals' : '/staff/tickets', origin)
    url.searchParams.set(row.resource_type === 'approval' ? 'approval' : 'ticket', task.id)
    const stamp = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(time(row.created_at))
    const text = row.kind === 'test' ? '【招财猫·工作人员 IM】连接测试。此消息不含客户资料，未执行银行业务。' : `【招财猫·${title}】\n编号：${task.id}\n${urgent ? '优先处理' : '普通任务'} · ${stamp}（北京时间）\n${url.href}\n请查看最新状态，接手以银行结果为准。`
    return { id: row.id, staffId: p.id, bindingId: p.binding_id, bindingRevision: p.binding_revision, text, lease: row.lease }
  }
  async function internal(req, action, value) {
    if (action === 'validate-binding') {
      const who=await auth.resolveCurrent(req)
      const binding=await one('SELECT * FROM staff_im_bindings WHERE id=? AND staff_id=? AND revision=? AND revoked_at IS NULL',value.bindingId,who.actorId,value.revision)
      if (!binding) throw fail(401,'员工微信绑定已失效，请重新连接','UNAUTHORIZED')
      return {ok:true}
    }
    if (action === 'test') {
      const who=await auth.resolveCurrent(req)
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(value.requestId??'')) throw fail(400,'测试请求编号无效')
      const p=await person(who.actorId)
      if (!qualifies(p) || p.binding_id!==value.bindingId) throw fail(409,'请先开通本人微信提醒')
      await run(`INSERT INTO staff_im_notifications(id,event_id,kind,resource_type,resource_id,staff_id,binding_id,binding_revision,rule_version,expires_at)
        VALUES(?,?,'test','ticket',?,?,?,?,?,?) ON CONFLICT(event_id,staff_id,kind,stage) DO NOTHING`,
        `sn_${randomUUID()}`,`test:${who.actorId}:${value.requestId}`,value.bindingId,who.actorId,p.binding_id,p.binding_revision,(await rules()).version,iso(clock()+120000))
      return {ok:true,status:'queued'}
    }
    if (action === 'bind') {
      const who = await auth.resolveCurrent(req)
      if (!/^im-[\w-]+$/.test(value.bindingId ?? '') || !/^[a-f0-9]{64}$/.test(value.recipientHash ?? '') || !/^[\w-]{20,100}$/.test(value.revision ?? '')) throw fail(400, '绑定信息无效')
      return db.transaction(async () => {
        await one('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', `staff-im:${who.actorId}`)
        const old = await one('SELECT * FROM staff_im_bindings WHERE id=?', value.bindingId)
        if (old && old.staff_id !== who.actorId) throw fail(409, '此连接已归其他员工')
        if (old && !old.revoked_at && old.revision === value.revision) return { ok: true }
        await run('UPDATE staff_im_bindings SET revoked_at=now(),enabled=false WHERE staff_id=? AND revoked_at IS NULL', who.actorId)
        try {
          await run(`INSERT INTO staff_im_bindings(id,staff_id,recipient_hash,revision) VALUES(?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,recipient_hash=EXCLUDED.recipient_hash,enabled=true,revoked_at=NULL`, value.bindingId, who.actorId, value.recipientHash, value.revision)
        } catch (e) { if (e.code === '23505') throw fail(409, '此微信已绑定其他员工'); throw e }
        await run("UPDATE staff_im_notifications SET status='suppressed',error_code='BINDING_CHANGED' WHERE staff_id=? AND status IN ('queued','retry_wait','deferred')", who.actorId)
        await run('INSERT INTO staff_im_preferences(staff_id,enabled) VALUES(?,true) ON CONFLICT(staff_id) DO UPDATE SET enabled=true,version=staff_im_preferences.version+1', who.actorId)
        await writeAudit({ actorId: who.actorId, action: 'staff.im.bind', targetType: 'staff-im', targetId: value.bindingId })
        return { ok: true }
      })
    }
    if (action === 'revoke') {
      await db.transaction(async () => {
        await run('UPDATE staff_im_bindings SET revoked_at=now(),enabled=false WHERE id=? AND revision=?', value.bindingId, value.revision)
        await run("UPDATE staff_im_notifications SET status='suppressed',error_code='BINDING_CHANGED' WHERE binding_id=? AND binding_revision=? AND status IN ('queued','retry_wait','deferred')", value.bindingId, value.revision)
      }); return { ok: true }
    }
    if (action === 'claim') return db.transaction(async () => {
      await sweep()
      for(let count=0;count<20;count++){
        const claimed = await one(`SELECT * FROM staff_im_notifications WHERE status IN ('queued','retry_wait','deferred') AND available_at<=?
          AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`,iso(clock()))
        if (!claimed) return null
        const lease = randomUUID()
        await run('UPDATE staff_im_notifications SET lease=?,lease_until=? WHERE id=?', lease, iso(clock() + 45000), claimed.id)
        const packet=await prepare({ ...claimed, lease });if(packet)return packet
      }
      return null
    })
    if (['begin-send', 'complete', 'not-ready'].includes(action)) return db.transaction(async () => {
      const row = await one('SELECT * FROM staff_im_notifications WHERE id=? FOR UPDATE', value.id)
      if(action==='complete' && row && row.attempt_id===value.attemptId && ['sent','unknown','suppressed','expired','failed'].includes(row.status)) return {status:row.status}
      if (!row || row.lease !== value.lease) throw fail(409, '通知租约已失效', 'LEASE_EXPIRED')
      if (action === 'begin-send') {
        if (!['queued', 'retry_wait', 'deferred'].includes(row.status) || time(row.lease_until) <= clock()) throw fail(409, '通知已被领取或失效')
        const payload = await prepare(row)
        if (!payload) return null
        const attemptId = randomUUID()
        await run("UPDATE staff_im_notifications SET status='sending',attempt_id=?,sending_at=now(),lease_until=? WHERE id=?", attemptId, iso(clock() + 45000), row.id)
        await run("INSERT INTO staff_im_attempts(id,notification_id,status) VALUES(?,?,'sending')", attemptId, row.id)
        return { ...payload, attemptId }
      }
      if (action === 'not-ready') {
        if (!['queued', 'retry_wait', 'deferred'].includes(row.status)) throw fail(409, '通知已进入发送')
        const attempts = row.attempts + 1
        await run('UPDATE staff_im_notifications SET status=?,attempts=?,error_code=?,available_at=?,lease=NULL,lease_until=NULL WHERE id=?', attempts >= 20 ? 'failed' : 'retry_wait', attempts, 'CHANNEL_NOT_READY', iso(clock() + Math.min(300000, 15000 * 2 ** Math.min(attempts - 1, 5))), row.id)
        if (clock() - time(row.created_at) >= 120000 && row.resource_type === 'ticket') {
          const config = await rules()
          await enqueue({ id: `unavailable:${row.resource_id}:${row.cycle_id ?? row.event_id}`, kind: 'delivery_unavailable', stage: 'unavailable', resource_type: 'ticket', resource_id: row.resource_id, occurred_at: row.created_at }, config)
        }
        return { ok: true }
      }
      if (row.attempt_id !== value.attemptId) throw fail(409, '发送尝试已失效')
      if (row.status !== 'sending') return { status: row.status }
      if (!['sent', 'unknown', 'not_attempted'].includes(value.outcome)) throw fail(400, '发送结果无效')
      const status = value.outcome === 'not_attempted' ? 'retry_wait' : value.outcome
      const receipt = typeof value.receiptId === 'string' ? value.receiptId.slice(0, 128) : null
      await run('UPDATE staff_im_notifications SET status=?,sent_at=?,error_code=?,receipt_id=?,available_at=?,lease_until=NULL WHERE id=?', status, status === 'sent' ? iso(clock()) : null, status === 'sent' ? null : 'DELIVERY_UNCONFIRMED', receipt, iso(clock() + 30000), row.id)
      await run('UPDATE staff_im_attempts SET status=?,completed_at=now(),error_code=?,receipt_id=? WHERE id=?', value.outcome, status === 'sent' ? null : 'DELIVERY_UNCONFIRMED', receipt, value.attemptId)
      return { status }
    })
    throw fail(404, '内部通知接口不存在')
  }
  async function handle(req, res, url) {
    if (!url.pathname.startsWith(internalPrefix) && !url.pathname.startsWith('/staff-api/im/')) return false
    if (url.pathname.startsWith(internalPrefix)) {
      if (req.method !== 'POST') throw fail(405, '请求方式不支持')
      const { raw, value } = await body(req)
      if (!verify(req.headers, url.pathname, raw)) throw fail(403, '内部通知签名无效', 'FORBIDDEN')
      json(res, 200, await internal(req, url.pathname.slice(internalPrefix.length), value)); return true
    }
    const who = await auth.resolveCurrent(req)
    const suffix = url.pathname.slice('/staff-api/im/'.length)
    if (suffix === 'notification-preferences') {
      if (req.method === 'GET') {
        json(res, 200, { ...(await one('SELECT * FROM staff_im_preferences WHERE staff_id=?', who.actorId) ?? { enabled: false, quiet_start: null, quiet_end: null, urgent_override: false, version: 0 }), binding: await one('SELECT id,revision,enabled FROM staff_im_bindings WHERE staff_id=? AND revoked_at IS NULL', who.actorId) ?? null }); return true
      }
      if (req.method === 'PATCH') {
        const { value: v } = await body(req)
        if (v.confirmed !== true || typeof v.enabled !== 'boolean' || typeof v.urgentOverride !== 'boolean' || !Number.isSafeInteger(v.version) || [v.quietStart, v.quietEnd].some(x => x !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x ?? '')) || Boolean(v.quietStart) !== Boolean(v.quietEnd)) throw fail(400, '请核对提醒设置并确认')
        await db.transaction(async () => {
          const changed = await run('UPDATE staff_im_preferences SET enabled=?,quiet_start=?,quiet_end=?,urgent_override=?,version=version+1 WHERE staff_id=? AND version=?', v.enabled, v.quietStart, v.quietEnd, v.urgentOverride, who.actorId, v.version)
          if (!changed.changes) throw fail(409, '设置已变化或尚未绑定，请刷新')
          if (!v.enabled) await run("UPDATE staff_im_notifications SET status='suppressed',error_code='NOTIFICATIONS_DISABLED' WHERE staff_id=? AND status IN ('queued','retry_wait','deferred')", who.actorId)
          await writeAudit({ actorId: who.actorId, action: 'staff.im.preferences', targetType: 'staff-im', targetId: who.actorId })
        }); json(res, 200, { ok: true }); return true
      }
    }
    if (suffix === 'notification-rules') {
      if (who.role !== 'supervisor') throw fail(403, '仅主管可以管理团队提醒')
      if (req.method === 'GET') { json(res, 200, { rules: await rules(), staff: await all("SELECT id,name,role FROM staff_users WHERE role IN ('csr','supervisor') ORDER BY name") }); return true }
      if (req.method === 'PUT') {
        const { value: v } = await body(req)
        if (v.confirmed !== true || !Number.isSafeInteger(v.version) || !Array.isArray(v.csrIds) || !Array.isArray(v.supervisorIds) || v.csrIds.length > 10 || v.supervisorIds.length < 1 || v.supervisorIds.length > 10 || [...v.csrIds, ...v.supervisorIds].some(x => typeof x !== 'string') || [v.start, v.end].some(x => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x ?? ''))) throw fail(400, '请配置合法值班池、时段和备用主管')
        for (const [ids, role] of [[v.csrIds, 'csr'], [v.supervisorIds, 'supervisor']]) for (const id of ids) {
          if ((await person(id))?.role !== role) throw fail(400, '接收人员角色不匹配')
        }
        await db.transaction(async () => {
          const changed = await run('UPDATE staff_im_rules SET config=?::jsonb,version=version+1,updated_by=? WHERE id=1 AND version=?', JSON.stringify({ csrIds: [...new Set(v.csrIds)], supervisorIds: [...new Set(v.supervisorIds)], start: v.start, end: v.end }), who.actorId, v.version)
          if (!changed.changes) throw fail(409, '规则已变化，请刷新')
          await run("UPDATE staff_im_outbox SET routed_at=NULL,next_route_at=now() WHERE occurred_at>now()-interval '24 hours' AND routing_status NOT IN ('suppressed','expired')")
          await writeAudit({ actorId: who.actorId, action: 'staff.im.rules', targetType: 'staff-im', targetId: 'team' })
        }); json(res, 200, { ok: true }); return true
      }
    }
    if (suffix === 'notifications' && req.method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1)
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw fail(400, '页码无效')
      const team = url.searchParams.get('team') === 'true' && who.role === 'supervisor'
      const where = team ? '' : 'WHERE n.staff_id=?', args = team ? [] : [who.actorId]
      const count = await one(`SELECT COUNT(*) AS n FROM staff_im_notifications n ${where}`, ...args)
      const items = await all(`SELECT n.id,n.kind,n.stage,n.resource_type,n.resource_id,n.staff_id,n.status,n.created_at,n.sent_at,n.error_code,
        COALESCE(t.status,a.status) AS task_status FROM staff_im_notifications n LEFT JOIN tickets t ON n.resource_type='ticket' AND t.id=n.resource_id
        LEFT JOIN approvals a ON n.resource_type='approval' AND a.id=n.resource_id ${where} ORDER BY n.created_at DESC LIMIT 30 OFFSET ?`, ...args, (page - 1) * 30)
      const waiting = team ? Number((await one("SELECT count(*) AS n FROM staff_im_outbox WHERE routing_status='waiting_recipient'")).n) : 0
      json(res, 200, { items, total: Number(count.n), page, waitingRecipients: waiting }); return true
    }
    throw fail(405, '接口或请求方式不支持')
  }
  return { handle, sweep, prepare }
}
