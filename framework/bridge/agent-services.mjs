/**
 * 客户助手能力清单 —— 网页、安卓和智能体共用这一份。
 *
 * 以前「网页能选哪些能力」写在 `app/src/components/layout/services.ts`，
 * 安卓再抄一份，服务端技能目录又是第三份，靠脚本比对。现在清单只在
 * `framework/agent-services.json`，客户端通过 `GET /agent-api/services` 读取：
 *
 *   { version, updatedAt, services: [{ id, label, description, order }] }
 *
 * 这里只负责校验和排序，不猜图标、路由或文案。图标与页面归属是客户端表现，
 * 客户端按 `id` 自己映射；`id` 必须能对应 `framework/skills/catalog.json` 里的技能，
 * 否则发消息时会被 `service-skills.mjs` 拒绝。
 *
 * 清单在进程启动时读一次：改动后重启 Agent 生效，不支持热更新。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DEFAULT_FILE = fileURLToPath(new URL('../agent-services.json', import.meta.url))
const MAX_SERVICES = 24
const ID = /^[a-z][a-z0-9-]{1,31}$/
const LABEL_MAX = 16
const DESCRIPTION_MAX = 60

function fail(message) {
  throw new Error(`agent-services.json: ${message}`)
}

function text(value, label, max) {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const trimmed = value.trim()
  if (trimmed === '') fail(`${label} 不能为空`)
  if (trimmed.length > max) fail(`${label} 超过 ${max} 个字符`)
  return trimmed
}

/**
 * 读取并校验能力清单。默认读仓库内那份；测试可传临时文件。
 * @returns {{version:number, updatedAt:string, services:Array<{id:string,label:string,description:string,order:number}>}}
 */
export function loadAgentServices(file = DEFAULT_FILE) {
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`agent-services.json: 无法读取或不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('顶层必须是对象')
  if (!Number.isSafeInteger(raw.version) || raw.version < 1) fail('version 必须是正整数')
  if (typeof raw.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.updatedAt)) fail('updatedAt 必须是 YYYY-MM-DD')
  if (!Array.isArray(raw.services) || raw.services.length === 0) fail('services 必须是非空数组')
  if (raw.services.length > MAX_SERVICES) fail(`services 最多 ${MAX_SERVICES} 项`)

  const ids = new Set()
  const orders = new Set()
  const services = raw.services.map((entry, index) => {
    const where = `services[${index}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail(`${where} 必须是对象`)
    if (typeof entry.id !== 'string' || !ID.test(entry.id)) fail(`${where}.id 必须是 2–32 位小写字母、数字或连字符`)
    if (ids.has(entry.id)) fail(`id 重复: ${entry.id}`)
    if (!Number.isSafeInteger(entry.order) || entry.order < 0 || entry.order > 9999) fail(`${where}.order 必须是 0–9999 的整数`)
    if (orders.has(entry.order)) fail(`order 重复: ${entry.order}`)
    ids.add(entry.id)
    orders.add(entry.order)
    return {
      id: entry.id,
      order: entry.order,
      label: text(entry.label, `${where}.label`, LABEL_MAX),
      description: text(entry.description, `${where}.description`, DESCRIPTION_MAX),
    }
  })

  services.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return { version: raw.version, updatedAt: raw.updatedAt, services }
}
