/** 使用官方 SDK 协议服务和公开 Agent API，为命名会话补上原生日志恢复。 */
import { HarnessSdkJsonRpcServer, Config } from '@deepseek-ai/dsh-sdk-jsonrpc-server'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
export { Config }
export const name = 'luckycat-sdk-session-resume'
export const inject = ['agents', 'sessionPersistence']

export function apply(ctx, config) {
  // 仅给 SDK 的构造边界提供门面，不改全局服务、依赖源码或 SDK 私有状态。
  const agents = new Proxy(ctx.agents, { get(target, key) {
    if (key === 'create') return async options => {
      const stored = await ctx.sessionPersistence.stat(options.sessionId)
      if (!stored) return ctx.agents.create(options)
      return ctx.agents.resume({ resumeSessionId: options.sessionId, agentOptions: options.agentOptions,
        parentAgent: options.parentAgent, signal: options.signal,
        setup: async (agentCtx, agent) => {
          // 恢复只等待新请求，不重放崩溃前尚未领取的办理指令。
          agent.inbox.clear()
          return await options.setup?.(agentCtx, agent)
        } })
    }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const facade = new Proxy(ctx, { get(target, key) {
    if (key === 'agents') return agents
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout)
  const server = new HarnessSdkJsonRpcServer(facade, transport, { maxTokensAsSuccess: config.maxTokensAsSuccess })
  transport.onRequest(async (method, params) => {
    if (method === 'initialize') await ctx.get('loader')?.await()
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') setImmediate(async () => {
      await transport.flush()
      await ctx.root.fiber.dispose()
      process.exit(0)
    })
    return result
  })
  ctx.effect(() => {
    transport.start()
    return async () => { await server.shutdown(); transport.close() }
  }, 'luckycat.sdk-resume')
}
