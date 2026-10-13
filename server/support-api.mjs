/** Authenticated customer ↔ staff ticket channel. No shared employee/agent credential. */
import { randomUUID, createHash } from 'node:crypto'
import { redactSupportText } from '../shared/support.mjs'
const fail = (message, status = 400, code = 'INVALID_REQUEST') => Object.assign(new Error(message), { status, code })
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const stamp = () => new Date().toISOString()
const requiredText = (value, limit, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw fail(`${name}不能为空，且不超过 ${limit} 字`)
  const text = redactSupportText(value)
  if (!text) throw fail(`${name}不能为空`)
  return text
}
export function createCustomerSupportApi({ db, auth }) {
  db.exec(`CREATE TABLE IF NOT EXISTS customer_support_requests (
    owner_id TEXT NOT NULL, request_id TEXT NOT NULL, kind TEXT NOT NULL,
    ticket_id TEXT NOT NULL, result_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
    PRIMARY KEY(owner_id, request_id));
    CREATE INDEX IF NOT EXISTS idx_customer_support_ticket ON customer_support_requests(ticket_id, kind, owner_id);
    CREATE INDEX IF NOT EXISTS idx_customer_support_list ON tickets(customer_id, updated_at);`)
  const ticket = row => ({ ticketId: row.id, reason: row.reason, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })
  const owned = (id, ownerId) => {
    const row = db.prepare(`SELECT * FROM tickets WHERE id = ? AND customer_id = ? AND EXISTS (SELECT 1 FROM customer_support_requests r WHERE r.ticket_id = tickets.id AND r.kind = 'create' AND r.owner_id = tickets.customer_id)`).get(id, ownerId)
    if (!row) throw fail('工单不存在', 404, 'NOT_FOUND')
    return row
  }
  const audit = (ownerId, action, id) => db.prepare(`INSERT INTO audit_logs
    (id,actor_type,actor_id,action,target_type,target_id,result,request_id,reason,created_at)
    VALUES (?, 'customer', ?, ?, 'ticket', ?, 'ok', NULL, NULL, ?)`).run(randomUUID(), ownerId, action, id, stamp())
  async function read(req, allowed) {
    const chunks = []; let size = 0, oversized = false
    // Drain oversize bodies without retaining them, so the client receives a JSON 413 reliably.
    for await (const chunk of req) {
      size += chunk.length
      if (size > 192 * 1024) { oversized = true; chunks.length = 0 }
      else if (!oversized) chunks.push(chunk)
    }
    if (oversized) throw fail('提交内容过大', 413)
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw fail('请求体不是合法 JSON') }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw fail('请求字段不合法')
    if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.requestId)) throw fail('缺少有效请求编号')
    return body
  }
  function mutation(ownerId, body, kind, payload, work) {
    const fingerprint = hash(payload)
    db.exec('BEGIN IMMEDIATE')
    try {
      const previous = db.prepare('SELECT * FROM customer_support_requests WHERE owner_id = ? AND request_id = ?').get(ownerId, body.requestId)
      if (previous) {
        if (previous.kind !== kind || previous.payload_hash !== fingerprint) throw fail('请求编号已用于其他内容，请重新提交', 409, 'REQUEST_CONFLICT')
        db.exec('COMMIT')
        return { ticketId: previous.ticket_id, messageId: previous.result_id, repeated: true }
      }
      const result = work()
      db.prepare('INSERT INTO customer_support_requests VALUES (?, ?, ?, ?, ?, ?)').run(ownerId, body.requestId, kind, result.ticketId, result.messageId ?? result.ticketId, fingerprint)
      audit(ownerId, kind === 'create' ? 'ticket.create' : 'ticket.message', result.ticketId)
      db.exec('COMMIT')
      return result
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  function json(res, status, data) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(data))
  }
  return { async handle(req, res, url) {
    const match = /^\/api\/support\/tickets(?:\/([^/]+)(\/messages)?)?$/.exec(url.pathname)
    if (!match) return false
    const ownerId = auth.identity(req).id
    const [, id, sub] = match
    if (!id && req.method === 'GET') {
      // Bounded pages; no silent truncation of older customer cases.
      const page = Number(url.searchParams.get('page') ?? 1)
      if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw fail('页码不合法')
      const total = db.prepare(`SELECT COUNT(*) AS count FROM tickets WHERE customer_id = ? AND id IN (SELECT ticket_id FROM customer_support_requests WHERE kind = 'create')`).get(ownerId).count
      const rows = db.prepare(`SELECT * FROM tickets WHERE customer_id = ? AND id IN (SELECT ticket_id FROM customer_support_requests WHERE kind = 'create') ORDER BY updated_at DESC, rowid DESC LIMIT 20 OFFSET ?`).all(ownerId, (page - 1) * 20)
      json(res, 200, { items: rows.map(ticket), page, size: 20, total }); return true
    }
    if (!id && req.method === 'POST') {
      const body = await read(req, ['requestId', 'reason', 'transcript'])
      const reason = requiredText(body.reason, 500, '问题描述')
      const transcript = body.transcript ?? []
      if (!Array.isArray(transcript) || transcript.length > 20 || transcript.some(item => !item || !['user','assistant'].includes(item.role) || typeof item.text !== 'string' || item.text.length > 2000)) throw fail('对话摘要不合法')
      const safeTranscript = transcript.map(item => ({ role: item.role, text: redactSupportText(item.text) })).filter(item => item.text)
      const result = mutation(ownerId, body, 'create', { reason, transcript: safeTranscript }, () => {
        const id = `T_${randomUUID().replaceAll('-', '')}`, ts = stamp()
        db.prepare(`INSERT INTO tickets (id,customer_id,channel,reason,priority,status,assignee_id,created_by,agent_transcript,created_at,updated_at)
          VALUES (?, ?, 'web', ?, 'normal', 'open', NULL, ?, ?, ?, ?)`).run(id, ownerId, reason, `customer:${ownerId}`, JSON.stringify(safeTranscript), ts, ts)
        return { ticketId: id }
      })
      json(res, result.repeated ? 200 : 201, ticket(owned(result.ticketId, ownerId))); return true
    }
    if (id && !sub && req.method === 'GET') {
      const row = owned(id, ownerId)
      const messages = db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, rowid').all(id)
        .map(item => ({ id: item.id, sender: item.sender, text: item.text, createdAt: item.created_at }))
      // Only the published support conversation; no assignee, audit or approval fields.
      json(res, 200, { ...ticket(row), messages }); return true
    }
    if (id && sub && req.method === 'POST') {
      owned(id, ownerId)
      const body = await read(req, ['requestId', 'text'])
      const value = requiredText(body.text, 2000, '留言')
      const result = mutation(ownerId, body, 'reply', { ticketId: id, text: value }, () => {
        const row = owned(id, ownerId)
        if (row.status === 'resolved') throw fail('工单已解决，如仍需帮助请重新转人工', 409, 'TICKET_CLOSED')
        const messageId = `msg_${randomUUID().replaceAll('-', '')}`, ts = stamp()
        db.prepare('INSERT INTO ticket_messages VALUES (?, ?, ?, ?, ?)').run(messageId, id, 'customer', value, ts)
        db.prepare("UPDATE tickets SET updated_at = ?, status = CASE WHEN status = 'waiting' THEN 'processing' ELSE status END WHERE id = ?").run(ts, id)
        return { ticketId: id, messageId }
      })
      json(res, result.repeated ? 200 : 201, { messageId: result.messageId }); return true
    }
    throw fail('请求方法不支持', 405, 'METHOD_NOT_ALLOWED')
  } }
}
