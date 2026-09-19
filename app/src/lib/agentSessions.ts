/**
 * 历史对话的本地存档：把浏览器里的多段对话存下来、读回来。
 *
 * 为什么存在**浏览器**里而不是服务端：这一版没有银行后端，agent 演示服务只活在
 * 内存里，重启就忘。把列表放在服务端，重启后要么全空、要么得先做持久化——而真正
 * 的持久化该由银行后端来做（见 `design/backend-handoff/AGENT-RUNTIME-CONTRACT.md`）。
 * 所以这一版：**记录存本地、上下文靠运行时**，两条路各管各的。
 *
 * 由此带来一条必须说清楚的规矩：本地有记录 ≠ 助手还记得。服务重启过之后，
 * 旧对话的记录还在，但运行时里的上下文没了。这个"失忆"由
 * `GET /agent-api/sessions/:id` 探测出来，界面负责如实告诉用户（见 `useAgentChat`）。
 *
 * 这个模块是**纯逻辑**：不碰 React、不碰网络，所以能直接拿 node 跑测试。
 *
 * @module app/lib/agentSessions
 */

import { STORAGE_KEYS, storage, trySet } from '@/lib/storage'

/** 对话里的一条内容。 */
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; state: 'running' | 'done' | 'error'; text?: string }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error' }

/** 一段对话（含它的全部内容）。 */
export interface StoredConversation {
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
export function relativeTime(ts: number, now: number = Date.now()): string {
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
  if (sameDay(at, yesterday)) return `昨天 ${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (today.getFullYear() === at.getFullYear()) return `${at.getMonth() + 1} 月 ${at.getDate()} 日`
  return `${at.getFullYear()} 年 ${at.getMonth() + 1} 月 ${at.getDate()} 日`
}

/** 一段对话有多少条"人看得见"的内容（工具执行过程不算）。 */
export function messageCount(conversation: StoredConversation): number {
  return conversation.items.filter(item => item.kind === 'user' || item.kind === 'assistant').length
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
    return { kind, id, text }
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
export function loadConversations(): StoredConversation[] {
  return sanitizeConversations(storage.get<unknown>(STORAGE_KEYS.agentSessions, []))
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
export function saveConversations(list: StoredConversation[]): StoredConversation[] {
  let pending = trimConversations(list)
  while (pending.length > 0) {
    if (trySet(STORAGE_KEYS.agentSessions, pending)) return pending
    pending = pending.slice(0, -1)
  }
  storage.remove(STORAGE_KEYS.agentSessions)
  return []
}
