/** SDK 暂无取消消息：经仅本机可访问的私有 socket 调用公开 Agent.cancel。 */
import { createServer } from 'node:http'
import { chmod, unlink } from 'node:fs/promises'

export const name = 'luckycat-agent-control'
export function apply(ctx) {
  const socketPath = process.env.LUCKYCAT_CONTROL_SOCKET
  const token = process.env.LUCKYCAT_INTERNAL_TOKEN
  if (!socketPath || !token) throw new Error('Missing private control channel')
  const agents = new Map()
  ctx.on('agent/created', ({ agent }) => { agents.set(String(agent.session.id), agent) })
  ctx.on('agent/disposed', ({ agent }) => { if (agents.get(String(agent.session.id)) === agent) agents.delete(String(agent.session.id)) })
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method !== 'POST' || req.headers['x-luckycat-internal'] !== token) { res.writeHead(403); res.end('{}'); return }
    const match = /^\/cancel\/([A-Za-z0-9_-]+)$/.exec(req.url ?? '')
    const agent = match ? agents.get(match[1]) : undefined
    if (!agent) { res.writeHead(404); res.end('{}'); return }
    if (agent.status !== 'running') { res.writeHead(409); res.end('{}'); return }
    agent.cancel({ kind: 'user' })
    res.end(JSON.stringify({ cancelled: true }))
  })
  ctx.effect(async () => {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
    await chmod(socketPath, 0o600)
    return async () => { await new Promise(resolve => server.close(resolve)); await unlink(socketPath).catch(() => {}) }
  })
}
