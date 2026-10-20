/**
 * 收款人消歧纯逻辑检查：别名命中、模糊匹配、手机号、流水回退、排序。
 *
 *   node --import ./tools/ts-resolve-hook.mjs challenge/checks/check-payee-resolve.mjs
 */

import { resolvePayee, disambiguationHint } from '../bridge/payee-resolve.mjs'

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

/* ── 种子数据：对齐 db.ts 的 payees ─────────────────────────────── */

const payees = [
  { id: 'pay_1', name: '陈嘉禾', channel: 'bank', bankCode: 'LCB', bankRegion: 'CN', bankName: '招财猫银行', accountNo: '8820000000124471', scope: 'domestic', lastUsedAt: '2026-10-06T13:00:00Z' },
  { id: 'pay_2', name: '苏晚', channel: 'bank', bankCode: '308', bankRegion: 'CN', bankName: '招商银行', accountNo: '6214830200989028', scope: 'domestic', lastUsedAt: '2026-09-25T10:00:00Z' },
  { id: 'pay_3', name: 'Wing Chan', channel: 'bank', bankCode: '004', bankRegion: 'HK', bankName: '香港上海汇丰银行', accountNo: '004123456789118', scope: 'overseas', lastUsedAt: '2026-08-19T10:00:00Z' },
]

const aliases = [
  { alias: '我妈', payeeName: '陈嘉禾', note: '母亲' },
  { alias: '妈', payeeName: '陈嘉禾', note: '母亲' },
  { alias: '小晚', payeeName: '苏晚', note: '常用昵称' },
]

const transactions = [
  { counterparty: '王五', createdAt: '2026-10-01T08:00:00Z' },
  { counterparty: '王五', createdAt: '2026-10-05T09:00:00Z' },
  { detail: { counterpartyName: '赵六' }, createdAt: '2026-09-20T08:00:00Z' },
]

const run = (query) => resolvePayee({ query, aliases, payees, transactions })

/* ═══ 别名 ═══════════════════════════════════════════════════════ */

{
  const result = run('我妈')
  eq(result.length, 1, '「我妈」：命中 1 个候选')
  eq(result[0]?.payeeName, '陈嘉禾', '「我妈」→ 陈嘉禾')
  eq(result[0]?.matchType, 'alias', '「我妈」：matchType = alias')
  eq(result[0]?.score, 100, '「我妈」：精确别名 score 100')
}

{
  const result = run('小晚')
  eq(result[0]?.payeeName, '苏晚', '「小晚」→ 苏晚')
}

// 包含命中：「转给我妈妈」中的「妈妈」也能命中「妈」
{
  const result = run('妈妈')
  ok(result.length >= 1, '「妈妈」：包含命中「妈」')
  eq(result[0]?.payeeName, '陈嘉禾', '「妈妈」→ 陈嘉禾')
}

/* ═══ 人名 ═══════════════════════════════════════════════════════ */

{
  const result = run('陈嘉禾')
  eq(result[0]?.matchType, 'name', '精确人名：matchType = name')
  eq(result[0]?.score, 90, '精确人名：score 90')
}

{
  const result = run('陈')
  ok(result.some((c) => c.payeeName === '陈嘉禾'), '模糊姓氏「陈」能命中陈嘉禾')
}

/* ═══ 手机号 ═════════════════════════════════════════════════════ */

{
  const result = run('4471')
  ok(result.some((c) => c.payeeName === '陈嘉禾'), '尾号 4471 命中陈嘉禾')
}

/* ═══ 流水回退 ═══════════════════════════════════════════════════ */

{
  const result = run('王五')
  ok(result.length >= 1, '流水 counterparty「王五」可命中')
  eq(result[0]?.matchType, 'history', '「王五」：matchType = history')
  ok(result[0].historyCount >= 2, `出现 ${result[0]?.historyCount} 次（期望 ≥2）`)
}

{
  const result = run('赵六')
  ok(result.some((c) => c.payeeName === '赵六'), 'detail.counterpartyName 也能命中')
}

/* ═══ 排序 ═══════════════════════════════════════════════════════ */

// 精确别名（100） > 精确人名（90） > 模糊（70）
// 「妈」既是别名又包含在人名搜索里，别名应该排在前面
{
  const result = run('妈')
  eq(result[0]?.matchType, 'alias', '「妈」：别名排最前')
}

/* ═══ 无命中 ═════════════════════════════════════════════════════ */

{
  eq(run('不存在的人').length, 0, '无命中：返回空数组')
  eq(run('').length, 0, '空输入：返回空数组')
  eq(run('   ').length, 0, '纯空白：返回空数组')
}

/* ═══ 消歧提示 ═══════════════════════════════════════════════════ */

{
  eq(disambiguationHint(run('我妈')), null, '单候选：不需要消歧')
}

{
  // 制造两个候选：搜「陈苏」会包含命中两个人
  const result = resolvePayee({
    query: '陈', aliases: [], payees,
    transactions: [],
  })
  // 「陈」包含命中陈嘉禾；如果没有第二个就不消歧
  if (result.length >= 2) {
    const hint = disambiguationHint(result)
    eq(hint?.needDisambiguation, true, '多候选：needDisambiguation = true')
    eq(hint?.options.length, result.length, '消歧选项数 = 候选数')
  } else {
    // 退而求其次：手工构造两个候选测消歧
    const two = [run('我妈')[0], run('小晚')[0]].filter(Boolean)
    const hint = disambiguationHint(two)
    eq(hint?.needDisambiguation, true, '多候选（手工）：needDisambiguation = true')
    ok(hint.message.includes('2'), '消歧文案含候选数')
    eq(hint.options.length, 2, '消歧选项 2 条')
  }
}

/* ── 收尾 ─────────────────────────────────────────────────────── */

console.log('')
if (failures > 0) {
  console.log(`共 ${failures} 项失败`)
  process.exit(1)
}
console.log('全部通过')
