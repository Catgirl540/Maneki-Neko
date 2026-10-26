import { createHash } from 'node:crypto'
import { parseReminderTime } from './reminder-time.mjs'
import { beijingReminderTime } from './bank-reminders.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sensitive = text => /(?:支付密码|登录密码|验证码|安全码|cvv)\s*[:：为是]?\s*[A-Za-z0-9]{3,}/i.test(text)
const createIntent = text => /提醒|闹钟|日程/.test(text)
const queryIntent = text => /^(?:请|帮我|请帮我)?(?:查看|查询|看看|列出)(?:一下)?(?:我的|已设置的)?(?:日程)?提醒(?:列表)?[？?。！!]?$/u.test(text) || /^(?:我的提醒|提醒列表|日程列表|有哪些提醒)[？?。！!]?$/u.test(text)
function titleOf(text) {
  return text.replace(/^(?:(?:请|麻烦|帮我|帮忙|请帮我)\s*)+/, '')
    .replace(/(?:设置|创建|添加|安排)(?:一个|一条|个|条)?(?:日程)?(?:提醒|闹钟|日程)/, '')
    .replace(/提醒我(?:一下)?|提醒一下/, '')
    .replace(/^提醒\s*/, '')
    .replace(/^[\s，,。；;：:、]+|[\s，,。；;：:、]+$/g, '').trim()
}
const statusText = { scheduled: '等待发送', sending: '正在发送', sent: '已提交微信（不代表已读）', cancelled: '已取消', suppressed: '绑定变化已停止', expired: '已过期', failed: '发送失败', unknown: '投递结果待核实' }
const describe = result => `${result.status === 'scheduled' ? '已设置提醒' : '这条提醒已存在'}：${result.title}\n时间：${beijingReminderTime(result.dueAt)}（北京时间）\n状态：${statusText[result.status] ?? '状态待核实'}\n编号：${result.id}\n可在银行网页“IM 连接 → 提醒记录”查看。`

/** Reminder-only lane. A verified persistent private-chat binding is sufficient; no bank token is restored. */
export function createImReminderChat({ reminders, clock = Date.now }) {
  const drafts = new Map(), recent = new Map(), lastCreated = new Map()
  let closed = false
  function clearExpired() {
    for (const map of [drafts, recent, lastCreated]) for (const [key, value] of map) if (value.expiresAt <= clock()) map.delete(key)
  }
  function remember(map, key, value) {
    if (!map.has(key) && map.size >= 1000) throw Error('当前提醒请求较多，请稍后重试')
    map.set(key, { ...value, expiresAt: clock() + 10 * 60000 })
  }
  function valid(route, context) {
    if (closed || context.signal?.aborted || context.isCurrent?.() !== true || route.channel !== 'weixin' || !route.ownerId || !route.bindingRevision) throw Error('微信绑定已变化，请重新绑定本人微信后再设置提醒')
  }
  async function handle(route, raw, context) {
    if (typeof raw !== 'string') return undefined
    const text = raw.trim()
    const key = hash([route.id, route.ownerId, route.bindingRevision, route.channel, route.botId, route.key])
    clearExpired()
    const old = drafts.get(key)
    const cancellation = /^(?:请|帮我|请帮我)?(?:取消|删除|撤销)(?:刚才(?:那条)?|上一条|这条)?(?:日程)?提醒(?:\s*(rem-[\w-]+))?[。！!]?$/u.exec(text)
    if (!createIntent(text) && !queryIntent(text) && !cancellation && !old) return undefined
    if (text.startsWith('/') || text.length > 12000) return undefined
    try {
      valid(route, context)
      const service = reminders()
      if (!service) return '微信提醒服务尚未启用，请稍后重试。'
      if (sensitive(text)) return '请勿在提醒中保存密码、验证码或银行卡安全码。请换一条不含这些信息的提醒内容。'
      if (/(?:每天|每日|每周|每星期|每月|每年|工作日|隔天|每隔|重复|循环)/.test(text)) return '目前支持一次性提醒，不能设置重复日程。请明确哪一天、几点提醒，我会在微信里直接保存。'
      if (queryIntent(text)) {
        const result = service.list(route.ownerId), rows = result.reminders.slice(0, 10)
        if (!rows.length) return '您还没有已保存的提醒。可以说“明天上午九点提醒我买花”。'
        return '您最近的提醒：\n' + rows.map(row => `${sensitive(row.title) ? '（敏感内容请在银行网页查看）' : row.title}\n${beijingReminderTime(row.dueAt)}（北京时间）· ${statusText[row.status] ?? '状态待核实'}\n编号：${row.id}`).join('\n\n') + (result.reminders.length > 10 ? '\n更多记录可在银行网页“IM 连接 → 提醒记录”查看。' : '')
      }
      if (old && /^(?:算了|取消|不要提醒了|取消设置|不设置了)[。！!]?$/u.test(text)) {
        drafts.delete(key); return '已放弃这次尚未保存的提醒，没有创建新任务。'
      }
      if (cancellation) {
        if (old && !cancellation[1]) { drafts.delete(key); return '已放弃这次尚未保存的提醒，没有创建新任务。' }
        const id = cancellation[1] ?? (/刚才|上一条|这条/.test(text) ? lastCreated.get(key)?.id : undefined)
        if (!id) return '请先说“查看提醒”，再回复“取消提醒 rem-…”并带上要取消的提醒编号。'
        valid(route, context)
        const prepared = service.prepare(route.ownerId, 'cancel', { reminderId: id })
        valid(route, context)
        const result = service.execute(route.ownerId, prepared, 'im-cancel-' + hash([key, id]))
        return result.status === 'cancelled' ? `已取消提醒：${sensitive(result.title) ? '（敏感内容请在银行网页查看）' : result.title}\n编号：${result.id}` : '提醒状态已变化，请先查看提醒记录。'
      }
      const fresh = createIntent(text), draft = fresh ? {} : old ?? {}
      const messageKey = hash([key, text]), receipt = recent.get(messageKey)
      if (fresh && receipt?.dedupUntil > clock()) {
        const existing = service.list(route.ownerId).reminders.find(row => row.id === receipt.id)
        if (existing) return describe(existing)
      }
      // Do not consume an unrelated bank request as a time answer.
      if (!fresh && !draft.awaitTitle && !/[今明后天周月日点时分秒:：]|上午|下午|晚上|中午|凌晨|早上/.test(text)) return undefined
      let parsed
      try {
        const input = !fresh && draft.ambiguousTime && /^(?:上午|下午|晚上|早上|中午|凌晨)$/.test(text) ? text + draft.ambiguousTime : text
        parsed = parseReminderTime(input, { now: clock(), dateHint: draft.date })
      } catch (error) {
        const title = titleOf(error.remainder ?? '') || draft.title || ''
        remember(drafts, key, { routeId: route.id, date: error.date ?? draft.date, title, ambiguousTime: error.ambiguousTime })
        return `${error.message}。请在微信里补充，例如“明天上午九点”；无需打开浏览器。`
      }
      const title = titleOf(parsed.remainder) || draft.title || ''
      const dueAt = parsed.dueAt ?? (!parsed.hasDate && !parsed.hasTime ? draft.dueAt : undefined)
      const next = { routeId: route.id, title, date: parsed.date ?? draft.date, dueAt, awaitTitle: !title }
      if (!title || !dueAt) {
        remember(drafts, key, next)
        if (!title && !dueAt) return '要提醒您什么事、哪天几点？例如“明天上午九点提醒我买花”。直接在微信补充即可。'
        if (!title) return `已记下时间：${beijingReminderTime(dueAt)}（北京时间）。要提醒您什么事？`
        return `“${title}”具体几点提醒？${next.date ? `日期已记为 ${next.date}（北京时间），` : ''}请回复例如“明天上午九点”。无需打开浏览器。`
      }
      // Retain the user's stated content if bank validation asks for another future time.
      remember(drafts, key, next)
      valid(route, context)
      const prepared = service.prepare(route.ownerId, 'create', { title, dueAt, bindingId: route.id })
      valid(route, context)
      const requestId = 'im-chat-' + hash([key, prepared.title, prepared.dueAt])
      const result = service.execute(route.ownerId, prepared, requestId)
      drafts.delete(key)
      remember(lastCreated, key, { routeId: route.id, id: result.id })
      remember(recent, messageKey, { routeId: route.id, id: result.id, dedupUntil: clock() + 30000 })
      return describe(result)
    } catch (error) {
      if (context.signal?.aborted || context.isCurrent?.() !== true) return '微信绑定已变化，本次操作未能继续，请重新绑定本人微信后重发。'
      if (error.status && error.status < 500) return `提醒未完成：${error.message}。请直接在微信里补充或重新发送。`
      return '暂时无法确认提醒保存结果，请先回复“查看提醒”或在银行网页核对记录，避免重复设置。'
    }
  }
  return {
    handle,
    invalidateRoute(id) { for (const map of [drafts, recent, lastCreated]) for (const [key, value] of map) if (value.routeId === id) map.delete(key) },
    close() { closed = true; drafts.clear(); recent.clear(); lastCreated.clear() },
  }
}
