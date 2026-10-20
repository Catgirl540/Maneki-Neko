/**
 * 定时动作的数据层：list / create / cancel / runDue。
 *
 * 这层接收 bank-api 注入的 domain 模块函数，操作**当前激活档案**的
 * profile.challenge 段。bank-api 的 exclusive() 保证同一时刻只有一段代码在
 * 切档，所以这里不需要额外加锁。
 *
 * 资金红线：runDue 只调 createBankBusinessApi().submitTransfer(payload) + persist()，
 * 绝不直接改 bank_accounts / bank_transactions 投影表。与在途到账
 * （domain/index.mjs 的 settleHeldTransfer）同一条业务路。
 *
 * 状态机保证至多一次：pending→running 时立即 persist，running 无论成败
 * 都出终态，资金动作不自动重试。宁可丢单，不可重复扣款。
 */

import {
  computeEffectiveRunAt, isDue, isStaleRunning, canCancel,
  markRunning, markDone, markFailed, markCancelled, recoverStale, newScheduledAction,
  timeLines,
} from '../bridge/scheduled.mjs'
import { ensureChallengeState } from './state.mjs'

/** 演示缩时窗口（秒）。0 = 关闭缩时，等真实时间。 */
function demoSeconds() {
  const v = Number(process.env.BANK_SCHEDULER_DEMO_SECONDS ?? 20)
  return Number.isFinite(v) && v >= 0 ? v : 20
}

/** 多步骤计划的步间间隔（秒）。缺省 = demoSeconds。 */
function staggerSeconds() {
  const v = Number(process.env.BANK_SCHEDULER_DEMO_STAGGER_SECONDS ?? demoSeconds())
  return Number.isFinite(v) && v >= 0 ? v : demoSeconds()
}

let seq = 0
function nextActionId() {
  seq += 1
  return `sch_${Date.now().toString(36)}_${seq.toString(36)}`
}

/**
 * 创建定时动作 API。参数是 bank-api 已装载的 domain 模块函数。
 *
 * @param {object} deps
 * @param {Function} deps.loadDb   读当前激活档案（server/domain/state.mjs）
 * @param {Function} deps.persist  落盘当前激活档案（server/domain/state.mjs）
 * @param {Function} deps.createBankBusinessApi 造业务 API（server/domain/index.mjs）
 */
export function createScheduledApi({ loadDb, persist, createBankBusinessApi }) {
  /** 当前档案的 challenge 段（自动创建）。 */
  function state() {
    return ensureChallengeState(loadDb())
  }

  /**
   * 创建定时动作。
   * @param {object} p
   * @param {'transfer'|'purchase'|'notify'|'lock'} p.kind
   * @param {string} p.title
   * @param {string} p.runAt          ISO 原定执行时间
   * @param {object} p.payload       TransferRequest 快照（不含 confirmedQuote）
   * @param {object} p.createdBy     { sessionId?, callId?, tool }
   * @param {number} [p.stepIndex]   多步骤计划第几步（0 起），决定缩时阶梯
   * @param {string} [p.planId]
   * @returns {{ action: object, timeLines: { label: string, value: string }[] }}
   */
  function create({ kind, title, runAt, payload, createdBy, stepIndex = 0, planId }) {
    const s = state()
    const now = Date.now()
    const { effectiveRunAt, demoCompressed } = computeEffectiveRunAt({
      runAt, now, demoSeconds: demoSeconds(), stepIndex, staggerSeconds: staggerSeconds(),
    })
    const action = newScheduledAction({
      id: nextActionId(), kind, title, runAt, effectiveRunAt, demoCompressed,
      payload, createdBy, planId, now,
    })
    s.scheduledActions.push(action)
    persist()
    return { action, timeLines: timeLines(action, now) }
  }

  /**
   * 列出定时动作。返回摘要（含双时间行），不返回 payload 里的完整账号。
   * @param {object} [filter] { status?: string }
   */
  function list(filter = {}) {
    const s = state()
    const now = Date.now()
    let items = s.scheduledActions
    if (filter.status) items = items.filter((a) => a.status === filter.status)
    return items.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      status: a.status,
      runAt: a.runAt,
      effectiveRunAt: a.effectiveRunAt,
      demoCompressed: a.demoCompressed,
      canCancel: canCancel(a),
      attempts: a.attempts,
      planId: a.planId,
      result: a.result,
      timeLines: timeLines(a, now),
      createdAt: a.createdAt,
    }))
  }

  /**
   * 取消 pending 动作。
   * @param {string} id
   * @param {string} [reason]
   */
  function cancel(id, reason) {
    const s = state()
    const action = s.scheduledActions.find((a) => a.id === id)
    if (!action) throw Object.assign(new Error('定时动作不存在'), { status: 404, code: 'NOT_FOUND' })
    if (!canCancel(action)) {
      throw Object.assign(new Error(`状态 ${action.status} 不可取消`), { status: 409, code: 'CONFLICT' })
    }
    const idx = s.scheduledActions.indexOf(action)
    s.scheduledActions[idx] = markCancelled(action, Date.now(), reason ?? '用户取消')
    persist()
    return s.scheduledActions[idx]
  }

  /**
   * 扫出当前档案到点的定时动作并执行。
   *
   * 同时回收陈旧 running（进程重启后挂死的）。
   * 返回本次执行摘要，调用方可并入 tickHolds 的返回值。
   *
   * @param {number} [now] 毫秒时间戳（测试可注入）
   * @returns {{ executed: string[], failed: string[], recovered: string[] }}
   */
  async function runDue(now = Date.now()) {
    const s = state()
    const result = { executed: [], failed: [], recovered: [] }

    // 先回收陈旧 running（至多一次语义的兜底）
    for (let i = 0; i < s.scheduledActions.length; i++) {
      const action = s.scheduledActions[i]
      if (!isStaleRunning(action, now)) continue
      s.scheduledActions[i] = recoverStale(action, now)
      result.recovered.push(action.id)
    }

    // 拾取到点的 pending，逐个执行
    for (let i = 0; i < s.scheduledActions.length; i++) {
      const action = s.scheduledActions[i]
      if (!isDue(action, now)) continue

      // pending → running，立即落盘防二次拾取
      const overdue = now - Date.parse(action.effectiveRunAt) > 30_000
      s.scheduledActions[i] = markRunning(action, now, { late: overdue })
      persist() // 立即落盘是至多一次的关键

      try {
        // 走 submitTransfer 业务路：内部现查余额/费率，与在途到账同一形状
        const api = createBankBusinessApi({ settleImmediately: true })
        // payload 是 TransferRequest 快照；去掉确认卡产物后直接重放
        const { confirmedQuote: _cq, confirmedRecipient: _cr, ...transferReq } = action.payload
        const receipt = await api.submitTransfer(transferReq)
        s.scheduledActions[i] = markDone(s.scheduledActions[i], Date.now(), {
          transactionId: receipt?.transactionId ?? receipt?.id,
          receipt,
        })
        result.executed.push(action.id)
      } catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误'
        s.scheduledActions[i] = markFailed(s.scheduledActions[i], Date.now(), msg)
        result.failed.push(action.id)
      }
      persist() // 终态落盘
    }

    return result
  }

  return { create, list, cancel, runDue }
}
