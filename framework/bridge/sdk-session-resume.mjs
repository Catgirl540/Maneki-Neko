/** 使用官方 SDK 协议服务和公开 Agent API，为命名会话补上原生日志恢复。 */
import { HarnessSdkJsonRpcServer, Config } from '@deepseek-ai/dsh-sdk-jsonrpc-server'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { timingSafeEqual } from 'node:crypto'
export { Config }
export const name = 'luckycat-sdk-session-resume'
export const inject = ['agents', 'sessionPersistence']

/** Cancel over the existing owned stdio transport; no network listener required. */
export function cancelSession(agents, params, token = process.env.LUCKYCAT_INTERNAL_TOKEN) {
  const supplied = Buffer.from(typeof params?.token === 'string' ? params.token : '')
  const expected = Buffer.from(token ?? '')
  if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Invalid private control credential')
  if (typeof params?.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(params.sessionId)) throw new Error('Invalid control session')
  const agent = agents.get(params.sessionId)
  if (!agent || agent.status !== 'running') return { cancelled: false }
  agent.cancel({ kind: 'user' })
  return { cancelled: true }
}

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
    if (method === 'luckycat.cancel') return cancelSession(ctx.agents, params)
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
