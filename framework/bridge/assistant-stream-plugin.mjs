/** SDK 扩展通知：沿同一条 stdio 通道转发实时正文，保持与最终消息的先后顺序。 */
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'

export const name = 'luckycat-assistant-stream'

export function apply(ctx) {
  // 仅写通知，不 start：stdin 的读取仍由官方 SDK 服务独占。
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout)
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!visibleFrame(frame)) return
    transport.notify('luckycat.assistant-stream', { sessionId: String(agent.session.id), frame })
  })
  ctx.effect(() => () => transport.close())
}

/** 不把推理过程、工具参数或用量送到网页。 */
export function visibleFrame(frame) {
  return frame.type !== 'chunk' || frame.chunk.type === 'text-delta'
    || (frame.chunk.type === 'block-end' && frame.chunk.block.type === 'text')
}
