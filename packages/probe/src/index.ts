/**
 * 自检探针：把工具注册表里**真实注册**的工具名列到 stderr。
 *
 * 为什么需要它：`InitializeResult` 只含 `serverInfo`，SDK 握手看不到工具面；
 * loader 的激活日志开关在 launcher 创建的 root include 上，不改内核就设不了。
 *
 * 为什么必须延迟读：loader 是**并发**激活条目（EntryGroup 用 Promise.allSettled），
 * 在 apply 里当场读注册表会读到空表。所以 apply 只排一个定时读取，
 * 由 ctx.effect 负责卸载时清理。
 *
 * 只通过 `--patch` overlay 挂载，不进生产树。
 * @module @luckycat/dsh-probe
 */

import { writeSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis 插件名。 */
export const name = 'luckycat-probe'

/** 要读工具注册表，必须先等它就绪。 */
export const inject = ['tools']

/** 等所有条目激活完再读表（loader 并发激活，apply 当场读会读到空）。 */
const REPORT_DELAY_MS = 1000

/** 排一个延迟自检；插件卸载时清掉定时器。 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const timer = setTimeout(() => { report(ctx) }, REPORT_DELAY_MS)
    return () => { clearTimeout(timer) }
  })
}

/** 把注册表内容同步写到 stderr，保证进程退出前落盘。 */
function report(ctx: Context): void {
  const names = ctx.tools.schemas().map(schema => schema.name).sort()
  const ping = ctx.tools.get('luckycat_ping')
  writeSync(2, `[luckycat-probe] tools=${names.length}\n`)
  writeSync(2, `[luckycat-probe] luckycat_ping=${ping === undefined ? 'MISSING' : 'REGISTERED'}\n`)
  writeSync(2, `[luckycat-probe] names=${names.join(',')}\n`)
}