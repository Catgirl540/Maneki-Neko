import { createHash, randomBytes } from 'node:crypto'
import { CURRENT_KEY, PROFILES_KEY } from './database.mjs'

/**
 * 工作人员端 `/staff-api/*` —— Phase 0 骨架
 *
 * 职责边界（工作人员端清单.md §0/§9.4）：
 *   - 员工鉴权（Bearer staff token，与客户 token 不混用）
 *   - 工单 / 审批 / 审计三张业务表的路由架子
 *   - writeAudit()：所有写操作的统一落账出口
 *   - 给 agent 的 5 个端点与员工前端共用同一套处理器，只换鉴权通道
 *
 * 契约：design/staff-console/工作人员端清单.md §5（冻结稿）
 */

const STAFF_SESSION_HOURS = 12
/**
 * 大额转账延迟到账阈值（清单 §9.1）。
 * **运行时可改**（2026-10-12 拍板）：落在 `staff_settings` 表里，员工端随时调，
 * 重启不丢；env 只是**首次建库的种子值**，不是唯一事实来源。
 * 默认 ¥500,000 = 50000000 分。金额一律整数分，别跟元混用。
 */
const REVIEW_THRESHOLD_SEED_CENTS = Number(process.env.BANK_TRANSFER_REVIEW_CENTS ?? 50_000_000)
const SETTING_TRANSFER_REVIEW_CENTS = 'transfer_review_cents'
/**
 * 阈值必须低于单笔转账上限，否则「进窗口」永远触发不了。
 * 与 `app/src/api/mock/index.ts` 的 `BANK_SINGLE_LIMIT`（¥1,000,000）对齐。
 */
const REVIEW_THRESHOLD_MAX_CENTS = 90_000_000
/**
 * 拦截理由是**枚举**（清单 §9.5）：自由文本等于允许"看着不爽"这种理由，
 * 也就把用户的资金处置权变成了员工的随心所欲。必须可审计、可统计。
 */
const INTERCEPT_REASONS = ['疑似诈骗', '收款方风险名单', '交易行为异常', '客户来电要求叫停']

// —— 建表（幂等） ————————————————————————————————————————
export function ensureStaffSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('csr','supervisor','ops')),
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id              TEXT PRIMARY KEY,
      customer_id     TEXT NOT NULL,
      channel         TEXT NOT NULL,
      reason          TEXT NOT NULL,
      priority        TEXT NOT NULL DEFAULT 'normal',
      status          TEXT NOT NULL DEFAULT 'open',
      assignee_id     TEXT,
      created_by      TEXT,
      transfer_id     TEXT,
      approval_id     TEXT,
      agent_transcript TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id         TEXT PRIMARY KEY,
      ticket_id  TEXT NOT NULL,
      sender     TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id               TEXT PRIMARY KEY,
      biz_type         TEXT NOT NULL,
      biz_payload      TEXT NOT NULL,
      risk_summary     TEXT NOT NULL DEFAULT '',
      applicant_id     TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      execution_status TEXT NOT NULL DEFAULT 'pending',
      execution_error  TEXT,
      decided_by       TEXT,
      reason           TEXT,
      created_at       TEXT NOT NULL,
      decided_at       TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          TEXT PRIMARY KEY,
      actor_type  TEXT NOT NULL,
      actor_id    TEXT,
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   TEXT,
      result      TEXT NOT NULL DEFAULT 'ok',
      request_id  TEXT,
      reason      TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_access_logs (
      id          TEXT PRIMARY KEY,
      staff_id    TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      reason      TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );
  `)
  // Preserve existing employees when expanding the role CHECK on an older database.
  const staffDefinition = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'staff_users'").get().sql
  if (!staffDefinition.includes("'ops'")) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE staff_users_next (id TEXT PRIMARY KEY, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('csr','supervisor','ops')), password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO staff_users_next SELECT id, name, role, password_hash, created_at FROM staff_users;
      DROP TABLE staff_users;
      ALTER TABLE staff_users_next RENAME TO staff_users;
      COMMIT;`)
  }
  // 老库迁移：tickets.created_by 是 Phase 1 加的（agent 只能查自己建的单，§5.5 约定 6）
  const ticketCols = db.prepare('PRAGMA table_info(tickets)').all()
  if (!ticketCols.some((c) => c.name === 'created_by')) {
    db.exec('ALTER TABLE tickets ADD COLUMN created_by TEXT')
  }
  // 演示账号：王小明（csr）/ 李主管（supervisor）。密码明文只在 demo 校验，
  // 哈希落库是防止「表里躺明文」的最低要求（清单 §3）。
  const seed = db.prepare('SELECT COUNT(*) AS n FROM staff_users').get()
  if (seed.n === 0) {
    const now = new Date().toISOString()
    const insert = db.prepare(
      'INSERT INTO staff_users (id, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    insert.run('staff_wang', '王小明', 'csr', hashPassword('123456'), now)
    insert.run('staff_li', '李主管', 'supervisor', hashPassword('123456'), now)
  }
  // 运行时配置种子：库空时写一次，之后以库里为准（员工端改了就生效，重启不回退）。
  db.prepare('INSERT OR IGNORE INTO staff_users (id, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('staff_ops', '运维人员', 'ops', hashPassword(process.env.BANK_OPS_PASSWORD ?? '123456'), new Date().toISOString())
  const hasThreshold = db.prepare('SELECT 1 AS x FROM staff_settings WHERE key = ?')
    .get(SETTING_TRANSFER_REVIEW_CENTS)
  if (!hasThreshold) {
    db.prepare('INSERT INTO staff_settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run(SETTING_TRANSFER_REVIEW_CENTS, String(REVIEW_THRESHOLD_SEED_CENTS), new Date().toISOString())
  }
}

/** 读延迟到账阈值（整数分）。库缺失时回落到 env 种子值，保证永远读得到数。 */
export function getTransferReviewCents(db) {
  const row = db.prepare('SELECT value FROM staff_settings WHERE key = ?')
    .get(SETTING_TRANSFER_REVIEW_CENTS)
  const n = Number(row?.value ?? REVIEW_THRESHOLD_SEED_CENTS)
  return Number.isFinite(n) && n > 0 ? n : REVIEW_THRESHOLD_SEED_CENTS
}

/**
 * 写延迟到账阈值（整数分）。校验在这里，不信任调用方。
 * 上限单列一条：阈值若高过单笔上限，转账根本走不到「进窗口」那一步。
 */
export function setTransferReviewCents(db, cents, actorId) {
  const n = Number(cents)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw staffError(400, '阈值必须是整数分（¥1 = 100）', 'BAD_THRESHOLD')
  }
  if (n <= 0) {
    throw staffError(400, '阈值必须大于 0', 'BAD_THRESHOLD')
  }
  if (n > REVIEW_THRESHOLD_MAX_CENTS) {
    throw staffError(
      400,
      `阈值不能超过 ¥${(REVIEW_THRESHOLD_MAX_CENTS / 100).toLocaleString('zh-CN')}（须低于单笔转账上限，否则永远进不了窗口）`,
      'BAD_THRESHOLD',
    )
  }
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO staff_settings (key, value, updated_by, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(SETTING_TRANSFER_REVIEW_CENTS, String(n), actorId ?? null, now)
  return n
}

function hashPassword(plain) {
  // demo 级：真实系统上 bcrypt/argon2。这里只做「不明文落库」。
  return `sha256:${createHash('sha256').update(plain).digest('hex')}`
}

// —— 错误体（与客户端一致：{ message, code }） ————————————————
export function staffError(status, message, code) {
  return Object.assign(new Error(message), { status, code })
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

// —— 写审计（所有写操作统一出口，漏记视为缺陷） ————————————
export function makeWriteAudit(db) {
  const insert = db.prepare(`INSERT INTO audit_logs
    (id, actor_type, actor_id, action, target_type, target_id, result, request_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  return function writeAudit({ actorType = 'staff', actorId = null, action, targetType = null, targetId = null, result = 'ok', requestId = null, reason = null }) {
    insert.run(
      `log_${randomBytes(8).toString('hex')}`,
      actorType, actorId, action, targetType, targetId, result, requestId, reason,
      new Date().toISOString(),
    )
  }
}

// —— 员工鉴权 ————————————————————————————————————————————
export function createStaffAuth(db) {
  const sessions = new Map()

  function resolve(req, { roles = ['csr', 'supervisor'], allowAgent = false } = {}) {
    const header = req.headers.authorization ?? ''
    const agentToken = req.headers['x-agent-token']

    if (allowAgent && agentToken) {
      const expected = process.env.STAFF_AGENT_TOKEN ?? 'demo-agent-token'
      if (agentToken !== expected) throw staffError(401, 'Agent 令牌无效', 'UNAUTHORIZED')
      // agent 通道：只保证调用方是 agent，具体能干什么由路由层限制（清单 §5 约定 6）
      return { actorType: 'agent', actorId: 'agent', role: 'agent' }
    }

    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header)
    const entry = match ? sessions.get(match[1]) : null
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) sessions.delete(match[1])
      throw staffError(401, '请重新登录', 'UNAUTHORIZED')
    }
    if (!roles.includes(entry.role)) {
      throw staffError(403, '当前角色无权执行该操作', 'FORBIDDEN')
    }
    return { actorType: 'staff', actorId: entry.id, role: entry.role, name: entry.name }
  }

  function login(name, password) {
    const row = db.prepare('SELECT * FROM staff_users WHERE name = ?').get(name)
    if (!row || row.password_hash !== hashPassword(password)) {
      throw staffError(401, '员工账号或密码错误', 'BAD_CREDENTIALS')
    }
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, {
      id: row.id, name: row.name, role: row.role,
      expiresAt: Date.now() + STAFF_SESSION_HOURS * 3600_000,
    })
    return { token, staff: { id: row.id, name: row.name, role: row.role } }
  }

  function logout(req) {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')
    if (match) sessions.delete(match[1])
  }

  return { resolve, login, logout }
}

// —— 工单状态机（清单 §4.1，非法流转 400） ——————————————————
const TICKET_TRANSITIONS = {
  open: ['processing', 'suspended'],
  processing: ['waiting', 'resolved', 'suspended'],
  waiting: ['processing', 'resolved'],
  suspended: ['processing'],
  resolved: [],
}

function assertTicketTransition(from, to) {
  if (!TICKET_TRANSITIONS[from]?.includes(to)) {
    throw staffError(400, `工单状态不能从「${from}」变为「${to}」`, 'INVALID_TRANSITION')
  }
}

// —— 客户展示名（工单列表要显示「客户名」，清单 §2） ————————
// 银行侧档案存在 app_storage 的 JSON 快照里（见 database.mjs）。这里只读名字，
// 不碰余额/流水；读不到就回落显示 customerId，不影响主链路。
function readCustomerNames(db) {
  const names = new Map()
  try {
    for (const key of [CURRENT_KEY, PROFILES_KEY]) {
      const row = db.prepare('SELECT value_json FROM app_storage WHERE key = ?').get(key)
      if (!row) continue
      const parsed = JSON.parse(row.value_json)
      if (key === PROFILES_KEY) {
        for (const profile of Object.values(parsed)) {
          if (profile?.user?.id) names.set(profile.user.id, profile.user.name)
        }
      } else if (parsed?.user?.id) {
        names.set(parsed.user.id, parsed.user.name)
      }
    }
  } catch {
    // bank 侧还没数据（比如冒烟用的空库）就算了
  }
  return names
}

// —— 路由表 ————————————————————————————————————————————
/**
 * 注册全部 /staff-api/* 路由。放在 bank.handle 之前调用，
 * 命中即返回 true，未命中交还给客户端既有 /api/*。
 */
/**
 * @param options.db - 与银行侧共用的 SQLite 连接
 * @param options.bankHooks - 资金侧钩子（由 index.mjs 从 demo-bank 注入）：
 *   `getHeldTransfer({customerId, transactionId})` 查挂起指令；
 *   `settleHeldTransfer({customerId, transactionId, outcome, reason})` 放行/驳回，
 *   内部走 submitTransfer 同一条业务路（§9.4 红线：不许直接改流水表）。
 */
export function createStaffApi({ db, bankHooks = {}, operations }) {
  ensureStaffSchema(db)
  const auth = createStaffAuth(db)
  const writeAudit = makeWriteAudit(db)

  const newId = (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`
  const now = () => new Date().toISOString()

  async function readBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (!chunks.length) return {}
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw staffError(400, '请求体不是合法 JSON', 'BAD_JSON')
    }
  }

  function requireFields(body, fields) {
    for (const key of fields) {
      if (body[key] === undefined || body[key] === null || body[key] === '') {
        throw staffError(400, `缺少字段：${key}`, 'MISSING_FIELD')
      }
    }
  }

  // —— 大额转账在途窗口：自动建记录（清单 §9.4.2） ————————————
  // 唯一约束：一笔在途指令同时只有一张 pending 记录；重复提交返回原单（幂等）。
  function findPendingTransferApproval(transactionId) {
    return db.prepare(
      `SELECT * FROM approvals
       WHERE biz_type = 'transfer' AND status = 'pending'
         AND json_extract(biz_payload, '$.transactionId') = ?`,
    ).get(transactionId)
  }

  function createTransferApproval({ customerId, request, result }) {
    const transactionId = result.transactionId
    const existing = findPendingTransferApproval(transactionId)
    if (existing) return { approvalId: existing.id, status: existing.status }
    const amountText = (result.amount / 100).toLocaleString('zh-CN')
    const thresholdText = (getTransferReviewCents(db) / 100).toLocaleString('zh-CN')
    const holdUntil = result.holdUntil ?? new Date().toISOString()
    const id = newId('A')
    // 参数快照冻结在 biz_payload（建单后冻结，处置时不再变）；
    // riskSummary 由服务端生成，不采信调用方自述（§5.2）。
    db.prepare(`INSERT INTO approvals
      (id, biz_type, biz_payload, risk_summary, applicant_id, status, execution_status, created_at)
      VALUES (?, 'transfer', ?, ?, NULL, 'pending', 'pending', ?)`)
      .run(id,
        JSON.stringify({ transactionId, customerId, request, amount: result.amount, fee: result.fee ?? 0, holdUntil }),
        `单笔 ¥${amountText}，超过延迟到账阈值 ¥${thresholdText}，将于窗口到点自动到账`,
        now())
    writeAudit({
      actorType: 'agent', actorId: 'system-hold', action: 'approval.create',
      targetType: 'approval', targetId: id, reason: `inflight ${transactionId}`,
    })
    return { approvalId: id, status: 'pending' }
  }

  /**
   * 窗口了结（到账 / 拦截 / 撤销）时关单。
   * 三条路都会走到这里：员工处置、用户撤销、定时扫账自动到账。
   */
  function closeTransferApproval({ customerId, transactionId, outcome, reason, actorId, actorType }) {
    const row = findPendingTransferApproval(transactionId)
    if (!row) return null
    const status = outcome === 'settled' ? 'settled' : outcome === 'recalled' ? 'recalled' : 'intercepted'
    // 执行态：到账=已执行；拦截/撤销=资金从未执行（不是"失败"，是"没做"）
    const executionStatus = outcome === 'settled' ? 'succeeded' : 'failed'
    const executionError = outcome === 'settled' ? null
      : outcome === 'recalled' ? '用户已撤销，未执行资金操作'
      : `已拦截，未执行资金操作${reason ? `（${reason}）` : ''}`
    db.prepare(`UPDATE approvals
       SET status = ?, execution_status = ?, execution_error = ?,
           decided_by = ?, reason = ?, decided_at = ?
       WHERE id = ?`)
      .run(status, executionStatus, executionError,
        actorId ?? null, reason ?? null, now(), row.id)
    writeAudit({
      actorType: actorType ?? 'agent', actorId: actorId ?? 'system',
      action: `approval.${status}`, targetType: 'approval', targetId: row.id,
      reason: reason ?? null,
    })
    if (outcome !== 'settled') {
      noteTicket(row, outcome === 'recalled'
        ? `【系统】转账已被用户撤销：${reason ?? '用户主动撤销'}`
        : `【系统】转账已被拦截：${reason ?? '（未填理由）'}`)
    }
    return row.id
  }

  /** 处置结果回写工单消息（§9.4.3），让客户侧有人跟进 */
  function noteTicket(approval, text) {
    const row = db.prepare(
      'SELECT id FROM tickets WHERE approval_id = ? OR transfer_id = ? LIMIT 1',
    ).get(approval.id, JSON.parse(approval.biz_payload).transactionId)
    if (!row) return
    db.prepare('INSERT INTO ticket_messages (id, ticket_id, sender, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId('msg'), row.id, 'system', text, now())
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), row.id)
  }

  async function handle(req, res, url) {
    const path = url.pathname
    if (!path.startsWith('/staff-api/')) return false

    // —— 健康检查（无需鉴权） ——
    if (path === '/staff-api/health') {
      json(res, 200, { ok: true, kind: 'staff-api' })
      return true
    }

    try {
      // —— 员工登录（独立于客户登录） ——
      if (path === '/staff-api/login' && req.method === 'POST') {
        const body = await readBody(req)
        requireFields(body, ['name', 'password'])
        const { token, staff } = auth.login(body.name, body.password)
        writeAudit({ actorId: staff.id, action: 'staff.login' })
        json(res, 200, { token, staff })
        return true
      }

      if (path === '/staff-api/logout' && req.method === 'POST') {
        auth.logout(req)
        json(res, 200, { ok: true })
        return true
      }

      if (path === '/staff-api/me' && req.method === 'GET') {
        const who = auth.resolve(req, { roles: ['csr', 'supervisor', 'ops'] })
        json(res, 200, { id: who.actorId, name: who.name, role: who.role })
        return true
      }

      if (path === '/staff-api/ops/overview') {
        auth.resolve(req, { roles: ['ops'] })
        if (req.method !== 'GET') throw staffError(405, '运维模块当前仅支持查询', 'METHOD_NOT_ALLOWED')
        if (!operations) throw staffError(503, '运维监控未配置', 'OPERATIONS_UNAVAILABLE')
        json(res, 200, await operations.overview())
        return true
      }

      // —— 工单（清单 §2 P0） ——
      if (path === '/staff-api/tickets' && req.method === 'POST') {
        // agent 转人工入口：允许 agent 通道；员工也可以代建
        const who = auth.resolve(req, { allowAgent: true })
        const body = await readBody(req)
        requireFields(body, ['customerId', 'channel', 'reason'])
        const id = newId('T')
        const ts = now()
        db.prepare(`INSERT INTO tickets
          (id, customer_id, channel, reason, priority, status, assignee_id, created_by, transfer_id, approval_id, agent_transcript, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?, ?, ?, ?)`)
          .run(id, body.customerId, body.channel, body.reason,
            body.priority === 'high' ? 'high' : 'normal',
            who.actorId,
            body.transferId ?? null, body.approvalId ?? null,
            body.transcript ? JSON.stringify(body.transcript) : null, ts, ts)
        writeAudit({ actorType: who.actorType, actorId: who.actorId, action: 'ticket.create', targetType: 'ticket', targetId: id })
        json(res, 201, { ticketId: id, status: 'open' })
        return true
      }

      if (path === '/staff-api/tickets' && req.method === 'GET') {
        // agent 也允许列（但下面只给它看自己建的单，§5.5 约定 6）
        const who = auth.resolve(req, { allowAgent: true })
        // 筛选（清单 §2）：状态 / 渠道 / 关键词
        const where = []
        const params = []
        const status = url.searchParams.get('status')
        const channel = url.searchParams.get('channel')
        const keyword = url.searchParams.get('keyword')
        if (status) {
          where.push('status = ?')
          params.push(status)
        }
        if (channel) {
          where.push('channel = ?')
          params.push(channel)
        }
        if (keyword) {
          where.push('(id LIKE ? OR customer_id LIKE ? OR reason LIKE ?)')
          const like = `%${keyword}%`
          params.push(like, like, like)
        }
        // agent 只能看自己建的单（§5.5 约定 6）；员工看全部
        if (who.role === 'agent') {
          where.push('created_by = ?')
          params.push(who.actorId)
        }
        const sql = `SELECT * FROM tickets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 100`
        const rows = db.prepare(sql).all(...params)
        writeAudit({ actorId: who.actorId, action: 'ticket.list', result: 'ok' })
        const names = readCustomerNames(db)
        json(res, 200, rows.map((row) => mapTicket(row, names)))
        return true
      }

      const ticketMatch = /^\/staff-api\/tickets\/([^/]+)(\/status|\/messages)?$/.exec(path)
      if (ticketMatch) {
        const [, id, sub] = ticketMatch
        const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)
        if (!ticket) throw staffError(404, '工单不存在', 'NOT_FOUND')

        if (!sub && req.method === 'GET') {
          const who = auth.resolve(req, { allowAgent: true })
          // agent 只能查自己建的单（§5.5 约定 6）
          if (who.role === 'agent' && ticket.created_by !== who.actorId) {
            throw staffError(403, '只能查看自己创建的工单', 'FORBIDDEN')
          }
          const messages = db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, rowid').all(id)
          json(res, 200, { ...mapTicket(ticket, readCustomerNames(db)), messages })
          return true
        }

        if (sub === '/status' && req.method === 'PATCH') {
          const who = auth.resolve(req, {})
          const body = await readBody(req)
          requireFields(body, ['status'])
          // 纯转派：状态不变、只换负责人（「转给主管」），不走状态机（contract v1.1 注释）
          if (body.status === ticket.status) {
            requireFields(body, ['assigneeId'])
            db.prepare('UPDATE tickets SET assignee_id = ?, updated_at = ? WHERE id = ?')
              .run(body.assigneeId, now(), id)
            writeAudit({ actorId: who.actorId, action: 'ticket.reassign', targetType: 'ticket', targetId: id, reason: body.assigneeId })
            json(res, 200, mapTicket(db.prepare('SELECT * FROM tickets WHERE id = ?').get(id), readCustomerNames(db)))
            return true
          }
          assertTicketTransition(ticket.status, body.status)
          const assignee = body.status === 'processing' ? (body.assigneeId ?? who.actorId) : ticket.assignee_id
          db.prepare('UPDATE tickets SET status = ?, assignee_id = ?, updated_at = ? WHERE id = ?')
            .run(body.status, assignee, now(), id)
          writeAudit({ actorId: who.actorId, action: 'ticket.status', targetType: 'ticket', targetId: id, reason: body.status })
          json(res, 200, mapTicket(db.prepare('SELECT * FROM tickets WHERE id = ?').get(id), readCustomerNames(db)))
          return true
        }

        if (sub === '/messages' && req.method === 'POST') {
          // sender 由登录态生成，不信任请求体（清单 §5.5 / 不变量 10）
          const who = auth.resolve(req, { allowAgent: true })
          // agent 只能回写自己建的单（§5.5 约定 6）
          if (who.role === 'agent' && ticket.created_by !== who.actorId) {
            throw staffError(403, '只能回复自己创建的工单', 'FORBIDDEN')
          }
          const body = await readBody(req)
          requireFields(body, ['text'])
          if (ticket.status === 'resolved') throw staffError(409, '工单已解决，不能继续回复', 'TICKET_CLOSED')
          const sender = who.actorType === 'agent' ? 'system' : 'staff'
          const mid = newId('msg')
          db.prepare('INSERT INTO ticket_messages (id, ticket_id, sender, text, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(mid, id, sender, body.text, now())
          db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), id)
          writeAudit({ actorType: who.actorType, actorId: who.actorId, action: 'ticket.message', targetType: 'ticket', targetId: id })
          json(res, 201, { messageId: mid })
          return true
        }
      }

      // —— 审批（清单 §2 P0 / §9.4） ——
      if (path === '/staff-api/approvals' && req.method === 'POST') {
        const who = auth.resolve(req, { allowAgent: true })
        const body = await readBody(req)
        requireFields(body, ['customerId', 'bizType'])

        // transfer 类防伪造（清单 §5.2）：只能提**已挂起的转账指令**，
        // 金额/收款方/风险摘要由服务端从指令读取，不采信 agent 自述。
        if (body.bizType === 'transfer') {
          requireFields(body, ['transferId'])
          const existing = findPendingTransferApproval(body.transferId)
          if (existing) {
            json(res, 200, { approvalId: existing.id, status: existing.status })
            return true
          }
          const held = await bankHooks.getHeldTransfer?.({
            customerId: body.customerId,
            transactionId: body.transferId,
          })
          if (!held) {
            throw staffError(400, '没有找到对应的挂起转账指令', 'HELD_TRANSFER_NOT_FOUND')
          }
          const made = createTransferApproval({
            customerId: body.customerId,
            request: held.request,
            result: { transactionId: held.transactionId, amount: held.amount, fee: 0, holdUntil: held.holdUntil },
          })
          writeAudit({ actorType: who.actorType, actorId: who.actorId, action: 'approval.create', targetType: 'approval', targetId: made.approvalId })
          json(res, 201, made)
          return true
        }

        // 非 transfer 类：payload 可带，但 riskSummary 仍由服务端生成（§5.2）
        const id = newId('A')
        db.prepare(`INSERT INTO approvals
          (id, biz_type, biz_payload, risk_summary, applicant_id, status, execution_status, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', 'pending', ?)`)
          .run(id, body.bizType,
            JSON.stringify(body.payload ?? {}),
            body.riskSummary ? `申请自述：${String(body.riskSummary).slice(0, 200)}` : '（未提供风险说明，由主管人工判断）',
            who.actorType === 'staff' ? who.actorId : null,
            now())
        writeAudit({ actorType: who.actorType, actorId: who.actorId, action: 'approval.create', targetType: 'approval', targetId: id })
        json(res, 201, { approvalId: id, status: 'pending' })
        return true
      }

      if (path === '/staff-api/approvals' && req.method === 'GET') {
        const who = auth.resolve(req, {})
        const rows = db.prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100').all()
        json(res, 200, rows.map(mapApproval))
        return true
      }

      const approvalMatch = /^\/staff-api\/approvals\/([^/]+)(\/decide)?$/.exec(path)
      if (approvalMatch) {
        const [, id, sub] = approvalMatch
        const approval = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)
        if (!approval) throw staffError(404, '审批单不存在', 'NOT_FOUND')

        if (!sub && req.method === 'GET') {
          // agent 轮询裁决结果（清单 §5.3）
          auth.resolve(req, { allowAgent: true })
          json(res, 200, mapApproval(approval))
          return true
        }

        if (sub === '/decide' && req.method === 'POST') {
          const who = auth.resolve(req, { roles: ['supervisor'] })
          if (approval.status !== 'pending') {
            throw staffError(409, '该记录已处置，不能重复操作', 'ALREADY_DECIDED')
          }
          const body = await readBody(req)
          requireFields(body, ['decision'])
          // transfer 类走「在途窗口」语义：settle（立即到账）| intercept（拦截）。
          // 其他类仍是审批语义：approved | rejected。
          const isTransfer = approval.biz_type === 'transfer'
          const allowed = isTransfer
            ? ['settle', 'intercept']
            : ['approved', 'rejected', 'settle', 'intercept']
          if (!allowed.includes(body.decision)) {
            throw staffError(400,
              isTransfer
                ? 'decision 只能是 settle（立即到账）或 intercept（拦截）'
                : 'decision 只能是 approved 或 rejected',
              'BAD_DECISION')
          }
          // 拦截必须给理由，而且是**枚举**——自由文本等于允许"看着不爽"这种理由
          if (body.decision === 'intercept') {
            if (!body.reasonCode || !INTERCEPT_REASONS.includes(body.reasonCode)) {
              throw staffError(400, `拦截理由必须是：${INTERCEPT_REASONS.join(' / ')}`, 'REASON_REQUIRED')
            }
          }
          // 驳回必须给理由
          if (body.decision === 'rejected' && !body.reason) {
            throw staffError(400, '驳回必须填写理由', 'REASON_REQUIRED')
          }
          // 避嫌（清单 §2）：主管不得处置自己发起的单
          if (approval.applicant_id && approval.applicant_id === who.actorId) {
            throw staffError(403, '不能处置自己发起的记录', 'CONFLICT_OF_INTEREST')
          }
          const payload = JSON.parse(approval.biz_payload)
          if (approval.biz_type === 'transfer' && typeof bankHooks.settleHeldTransfer !== 'function') {
            throw staffError(503, '资金侧未接入，无法处置转账', 'BANK_HOOK_MISSING')
          }

          if (approval.biz_type === 'transfer') {
            // —— 资金落地（§9.4）：走共用业务入口，禁止直接改流水表 ——
            // settle → 解冻后走 submitTransfer 真正到账
            // intercept → 只解冻，指令从未执行过
            const outcome = body.decision === 'settle' ? 'settled' : 'intercepted'
            const reasonText = body.decision === 'intercept'
              ? `${body.reasonCode}${body.reasonDetail ? `：${body.reasonDetail}` : ''}`
              : body.reason ?? undefined
            try {
              await bankHooks.settleHeldTransfer({
                customerId: payload.customerId,
                transactionId: payload.transactionId,
                outcome,
                reason: reasonText,
              })
            } catch (error) {
              // 到账执行失败极少见（冻结后不会没钱）；照样关单，别让记录悬着
              db.prepare(`UPDATE approvals SET status = ?, execution_status = 'failed',
                 execution_error = ?, decided_by = ?, reason = ?, decided_at = ? WHERE id = ?`)
                .run(outcome === 'settled' ? 'settled' : 'intercepted',
                  `资金侧异常：${error?.message ?? '未知'}`, who.actorId, reasonText ?? null, now(), id)
              writeAudit({ actorId: who.actorId, action: 'approval.error', targetType: 'approval', targetId: id, reason: error?.message ?? null })
              json(res, 200, mapApproval(db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)))
              return true
            }
            // 正常路径：settleHeldTransfer 的 onHoldClosed 回调已把单子关掉并落审计，
            // 这里只补一条员工处置人，再回读一次给前端。
            db.prepare('UPDATE approvals SET decided_by = ?, reason = ? WHERE id = ?')
              .run(who.actorId, reasonText ?? null, id)
            json(res, 200, mapApproval(db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)))
            return true
          }

          // 非 transfer 类（锁卡 / 调额…）：仍是"审批"语义
          // 兼容两种写法：approved/rejected 直接用；settle/intercept 映射成通过/驳回
          const mapped = body.decision === 'approved' || body.decision === 'settle' ? 'approved' : 'rejected'
          db.prepare('UPDATE approvals SET status = ?, decided_by = ?, reason = ?, decided_at = ? WHERE id = ?')
            .run(mapped, who.actorId, body.reason ?? null, now(), id)
          writeAudit({ actorId: who.actorId, action: `approval.${mapped}`, targetType: 'approval', targetId: id, reason: body.reason ?? null })
          json(res, 200, mapApproval(db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)))
          return true
        }
      }

      // —— 运行时参数（清单 §9.1，2026-10-12 起可在员工端随时改） ——
      // 只给主管改：阈值是风控参数，客服能看见但不能随手拧。
      if (path === '/staff-api/settings/transfer-threshold' && req.method === 'GET') {
        auth.resolve(req, {})
        json(res, 200, {
          transferReviewCents: getTransferReviewCents(db),
          maxTransferReviewCents: REVIEW_THRESHOLD_MAX_CENTS,
        })
        return true
      }
      if (path === '/staff-api/settings/transfer-threshold' && req.method === 'PUT') {
        const who = auth.resolve(req, { roles: ['supervisor'] })
        const body = await readBody(req)
        const before = getTransferReviewCents(db)
        const next = setTransferReviewCents(db, body.transferReviewCents, who.actorId)
        writeAudit({
          actorId: who.actorId,
          action: 'settings.transferThreshold.update',
          targetType: 'setting',
          targetId: SETTING_TRANSFER_REVIEW_CENTS,
          reason: `¥${(before / 100).toLocaleString('zh-CN')} → ¥${(next / 100).toLocaleString('zh-CN')}`,
        })
        json(res, 200, {
          transferReviewCents: next,
          maxTransferReviewCents: REVIEW_THRESHOLD_MAX_CENTS,
        })
        return true
      }

      // —— 客户查询（清单 §2 P0，乙模块） ——
      if (path === '/staff-api/customers' && req.method === 'GET') {
        const who = auth.resolve(req, {})
        if (typeof bankHooks.searchCustomers !== 'function') {
          throw staffError(503, '银行侧未接入，无法查询客户', 'BANK_HOOK_MISSING')
        }
        const keyword = url.searchParams.get('keyword') ?? ''
        const results = await bankHooks.searchCustomers(keyword)
        writeAudit({ actorId: who.actorId, action: 'customer.search', reason: keyword || null })
        json(res, 200, results)
        return true
      }

      const customerProfileMatch = /^\/staff-api\/customers\/([^/]+)\/profile$/.exec(path)
      if (customerProfileMatch && req.method === 'GET') {
        const who = auth.resolve(req, {})
        const reason = (url.searchParams.get('reason') ?? '').trim()
        if (!reason) {
          throw staffError(400, '查看完整资料必须填写事由', 'REASON_REQUIRED')
        }
        if (typeof bankHooks.getCustomerProfile !== 'function') {
          throw staffError(503, '银行侧未接入，无法读取客户档案', 'BANK_HOOK_MISSING')
        }
        const profile = await bankHooks.getCustomerProfile(customerProfileMatch[1])
        // 敏感资料访问与返回在同一接口内原子落账（清单 §2 / 不变量 6、10），
        // 前端不再另发补记请求，杜绝「资料已返回但补记失败」的无记录查看。
        db.prepare('INSERT INTO customer_access_logs (id, staff_id, customer_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(newId('cal'), who.actorId, customerProfileMatch[1], reason, now())
        writeAudit({ actorId: who.actorId, action: 'customer.profile.view', targetType: 'customer', targetId: customerProfileMatch[1], reason })
        json(res, 200, profile)
        return true
      }

      // —— 代客办理（清单 §2 P1，乙模块）：白名单动作 + 客户核验 ——
      const customerActionMatch = /^\/staff-api\/customers\/([^/]+)\/actions\/([^/]+)$/.exec(path)
      if (customerActionMatch && req.method === 'POST') {
        const who = auth.resolve(req, {})
        const [, customerId, action] = customerActionMatch
        const WHITELIST = ['lockCard', 'unlockCard', 'updateCardSettings', 'patchAutodebit']
        if (!WHITELIST.includes(action)) {
          throw staffError(400, `不支持的代客动作：${action}`, 'BAD_ACTION')
        }
        const body = await readBody(req)
        requireFields(body, ['ticketId', 'verificationMethod', 'verificationResult', 'reason'])
        if (body.verificationResult === 'failed') {
          throw staffError(403, '客户核验未通过，不能办理', 'VERIFICATION_FAILED')
        }
        // 高影响动作（解锁卡 / 调限额）必须核验通过，未核验禁止（清单 §2 P1）
        const HIGH_IMPACT = ['unlockCard', 'updateCardSettings']
        if (HIGH_IMPACT.includes(action) && body.verificationResult !== 'passed') {
          throw staffError(403, '该动作影响资金安全，必须完成客户核验', 'VERIFICATION_REQUIRED')
        }
        // 组装 payload 交给 bankHooks（复用客户端业务规则，不复制校验逻辑）
        let payload
        if (action === 'updateCardSettings') {
          requireFields(body, ['cardId', 'dailyLimit'])
          const DAILY_LIMIT_OPTIONS = [200_000, 500_000, 1_000_000, 5_000_000]
          if (!DAILY_LIMIT_OPTIONS.includes(body.dailyLimit)) {
            throw staffError(400, '请选择有效的单日限额档位', 'INVALID_DAILY_LIMIT')
          }
          payload = { cardId: body.cardId, patch: { dailyLimit: body.dailyLimit } }
        } else if (action === 'patchAutodebit') {
          requireFields(body, ['autoDebitId', 'enabled'])
          payload = { autoDebitId: body.autoDebitId, enabled: Boolean(body.enabled) }
        } else {
          requireFields(body, ['cardId'])
          payload = { cardId: body.cardId }
        }
        if (typeof bankHooks.performCustomerAction !== 'function') {
          throw staffError(503, '银行侧未接入，无法代客办理', 'BANK_HOOK_MISSING')
        }
        await bankHooks.performCustomerAction({ customerId, action, payload })
        writeAudit({
          actorId: who.actorId,
          action: `customer.action.${action}`,
          targetType: 'customer',
          targetId: customerId,
          reason: `工单 ${body.ticketId} · ${body.reason}`,
        })
        json(res, 200, { ok: true })
        return true
      }

      // —— 审计（清单 §2 P2，只给主管看） ——
      if (path === '/staff-api/audit-logs' && req.method === 'GET') {
        const who = auth.resolve(req, { roles: ['supervisor'] })
        const rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all()
        json(res, 200, rows)
        return true
      }

      json(res, 404, { message: '接口不存在', code: 'NOT_FOUND' })
      return true
    } catch (error) {
      if (res.writableEnded) return true
      json(res, error?.status ?? 500, {
        message: error?.message ?? '服务异常',
        code: error?.code ?? 'INTERNAL_ERROR',
      })
      return true
    }
  }

  return { handle, writeAudit, auth, createTransferApproval, closeTransferApproval }
}

function mapTicket(row, customerNames = new Map()) {
  return {
    ticketId: row.id,
    customerId: row.customer_id,
    customerName: customerNames.get(row.customer_id) ?? null,
    channel: row.channel,
    reason: row.reason,
    priority: row.priority,
    status: row.status,
    assigneeId: row.assignee_id,
    transferId: row.transfer_id,
    approvalId: row.approval_id,
    agentTranscript: row.agent_transcript ? JSON.parse(row.agent_transcript) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapApproval(row) {
  return {
    approvalId: row.id,
    bizType: row.biz_type,
    payload: JSON.parse(row.biz_payload),
    riskSummary: row.risk_summary,
    applicantId: row.applicant_id,
    status: row.status,
    executionStatus: row.execution_status,
    executionError: row.execution_error,
    decidedBy: row.decided_by,
    reason: row.reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }
}
