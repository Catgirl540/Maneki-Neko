/**
 * 交接文档的"不许漂"检查。
 *
 * 为什么需要它：`design/backend-handoff/AGENT-RUNTIME-CONTRACT.md` 是**交给后端团队的
 * 那份东西**，而它已经漂过一次——插件清单里没有 `consent`（整个敏感操作闸门），
 * 事实来源里写着不存在的 `P1a…`，路径的 `framework/` 前缀时有时无，§1 说人工审批
 * "未定"而 §7 说"已实现"。这些都不是笔误，是**没有任何东西在查**。
 *
 * 所以这里只查能机器判定的部分，不假装能查文风：
 *   ① 文档里写的仓库路径，必须真的存在
 *   ② `framework/packages/` 下每个包，都必须被交接文档**以路径形式**点名
 *      （"提到过 consent 这个词"不算——路径才算，否则加了包不写文档也查不出来）
 *   ③ 检查本身不许空转：抽到的路径条数要够
 *
 * 查不出来的（**明确写在这里，免得以为这道闸很全**）：正文的说法是否自相矛盾、
 * 语义是否过时、接口形状对不对。那些只能靠人读。
 *
 *   node tools/check-handoff-doc.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { globSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/** 会被交出去的三份文档。 */
const DOCS = [
  'design/backend-handoff/AGENT-RUNTIME-CONTRACT.md',
  'framework/design/P6-WEB-BRIDGE.md',
  'framework/design/P7-SESSIONS.md',
]

/** 包清单这条只对主交接文档较真：它是给后端列"框架里有什么"的那一份。 */
const PACKAGE_DOC = 'design/backend-handoff/AGENT-RUNTIME-CONTRACT.md'

/**
 * 按这几处依次解析文档里的路径。
 * `framework/design/` 是为了让设计文档里 `../app/src/…` 与同目录的 `P7-SESSIONS.md` 能解析。
 */
const ROOTS = ['', 'framework/', 'framework/design/', 'reference/deepseek-harness/']

/**
 * 允许"查不到"的条目，每一条都要写清理由。
 * 加东西进来之前先想清楚：是真的查不到，还是文档该改。
 */
const ALLOWED_MISSING = new Map([
  // 运行时的会话日志目录，不是本仓库里的文件；文档正是在说"别去读它"。
  ['$DSH_HOME/sessions/*.jsonl', '运行时目录，按设计不在仓库里'],
])

/**
 * 允许"没有以路径形式点名"的包，每条都要写清理由。
 * `probe` 是只在 `--patch` 时挂载的注册表探针（见 `framework/scripts/verify.sh`），
 * 不属于生产插件面，后端不需要知道它。
 */
const ALLOWED_UNNAMED_PACKAGES = new Set(['probe'])

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

const doc = readFileSync(path.join(ROOT, PACKAGE_DOC), 'utf8')

/* ------------------------------------------------- ① 抽路径并逐个确认存在 */

/**
 * 看起来像仓库内路径的 token：反引号里、不含空白、以已知扩展名结尾。
 *
 * **刻意用"除了空白什么都要"**，不要写成"只允许 `\w./` 这些字符"：那样写的话
 * `design/{…,P1a…,…}.md` 里的省略号会把整条 token 从中间切断，正则匹配不到 `.md`，
 * 于是这条**根本不存在的路径**被静默跳过——检查会空转通过。
 * 这是实测踩到的：改之前那版文档里就有一条这样的路径，窄字符集放过了它。
 */
const PATH_TOKEN = /`([^`\s]+\.(?:ts|tsx|mjs|js|json|yml|yaml|sh|md|jsonl))`/g

/** 把一个可能带 `{a,b}` 的模式展开成若干具体模式（`*` 留着，后面单独处理）。 */
function braceExpand(pattern) {
  const braced = pattern.match(/^(.*)\{([^}]*)\}(.*)$/)
  if (braced === null) return [pattern]
  return braced[2].split(',').map(part => `${braced[1]}${part.trim()}${braced[3]}`)
}

/** 一个（已展开大括号的）模式能不能在几个根里任一找到东西。 */
function variantResolves(variant) {
  return ROOTS.some((root) => {
    const base = path.join(ROOT, root)
    if (!variant.includes('*')) return existsSync(path.join(base, variant))
    try {
      return globSync(variant, { cwd: base }).length > 0
    } catch {
      return false
    }
  })
}

/**
 * 这个 token 能解析到真实文件吗。
 *
 * **每一个展开后的分支都要能解析**，不是"有一个能就行"。
 * `design/{A,B,P1a…,D}.md` 这种写法里，前三个都存在、第四个不存在——
 * 用 `.some()` 的话坏的会被好的盖住，检查照样通过（实测踩到）。
 */
function resolves(token) {
  const variants = braceExpand(token)
  return variants.length > 0 && variants.every(variantResolves)
}

let checkedTokens = 0
for (const relative of DOCS) {
  const text = readFileSync(path.join(ROOT, relative), 'utf8')
  // 只认带 `/` 的：`agentSessions.ts` 这种是正文里提个文件名，不是路径。
  const tokens = [...new Set([...text.matchAll(PATH_TOKEN)].map(match => match[1]))]
    .filter(token => token.includes('/'))
  checkedTokens += tokens.length
  // 每份文档单独设下限：只卡总数的话，其中一份被删空也能靠其他两份凑够，
  // 那一条断言就空转了（实测踩到）。
  report(tokens.length >= 3, `${relative} 里确实抽到了路径（这份检查没有空转）`,
    [`抽到 ${tokens.length} 条`])
  const missing = tokens.filter(token => !ALLOWED_MISSING.has(token) && !resolves(token))
  report(missing.length === 0, `${relative} 里写的仓库路径都真实存在`,
    missing.map(token => `${token} —— 几处都找不到（仓库根 / framework/ / framework/design/ / 上游只读参考）`))
}

report(checkedTokens >= 20, '三份文档加起来抽到的路径条数够多', [`一共 ${checkedTokens} 条`])

/* ---------------------------------------- ② 每个包都要被"路径形式"点名 */

const packages = readdirSync(path.join(ROOT, 'framework/packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)

/** 文档里是否以 `packages/<名字>` 或 `packages/{…,<名字>,…}` 的形式点了它的名。 */
function namedAsPath(name) {
  if (doc.includes(`packages/${name}`)) return true
  const braced = /packages\/\{([^}]*)\}/g
  for (const match of doc.matchAll(braced)) {
    if (match[1].split(',').map(part => part.trim()).includes(name)) return true
  }
  return false
}

const unnamed = packages.filter(name => !ALLOWED_UNNAMED_PACKAGES.has(name) && !namedAsPath(name))
report(unnamed.length === 0, 'framework/packages 下每个包都被文档以路径形式点名',
  unnamed.map(name => `${name} —— 文档里没有 packages/${name}，加了包就别忘了写进事实来源`))

report(packages.length >= 5, '包清单读到了（不是空目录）', [`${packages.length} 个：${packages.join(' ')}`])

/* -------------------------------------------------------------------- 汇总 */

console.log()
console.log(failures === 0 ? 'check-handoff-doc: 全部通过' : `check-handoff-doc: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
