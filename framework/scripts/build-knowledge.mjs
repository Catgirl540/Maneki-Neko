/** 唯一知识语料生成入口；没有时间戳，同一知识源及依据生成同一版本。 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { load, JSON_SCHEMA } from 'js-yaml'

export const frameworkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const outputPath = resolve(frameworkRoot, '.generated/knowledge/corpus.json')
export function generateKnowledge({ root = resolve(frameworkRoot, '..'), knowledge = resolve(root, 'framework/knowledge') } = {}) {
  const appRoutes = [...readFileSync(resolve(root, 'app/src/App.tsx'), 'utf8').matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1])
  const documents = [], ids = new Set(), evidence = new Map()
  const fail = (file, reason) => { throw new Error(`knowledge ${file}: ${reason}`) }
  for (const file of readdirSync(knowledge).filter(f => f.endsWith('.md') && f !== 'README.md').sort()) {
    const raw = readFileSync(resolve(knowledge, file), 'utf8').replaceAll('\r\n', '\n')
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
    if (!match) fail(file, '缺少 YAML 头部')
    const meta = load(match[1], { schema: JSON_SCHEMA })
    for (const field of ['id', 'title', 'navigation']) if (typeof meta?.[field] !== 'string' || !meta[field].trim()) fail(file, `缺失 ${field}`)
    if (!/^[a-z][a-z0-9-]*$/.test(meta.id)) fail(file, 'id 必须为稳定英文标识')
    if (ids.has(meta.id)) fail(file, `重复 id ${meta.id}`)
    ids.add(meta.id)
    if (!['账户', '理财', '助手', '我的'].includes(meta.navigation)) fail(file, '无效一级入口')
    for (const field of ['routes', 'keywords', 'sources']) if (!Array.isArray(meta[field]) || !meta[field].length || meta[field].some(x => typeof x !== 'string' || !x.trim())) fail(file, `缺失或无效 ${field}`)
    for (const route of meta.routes) {
      if (!route.startsWith('/') || route.startsWith('//') || !appRoutes.includes(route.split('?')[0])) fail(file, `无效路由 ${route}`)
    }
    for (const source of meta.sources) {
      const path = resolve(root, source)
      if (isAbsolute(source) || relative(root, path).startsWith('..') || !existsSync(path)) fail(file, `依据文件不存在或越界 ${source}`)
      evidence.set(source, createHash('sha256').update(readFileSync(path)).digest('hex'))
    }
    const body = match[2].trim(), sectionIds = new Set()
    const parts = [...body.matchAll(/^## (.+?) \{#([a-z][a-z0-9-]*)\}\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
    if (!parts.length || parts.map(m => m[0].trim()).join('\n\n') !== body) fail(file, '正文必须完全由带稳定 {#id} 的二级问题章节组成')
    const sections = parts.map(m => {
      const [, title, id, textRaw] = m
      if (sectionIds.has(id)) fail(file, `重复章节 id ${id}`)
      sectionIds.add(id)
      const text = textRaw.trim()
      if (!text || Array.from(title + '\n' + text).length > 450) fail(file, `章节 ${id} 为空或超过 450 字，请缩短完整答案`)
      return { id, title, text }
    })
    documents.push({ id: meta.id, title: meta.title, navigation: meta.navigation, routes: meta.routes, tags: meta.keywords,
      sources: meta.sources, sections, text: sections.map(s => `## ${s.title}\n${s.text}`).join('\n\n') })
  }
  if (!documents.length) throw new Error('knowledge: 没有知识文档')
  const sources = Object.fromEntries([...evidence].sort(([a], [b]) => a.localeCompare(b)))
  const version = createHash('sha256').update(JSON.stringify({ documents, sources })).digest('hex').slice(0, 16)
  return { schemaVersion: 1, version, sources, documents }
}
export function writeKnowledge(corpus = generateKnowledge(), path = outputPath) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(corpus, null, 2) + '\n')
  renameSync(temp, path)
  return corpus
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const corpus = writeKnowledge()
  console.log(`knowledge: ${corpus.documents.length} 篇，${corpus.documents.reduce((n, d) => n + d.sections.length, 0)} 问，版本 ${corpus.version}`)
}
