/**
 * 定时动作纯逻辑检查：缩时公式、状态机迁移、防重复执行、陈旧回收。
 *
 * 不碰网络、不碰 storage、不碰 mock API——只 import challenge/bridge/scheduled.mjs
 * 与 challenge/mock/state.mjs，逐条钉住边界。
 *
 * 值得单独测的原因：定时转账是**资金**动作，状态机写错的后果是重复扣款
 * 或该扣没扣。两种在界面上都只表现为「余额不对」，不报错。
 *
 *   node --import ./tools/ts-resolve-hook.mjs challenge/checks/check-scheduled.mjs
 */

import {
  computeEffectiveRunAt, timeLines, isDue, isStaleRunning, canCancel,
  markRunning, markDone, markFailed, markCancelled, recoverStale, newScheduledAction,
} from '../bridge/scheduled.mjs'
import {
  ensureChallengeState, emptyChallengeState, seedPayeeAliases, CHALLENGE_STATE_VERSION,
} from '../mock/state.mjs'

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}
const eq = (actual, expected, title) => report(
  JSON.stringify(actual) === JSON.stringify(expected),
  title,
  [`实际：${JSON.stringify(actual)}`, `期望：${JSON.stringify(expected)}`],
)
const ok = (cond, title, lines) => report(cond, title, lines)

/* ── 固定时间轴：不依赖真实时钟，测试可复现 ─────────────────────── */

const T0 = Date.parse('2026-10-16T10:00:00.000Z')
const RUN_AT = '2026-10-18T09:00:00.000Z' // 后天早上
const mk = (overrides = {}) => ({
  ...newScheduledAction({
    id: 'sch_test',
    kind: 'transfer',
    title: '转账给陈嘉禾',
    runAt: RUN_AT,
    effectiveRunAt: RUN_AT,
    demoCompressed: false,
    payload: { amount: 20_000 },
    createdBy: { tool: 'bank_schedule_transfer' },
    now: T0,
  }),
  ...overrides,
})

/* ═══ 演示缩时公式 ═══════════════════════════════════════════════ */

// 演示模式：原定后天 → 压到 20 秒后
{
  const { effectiveRunAt, demoCompressed } = computeEffectiveRunAt({
    runAt: RUN_AT, now: T0, demoSeconds: 20,
  })
  eq(effectiveRunAt, new Date(T0 + 20_000).toISOString(), '缩时 20 秒：effectiveRunAt = now + 20s')
  eq(demoCompressed, true, '缩时 20 秒：demoCompressed 标记为 true')
}

// 原定时间本来就比压缩后还近 → 用原定时间，不往后推
{
  const soon = new Date(T0 + 5_000).toISOString()
  const { effectiveRunAt, demoCompressed } = computeEffectiveRunAt({
    runAt: soon, now: T0, demoSeconds: 20,
  })
  eq(effectiveRunAt, soon, '原定 5 秒后：不被拉长到 20 秒，沿用原定时间')
  eq(demoCompressed, false, '原定 5 秒后：不算缩时')
}

// demoSeconds = 0 关闭缩时
{
  const { effectiveRunAt, demoCompressed } = computeEffectiveRunAt({
    runAt: RUN_AT, now: T0, demoSeconds: 0,
  })
  eq(effectiveRunAt, RUN_AT, '缩时关闭（0）：effectiveRunAt = 原定时间')
  eq(demoCompressed, false, '缩时关闭（0）：demoCompressed = false')
}

// 多步骤阶梯：第 0 步 now+20s、第 1 步 now+40s、第 2 步 now+60s
for (const [step, offset] of [[0, 20], [1, 40], [2, 60]]) {
  const { effectiveRunAt } = computeEffectiveRunAt({
    runAt: RUN_AT, now: T0, demoSeconds: 20, stepIndex: step,
  })
  eq(effectiveRunAt, new Date(T0 + offset * 1000).toISOString(), `阶梯第 ${step} 步：now + ${offset}s`)
}

// 步间间隔可独立配置
{
  const { effectiveRunAt } = computeEffectiveRunAt({
    runAt: RUN_AT, now: T0, demoSeconds: 10, stepIndex: 2, staggerSeconds: 15,
  })
  eq(effectiveRunAt, new Date(T0 + 10_000 + 2 * 15_000).toISOString(), 'stagger 独立：now + 10s + 2×15s')
}

// 非法 runAt 必须炸，不能静默落到 Invalid Date
ok(
  (() => { try { computeEffectiveRunAt({ runAt: '明天', now: T0, demoSeconds: 20 }); return false } catch { return true } })(),
  'runAt 非法：抛错而不是静默出 Invalid Date',
)

/* ═══ 双时间行 ═══════════════════════════════════════════════════ */

{
  const action = mk({ effectiveRunAt: new Date(T0 + 20_000).toISOString(), demoCompressed: true })
  const lines = timeLines(action, T0)
  eq(lines.length, 2, 'demoCompressed：两行时间')
  eq(lines[0], { label: '执行时间', value: RUN_AT }, '第一行是原定业务时间')
  ok(lines[1].value.includes('20') && lines[1].value.includes(RUN_AT), '第二行含倒计时秒数与原定时间',
    [lines[1].value])
}

{
  const lines = timeLines(mk(), T0)
  eq(lines.length, 1, '非缩时：只有一行时间')
}

/* ═══ 状态机 ═════════════════════════════════════════════════════ */

// 到点判定
ok(isDue(mk({ effectiveRunAt: new Date(T0 - 1).toISOString() }), T0), 'pending 且已到点：isDue')
ok(!isDue(mk(), T0 + 1000), 'pending 但未到点：不 isDue')
ok(!isDue(mk({ effectiveRunAt: new Date(T0 - 1).toISOString(), status: 'cancelled' }), T0),
  'cancelled 不 isDue（已改过的状态不能再拾取）')

// pending → running
{
  const running = markRunning(mk({ effectiveRunAt: new Date(T0 - 5_000).toISOString() }), T0, { late: true })
  eq(running.status, 'running', 'markRunning：status → running')
  eq(running.attempts, 1, 'markRunning：attempts → 1')
  eq(running.audit.at(-1).event, 'fire-late', '迟到拾取：补 fire-late 审计')
  eq(running.audit.at(-2).event, 'fire-start', 'fire-start 在 fire-late 之前')
}

// 非 pending 不能进入 running——防重复执行的关键闸
for (const status of ['running', 'done', 'failed', 'cancelled']) {
  ok(
    (() => { try { markRunning(mk({ status }), T0); return false } catch { return true } })(),
    `status=${status} 不能进入 running`,
  )
}

// running → done
{
  const done = markDone(markRunning(mk(), T0), T0 + 1000, { transactionId: 'tx_1' })
  eq(done.status, 'done', 'markDone：status → done')
  eq(done.result, { transactionId: 'tx_1' }, 'markDone：result 落上')
  eq(done.audit.at(-1).event, 'fire-done', 'markDone：审计记 fire-done')
}

// running → failed
{
  const failed = markFailed(markRunning(mk(), T0), T0 + 1000, '余额不足')
  eq(failed.status, 'failed', 'markFailed：status → failed')
  eq(failed.result, { error: '余额不足' }, 'markFailed：错误落进 result')
  eq(failed.audit.at(-1).event, 'fire-fail', 'markFailed：审计记 fire-fail')
}

// 只有 pending 能取消
eq(canCancel(mk()), true, 'pending 可取消')
for (const status of ['running', 'done', 'failed', 'cancelled']) {
  eq(canCancel(mk({ status })), false, `${status} 不可取消`)
  ok(
    (() => { try { markCancelled(mk({ status }), T0); return false } catch { return true } })(),
    `status=${status} 不能取消`,
  )
}
{
  const cancelled = markCancelled(mk(), T0, '用户取消')
  eq(cancelled.status, 'cancelled', 'markCancelled：status → cancelled')
  eq(cancelled.audit.at(-1).event, 'cancel', 'markCancelled：审计记 cancel')
}

/* ═══ 陈旧 running 回收（至多一次） ═══════════════════════════════ */

{
  const running = markRunning(mk(), T0)
  eq(recoverStale(running, T0 + 30_000, 60_000), null, 'running 30 秒：不算陈旧（阈值 60 秒）')

  const stale = recoverStale(running, T0 + 61_000, 60_000)
  ok(stale !== null, 'running 61 秒：回收为 failed')
  eq(stale?.status, 'failed', '陈旧回收：status → failed')
  eq(stale?.audit.at(-1).event, 'interrupted', '陈旧回收：审计记 interrupted')

  eq(recoverStale(mk(), T0 + 999_000, 60_000), null, 'pending 不会被陈旧回收（只有 running 会）')
  eq(recoverStale(mk({ status: 'done' }), T0 + 999_000, 60_000), null, 'done 不会被陈旧回收')
}

/* ═══ 防重复执行：attempts 上限 ═══════════════════════════════════ */

{
  const running = markRunning(mk(), T0)
  // 成功后不能再拾取
  const done = markDone(running, T0 + 500, {})
  ok(!isDue(done, T0 + 999_000), 'done 之后不再 isDue（不会二次拾取）')
  // 失败后也不能再拾取——资金动作不自动重试
  const failed = markFailed(markRunning(mk(), T0), T0 + 500, 'boom')
  ok(!isDue(failed, T0 + 999_000), 'failed 之后不再 isDue（资金动作不自动重试）')
}

/* ═══ profile.challenge 附加段 ════════════════════════════════════ */

{
  const profile = { user: { phone: '13800138000' }, accounts: [] }
  const state = ensureChallengeState(profile)
  eq(state.version, CHALLENGE_STATE_VERSION, 'ensureChallengeState：版本号落上')
  eq(state.scheduledActions, [], 'ensureChallengeState：scheduledActions 初始化为空数组')
  eq(Array.isArray(state.payeeAliases), true, 'ensureChallengeState：payeeAliases 是数组')

  // 幂等：已有数据不被清
  state.scheduledActions.push(mk())
  const again = ensureChallengeState(profile)
  eq(again.scheduledActions.length, 1, 'ensureChallengeState 幂等：已有动作不被清空')
}

{
  // 空档案播种别名
  const state = emptyChallengeState()
  const seeded = seedPayeeAliases(state, [{ alias: '我妈', payeeName: '陈嘉禾' }])
  eq(seeded.length, 1, 'seedPayeeAliases：播种 1 条')
  // 幂等：已有别名不覆盖
  seedPayeeAliases(state, [{ alias: '我爸', payeeName: '张三' }])
  eq(state.payeeAliases.length, 1, 'seedPayeeAliases 幂等：已有别名不重复播种')
}

/* ── 收尾 ─────────────────────────────────────────────────────── */

console.log('')
if (failures > 0) {
  console.log(`共 ${failures} 项失败`)
  process.exit(1)
}
console.log('全部通过')
