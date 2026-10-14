/**
 * 历史对话的本地存档：把浏览器里的多段对话存下来、读回来。
 *
 * 历史列表仍保存在本机；服务端按登录客户保存上下文并在重启后恢复。
 * 未建立服务端归属的旧版本记录，可在发送时迁入最近的文字上下文。
 *
 * 这个模块是**纯逻辑**：不碰 React、不碰网络，所以能直接拿 node 跑测试。
 *
 * @module app/lib/agentSessions
 */

import { STORAGE_KEYS, storage, trySet } from './storage'
const historyKey = (ownerId?: string) => ownerId ? `${STORAGE_KEYS.agentSessions}.${ownerId}` : STORAGE_KEYS.agentSessions

/** 对话里的一条内容。 */
export type ChatItem =
  /*
   * `thumb` 是**缩略图**（`data:image/jpeg;base64,…`），不是原图：
   * 原图只发给 agent，存档里放原图会一张就吃掉 `MAX_STORE_BYTES`（2MB）的大半。
   * 见 `lib/image.ts` 的 `prepareImage`——它返回的两份数据是分开的。
   */
  | { kind: 'user'; id: string; text: string; thumb?: string; imageName?: string }
  | { kind: 'assistant'; id: string; text: string; messageId?: string; streaming?: boolean }
  | { kind: 'tool'; id: string; name: string; state: 'running' | 'done' | 'error'; text?: string }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error' }

/** 一条"人说的话"：用户发言或助手回复。工具执行过程与系统通知不算。 */
export type MessageItem = Extract<ChatItem, { kind: 'user' | 'assistant' }>

/** 旧版本迁移只带最近文字，不把本地工具行、通知或图片当作业务事实。 */
export function recoveryHistory(items: ChatItem[]): { role: 'user' | 'assistant'; text: string }[] {
  const messages = items.filter((item): item is MessageItem => item.kind === 'user' || item.kind === 'assistant')
  const history: { role: 'user' | 'assistant'; text: string }[] = []
  for (const item of messages.slice(-40).reverse()) {
    const row = { role: item.kind, text: item.text.slice(0, MAX_ITEM_TEXT) }
    if (new TextEncoder().encode(JSON.stringify([row, ...history])).byteLength > 48_000) break
    history.unshift(row)
  }
  return history
}

/** 一段对话（含它的全部内容）。 */export interface StoredConversation {
  /** 本地 id：只在这台设备上有意义，用来在界面上认人。 */
  id: string
  /**
   * agent 侧的会话 id。**懒创建**：还没发过话的对话没有这个字段，
   * 所以也不会在服务端留下空会话。
   */
  agentSessionId?: string
  title: string
  /** 用户手动改过标题。改过之后就不再用第一句话自动起名了。 */
  titleEdited?: boolean
  createdAt: number
  updatedAt: number
  items: ChatItem[]
}

/** 最多留多少段对话，超了从最旧的整段丢。 */
export const MAX_CONVERSATIONS = 50
/** 单条内容存下来的长度上限（正常回复远达不到，纯粹防跑飞）。 */
export const MAX_ITEM_TEXT = 20_000
/** 存档的总体积上限，超了从最旧的整段丢。 */
export const MAX_STORE_BYTES = 2_000_000

/** 标题最长多少个字。 */
const MAX_TITLE = 18

/** 生成一个本地随机 id（`crypto.randomUUID` 在非安全上下文里没有，所以留了后备）。 */
function randomId(): string {
  const c = globalThis.crypto
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '').slice(0, 16)
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** 造一段新的空对话。 */
export function makeConversation(now: number = Date.now()): StoredConversation {
  return {
    id: `c_${randomId()}`,
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    items: [],
  }
}

/**
 * 从第一句话里取标题。
 * @param text - 用户说的第一句话。
 * @returns 一行短标题；空话返回「新对话」。
 */
export function titleFrom(text: string): string {
  const first = (text.trim().split('\n')[0] ?? '').replace(/\s+/g, ' ').trim()
  if (first === '') return '新对话'
  return first.length > MAX_TITLE ? `${first.slice(0, MAX_TITLE)}…` : first
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** 是不是同一天。 */
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * 把时间戳说成人话。
 * @param ts - 时间戳（毫秒）。
 * @param now - 现在（毫秒），显式传入是为了能测。
 * @returns 例如「刚刚」「5 分钟前」「14:03」「昨天」「3 月 2 日」。
 */
export function relativeTime(
  ts: number,
  now: number = Date.now(),
  options: { compact?: boolean } = {},
): string {
  if (!Number.isFinite(ts)) return ''
  const diff = now - ts
  // 未来时间（设备时钟被调过）按"刚刚"处理，不显示负数。
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const at = new Date(ts)
  const today = new Date(now)
  if (sameDay(at, today)) return `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(at, yesterday)) {
    // 列表那一行很窄（旁边还有状态标记和两个按钮），`昨天 20:17` 会被挤到截断。
    // 在这个位置"昨天"已经够了，几点几分是次要信息。
    return options.compact === true ? '昨天' : `昨天 ${pad(at.getHours())}:${pad(at.getMinutes())}`
  }
  if (today.getFullYear() === at.getFullYear()) return `${at.getMonth() + 1} 月 ${at.getDate()} 日`
  return `${at.getFullYear()} 年 ${at.getMonth() + 1} 月 ${at.getDate()} 日`
}

/** 一段对话有多少条"人看得见"的内容（工具执行过程不算）。 */
export function messageCount(conversation: StoredConversation): number {
  return conversation.items.filter(item => item.kind === 'user' || item.kind === 'assistant').length
}

/**
 * 这段对话是不是"空"的——建出来但一次都没用过。
 *
 * **不能只看内容条数**：`agentSessionId` 是发第一句话时才建的，所以只要它有值，
 * 就一定发过话。两个条件一起看，才不会把一段真用过的对话误判成空的丢掉。
 * （清空是不可能的：没有"清空这段对话"这个操作，内容只增不减。）
 * @param conversation - 待判断的对话。
 * @returns 是不是空对话。
 */
export function isEmptyConversation(conversation: StoredConversation): boolean {
  return conversation.items.length === 0 && conversation.agentSessionId === undefined
}

/**
 * 最后一条助手回复的 id。
 *
 * 「重新生成」只挂在这一条上。挂到每一条上要面临一个很难解释的问题：
 * 重新生成中间那条回复，就得把它**后面**的几轮问答全丢掉——
 * 用户点的是"重说这一句"，代价却是删掉后面十分钟的对话。
 * @param items - 一段对话的内容。
 * @returns 最后一条助手回复的 id；没有助手回复时 undefined。
 */
export function lastAssistantId(items: ChatItem[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item !== undefined && item.kind === 'assistant') return item.id
  }
  return undefined
}

/**
 * 一条内容"对应的那次提问"是哪一句。
 *
 * 「重新生成」的按钮挂在**助手回复**上（用户点的就是那条回复），但倒回要倒到的
 * 是**产生它的那句提问**——这个换算很容易漏。漏了的后果是静默失灵：
 * `rewindTo` 拿到一个助手 id、按规矩拒绝、于是按钮点了什么都不发生
 * （实测踩到：编辑能用，因为编辑本来就传的用户消息 id）。
 * @param items - 一段对话的内容。
 * @param itemId - 用户点的那条内容。
 * @returns 对应的用户消息 id；不是用户发言/助手回复、或往前找不到提问时 undefined。
 */
export function promptOf(items: ChatItem[], itemId: string): string | undefined {
  const index = items.findIndex(item => item.id === itemId)
  const target = index < 0 ? undefined : items[index]
  if (target === undefined) return undefined
  if (target.kind === 'user') return target.id
  // 工具行和系统通知上没有这些动作，不该走到这里。
  if (target.kind !== 'assistant') return undefined
  for (let i = index - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item !== undefined && item.kind === 'user') return item.id
  }
  return undefined
}

/**
 * 把一段对话倒回到某条用户消息：保留到它为止，丢掉它后面的全部内容。
 *
 * 这是「编辑重发」和「重新生成」共用的那一步。两者只差在要不要换文字：
 *   · 编辑重发 → 传 `text`，那条用户消息换成新的
 *   · 重新生成 → 不传，保留原话，丢掉助手那条回复
 *
 * **只是本地这份记录的倒退，服务端的会话日志退不了。** 助手那边仍然记得
 * 被丢掉的那些话，所以重发等于"在同一个上下文里再问一遍"，而不是"回到当初那个状态"。
 * 这件事不藏着，写在界面的提示里（见 `MessageActions.tsx`）。
 * @param items - 一段对话的内容。
 * @param itemId - 要倒回到的那条内容 id，必须是用户说的话。
 * @param text - 换掉这条用户消息的文字；不传就用原文。
 * @returns 倒回之后的内容；找不到、或者那条不是用户消息时返回 undefined。
 */
export function rewindTo(items: ChatItem[], itemId: string, text?: string): ChatItem[] | undefined {
  const index = items.findIndex(item => item.id === itemId)
  const target = index < 0 ? undefined : items[index]
  if (target === undefined || target.kind !== 'user') return undefined
  const kept = items.slice(0, index + 1)
  if (text === undefined) return kept
  // 换文字时把最后一条也换掉。空文字是调用方的事——这里只做切片，不判断内容。
  return [...kept.slice(0, -1), { ...target, text }]
}

/**
 * 丢掉多余的"空对话"。
 *
 * 空对话没有内容可回看，留着唯一的价值是"当前正打开着这一段"。所以策略是：
 *   · 有非空的 → 空的一个都不留（用户不会想回到一张白纸）
 *   · 全是空的 → 只留最新那一段（列表总得有东西可显示）
 *
 * 页面上另有两条同源的规则（见 `useAgentChat`）：当前已经是空对话就不许再新建、
 * 离开空对话就把它销毁。这里管的是**读存档时**：老版本的存档里可能已经躺着
 * 好几个空的，光靠那两条规则清不掉。
 * @param list - 一堆对话。
 * @returns 清完的列表。
 */
export function pruneEmptyConversations(list: StoredConversation[]): StoredConversation[] {
  const nonEmpty = list.filter(conversation => !isEmptyConversation(conversation))
  if (nonEmpty.length > 0) return nonEmpty
  const newest = list.reduce<StoredConversation | undefined>(
    (best, conversation) => (best === undefined || conversation.updatedAt > best.updatedAt ? conversation : best),
    undefined,
  )
  return newest === undefined ? [] : [newest]
}

/* ----------------------------------------------------------------- 读回来 */

/** 是不是普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验并修一条内容；认不出来的返回 undefined（丢掉，而不是让整页崩掉）。 */
function sanitizeItem(raw: unknown, index: number): ChatItem | undefined {
  if (!isRecord(raw)) return undefined
  const id = typeof raw['id'] === 'string' && raw['id'] !== '' ? raw['id'] : `r_${index}`
  const kind = raw['kind']
  if (kind === 'user' || kind === 'assistant') {
    const text = raw['text']
    if (typeof text !== 'string') return undefined
    if (kind === 'assistant') return { kind, id, text,
      ...(typeof raw['messageId'] === 'string' ? { messageId: raw['messageId'] } : {}) }
    // 缩略图是可选的；存坏了就丢掉它，不能让整条消息消失。
    const thumb = typeof raw['thumb'] === 'string' && raw['thumb'].startsWith('data:image/')
      ? raw['thumb']
      : undefined
    const imageName = typeof raw['imageName'] === 'string' && raw['imageName'] !== '' ? raw['imageName'] : undefined
    return {
      kind,
      id,
      text,
      ...thumb === undefined ? {} : { thumb },
      ...imageName === undefined ? {} : { imageName },
    }
  }
  if (kind === 'notice') {
    const text = raw['text']
    if (typeof text !== 'string') return undefined
    return { kind: 'notice', id, text, tone: raw['tone'] === 'info' ? 'info' : 'error' }
  }
  if (kind === 'tool') {
    const name = raw['name']
    if (typeof name !== 'string' || name === '') return undefined
    const state = raw['state']
    const text = typeof raw['text'] === 'string' ? raw['text'] : undefined
    // 上次关页面时还在"执行中"的工具，这一轮早就断了。存成"未执行"，
    // 否则下次打开会有一行永远转圈。
    if (state !== 'done' && state !== 'error') {
      return { kind: 'tool', id, name, state: 'error', text: text ?? '上次没跑完' }
    }
    return text === undefined
      ? { kind: 'tool', id, name, state }
      : { kind: 'tool', id, name, state, text }
  }
  return undefined
}

/** 校验并修一段对话；认不出来返回 undefined。 */
function sanitizeConversation(raw: unknown): StoredConversation | undefined {
  if (!isRecord(raw)) return undefined
  const id = raw['id']
  if (typeof id !== 'string' || id === '') return undefined
  const itemsRaw = Array.isArray(raw['items']) ? raw['items'] : []
  const items = itemsRaw
    .map((item, index) => sanitizeItem(item, index))
    .filter((item): item is ChatItem => item !== undefined)
  const createdAt = typeof raw['createdAt'] === 'number' && Number.isFinite(raw['createdAt']) ? raw['createdAt'] : 0
  const updatedAt = typeof raw['updatedAt'] === 'number' && Number.isFinite(raw['updatedAt']) ? raw['updatedAt'] : createdAt
  const agentSessionId = typeof raw['agentSessionId'] === 'string' && raw['agentSessionId'] !== ''
    ? raw['agentSessionId']
    : undefined
  const titleRaw = raw['title']
  const firstUser = items.find(item => item.kind === 'user')
  const title = typeof titleRaw === 'string' && titleRaw.trim() !== ''
    ? titleRaw
    : firstUser === undefined ? '新对话' : titleFrom(firstUser.text)
  const base = { id, title, createdAt, updatedAt, items }
  return {
    ...base,
    ...agentSessionId === undefined ? {} : { agentSessionId },
    ...raw['titleEdited'] === true ? { titleEdited: true } : {},
  }
}

/**
 * 把存档里的东西洗成能用的列表：认得出来的留下，认不出来的丢掉。
 *
 * 存档是**用户能改的东西**（localStorage 就在那儿），也可能来自旧版本，
 * 所以这里不假设任何字段是对的：坏一条丢一条，绝不让整页白屏。
 * @param raw - 从 localStorage 读出来的任意值。
 * @returns 按更新时间从新到旧排好的对话列表。
 */
export function sanitizeConversations(raw: unknown): StoredConversation[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const kept: StoredConversation[] = []
  for (const entry of list) {
    const conversation = sanitizeConversation(entry)
    if (conversation === undefined || seen.has(conversation.id)) continue
    seen.add(conversation.id)
    kept.push(conversation)
  }
  return kept.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 读存档。 */
export function loadConversations(ownerId?: string): StoredConversation[] {
  // 先洗（认不出来的丢掉）再裁（多余的空白对话丢掉）：两件事分开，
  // 因为"合法"和"该留"不是一回事。
  return pruneEmptyConversations(sanitizeConversations(storage.get<unknown>(historyKey(ownerId), [])))
}

/* ----------------------------------------------------------------- 存回去 */

/** 字符串的 UTF-8 字节数（中文一个字三字节，按字符数算会严重低估）。 */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 单条内容超过上限就截断，并留个记号——静默截断会让用户以为本来就这么多。 */
function shrinkText(text: string): string {
  if (text.length <= MAX_ITEM_TEXT) return text
  return `${text.slice(0, MAX_ITEM_TEXT)}…（过长，已截断）`
}

/** 把一段对话压到存档尺寸。 */
function shrinkConversation(conversation: StoredConversation): StoredConversation {
  return {
    ...conversation,
    items: conversation.items.map((item) => {
      if (item.kind === 'tool' && item.text !== undefined) {
        return { ...item, text: shrinkText(item.text) }
      }
      if (item.kind === 'tool') return item
      return { ...item, text: shrinkText(item.text) }
    }),
  }
}

/**
 * 按上限裁一遍：先按段数取最新的，再按体积从最旧的整段丢。
 *
 * 体积那条是必须的：50 段各带一篇长回复就能把 localStorage 撑爆，
 * 而 localStorage 写失败是**抛异常**的——不裁的话表现是"历史忽然全没了"。
 * @param list - 待存的对话。
 * @returns 裁完的对话，从新到旧。
 */
export function trimConversations(list: StoredConversation[]): StoredConversation[] {
  const sorted = [...list]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
    .map(shrinkConversation)
  const kept: StoredConversation[] = []
  let bytes = 0
  for (const conversation of sorted) {
    const size = byteLength(JSON.stringify(conversation))
    // 最新的一段无论如何都留着：宁可超一点，也不能一存就什么都没有。
    if (kept.length > 0 && bytes + size > MAX_STORE_BYTES) break
    bytes += size
    kept.push(conversation)
  }
  return kept
}

/**
 * 存存档。尽力而为：写不进去就丢掉最旧的再试，全丢掉还不行就清空这个键。
 * @param list - 要存的对话。
 * @returns 实际存下来的对话；调用方可以据此知道有没有被裁。
 */
export function saveConversations(list: StoredConversation[], ownerId?: string): StoredConversation[] {
  let pending = trimConversations(list)
  while (pending.length > 0) {
    if (trySet(historyKey(ownerId), pending)) return pending
    pending = pending.slice(0, -1)
  }
  storage.remove(historyKey(ownerId))
  return []
}
