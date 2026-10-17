import test from 'node:test'
import assert from 'node:assert/strict'
import { projectModelRetry, modelFailureMessage } from './model-retry.mjs'

test('重试只投影有限预算和进度，不公开上游内容或模型信息', () => {
  const projected = projectModelRetry({ type: 'llm/retry', data: { retry: 2, maxRetries: 3, delayMs: 2000,
    mode: 'normal', provider: 'private-provider', failure: { code: 'TRANSPORT', message: 'private upstream detail' } } })
  assert.deepEqual(projected, { type: 'model-retry', phase: 'waiting', attempt: 2, maxRetries: 3, delayMs: 2000, reason: '模型连接中断' })
  assert(!JSON.stringify(projected).includes('private'))
  assert.deepEqual(projectModelRetry({ type: 'llm/retry-started', data: { retry: 2 } }),
    { type: 'model-retry', phase: 'running', attempt: 2, delayMs: 0 })
})

test('拒绝无界或无效重试进度', () => {
  for (const data of [{ retry: 0 }, { retry: 1, mode: 'always' },
    { retry: 4, maxRetries: 3, mode: 'normal', delayMs: 100 },
    { retry: 1, maxRetries: 3, mode: 'normal', delayMs: -1 }]) {
    assert.equal(projectModelRetry({ type: 'llm/retry', data }), undefined)
  }
})

test('耗尽、认证失败、上下文过长与未知故障给出不同提示', () => {
  assert.match(modelFailureMessage({ code: 'TRANSPORT', message: 'secret' }, 3), /已自动重试 3 次/)
  assert.match(modelFailureMessage({ code: 'AUTH' }), /认证失败/)
  assert.match(modelFailureMessage({ code: 'CONTEXT_WINDOW_EXCEEDED' }), /新建对话/)
  assert(!modelFailureMessage({ code: 'UNKNOWN', message: 'secret' }).includes('secret'))
})
