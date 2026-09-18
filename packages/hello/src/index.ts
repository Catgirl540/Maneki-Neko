/**
 * P0 冒烟插件：注册一个自定义工具，证明「不改内核、增删插件」这条路真的走得通。
 * @module @luckycat/dsh-hello
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis 插件名，出现在 loader 诊断里。 */
export const name = 'luckycat-hello'

/** 需要的服务就绪后 apply 才会被调用。 */
export const inject = ['tools']

/** 注册冒烟工具。注册是 effect，插件卸载时自动回收。 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'luckycat_ping',
    description: 'Luckycat framework smoke tool. Call it to confirm the luckycat plugin layer is loaded.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(): Promise<string> {
      return Promise.resolve('喵呜——luckycat framework plugin is loaded.')
    },
  }))
}