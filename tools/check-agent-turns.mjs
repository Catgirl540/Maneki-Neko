// node --import ./tools/ts-resolve-hook.mjs --test tools/check-agent-turns.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { groupChatMessages, prepareTurnRetry, retryRequestText, turnContent } from '../app/src/lib/agentTurns.ts'
import { messageCount, promptOf, sanitizeConversations } from '../app/src/lib/agentSessions.ts'

const user = (id, text = '查一下余额') => ({ kind: 'user', id, text })
const assistant = (id, text, streaming = false) => ({ kind: 'assistant', id, text, streaming })
const tool = (id, state = 'done') => ({ kind: 'tool', id, name: 'bank_get_balance', state, text: '已查询账户' })
const items = [user('u1'), assistant('a1', '我查一下您的账户余额。'), tool('t1'), assistant('a2', '可用余额为 100 元。')]
const conversation = rows => ({ id: 'c1', title: '余额', createdAt: 1, updatedAt: 1, items: rows })
const response = rows => groupChatMessages(rows).at(-1)

test('同一轮前言、工具与答复共用一个根节点，复制和朗读只取最终正文', () => {
  const messages = groupChatMessages(items)
  assert.equal(messages.length, 2)
  const { reply, activity } = turnContent(messages[1])
  assert.equal(reply.id, 'a2')
  assert.equal(reply.text, '可用余额为 100 元。')
  assert.deepEqual(activity.map(item => item.id), ['a1', 't1'])
  assert.equal(promptOf(items, reply.id), 'u1')
  assert.equal(messageCount(conversation(items)), 2)
})

test('下一轮具有独立根节点，不吞并前一轮内容', () => {
  const rows = [...items, user('u2', '谢谢'), assistant('a3', '不客气。')]
  const messages = groupChatMessages(rows)
  assert.deepEqual(messages.map(item => item.id), ['u1', 'turn-u1', 'u2', 'turn-u2'])
  assert.equal(turnContent(messages[1]).reply.text, '可用余额为 100 元。')
  assert.equal(turnContent(messages[3]).reply.text, '不客气。')
  assert.equal(messageCount(conversation(rows)), 4)
})

test('从等待到多次工具调用再到流式结束，根节点始终稳定', () => {
  const rows = [user('u1')]
  const ids = [response(rows).id]
  rows.push(assistant('a1', '先查余额'), tool('t1', 'running'))
  ids.push(response(rows).id)
  assert.equal(turnContent(response(rows)).reply, undefined)
  rows[2] = tool('t1')
  rows.push(assistant('a2', '再查账单'), tool('t2'), assistant('a3', '汇总中', true))
  ids.push(response(rows).id)
  const content = turnContent(response(rows))
  assert.equal(content.reply.streaming, true)
  assert.deepEqual(content.activity.map(item => item.id), ['a1', 't1', 'a2', 't2'])
  rows[5] = assistant('a3', '汇总完成')
  ids.push(response(rows).id)
  assert.equal(turnContent(response(rows)).reply.streaming, false)
  assert.equal(new Set(ids).size, 1)
})

test('正文的连续分段合并，空分段不取代已有答复', () => {
  const content = turnContent(response([user('u'), assistant('a1', '第一部分'), assistant('a2', '第二部分'), assistant('a3', '')]))
  assert.equal(content.reply.text, '第一部分\n\n第二部分')
  assert.equal(content.reply.id, 'a2')
  assert.equal(content.activity.length, 0)
})

test('工具失败与停止通知保留在根节点，前言不会冒充最终结果', () => {
  const notice = { kind: 'notice', id: 'n1', text: '连接中断', tone: 'error' }
  const content = turnContent(response([user('u'), assistant('a1', '我查一下'), tool('t1', 'error'), notice]))
  assert.equal(content.reply, undefined)
  assert.equal(content.lastTool.state, 'error')
  assert.deepEqual(content.notices, [notice])
  assert.ok(!content.activity.includes(notice))
})

test('失败后得到解释时保留答复及错误，不把错误折叠隐藏', () => {
  const rows = [user('u'), tool('t', 'error'), { kind: 'notice', id: 'n', text: '服务不可用', tone: 'error' }, assistant('a', '请稍后重试。')]
  const content = turnContent(response(rows))
  assert.equal(content.reply.text, '请稍后重试。')
  assert.equal(content.notices[0].text, '服务不可用')
})

test('旧存档缺少用户提问仍能显示，空历史和等待首段也能分组', () => {
  assert.deepEqual(groupChatMessages([]), [])
  assert.equal(response([user('u')]).items.length, 0)
  assert.equal(turnContent(response([assistant('a', '旧回复')])).reply.text, '旧回复')
  assert.equal(response([{ kind: 'notice', id: 'n', text: '已恢复', tone: 'info' }]).id, 'turn-n')
})

test('读取旧存档无需迁移，分组不会改动原始记录和功能选择', () => {
  const rows = [{ ...user('u1'), serviceIds: ['cards', 'security'] }, ...items.slice(1)]
  const before = structuredClone(rows)
  const stored = sanitizeConversations([conversation(rows)])[0]
  const content = turnContent(response(stored.items))
  assert.equal(content.reply.id, 'a2')
  assert.deepEqual(content.activity.map(item => item.id), ['a1', 't1'])
  assert.deepEqual(rows, before)
  assert.deepEqual(stored.items[0].serviceIds, ['cards', 'security'])
})

test('无正文失败仍可重试，保持原问题及功能选择，不重复插入用户消息', () => {
  const prompt = { ...user('u1'), serviceIds: ['transfer', 'cards'] }
  const rows = [prompt, { kind: 'notice', id: 'n1', text: '模型没有产出可见文本', tone: 'error' }]
  const plan = prepareTurnRetry(rows, 'u1')
  assert.deepEqual(plan.items, [prompt])
  assert.deepEqual(plan.prompt.serviceIds, ['transfer', 'cards'])
  assert.equal(rows.length, 2)
})

test('回复失败后重试保留已完成操作，去除失败通知和不完整尾部正文', () => {
  const rows = [user('u1'), tool('t1'), assistant('a1', '未完成的答复'), { kind: 'notice', id: 'n1', text: '上游失败', tone: 'error' }]
  const plan = prepareTurnRetry(rows, 'u1')
  assert.deepEqual(plan.items.map(item => item.id), ['u1', 't1'])
  assert.equal(plan.items[1].state, 'done')
  const request = retryRequestText(plan.prompt.text)
  assert.match(request, /不是新的业务指令/)
  assert.match(request, /先查最新交易状态或流水/)
  assert.match(request, /不得重复提交/)
  assert.match(request, /仍须经过原有确认和身份验证/)
  assert(request.endsWith('用户原始请求：查一下余额'))
})

test('不重试较早问题、成功回复、未知消息；图片请求保持图片标记', () => {
  assert.equal(prepareTurnRetry([...items, user('u2')], 'u1'), undefined)
  assert.equal(prepareTurnRetry(items, 'u1'), undefined)
  assert.equal(prepareTurnRetry(items, 'missing'), undefined)
  const imagePrompt = { ...user('image', ''), thumb: 'data:image/png;base64,a' }
  const rows = [imagePrompt, { kind: 'notice', id: 'n', text: '图片发送失败', tone: 'error' }]
  assert.equal(prepareTurnRetry(rows, 'image').prompt.thumb, imagePrompt.thumb)
})
