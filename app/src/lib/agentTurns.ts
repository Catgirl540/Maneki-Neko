import type { ChatItem, MessageItem } from './agentSessions'

export type ResponseItem = Exclude<ChatItem, { kind: 'user' }>
export interface AssistantTurn {
  kind: 'turn'
  id: string
  promptId?: string
  items: ResponseItem[]
}
export type ChatMessage = Extract<ChatItem, { kind: 'user' }> | AssistantTurn

/** 按用户提问分组，原始事件与存档不变；根节点的 id 在流式更新中保持稳定。 */
export function groupChatMessages(items: readonly ChatItem[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  let turn: AssistantTurn | undefined
  for (const item of items) {
    if (item.kind === 'user') {
      messages.push(item)
      turn = { kind: 'turn', id: `turn-${item.id}`, promptId: item.id, items: [] }
      messages.push(turn)
    } else {
      if (!turn) {
        turn = { kind: 'turn', id: `turn-${item.id}`, items: [] }
        messages.push(turn)
      }
      turn.items.push(item)
    }
  }
  return messages
}

/** 仅重试最后一轮；保留已执行的工具记录，避免把已有交易藏掉后重复办理。 */
export function prepareTurnRetry(items: readonly ChatItem[], promptId: string) {
  const index = items.findLastIndex(item => item.kind === 'user')
  const prompt = items[index]
  if (prompt?.kind !== 'user' || prompt.id !== promptId || (!prompt.text.trim() && !prompt.thumb)) return undefined
  const tail = items.slice(index + 1)
  if (!tail.some(item => item.kind === 'notice' && item.tone === 'error' || item.kind === 'tool' && item.state === 'error')) return undefined
  const lastTool = tail.findLastIndex(item => item.kind === 'tool')
  const kept = tail.filter((item, i) => item.kind === 'notice' ? item.tone !== 'error'
    : item.kind === 'assistant' ? i <= lastTool : true)
  return { prompt, items: [...items.slice(0, index + 1), ...kept] }
}

export function retryRequestText(original: string): string {
  return `这是上一轮失败后的重试，不是新的业务指令。沿用上轮信息继续处理，先核对已执行的工具结果；涉及转账、申购等写操作时，先查最新交易状态或流水，不得重复提交已成功、处理中或结果不明的业务。仍须经过原有确认和身份验证。若业务已经完成而仅回复失败，只补充结果说明。\n用户原始请求：${original}`
}

/** 最后一次工具调用之前的发言归入过程，之后的正文合为一条可复制、朗读的回复。 */
export function turnContent(turn: AssistantTurn) {
  const lastTool = turn.items.findLastIndex(item => item.kind === 'tool')
  const replies = turn.items.slice(lastTool + 1).filter(
    (item): item is Extract<MessageItem, { kind: 'assistant' }> => item.kind === 'assistant' && item.text.trim() !== '',
  )
  const last = replies.at(-1)
  const reply = last ? {
    ...last,
    text: replies.map(item => item.text).join('\n\n'),
    streaming: replies.some(item => item.streaming),
  } : undefined
  return {
    reply,
    activity: turn.items.slice(0, lastTool + 1).filter(item => item.kind !== 'notice'),
    notices: turn.items.filter((item): item is Extract<ResponseItem, { kind: 'notice' }> => item.kind === 'notice'),
    lastTool: lastTool < 0 ? undefined : turn.items[lastTool] as Extract<ResponseItem, { kind: 'tool' }>,
  }
}
