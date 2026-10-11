/**
 * RAG 离线测试：语料校验、切块、关键词/向量打分、有界注入与 UTF-8 安全截断。
 * 全程不联网、不起服务。
 *
 * 跑法：node --test packages/rag/tests/
 */

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  boundHits,
  chunkDocuments,
  cosine,
  keywordCoverage,
  loadCorpus,
  rankHits,
  truncateUtf8,
} from '../lib/index.js'

/** 写一个临时语料文件，返回路径。 */
function tempCorpus(content) {
  const dir = mkdtempSync(join(tmpdir(), 'luckycat-rag-'))
  const path = join(dir, 'corpus.json')
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
  return path
}

const SAMPLE = {
  documents: [
    { id: 'kb-fee', title: '手续费', text: '境内人民币转账手续费按转账金额的千分之一收取。\n\n单笔手续费上限为 50 元。' },
    { id: 'kb-limit', title: '限额', text: '手机银行单笔转账限额为 5 万元，日累计限额为 20 万元。' },
  ],
}

describe('loadCorpus', () => {
  it('正常读出文档', () => {
    const documents = loadCorpus(tempCorpus(SAMPLE))
    assert.equal(documents.length, 2)
    assert.equal(documents[0].id, 'kb-fee')
  })

  it('路径不存在时报错并带上路径', () => {
    assert.throws(() => loadCorpus('/nonexistent/corpus.json'), /读不到文件/)
  })

  it('JSON 坏了要报错', () => {
    assert.throws(() => loadCorpus(tempCorpus('{ not json')), /不是合法 JSON/)
  })

  it('documents 为空要报错', () => {
    assert.throws(() => loadCorpus(tempCorpus({ documents: [] })), /documents 为空/)
  })

  it('id 重复要报错', () => {
    const dup = { documents: [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }] }
    assert.throws(() => loadCorpus(tempCorpus(dup)), /id 重复/)
  })

  it('text 缺失要报错，并指出是哪一条', () => {
    const bad = { documents: [{ id: 'a', text: 'ok' }, { id: 'b' }] }
    assert.throws(() => loadCorpus(tempCorpus(bad)), /id=b.*text/)
  })
})

describe('chunkDocuments', () => {
  it('按空行分段', () => {
    const chunks = chunkDocuments([{ id: 'a', text: '第一段\n\n第二段' }])
    assert.equal(chunks.length, 2)
    assert.deepEqual(chunks.map(c => c.text), ['第一段', '第二段'])
  })

  it('超长段落按码点硬切，不产生半个字', () => {
    const long = '喵'.repeat(10)
    const chunks = chunkDocuments([{ id: 'a', text: long }], 3)
    assert.equal(chunks.length, 4)
    for (const chunk of chunks) {
      // 每个块都必须能被 UTF-8 无损往返，否则说明切坏了
      assert.equal(Buffer.from(chunk.text, 'utf8').toString('utf8'), chunk.text)
      assert.ok(Array.from(chunk.text).length <= 3)
    }
  })

  it('保留来源 id 与序号', () => {
    const chunks = chunkDocuments([{ id: 'doc-1', title: 'T', text: 'a\n\nb' }])
    assert.deepEqual(chunks.map(c => [c.documentId, c.index, c.title]), [['doc-1', 0, 'T'], ['doc-1', 1, 'T']])
  })
})

describe('打分', () => {
  it('关键词覆盖率能区分「手续费」与「限额」', () => {
    const fee = keywordCoverage('转账手续费是多少', SAMPLE.documents[0].text)
    const limit = keywordCoverage('转账手续费是多少', SAMPLE.documents[1].text)
    assert.ok(fee > limit, `手续费命中应当更高：fee=${fee} limit=${limit}`)
    assert.ok(fee > 0.5, `覆盖率应超过一半，实际 ${fee}`)
  })

  it('余弦相似度基本性质', () => {
    assert.equal(cosine([1, 0], [1, 0]), 1)
    assert.equal(cosine([1, 0], [0, 1]), 0)
    assert.equal(cosine([0, 0], [1, 1]), 0, '零向量不能除零')
  })

  it('rankHits 在无向量时走关键词，并标 matchedBy=keyword', () => {
    const chunks = chunkDocuments(SAMPLE.documents)
    const hits = rankHits({ query: '转账手续费上限是多少', chunks, topK: 2, minScore: 0.1 })
    assert.equal(hits[0].chunk.documentId, 'kb-fee')
    assert.equal(hits[0].matchedBy, 'keyword')
    assert.equal(hits[0].similarity, undefined)
  })

  it('给了向量时取两路较优者，并记录相似度', () => {
    // 前提：每篇只切出一段，块与向量才能一一对应（上一版就是这里对应错了）
    const singleChunks = chunkDocuments([
      { id: 'kb-fee', text: '手续费千分之一，单笔上限 50 元。' },
      { id: 'kb-limit', text: '手机银行单笔转账限额 5 万元。' },
    ])
    assert.equal(singleChunks.length, 2, '前提失败：每篇应当只切出一段')
    const chunkVectors = [[1, 0], [0, 1]]
    const hits = rankHits({ query: '毫不相干的问法', queryVector: [0, 1], chunks: singleChunks, chunkVectors, topK: 2, minScore: 0 })
    assert.equal(hits[0].chunk.documentId, 'kb-limit')
    assert.equal(hits[0].matchedBy, 'vector')
    assert.equal(hits[0].similarity, 1)
  })
})

describe('有界注入', () => {
  const chunks = chunkDocuments([
    { id: 'kb-fee', text: '甲'.repeat(120) },
    { id: 'kb-limit', text: '乙'.repeat(120) },
    { id: 'kb-hours', text: '丙'.repeat(120) },
  ])
  const hits = rankHits({ query: '甲', chunks, topK: 3, minScore: 0 })
  // 一段超长正文（5000 码点 ≈ 15KB），用来验证截断路径
  const longHits = rankHits({
    query: '甲',
    chunks: chunkDocuments([{ id: 'kb-long', text: '甲'.repeat(5_000) }], 5_000),
    topK: 1,
    minScore: 0,
  })

  it('预算充足时全部注入，不丢不截', () => {
    const bounded = boundHits(hits, 10_000)
    assert.equal(bounded.dropped, 0)
    assert.equal(bounded.truncated, false)
    assert.ok(bounded.text.includes('kb-fee#0'))
    assert.ok(bounded.text.includes('kb-limit#0'))
  })

  it('预算不足时先丢分数最低的', () => {
    const bounded = boundHits(hits, 700)
    assert.ok(bounded.dropped > 0, '应当丢掉一些')
    assert.ok(bounded.text.includes('kb-fee#0'), '最高分的必须留下')
    assert.ok(!bounded.text.includes('kb-hours#0'), '最低分的应当被丢')
  })

  it('只有一条且超预算时按码点截断，总字节仍不超预算', () => {
    const bounded = boundHits(longHits, 1_000)
    assert.equal(bounded.truncated, true)
    assert.ok(Buffer.byteLength(bounded.text, 'utf8') <= 1_000)
    assert.equal(Buffer.from(bounded.text, 'utf8').toString('utf8'), bounded.text)
  })

  it('预算是多字节时按字节而非字符计算', () => {
    const bounded = boundHits(longHits, 900)
    assert.ok(Buffer.byteLength(bounded.text, 'utf8') <= 900)
  })

  it('预算小到装不下包装时什么都不注入（不注入空引用块）', () => {
    const bounded = boundHits(hits, 40)
    assert.equal(bounded.text, '', '空引用块没有意义，应当不注入')
    assert.equal(bounded.injectedBytes, 0)
    assert.equal(bounded.dropped, 3)
  })

  it('正文之前放得下但连最小可用长度都不够时，也不注入', () => {
    // 包装约占 270+ 字节；300 字节预算只剩约 30 字节，留半个字没用
    const bounded = boundHits(hits.slice(0, 1), 300)
    assert.equal(bounded.text, '')
    assert.equal(bounded.truncated, false)
    assert.equal(bounded.dropped, 1)
  })

  it('没有命中时不注入任何东西', () => {
    const bounded = boundHits([], 500)
    assert.equal(bounded.text, '')
    assert.equal(bounded.injectedBytes, 0)
  })
})

describe('truncateUtf8', () => {
  it('短文本原样返回', () => {
    assert.equal(truncateUtf8('abc', 10), 'abc')
  })

  it('不切断多字节字符（含 emoji）', () => {
    const text = '💳'.repeat(10) // 每个 4 字节
    const clipped = truncateUtf8(text, 6)
    assert.ok(Buffer.byteLength(clipped, 'utf8') <= 6)
    assert.equal(Buffer.from(clipped, 'utf8').toString('utf8'), clipped)
    assert.equal(Array.from(clipped).length, 1, '6 字节只能放下 1 个 4 字节字符')
  })

  it('恰好等于上限时不算截断', () => {
    assert.equal(truncateUtf8('喵喵', 6), '喵喵')
  })
})