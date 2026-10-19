/** DSH 0.2 使用平铺工具消息；兼容旧日志中的 tool-result 嵌套块。 */
export function projectToolResult(message = {}) {
  const content = Array.isArray(message.content) ? message.content : []
  const legacy = content.find(block => block?.type === 'tool-result')
  const blocks = legacy ? legacy.content : content
  return {
    type: 'tool-result',
    callId: String(message.toolCallId ?? message.source?.callId ?? ''),
    isError: message.isError === true || legacy?.isError === true,
    text: Array.isArray(blocks) ? blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('') : '',
  }
}
