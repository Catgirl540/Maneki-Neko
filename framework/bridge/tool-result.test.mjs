import test from 'node:test'
import assert from 'node:assert/strict'
import { projectToolResult } from './tool-result.mjs'

test('新版工具回执保留正文、调用编号和失败状态', () => {
  assert.deepEqual(projectToolResult({ toolCallId: 'new-call', isError: true, content: [{ type: 'text', text: '接口不可用' }, { type: 'image', data: 'private' }] }), {
    type: 'tool-result', callId: 'new-call', isError: true, text: '接口不可用',
  })
  assert.equal(projectToolResult({ source: { callId: 'success' }, content: [{ type: 'text', text: '{"receipt":"ok"}' }] }).isError, false)
})

test('旧版嵌套工具日志仍可展示回执，空消息不会生成成功正文', () => {
  assert.deepEqual(projectToolResult({ source: { callId: 'old-call' }, content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: '用户取消' }] }] }), {
    type: 'tool-result', callId: 'old-call', isError: true, text: '用户取消',
  })
  assert.equal(projectToolResult().text, '')
})
