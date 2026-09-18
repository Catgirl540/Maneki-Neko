/**
 * 向量后端的离线测试：用本机 stub HTTP 服务器覆盖成功与各类失败分支。
 * 一次网络都不发（全部指向 127.0.0.1 的临时端口）。
 *
 * 跑法：node --test packages/embedding/tests/
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { createOpenAiEmbeddingsProvider } from '../lib/index.js'

/** 每条用例用独立的环境变量名，避免测试之间互相污染。 */
let envCounter = 0
function freshEnvName() {
  envCounter += 1
  return `LUCKYCAT_TEST_KEY_${envCounter}`
}

/** 启动一个 stub 服务器，返回 { baseURL, requests, close, setHandler }。 */
async function startStub() {
  const requests = []
  let handler = (_body, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [] }))
  }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const body = raw === '' ? {} : JSON.parse(raw)
      requests.push({ url: req.url, authorization: req.headers.authorization, body })
      handler(body, res)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    setHandler: next => { handler = next },
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/** 造一个「每个输入返回一个定长向量」的响应。 */
function vectorsFor(body, dims = 3, reverse = false) {
  const inputs = body.input
  const data = inputs.map((_text, index) => ({ index, embedding: Array.from({ length: dims }, () => index + 0.5) }))
  return { data: reverse ? [...data].reverse() : data }
}

describe('createOpenAiEmbeddingsProvider', () => {
  let stub
  before(async () => { stub = await startStub() })
  after(async () => { await stub.close() })

  it('成功时按 index 还原顺序（乱序返回也要对）', async () => {
    stub.setHandler((body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(vectorsFor(body, 3, true)))
    })
    const provider = createOpenAiEmbeddingsProvider('stub', { baseURL: stub.baseURL, model: 'm' })
    const vectors = await provider.embed({ texts: ['a', 'b', 'c'] })
    assert.deepEqual(vectors, [[0.5, 0.5, 0.5], [1.5, 1.5, 1.5], [2.5, 2.5, 2.5]])
  })

  it('按 batchSize 分批，且请求体带上 model 与 dimensions', async () => {
    stub.setHandler((body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(vectorsFor(body)))
    })
    const before = stub.requests.length
    const provider = createOpenAiEmbeddingsProvider('stub', { baseURL: stub.baseURL, model: 'emb-1', dimensions: 7, batchSize: 2 })
    const vectors = await provider.embed({ texts: ['1', '2', '3', '4', '5'] })
    assert.equal(vectors.length, 5)
    const sent = stub.requests.slice(before)
    assert.equal(sent.length, 3, '5 条 / 每批 2 条 = 3 次请求')
    assert.deepEqual(sent.map(r => r.body.input.length), [2, 2, 1])
    assert.equal(sent[0].body.model, 'emb-1')
    assert.equal(sent[0].body.dimensions, 7)
  })

  it('apiKeyEnv 未设置时报 MISSING_CREDENTIAL，且只报变量名', async () => {
    const envName = freshEnvName()
    const provider = createOpenAiEmbeddingsProvider('stub', { baseURL: stub.baseURL, model: 'm', apiKeyEnv: envName })
    await assert.rejects(
      provider.embed({ texts: ['a'] }),
      (error) => {
        assert.equal(error.code, 'MISSING_CREDENTIAL')
        assert.match(error.message, new RegExp(envName))
        return true
      },
    )
  })

  it('带了 key 时按 Bearer 发送，且错误信息不回显 key', async () => {
    const envName = freshEnvName()
    const secret = 'sk-do-not-leak-this'
    process.env[envName] = secret
    stub.setHandler((_body, res) => {
      res.writeHead(401, { 'content-type': 'text/plain' })
      res.end('unauthorized: bad key')
    })
    const provider = createOpenAiEmbeddingsProvider('stub', { baseURL: stub.baseURL, model: 'm', apiKeyEnv: envName, maxAttempts: 1 })
    await assert.rejects(
      provider.embed({ texts: ['a'] }),
      (error) => {
        assert.equal(error.code, 'HTTP_STATUS')
        assert.match(error.message, /401/)
        assert.ok(!error.message.includes(secret), '错误信息里绝不能出现密钥')
        return true
      },
    )
    assert.equal(stub.requests.at(-1).authorization, `Bearer ${secret}`)
    delete process.env[envName]
  })

  it('5xx 会重试，且次数受 maxAttempts 限制', async () => {
    let calls = 0
    stub.setHandler((body, res) => {
      calls += 1
      if (calls === 1) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('boom')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(vectorsFor(body)))
    })
    const provider = createOpenAiEmbeddingsProvider('stub', { baseURL: stub.baseURL, model: 'm', maxAttempts: 2 })
    const vectors = await provider.embed({ texts: ['a'] })
    assert.equal(calls, 2, '第一次 500，第二次成功')
    assert.equal(vectors.length, 1)
  })

  it('4xx（非 429）不重试', async () => {
    let calls = 0
    stub.setHandler((_body, res) => {
      calls += 1
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('bad request')
    })
    const provider = createOpenAiEmbeddingsProvider('stub', { baseURL: stub.baseURL, model: 'm', maxAttempts: 3 })
    await assert.rejects(provider.embed({ texts: ['a'] }), error => error.code === 'HTTP_STATUS')
    assert.equal(calls, 1)
  })

  it('响应条数对不上时报 MALFORMED_RESPONSE', async () => {
    stub.setHandler((_body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }))
    })
    const provider = createOpenAiEmbeddingsProvider('stub', { baseURL: stub.baseURL, model: 'm' })
    await assert.rejects(provider.embed({ texts: ['a', 'b'] }), error => error.code === 'MALFORMED_RESPONSE')
  })

  it('空输入被拒', async () => {
    const provider = createOpenAiEmbeddingsProvider('stub', { baseURL: stub.baseURL, model: 'm' })
    await assert.rejects(provider.embed({ texts: [] }), error => error.code === 'EMPTY_INPUT')
  })

  it('明文 http 只允许回环地址', () => {
    assert.throws(
      () => createOpenAiEmbeddingsProvider('remote', { baseURL: 'http://example.com/v1', model: 'm' }),
      error => error.code === 'ENDPOINT_NOT_ALLOWED',
    )
    assert.doesNotThrow(
      () => createOpenAiEmbeddingsProvider('local', { baseURL: 'http://127.0.0.1:8080/v1', model: 'm' }),
    )
  })

  it('baseURL 缺失时立刻报错，而不是留到调用时炸', () => {
    assert.throws(
      () => createOpenAiEmbeddingsProvider('empty', { model: 'm' }),
      error => error.code === 'ENDPOINT_NOT_ALLOWED',
    )
  })

  // 回归：真实踩过一次——某网关对错误路径返回「200 + HTML 页面」，
  // 裸 response.json() 抛出没有分类的 SyntaxError（code=UNKNOWN），
  // 调用方只看到 "Unexpected token '<'"，根本没法诊断。
  it('200 但返回 HTML 时报 MALFORMED_RESPONSE，并带出片段', async () => {
    stub.setHandler((_body, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!DOCTYPE html><html><body>wrong path</body></html>')
    })
    const provider = createOpenAiEmbeddingsProvider('stub', { baseURL: stub.baseURL, model: 'm', maxAttempts: 1 })
    await assert.rejects(
      provider.embed({ texts: ['a'] }),
      (error) => {
        assert.equal(error.code, 'MALFORMED_RESPONSE', '必须被分类，不能是裸 SyntaxError')
        assert.match(error.message, /text\/html/)
        assert.match(error.message, /wrong path/)
        return true
      },
    )
  })
})