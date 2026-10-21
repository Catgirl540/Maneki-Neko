/**
 * 定时动作的纯逻辑：演示缩时、到点判定、状态机、审计。
 *
 * 这层不碰 storage、不碰 mock API、不碰任何共享文件——只吃状态对象吐状态对象。
 * 资金动作的「至多一次」语义全靠这里的状态机保证：
 * pending → running 时立即落盘（调用方 persist），同一 tick 内不会二次拾取；
 * running 无论成败都出终态，绝不自动重试。
 *
 *   node --import ./tools/ts-resolve-hook.mjs challenge/checks/check-scheduled.mjs
 */

/* ── 类型（JSDoc，编辑器可拾取） ─────────────────────────────────── */

/**
 * @typedef {'transfer'|'purchase'|'notify'|'lock'} ScheduledKind
 * @typedef {'pending'|'running'|'done'|'failed'|'cancelled'} ScheduledStatus
 * @typedef {'create'|'cancel'|'fire-start'|'fire-done'|'fire-fail'|'fire-late'|'interrupted'} AuditEvent
 * @typedef {{ at: string, event: AuditEvent, detail?: string }} AuditEntry
 * @typedef {{
 *   id: string,
 *   kind: ScheduledKind,
 *   status: ScheduledStatus,
 *   title: string,
 *   createdAt: string,
 *   createdBy: { sessionId?: string, callId?: string, tool: string },
 *   runAt: string,
 *   effectiveRunAt: string,
 *   demoCompressed: boolean,
 *   payload: Record<string, unknown>,
 *   planId?: string,
 *   result?: { transactionId?: string, receipt?: unknown, error?: string },
 *   attempts: number,
 *   audit: AuditEntry[],
 * }} ScheduledAction
 */

/* ── 演示缩时 ──────────────────────────────────────────────────── */

/**
 * 把「原定业务时间」压到「演示可等的时间」。
 *
 * 为什么要缩时：定时转账的真实语义是「后天早上 9 点」，现场演示等不到。
 * 缩时只是把 effectiveRunAt 提前，runAt 原样保留——确认卡和列表都打两行时间，
 * 诚实演示，不装真定时。
 *
 * 原定时间比压缩后还近的，不往后推（否则「5 分钟后转」会被拉长到 20 秒后才对不上）。
 *
 * @param {object} p
 * @param {string} p.runAt               ISO 原定执行时间（业务语义）
 * @param {number} p.now                 当前毫秒时间戳
 * @param {number} p.demoSeconds         缩时窗口秒数；0 = 关闭缩时
 * @param {number} [p.stepIndex]         多步骤计划的第几步（0 起），决定阶梯
 * @param {number} [p.staggerSeconds]    步间间隔秒数；缺省 = demoSeconds
 * @returns {{ effectiveRunAt: string, demoCompressed: boolean }}
 */
export function computeEffectiveRunAt({ runAt, now, demoSeconds, stepIndex = 0, staggerSeconds }) {
  const target = Date.parse(runAt)
  if (!Number.isFinite(target)) throw new Error(`runAt 不是合法时间：${runAt}`)
  if (demoSeconds <= 0) {
    return { effectiveRunAt: new Date(target).toISOString(), demoCompressed: false }
  }
  const staggerMs = (staggerSeconds ?? demoSeconds) * 1000
  const compressed = now + demoSeconds * 1000 + stepIndex * staggerMs
  if (target <= compressed) {
    return { effectiveRunAt: new Date(target).toISOString(), demoCompressed: false }
  }
  return { effectiveRunAt: new Date(compressed).toISOString(), demoCompressed: true }
}

/**
 * 双时间行的展示文案。demoCompressed 时同时给出原定时间与倒计时，
 * 让用户（和评委）分清「业务上说的是哪天」和「演示上什么时候发生」。
 *
 * @param {Pick<ScheduledAction, 'runAt'|'effectiveRunAt'|'demoCompressed'>} action
 * @param {number} now
 * @returns {{ label: string, value: string }[]}
 */
export function timeLines(action, now) {
  const lines = [{ label: '执行时间', value: action.runAt }]
  if (!action.demoCompressed) return lines
  const seconds = Math.max(0, Math.round((Date.parse(action.effectiveRunAt) - now) / 1000))
  lines.push({ label: '演示模式', value: `约 ${seconds} 秒后执行（原定 ${action.runAt}）` })
  return lines
}

/* ── 状态机 ────────────────────────────────────────────────────── */

/** 纯函数：在 action 的 audit 尾部追加一条，不改原对象。 */
function pushAudit(action, event, at, detail) {
  /** @type {AuditEntry} */
  const entry = { at, event }
  if (detail !== undefined) entry.detail = detail
  return { ...action, audit: [...action.audit, entry] }
}

const iso = (ms) => new Date(ms).toISOString()

/** 到点可执行：只有 pending 能被拾取。 */
export function isDue(action, now) {
  return action.status === 'pending' && Date.parse(action.effectiveRunAt) <= now
}

/** running 挂了太久（进程重启/异常中断）——回收为 failed，宁可丢单不可重复扣款。 */
export function isStaleRunning(action, now, staleMs = 60_000) {
  if (action.status !== 'running') return false
  const started = action.audit.findLast((e) => e.event === 'fire-start')
  return started !== undefined && now - Date.parse(started.at) > staleMs
}

export function canCancel(action) {
  return action.status === 'pending'
}

/**
 * pending → running。**调用方必须立即 persist()**，否则同一 tick 内会被二次拾取。
 * late = 拾取时已经迟到（effectiveRunAt 早已过），补一条 fire-late 审计。
 */
export function markRunning(action, now, { late = false } = {}) {
  if (action.status !== 'pending') {
    throw new Error(`状态 ${action.status} 不能进入 running（只允许 pending）`)
  }
  const at = iso(now)
  let next = pushAudit(
    { ...action, status: 'running', attempts: action.attempts + 1 },
    'fire-start', at,
  )
  if (late) {
    const overdue = Math.round((now - Date.parse(action.effectiveRunAt)) / 1000)
    next = pushAudit(next, 'fire-late', at, `迟到 ${overdue} 秒`)
  }
  return next
}

/** running → done。 */
export function markDone(action, now, result) {
  if (action.status !== 'running') {
    throw new Error(`状态 ${action.status} 不能进入 done（只允许 running）`)
  }
  return pushAudit({ ...action, status: 'done', result }, 'fire-done', iso(now))
}

/** running → failed。资金动作不自动重试。 */
export function markFailed(action, now, error) {
  if (action.status !== 'running') {
    throw new Error(`状态 ${action.status} 不能进入 failed（只允许 running）`)
  }
  return pushAudit(
    { ...action, status: 'failed', result: { error } },
    'fire-fail', iso(now), error,
  )
}

/** pending → cancelled。running 及终态不可取消。 */
export function markCancelled(action, now, reason) {
  if (!canCancel(action)) {
    throw new Error(`状态 ${action.status} 不能取消（只允许 pending）`)
  }
  return pushAudit({ ...action, status: 'cancelled' }, 'cancel', iso(now), reason)
}

/** running 陈旧回收 → failed（interrupted）。返回 null 表示不该回收。 */
export function recoverStale(action, now, staleMs = 60_000) {
  if (!isStaleRunning(action, now, staleMs)) return null
  return pushAudit(
    { ...action, status: 'failed', result: { error: '执行中断，已按至多一次放弃' } },
    'interrupted', iso(now),
  )
}

/* ── 工厂 ──────────────────────────────────────────────────────── */

/**
 * 新建一条定时动作，自动带 create 审计。
 * payload 存 TransferRequest 快照（不是报价快照）——执行时点由 submitTransfer
 * 内部现查费率/余额，天然处理报价过期，与在途到账同一形状。
 */
export function newScheduledAction({
  id, kind, title, runAt, effectiveRunAt, demoCompressed,
  payload, createdBy, planId, now,
}) {
  /** @type {ScheduledAction} */
  const action = {
    id,
    kind,
    status: 'pending',
    title,
    createdAt: iso(now),
    createdBy,
    runAt,
    effectiveRunAt,
    demoCompressed,
    payload,
    attempts: 0,
    audit: [{ at: iso(now), event: 'create' }],
  }
  if (planId !== undefined) action.planId = planId
  return action
}
