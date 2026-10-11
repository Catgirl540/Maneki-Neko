/** 将一次运行的实时正文与权威完成消息合并；网页收到累计快照，断线重放也不会重复拼字。 */
export function createAssistantStream(sessionId, publish) {
  const attempts = new Map()
  let timer
  let stopped = false
  const idOf = data => `${sessionId}:${data.turn}:${data.step}`
  const textOf = blocks => [...blocks.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join('')
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    for (const state of attempts.values()) {
      if (!state.dirty) continue
      state.dirty = false
      const text = textOf(state.blocks)
      if (text) publish({ type: 'assistant-update', messageId: state.messageId, text })
    }
  }
  return {
    frame(frame) {
      if (stopped) return
      if (frame.type === 'start') {
        attempts.set(frame.attemptId, { messageId: idOf(frame), blocks: new Map(), dirty: false })
        return
      }
      const state = attempts.get(frame.attemptId)
      if (!state) return
      if (frame.type === 'end') {
        if (frame.outcome.kind === 'abandoned') publish({ type: 'assistant-reset', messageId: state.messageId })
        attempts.delete(frame.attemptId)
        return
      }
      const chunk = frame.chunk
      if (chunk.type === 'text-delta') state.blocks.set(chunk.index, (state.blocks.get(chunk.index) ?? '') + chunk.text)
      else if (chunk.type === 'block-end' && chunk.block.type === 'text') state.blocks.set(chunk.index, chunk.block.text)
      else return
      state.dirty = true
      timer ??= setTimeout(flush, 40)
    },
    settle(event) {
      if (stopped) return
      const messageId = idOf(event.data)
      // 最终消息紧接最后一个 token 时直接以完成文本收尾，取消尚未发布的旧快照。
      for (const [id, state] of attempts) if (state.messageId === messageId) attempts.delete(id)
      if (event.type === 'assistant/attempt') return { type: 'assistant-reset', messageId }
      const text = (event.data.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('')
      return text ? { type: 'assistant', messageId, text } : { type: 'assistant-reset', messageId }
    },
    stop() {
      if (stopped) return
      flush()
      for (const state of attempts.values()) {
        const text = textOf(state.blocks)
        if (text) publish({ type: 'assistant', messageId: state.messageId, text })
      }
      attempts.clear()
      stopped = true
    },
    close() { flush(); attempts.clear() },
  }
}
