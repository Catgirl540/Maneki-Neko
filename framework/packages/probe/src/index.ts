/**
 * 自检探针：把工具注册表与向量服务的**真实状态**写到 stderr。
 *
 * 为什么需要它：`InitializeResult` 只含 `serverInfo`，SDK 握手看不到工具面；
 * loader 的激活日志开关在 launcher 创建的 root include 上，不改内核就设不了。
 *
 * 为什么必须延迟读：loader 是**并发**激活条目（EntryGroup 用 Promise.allSettled），
 * 在 apply 里当场读注册表会读到空表。所以 apply 只排一个定时读取，
 * 由 ctx.effect 负责卸载时清理。
 *
 * 只通过 `--patch` overlay 挂载，不进生产树。
 * 环境变量 `LUCKYCAT_PROBE_EMBED=1` 时额外做一次真实向量调用。
 * @module @luckycat/dsh-probe
 */

import { writeSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis 插件名。 */
export const name = 'luckycat-probe'

/** 要读工具注册表，必须先等它就绪。 */
export const inject = ['tools']

/** 等所有条目激活完再读表（loader 并发激活，apply 当场读会读到空）。 */
const REPORT_DELAY_MS = 1000

/** 向量服务的最小结构类型；用 ctx.get 可选读取，避免与那个包产生类型耦合。 */
interface EmbeddingLike {
  listRoutes(): readonly string[]
  embed(request: { texts: readonly string[] }): Promise<number[][]>
}

/** 排一个延迟自检；插件卸载时清掉定时器。 */
export function apply(ctx: Context): void {
  // 故意返回"假密钥"的工具：用来端到端验证加固包有没有在结果落盘/进模型前抹掉它。
  // 只挂在 --patch 的 doctor overlay 下，不进生产树。
  ctx.tools.register(defineTool({
    name: 'luckycat_probe_secret',
    description: 'Diagnostic tool that returns a fake credential so the hardening layer can be verified. Test only.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(): Promise<string> {
      const fakeEnvValue = process.env.LUCKYCAT_PROBE_FAKE_SECRET ?? '(未设置)'
      return Promise.resolve(
        '诊断用假凭据：\n'
        + 'sk-or-v1-fakefakefakefakefakefakefake\n'
        + `env 取值：${fakeEnvValue}\n`,
      )
    },
  }))

  ctx.effect(() => {
    const timer = setTimeout(() => {
      reportTools(ctx)
      void reportEmbedding(ctx)
    }, REPORT_DELAY_MS)
    return () => { clearTimeout(timer) }
  })
}

/** 把工具注册表内容同步写到 stderr，保证进程退出前落盘。 */
function reportTools(ctx: Context): void {
  const names = ctx.tools.schemas().map(schema => schema.name).sort()
  const ping = ctx.tools.get('luckycat_ping')
  writeSync(2, `[luckycat-probe] tools=${names.length}\n`)
  writeSync(2, `[luckycat-probe] luckycat_ping=${ping === undefined ? 'MISSING' : 'REGISTERED'}\n`)
  writeSync(2, `[luckycat-probe] names=${names.join(',')}\n`)
}

/**
 * 向量服务自检。可选服务用 `ctx.get` 读（DSH 约定：声明式注入才用 `ctx.<name>`），
 * 因为探针可能在没挂向量服务的树上运行。
 */
async function reportEmbedding(ctx: Context): Promise<void> {
  const get = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
  // 补课项是否真的激活：压缩与用量统计都是可选服务，用 ctx.get 探。
  // 注意：compaction-basic 硬依赖 tokenMeter，所以这两个要一起看。
  writeSync(2, `[luckycat-probe] compaction=${get('compaction') === undefined ? 'ABSENT' : 'ACTIVE'}\n`)
  writeSync(2, `[luckycat-probe] tokenMeter=${get('tokenMeter') === undefined ? 'ABSENT' : 'ACTIVE'}\n`)

  const embedding = get('embedding') as EmbeddingLike | undefined
  if (embedding === undefined) {
    writeSync(2, '[luckycat-probe] embedding=NOT_MOUNTED\n')
    return
  }
  writeSync(2, `[luckycat-probe] embedding_routes=${embedding.listRoutes().join(',') || 'none'}\n`)
  if (process.env.LUCKYCAT_PROBE_EMBED !== '1') return
  const route = process.env.LUCKYCAT_PROBE_EMBED_ROUTE
  try {
    const vectors = await embedding.embed({
      texts: ['luckycat 向量自检'],
      ...route === undefined ? {} : { route },
    })
    writeSync(2, `[luckycat-probe] embed_ok=1 route=${route ?? '(default)'} count=${vectors.length} dims=${vectors[0]?.length ?? 0}\n`)
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'UNKNOWN'
    const message = error instanceof Error ? error.message : String(error)
    writeSync(2, `[luckycat-probe] embed_ok=0 code=${code} message=${message}\n`)
  }
}