/**
 * 消息级动作的纯逻辑检查：倒回重发（编辑 / 重新生成）与"哪条能重新生成"。
 *
 * 不需要浏览器、不需要模型、不需要网络：直接 import 应用里真正在跑的那个
 * `app/src/lib/agentSessions.ts`。
 *
 * 为什么这块值得单独测：倒回是**破坏性**的一步——它把一段对话从某个位置截断。
 * 切少一刀（该丢的没丢）会看到"同一个问题问了两遍、答案对不上"；
 * 切多一刀（把用户那句话本身也丢了）会看到"问题没了，只剩一个回答"。
 * 两种都只在界面上表现为"怪怪的"，不报错。所以这里逐条钉住边界：
 * 目标必须是用户说的话、目标之前的一条不动、目标之后的一条不留。
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/check-message-actions.mjs
 */

import { lastAssistantId, promptOf, rewindTo } from '../app/src/lib/agentSessions.ts'

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

/** 造一段内容。 */
const user = (id, text) => ({ kind: 'user', id, text })
const assistant = (id, text) => ({ kind: 'assistant', id, text })
const tool = (id, name) => ({ kind: 'tool', id, name, state: 'done' })
const notice = (id, text) => ({ kind: 'notice', id, text, tone: 'error' })

/** 一轮完整的问答：用户问 → 工具 → 助手答。 */
const round = (n) => [
  user(`u${n}`, `问题 ${n}`),
  tool(`t${n}`, 'bank_get_balance'),
  assistant(`a${n}`, `回答 ${n}`),
]

/* ------------------------------------------------------------ rewindTo：切得准 */

const two = [...round(1), ...round(2)]

eq(
  rewindTo(two, 'u2')?.map(item => item.id),
  ['u1', 't1', 'a1', 'u2'],
  '倒回到第二句：保留到它为止，后面的助手回复和工具行一条不留',
)

eq(
  rewindTo(two, 'u1')?.map(item => item.id),
  ['u1'],
  '倒回到第一句：只剩这一句（后面两轮全丢）',
)

eq(
  rewindTo(two, 'u2', '改过的问题')?.at(-1),
  user('u2', '改过的问题'),
  '给了新说法就换成新的，其余字段不动',
)

eq(
  rewindTo(two, 'u1')?.[0],
  user('u1', '问题 1'),
  '不给新说法就沿用原文',
)

eq(
  rewindTo([user('u1', '问题 1')], 'u1')?.length,
  1,
  '目标本来就是最后一条：返回的就它自己（不是空列表）',
)

// 丢掉的不止助手回复：中间夹着的工具行、报错通知也一起走。
eq(
  rewindTo([...round(1), notice('n1', '发送失败：断线了')], 'u1')?.map(item => item.id),
  ['u1'],
  '倒回时把工具行和错误通知一起丢掉（它们属于被作废的那一轮）',
)

/* -------------------------------------------------- rewindTo：不该动的时候不动 */

eq(rewindTo(two, 'a2'), undefined, '目标是助手回复 → 不动（只允许倒回到用户说的话）')
eq(rewindTo(two, 't1'), undefined, '目标是工具行 → 不动')
eq(rewindTo(two, 'n_x'), undefined, '找不到这条 id → 不动')
eq(rewindTo([], 'u1'), undefined, '空对话 → 不动')

// 原数组不能被改：调用方（hook）是在旧值上算新值，算的过程中把它改掉，
// 会让 React 认为"状态没变"，界面就不刷新了。
const frozen = [...round(1), ...round(2)]
const snapshot = JSON.stringify(frozen)
rewindTo(frozen, 'u2', '换个说法')
eq(JSON.stringify(frozen), snapshot, '倒回不会改动传进来的那个数组（改了界面就不刷新）')

/* ------------------------------------------------- lastAssistantId：哪条能重生成 */

eq(lastAssistantId(two), 'a2', '最后一条助手回复 = 最后那轮的 a2')
eq(
  lastAssistantId([...round(1), user('u2', '还没回答的问题')]),
  'a1',
  '用户刚发完、助手还没答时，仍然是上一条助手回复（不然重新生成按钮会凭空消失）',
)
eq(
  lastAssistantId([...round(1), tool('t9', 'bank_transfer')]),
  'a1',
  '末尾挂着工具行时，助手回复不算它',
)
eq(lastAssistantId([user('u1', '问题')]), undefined, '一句助手回复都没有 → undefined')
eq(lastAssistantId([]), undefined, '空对话 → undefined')

/* --------------------------------------------------- promptOf：回复 → 那次提问 */

// 「重新生成」的按钮挂在助手回复上，倒回要倒到产生它的那句提问。
// 这个换算漏了的后果是**静默失灵**：按钮点下去什么都不发生（实测踩到过）。
eq(promptOf(two, 'a2'), 'u2', '助手回复 → 往前最近的那句用户提问')
eq(promptOf(two, 'a1'), 'u1', '中间那条助手回复 → 它自己那一轮的提问（不是最新那句）')
eq(promptOf(two, 'u1'), 'u1', '本来就是用户消息 → 就用它自己')
eq(promptOf(two, 't1'), undefined, '工具行上没有这些动作 → 不动')
eq(promptOf(two, 'n_x'), undefined, '找不到这条 id → 不动')
eq(
  promptOf([assistant('a1', '开场白'), user('u1', '问题')], 'a1'),
  undefined,
  '回复前面还没有任何提问（开场白）→ 不动',
)

console.log()
if (failures === 0) console.log('check-message-actions: 全部通过')
else console.log(`check-message-actions: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
