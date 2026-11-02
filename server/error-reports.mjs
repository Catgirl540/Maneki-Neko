import { randomUUID } from 'node:crypto'
import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 客户报错反馈的落盘存储。
 *
 * 为什么不用工单表：现有「人工工单」是内存 Map（`server/domain/index.mjs`，
 * 按客户隔离、重启即丢、员工端看不到），语义也是「找客服」而不是「系统出问题」。
 * 报错是要给运维排查的日志，混进工单会污染两边的语义，所以单独一行一个 JSON。
 *
 * 存储形态：追加写 `error-reports.jsonl`，一条一行；
 * 标记已处理时整份重写（报错量级是人工处理的量，不担心写放大）。
 */
const FILE_NAME = 'error-reports.jsonl'

/** 单文件保留上限：超过就丢弃最旧的，避免无限增长。 */
const MAX_ROWS = 2000

/**
 * 报错文件位置。
 *
 * 默认放在本模块旁边的 `data/`：老实现用 `join(root, 'server/data')`，
 * 但生产上服务工作目录已经是 `<release>/server`，`root` 又退化成 process.cwd()，
 * 于是拼出 `<release>/server/server/data`，服务账号没有权限创建，接口直接 500 EACCES。
 * 改成按模块定位后，从哪个目录启动都落到 `<release>/server/data/error-reports.jsonl`。
 */
export function errorReportPath(_root) {
  const dir = process.env.BANK_ERROR_REPORT_DIR ?? join(import.meta.dirname, 'data')
  return join(dir, FILE_NAME)
}

async function readRows(file) {
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        // 坏行不该让整个列表 500：跳过，运维仍能看到其余记录。
        return null
      }
    })
    .filter(Boolean)
}

async function writeRows(file, rows) {
  await mkdir(dirname(file), { recursive: true })
  const text = rows.map((row) => JSON.stringify(row)).join('\n')
  await writeFile(file, text === '' ? '' : `${text}\n`, 'utf8')
}

/**
 * 追加一条报错。
 * @param {string} root 仓库根目录
 * @param {object} report 规范化之后的报错字段
 * @param {{ customerId?: string, customerPhone?: string }} who 谁报的（内部字段，不回给客户端）
 */
export async function recordErrorReport(root, report, who = {}) {
  const file = errorReportPath(root)
  const row = {
    id: `err_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    status: 'open',
    message: report.message,
    note: report.note,
    page: report.page,
    appVersion: report.appVersion,
    platform: report.platform,
    customerId: who.customerId ?? '',
    customerPhone: who.customerPhone ?? '',
    resolvedAt: null,
    resolvedBy: null,
  }
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(row)}\n`, 'utf8')
  await trim(file)
  return { id: row.id, createdAt: row.createdAt }
}

async function trim(file) {
  const rows = await readRows(file)
  if (rows.length > MAX_ROWS) await writeRows(file, rows.slice(rows.length - MAX_ROWS))
}

/** 运维端列表：最新在前，可按状态过滤。 */
export async function listErrorReports(root, { limit = 100, status } = {}) {
  const rows = await readRows(errorReportPath(root))
  const filtered = status ? rows.filter((row) => row.status === status) : rows
  return filtered.slice(-limit).reverse()
}

/** 标记已处理；找不到返回 null，避免调用方把「没这条」当成成功。 */
export async function resolveErrorReport(root, id, staffId) {
  const file = errorReportPath(root)
  const rows = await readRows(file)
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return null
  rows[index] = {
    ...rows[index],
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    resolvedBy: staffId ?? '',
  }
  await writeRows(file, rows)
  return rows[index]
}
