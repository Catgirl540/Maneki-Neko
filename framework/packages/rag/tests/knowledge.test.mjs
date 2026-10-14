import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { generateKnowledge, writeKnowledge, outputPath, frameworkRoot } from '../../../scripts/build-knowledge.mjs'
import { apply, loadCorpus, chunkDocuments, rankHits, boundHits } from '../lib/index.js'

const corpus = writeKnowledge()
const chunks = chunkDocuments(loadCorpus(outputPath))
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url)))
const source = h => `${h.chunk.documentId}#${h.chunk.sectionId}`

test('知识源确定生成，八篇完整问答、稳定章节 ID、路由及版本保留', () => {
  assert.deepEqual(generateKnowledge(), corpus)
  assert.equal(corpus.documents.length, 8)
  assert.equal(chunks.length, 43)
  assert(chunks.every(c => c.sectionId && c.routes.length && c.version === corpus.version))
  assert(chunks.every(c => Array.from(c.text).length <= 450))
  for (const c of chunks) {
    const result = boundHits([{ chunk: c, score: 1, coverage: 1, matchedBy: 'keyword' }])
    assert(result.injectedBytes <= 2000)
    assert.equal(result.truncated, false, source({ chunk: c }))
    assert(result.text.includes(c.text), '条件与例外必须完整保留')
  }
})

test('至少四十道问题：关键词降级前三命中率 ≥95%，费用/额度/能力边界全部命中', () => {
  assert(questions.length >= 40)
  const failures = []
  for (const q of questions) {
    const hits = rankHits({ query: q.query, chunks, topK: 3, minScore: .34 })
    const found = hits.some(h => source(h) === q.source)
    if (!found) failures.push(q)
    if (q.critical) assert(found, `关键问题漏检：${q.query} -> ${q.source}`)
    assert(boundHits(hits).injectedBytes <= 2000)
  }
  assert(new Set(questions.map(q => q.source.split('#')[0])).size === 8)
  assert(1 - failures.length / questions.length >= .95, JSON.stringify(failures))
  console.log(`关键词 Top3：${questions.length - failures.length}/${questions.length}；关键问题全部命中`)
})

test('生成器拒绝重复 ID、缺失字段、无效路由、缺失依据与无法完整切块的章节', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'kb-validation-'))
  try {
    mkdirSync(resolve(root, 'app/src'), { recursive: true })
    mkdirSync(resolve(root, 'framework/knowledge'), { recursive: true })
    writeFileSync(resolve(root, 'app/src/App.tsx'), '<Route path="/dashboard" />')
    const valid = '---\nid: kb-test\ntitle: 测试\nnavigation: 账户\nroutes: [/dashboard]\nkeywords: [测试]\nsources: [app/src/App.tsx]\n---\n\n## 问题 {#q}\n\n完整回答。\n'
    const path = resolve(root, 'framework/knowledge/a.md')
    for (const [bad, error] of [
      [valid.replace('title: 测试\n', ''), /缺失 title/],
      [valid.replace('[/dashboard]', '[/not-a-route]'), /无效路由/],
      [valid.replace('sources: [app/src/App.tsx]', 'sources: [missing.ts]'), /依据文件/],
      [valid.replace('完整回答。', '长'.repeat(451)), /超过 450/],
      [valid + '\n## 又一个 {#q}\n\n回答。', /重复章节/],
      [valid.replace('## 问题 {#q}', '## 没有稳定标识'), /正文必须/],
    ]) {
      writeFileSync(path, bad)
      assert.throws(() => generateKnowledge({ root }), error)
    }
    writeFileSync(path, valid)
    writeFileSync(resolve(root, 'framework/knowledge/b.md'), valid)
    assert.throws(() => generateKnowledge({ root }), /重复 id/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

function lookup(embedding) {
  let tool
  apply({ tools: { register(t) { tool = t } }, get() { return embedding } }, { corpusPath: outputPath })
  const notices = []
  return { tool, notices, execute: query => tool.execute({ query }, { deferContext(n) { notices.push(n) } }) }
}

test('向量故障仍能回答高频规则，返回路由/版本并记录降级', async () => {
  let attempts = 0
  const kb = lookup({ async embed() { attempts++; throw new Error('fixture unavailable') } })
  for (const query of ['转账手续费怎么收', '卡丢了怎么办', '理财开户还需要填身份证吗', '助手能办理哪些业务']) {
    const value = await kb.execute(query)
    assert.equal(value.mode, 'keyword-only')
    assert(value.hits.length)
    assert.equal(value.corpusVersion, corpus.version)
    assert(value.hits.every(h => h.routes.length && h.corpusVersion === corpus.version))
    assert(value.injection.bytes <= 2000)
    assert.equal(value.answerPolicy, 'rules-only-query-live-data')
  }
  assert.equal(attempts, 4, '失败后下一次可重试，不缓存拒绝的 Promise')
  assert(kb.notices.length)
  assert.match(kb.tool.description, /never invent values/)
  assert.match(kb.tool.description, /do not show them to customers/)
})

test('混合向量检索保留，空查询及无匹配不伪造答案', async () => {
  const vector = lookup({ async embed({ texts }) { return texts.map(() => [1, 0]) } })
  assert.equal((await vector.execute('转账手续费')).mode, 'hybrid')
  const kb = lookup()
  const empty = await kb.execute(' ')
  assert(empty.error)
  const unknown = await kb.execute('火星登陆轨道坐标')
  assert.deepEqual(unknown.hits, [])
  assert.equal(unknown.answerPolicy, 'no-supported-answer')
  assert.equal(unknown.injection.bytes, 0)
  assert.equal(kb.notices.length, 0)
})

test('超长问答失败而非丢失限制；标题与关键词也能用于检索', () => {
  assert.throws(() => chunkDocuments([{ id: 'a', text: 'x', sections: [{ id: 'q', title: '问题', text: '长'.repeat(900) }] }]), /超出块长/)
  const tagged = chunkDocuments([{ id: 'a', text: '简短答案', title: '费用', tags: ['专属查询词'] }])
  assert.equal(rankHits({ query: '专属查询词', chunks: tagged, topK: 3, minScore: .34 })[0].chunk.documentId, 'a')
  assert(frameworkRoot.endsWith('/framework'))
})
