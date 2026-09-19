/**
 * 「被 import 的源码，必须真的在 git 里」检查。
 *
 * 为什么需要它（真踩过，而且推上去了）：
 *   `.gitignore` 里有一条 `agent/`（本意是忽略仓库**根目录**下那份 codex 改造仓库）。
 *   gitignore 的 `agent/` 匹配的是「任意层级下叫 agent 的目录」，于是
 *   `app/src/components/agent/` 整目录被吞掉 —— `ConsentCard.tsx` **从没进过仓库**。
 *   本机一切正常（文件就在磁盘上），推上去的仓库却是**编译不过的**。
 *   同一件事还有第二个症状：Tailwind 会跳过被 gitignore 的路径，
 *   所以那个目录里的样式类也静默地没被编译出来（表格没有边框、没有底色）。
 *
 * 两种失败都要报：
 *   · 目标文件存在、被 import，但在 `.gitignore` 里 → 一定是配置写错了；
 *   · 目标文件存在、被 import，只是没 `git add` → 推上去就是坏的。
 *
 *   node tools/check-tracked.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/** 要扫的源码根（相对仓库根）。 */
const ROOTS = ['app/src', 'framework/packages', 'framework/bridge', 'framework/scripts', 'tools']
/** 这些目录下的东西是构建产物或依赖，不扫。 */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.dsh-home', '.npm-cache', 'tests'])

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const tracked = new Set(git(['ls-files']).split('\n').filter(Boolean))

/**
 * 某个路径是否被 gitignore 忽略。
 *
 * 刻意逐个问 `git check-ignore`，而不是先把「所有被忽略的文件」列出来：
 * 这个仓库的 `.npm-cache` 有上百万个被忽略的条目，一次列出来会直接把
 * execFileSync 的缓冲撑爆（实测踩到，报了一屏 cacache 路径）。
 * 真正有问题的路径通常只有个位数，逐个问既便宜又稳。
 */
const isIgnored = (relative) => {
  try {
    git(['check-ignore', '-q', '--', relative])
    return true
  } catch {
    return false
  }
}

/** 递归收集源码文件。 */
function collect(dir, out = []) {
  const absolute = path.join(ROOT, dir)
  if (!existsSync(absolute)) return out
  for (const entry of readdirSync(absolute)) {
    if (SKIP_DIRS.has(entry)) continue
    const relative = path.join(dir, entry)
    if (statSync(path.join(ROOT, relative)).isDirectory()) collect(relative, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(relative)
  }
  return out
}

/** 逐个候选后缀去找真实文件。 */
function resolveTarget(specifier, importer) {
  const base = specifier.startsWith('@/')
    ? path.join('app/src', specifier.slice(2))
    : path.join(path.dirname(importer), specifier)
  for (const suffix of ['', '.ts', '.tsx', '.mjs', '.js', '.json', '.css', '/index.ts', '/index.tsx']) {
    const candidate = path.normalize(base + suffix)
    if (candidate.startsWith('..')) continue
    const absolute = path.join(ROOT, candidate)
    if (existsSync(absolute) && statSync(absolute).isFile()) return candidate
  }
  return undefined
}

const sources = ROOTS.flatMap((root) => collect(root))
const problems = []
let checkedLinks = 0

for (const file of sources) {
  const source = readFileSync(path.join(ROOT, file), 'utf8')
  // `from '…'`、`import '…'`、`import('…')` 三种写法都要收。
  const specifiers = [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1])

  for (const specifier of specifiers) {
    // 只看站内路径：`@/…` 与相对路径。裸包名交给 npm。
    if (!specifier.startsWith('@/') && !specifier.startsWith('.')) continue
    const target = resolveTarget(specifier, file)
    if (target === undefined) continue
    // 相对路径也可能指进依赖里（例如 tools/ts-resolve-hook.mjs 直接用 app 的
    // typescript 编译源码）。node_modules 本来就不该进仓库，跳过。
    if (target.split(path.sep).includes('node_modules')) continue
    checkedLinks += 1
    if (tracked.has(target)) continue
    problems.push(isIgnored(target)
      ? { file, target, why: '被 .gitignore 吞了（import 得到但它不在仓库里）' }
      : { file, target, why: '还没 git add（推上去仓库就是坏的）' })
  }
}

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

report(checkedLinks > 0, '检查本身没瞎（确实解析到了站内 import）', [`解析到 ${checkedLinks} 条站内 import`])
report(problems.length === 0,
  '被 import 的站内源码都在 git 里',
  problems.length === 0
    ? [`扫了 ${sources.length} 个源文件`]
    : problems.slice(0, 10).map((p) => `${p.file} → ${p.target}：${p.why}`))

console.log()
console.log(failures === 0 ? 'check-tracked: 全部通过' : `check-tracked: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
