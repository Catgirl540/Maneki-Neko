/**
 * 历史对话存档的检查。
 *
 * 全部是**纯逻辑**断言，不需要浏览器、不需要模型、不需要网络：
 * 直接 import 应用里真正在跑的那个 `app/src/lib/agentSessions.ts`。
 *
 * 为什么这块值得单独测：存档是"用户能改、旧版本能写、写不进去还会抛异常"的地方。
 * 一个字段没校验住，表现就是**整页白屏**或者**历史忽然全没了**，而这两件事
 * 在界面上都看不出原因。所以这里绝大部分断言是"坏数据进来会怎样"。
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/check-sessions.mjs
 */

import {
  recoveryHistory,
  MAX_CONVERSATIONS,
  isEmptyConversation,
  makeConversation,
  messageCount,
  pruneEmptyConversations,
  relativeTime,
  sanitizeConversations,
  saveConversations,
  titleFrom,
  trimConversations,
  loadConversations,
} from '../app/src/lib/agentSessions.ts'

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

/* --------------------------------------------------------------- 假 localStorage */

/**
 * 一个能装成 `window.localStorage` 的东西。
 * @param failFirst - 前几次写入抛配额错误（模拟写满）。默认一次都不抛。
 */
function fakeStorage(failFirst = 0) {
  const map = new Map()
  let writes = 0
  return {
    map,
    get writes() { return writes },
    getItem(key) { return map.has(key) ? map.get(key) : null },
    setItem(key, value) {
      writes += 1
      if (writes <= failFirst) throw new Error('QuotaExceededError')
      map.set(key, value)
    },
    removeItem(key) { map.delete(key) },
  }
}

/** 装上一个假的 window，返回那个 localStorage。 */
function installStorage(failFirst) {
  const store = fakeStorage(failFirst)
  globalThis.window = { localStorage: store }
  return store
}

installStorage()

/* ------------------------------------------------------------------ 造对话 */

/** 造一段对话；给什么都没写的话就用默认值补上。 */
function conversation(overrides = {}) {
  return {
    id: 'c1',
    title: '标题',
    createdAt: 1,
    updatedAt: 1,
    items: [],
    ...overrides,
  }
}

/** 造一段"很占地方"的对话：中文一个字三字节，所以按字符数估会严重低估。 */
function fat(id, updatedAt, text = '字'.repeat(19_000)) {
  return conversation({
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    items: [{ kind: 'assistant', id: `${id}-a`, text }],
  })
}

/* ------------------------------------------------------------ 新建与自动标题 */

const fresh = makeConversation(1000)
report(
  fresh.id.startsWith('c_') && fresh.title === '新对话' && fresh.items.length === 0
    && fresh.createdAt === 1000 && fresh.updatedAt === 1000 && fresh.agentSessionId === undefined,
  '新对话：有本地 id、标题是「新对话」、没有 agent 会话 id（懒创建）',
  [JSON.stringify(fresh)],
)
report(new Set(Array.from({ length: 50 }, () => makeConversation().id)).size === 50,
  '50 次新建拿到 50 个不同的本地 id')

eq(titleFrom('我的账户余额还有多少？'), '我的账户余额还有多少？', '标题：短问题原样用')
eq(titleFrom('  帮我  转 800 元\n给梁乐怡  '), '帮我 转 800 元', '标题：只取第一行、空白压成一个空格')
eq(titleFrom('一二三四五六七八九十一二三四五六七八九十'), '一二三四五六七八九十一二三四五六七八…', '标题：超过 18 个字截断并加省略号')
eq(titleFrom('   '), '新对话', '标题：全是空白回落到「新对话」')

/* ------------------------------------------------------------------ 时间说法 */

const base = new Date('2026-03-10T15:30:00').getTime()
const at = (iso) => new Date(iso).getTime()
eq(relativeTime(base, base), '刚刚', '时间：此刻是「刚刚」')
eq(relativeTime(base - 30_000, base), '刚刚', '时间：30 秒前还是「刚刚」')
eq(relativeTime(base - 5 * 60_000, base), '5 分钟前', '时间：5 分钟前')
eq(relativeTime(base - 3 * 3_600_000, base), '12:30', '时间：同一天只给时刻')
eq(relativeTime(at('2026-03-09T09:05:00'), base), '昨天 09:05', '时间：昨天带时刻')
eq(relativeTime(at('2026-03-09T09:05:00'), base, { compact: true }), '昨天',
  '时间：compact 时省掉昨天的时刻（列表那一行太窄，会被截断）')
eq(relativeTime(base - 5 * 60_000, base, { compact: true }), '5 分钟前',
  '时间：compact 不影响比"昨天"更近的那几档')
eq(relativeTime(at('2026-03-02T09:05:00'), base), '3 月 2 日', '时间：同年更早的日期')
eq(relativeTime(at('2025-12-31T23:00:00'), base), '2025 年 12 月 31 日', '时间：跨年带年份')
eq(relativeTime(base + 60_000, base), '刚刚', '时间：设备时钟被调快时不显示负数')
eq(relativeTime(Number.NaN, base), '', '时间：坏时间戳给空串')

/* ------------------------------------------------ 读回来：坏数据不许炸、不许丢好人 */

eq(sanitizeConversations('不是数组'), [], '读回来：顶层不是数组就当空列表')
eq(sanitizeConversations([null, 3, 'x', {}]), [], '读回来：不是对象的、没有 id 的一律丢掉')
eq(
  sanitizeConversations([conversation({ id: 'a' }), conversation({ id: 'a' })]).length,
  1,
  '读回来：同一个 id 只留一条',
)
eq(
  sanitizeConversations([
    conversation({ id: 'new', updatedAt: 5 }),
    conversation({ id: 'old', updatedAt: 1 }),
    conversation({ id: 'mid', updatedAt: 3 }),
  ]).map(c => c.id),
  ['new', 'mid', 'old'],
  '读回来：按更新时间从新到旧排',
)

const badItems = sanitizeConversations([conversation({
  items: [
    { kind: 'user', id: 'u1', text: '你好' },
    { kind: 'user', id: 'u2' },                 // 缺 text
    { kind: 'wat', id: 'x', text: '?' },        // 不认识的 kind
    'not an object',
    { kind: 'tool', id: 't1', name: 'bank_transfer', state: 'running' },
    { kind: 'tool', id: 't2', state: 'done' },  // 缺 name
    { kind: 'notice', id: 'n1', text: '注意' },  // 缺 tone
  ],
})])[0].items

eq(badItems.map(i => i.id), ['u1', 't1', 'n1'], '读回来：坏条目丢掉，好条目留下（不是整段丢）')
eq(badItems[1].state, 'error', '读回来：上次关页面时还在"执行中"的工具改成「未执行」')
eq(badItems[1].text, '上次没跑完', '读回来：被中断的工具给一句解释，不留永远转圈的行')
eq(badItems[2].tone, 'error', '读回来：通知缺少 tone 时按 error 处理（宁可吓人，不要漏报）')

const repaired = sanitizeConversations([{ id: 'r', items: [{ kind: 'user', id: 'u', text: '这是第一句话' }] }])[0]
report(
  repaired.title === '这是第一句话' && repaired.createdAt === 0 && repaired.updatedAt === 0
    && repaired.agentSessionId === undefined,
  '读回来：缺标题就用第一句话补、缺时间就补 0、没有 agent 会话 id 就不造一个',
  [JSON.stringify(repaired)],
)

eq(
  sanitizeConversations([conversation({ title: '   ' , items: [{ kind: 'user', id: 'u', text: '兜底' }] })])[0].title,
  '兜底',
  '读回来：标题是空白串时也用第一句话兜底',
)
eq(
  sanitizeConversations([conversation({ agentSessionId: '' })])[0].agentSessionId,
  undefined,
  '读回来：空的 agent 会话 id 当成没有',
)
eq(
  sanitizeConversations([conversation({ titleEdited: true })])[0].titleEdited,
  true,
  '读回来：手动改过标题的标记要留着（否则下一句话会把用户起的名字冲掉）',
)
eq(
  sanitizeConversations([conversation({ updatedAt: Number.NaN })]).length,
  1,
  '读回来：坏时间戳不许把整段丢掉',
)

/* --------------------------------------------------- 空对话的判定与清理 */

const emptyConv = conversation({ id: 'e' })
const talkedConv = conversation({
  id: 't',
  items: [{ kind: 'user', id: 'u', text: '你好' }],
})
report(isEmptyConversation(emptyConv), '空对话：没有内容、也没有 agent 会话 → 是空的')
report(!isEmptyConversation(talkedConv), '空对话：有内容 → 不是空的')
// 这一条是关键：agent 会话是发第一句话时才建的，所以有它就一定发过话。
// 只看内容条数的话，这种会被误判成空的删掉——把一段真用过的对话弄丢。
report(
  !isEmptyConversation(conversation({ id: 's', agentSessionId: 'web-1' })),
  '空对话：有 agent 会话 id 就不算空（哪怕内容被清过，也说明用过）',
)

eq(
  pruneEmptyConversations([
    conversation({ id: 'a', updatedAt: 3 }),
    conversation({ id: 'e1', updatedAt: 2 }),
    conversation({ id: 'e2', updatedAt: 1 }),
  ]).map(c => c.id),
  ['a'],
  '清理：有真内容时，空对话一个都不留',
)
eq(
  pruneEmptyConversations([
    conversation({ id: 'e1', updatedAt: 1 }),
    conversation({ id: 'e2', updatedAt: 9 }),
  ]).map(c => c.id),
  ['e2'],
  '清理：全是空的时只留最新那一段（列表总得有东西可显示）',
)
eq(pruneEmptyConversations([]).map(c => c.id), [], '清理：空列表还是空列表')
eq(
  pruneEmptyConversations([conversation({ id: 'a', updatedAt: 1, items: talkedConv.items })]).map(c => c.id),
  ['a'],
  '清理：没有空对话时原样返回',
)

installStorage()
globalThis.window.localStorage.setItem('luckycat.agent.sessions.v1', JSON.stringify([
  conversation({ id: 'real', updatedAt: 5, items: talkedConv.items, agentSessionId: 'web-1' }),
  conversation({ id: 'blank1', updatedAt: 4 }),
  conversation({ id: 'blank2', updatedAt: 3 }),
]))
eq(loadConversations().map(c => c.id), ['real'],
  '读存档时就把老版本留下的多余空对话清掉（光靠"切走时销毁"清不掉已经躺在盘上的）')

/* -------------------------------------------------------------------- 存回去 */

const many = Array.from({ length: MAX_CONVERSATIONS + 20 }, (_, i) => conversation({
  id: `c${i}`,
  updatedAt: i,
}))
const capped = trimConversations(many)
report(
  capped.length === MAX_CONVERSATIONS && capped[0].id === `c${MAX_CONVERSATIONS + 19}`,
  `存回去：段数超过 ${MAX_CONVERSATIONS} 时从最旧的整段丢`,
  [`留下 ${capped.length} 段，最新的是 ${capped[0].id}`],
)
report(!capped.some(c => c.id === 'c0'), '存回去：被丢掉的确实是最旧的（c0 不在了）')

const huge = Array.from({ length: 60 }, (_, i) => fat(`f${i}`, i))
const byBytes = trimConversations(huge)
const bytes = new TextEncoder().encode(JSON.stringify(byBytes)).length
report(
  byBytes.length < 60 && bytes <= 2_000_000 && byBytes[0].id === 'f59',
  '存回去：体积超上限时也从最旧的丢，且一定保住最新的那段',
  [`留下 ${byBytes.length} 段，共 ${bytes} 字节`],
)

const oneMonster = trimConversations([conversation({
  id: 'monster',
  items: Array.from({ length: 300 }, (_, i) => ({ kind: 'assistant', id: `m${i}`, text: '字'.repeat(19_000) })),
})])
report(oneMonster.length === 1, '存回去：单段就超上限时也要留下它（宁可超，也不能一存就什么都没有）')

const truncated = trimConversations([conversation({
  items: [{ kind: 'assistant', id: 'a', text: '字'.repeat(25_000) }],
})])[0].items[0].text
report(
  truncated.length === 20_000 + '…（过长，已截断）'.length && truncated.endsWith('…（过长，已截断）'),
  '存回去：单条内容超长会截断，并且**留下记号**（静默截断会让用户以为本来就这么多）',
  [`长度 ${truncated.length}`],
)

/* -------------------------------------------------------- 真存一遍，再读回来 */

installStorage()
const roundTrip = [conversation({ id: 'keep', agentSessionId: 'web-1', titleEdited: true, items: [
  { kind: 'user', id: 'u', text: '你好' },
  { kind: 'assistant', id: 'a', text: '在的' },
  { kind: 'tool', id: 't', name: 'bank_get_balance', state: 'done', text: '余额 1.00 CNY' },
] })]
const stored = saveConversations(roundTrip)
eq(stored.length, 1, '存取往返：写进去一段')
const back = loadConversations()
report(
  back.length === 1 && back[0].id === 'keep' && back[0].agentSessionId === 'web-1'
    && back[0].titleEdited === true && back[0].items.length === 3 && back[0].items[2].text === '余额 1.00 CNY',
  '存取往返：字段与内容都还在',
  [JSON.stringify(back)],
)
eq(messageCount(back[0]), 2, '存取往返：条数只算人看得见的内容（工具执行过程不算）')

installStorage()
globalThis.window.localStorage.setItem('luckycat.agent.sessions.v1', '{不是 JSON')
eq(loadConversations(), [], '读回来：存档本身不是合法 JSON 时给空列表，而不是抛异常')

installStorage(1)
const evicted = saveConversations([
  conversation({ id: 'old', updatedAt: 1 }),
  conversation({ id: 'mid', updatedAt: 2 }),
  conversation({ id: 'new', updatedAt: 3 }),
])
eq(evicted.map(c => c.id), ['new', 'mid'], '配额写满：丢掉最旧的一段再试，把剩下的存下来')

installStorage(Number.MAX_SAFE_INTEGER)
eq(saveConversations([conversation({ id: 'x' })]), [], '配额一直写不进去：不抛异常，返回空')
eq(globalThis.window.localStorage.getItem('luckycat.agent.sessions.v1'), null,
  '配额一直写不进去：把那个键清掉，不留半截垃圾')

/* -------------------------------------------------------------------- 汇总 */

console.log(failures === 0 ? '\n全部通过' : `\n失败 ${failures} 项`)

// HTTP 助手记录按客户隔离，旧版未绑定客户记录不进入客户存档。
installStorage()
saveConversations([conversation({ id: 'owner-a', items: [{ kind: 'user', id: 'a-message', text: '客户 A' }] })], 'a')
saveConversations([conversation({ id: 'owner-b', items: [{ kind: 'user', id: 'b-message', text: '客户 B' }] })], 'b')
eq(loadConversations('a').map(c => c.id), ['owner-a'], '客户 A 仅加载自己的对话')
eq(loadConversations('b').map(c => c.id), ['owner-b'], '客户 B 仅加载自己的对话')
const recovery = recoveryHistory([
  { kind: 'user', id: 'old', text: '旧问题', thumb: '不能迁入的图片' },
  { kind: 'tool', id: 'tool', name: 'bank_transfer', state: 'done', text: '不能迁入的工具回执' },
  { kind: 'notice', id: 'notice', text: '不能迁入的系统通知', tone: 'info' },
  { kind: 'assistant', id: 'reply', text: '旧回复' },
])
eq(recovery, [{ role: 'user', text: '旧问题' }, { role: 'assistant', text: '旧回复' }], '旧版恢复只带用户与助手文字，不带图片、工具或通知')
const recent = recoveryHistory(Array.from({ length: 80 }, (_, i) => ({ kind: 'user', id: String(i), text: '消息 ' + i })))
eq([recent.length, recent[0].text, recent.at(-1).text], [40, '消息 40', '消息 79'], '恢复保留最近 40 条且顺序不变')
const bounded = recoveryHistory(Array.from({ length: 40 }, (_, i) => ({ kind: 'user', id: String(i), text: '界'.repeat(10000) })))
report(new TextEncoder().encode(JSON.stringify(bounded)).byteLength <= 48_000, '恢复按 UTF-8 字节控制体积，避免中文超出请求预算')
installStorage()
saveConversations([conversation({ items: [
  { kind: 'user', id: 'chosen', text: '申请新卡', serviceIds: ['cards', 'security'] },
  { kind: 'user', id: 'cleared', text: '普通问题', serviceIds: [] },
] })])
eq(loadConversations()[0].items.map(item => item.serviceIds), [['cards', 'security'], []], '历史保留每条消息的功能选择快照，清除选择也保留为空数组')
const invalidSelection = sanitizeConversations([conversation({ items: [{ kind: 'user', id: 'bad-selection', text: '旧记录', serviceIds: 'cards' }] })])[0]
report(invalidSelection.items[0].serviceIds === undefined && invalidSelection.items[0].text === '旧记录', '损坏的功能选择被丢弃，原始消息继续可读')
process.exit(failures === 0 ? 0 : 1)
