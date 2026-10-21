/** 验证业务技能与网页入口、真实工具和依据文件一致；不生成或修改源码。 */
import { readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import yaml from 'js-yaml'

export const frameworkRoot = fileURLToPath(new URL('../', import.meta.url))
export const MAX_SKILL_BODY_BYTES = 6000
const repoRoot = resolve(frameworkRoot, '..')
const requiredSections = ['适用请求', '必要信息', '办理步骤', '结果说明', '能力限制']
const within = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) }
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const array = (value, label) => {
  if (!Array.isArray(value) || value.some(v => !nonempty(v)) || new Set(value).size !== value.length) throw Error(`${label}: 必须是无重复的字符串数组`)
}

export function validateSkills({ skillsRoot = resolve(frameworkRoot, 'skills'), sourceRoot = repoRoot } = {}) {
  const source = path => readFileSync(resolve(sourceRoot, path), 'utf8')
  const bankTools = [
    ...source('framework/packages/bank-demo/src/http-tools.ts').matchAll(/\bname: '(bank_[a-z_]+)'/g),
    ...source('framework/packages/bank-demo/src/challenge-tools.ts').matchAll(/\bname: '(bank_[a-z_]+)'/g),
  ].map(m => m[1])
  const tools = new Set([...bankTools, 'knowledge_lookup', 'ask_user_question'])
  const ui = [...source('app/src/components/layout/services.ts').matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)].map(m => ({ id: m[1], label: m[2] }))
  const routes = new Set([...source('app/src/App.tsx').matchAll(/<Route path="([^"]+)"/g)].map(m => m[1]))
  const catalogText = readFileSync(resolve(skillsRoot, 'catalog.json'), 'utf8')
  const catalog = JSON.parse(catalogText)
  if (catalog.version !== 1 || !Array.isArray(catalog.services) || catalog.services.length !== ui.length || ui.length !== 10) throw Error('技能清单必须对应当前 10 个智能服务')
  const ids = new Set(), names = new Set(), loaded = []
  const hash = createHash('sha256').update(catalogText)
  for (const entry of catalog.services) {
    const { serviceId, skillName } = entry
    if (!ui.some(item => item.id === serviceId) || ids.has(serviceId)) throw Error(`服务映射无效或重复: ${serviceId}`)
    if (typeof skillName !== 'string' || !/^bank-[a-z]+$/.test(skillName) || names.has(skillName)) throw Error(`技能名称无效或重复: ${skillName}`)
    ids.add(serviceId); names.add(skillName)
    const path = resolve(skillsRoot, skillName, 'SKILL.md')
    if (!within(realpathSync(skillsRoot), realpathSync(path))) throw Error(`${skillName}: 技能文件越过指定目录`)
    const raw = readFileSync(path, 'utf8')
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw)
    if (!match) throw Error(`${skillName}: 缺少 YAML 头部`)
    const header = yaml.load(match[1]), content = match[2].trim().replace(/\r\n/g, '\n'), meta = header?.metadata
    if (header?.name !== skillName || !nonempty(header.description) || header.description.length > 180) throw Error(`${skillName}: name/description 缺失、不一致或过长`)
    if (!meta || meta.serviceId !== serviceId || meta.label !== ui.find(item => item.id === serviceId).label) throw Error(`${skillName}: metadata 与网页入口不一致`)
    for (const key of ['routes', 'tools', 'sources']) array(meta[key], `${skillName}.${key}`)
    if (!meta.routes.length || !meta.sources.length || meta.routes.some(route => !routes.has(route))) throw Error(`${skillName}: 路由或依据缺失/无效`)
    for (const path of meta.sources) {
      const target = resolve(sourceRoot, path)
      if (!within(sourceRoot, target) || path.startsWith('archive/') || !existsSync(target) || !within(realpathSync(sourceRoot), realpathSync(target))) throw Error(`${skillName}: 依据文件不存在或越界: ${path}`)
    }
    const references = [...content.matchAll(/\b(?:bank_[a-z_]+|knowledge_lookup|ask_user_question)\b/g)].map(m => m[0])
    for (const tool of [...meta.tools, ...references]) if (!tools.has(tool) || !meta.tools.includes(tool)) throw Error(`${skillName}: 工具未注册或未声明: ${tool}`)
    for (const name of content.matchAll(/\bbank-[a-z]+\b/g)) if (!catalog.services.some(s => s.skillName === name[0])) throw Error(`${skillName}: 引用未知技能 ${name[0]}`)
    if (!content || Buffer.byteLength(content) > MAX_SKILL_BODY_BYTES) throw Error(`${skillName}: 正文为空或超过 ${MAX_SKILL_BODY_BYTES} 字节；禁止截断条件`)
    for (const title of requiredSections) if (!content.replaceAll('\r\n', '\n').includes(`## ${title}\n`)) throw Error(`${skillName}: 缺少章节 ${title}`)
    if (![undefined, false].includes(header['disable-model-invocation']) || ![undefined, true].includes(header['user-invocable'])) throw Error(`${skillName}: 必须支持自动与显式调用，调用策略仅接受布尔值`)
    hash.update(skillName).update(raw)
    loaded.push({ ...entry, header, content })
  }
  const entries = readdirSync(skillsRoot, { withFileTypes: true })
  if (entries.some(e => e.name.endsWith('.md') || e.isSymbolicLink())) throw Error('技能根目录只允许清单和已映射目录，维护说明不能作为平铺技能扫描')
  const directories = entries.filter(e => e.isDirectory()).map(e => e.name)
  if (directories.some(name => !names.has(name))) throw Error('存在未映射技能目录')
  return { version: hash.digest('hex').slice(0, 16), skills: loaded }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = validateSkills()
  console.log(`PASS 业务技能：${result.skills.length} 项，版本 ${result.version}，单篇正文 ≤${MAX_SKILL_BODY_BYTES} 字节`)
}
