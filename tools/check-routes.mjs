/**
 * 路由闸：站内链接必须指向真实存在的路由，且每个路由都得有人能走到。
 *
 * ## 为什么需要它
 *
 * 单页应用里写错一个路径**不会报任何错**：React Router 匹配不上就掉进兜底的
 * `path="*"`，用户看到的是被悄悄送去了首页。于是「总览从 `/` 挪到 `/dashboard`」
 * 这种改动，漏改一处链接的后果是——那一处按钮点下去**看起来没反应**，
 * 或者莫名其妙回到首页，而控制台、构建、类型检查全都是干净的。
 * （这次改动一口气碰了十几处链接，正是靠这道闸才发现 `OpenAccountPage` 里
 * 还有两处指向旧路径。）
 *
 * 同时反过来查一遍：**路由表里有没有没人能走到的页面**。删页面时漏删路由，
 * 或者顺手改错了路径，都会留下一张打不开的页面。
 *
 * 纯文本分析，不需要浏览器、不需要服务：
 *
 *   node tools/check-routes.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP = path.join(ROOT, 'app/src')

let failures = 0
const ok = (title) => console.log(`PASS  ${title}`)
const bad = (title, detail = '') => {
  failures += 1
  console.log(`FAIL  ${title}${detail === '' ? '' : `\n      ${detail}`}`)
}

/* ── 1. 路由表 ─────────────────────────────────────────────────────────── */

const appSource = readFileSync(path.join(APP, 'App.tsx'), 'utf8')
const routes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1])
if (routes.length === 0) {
  bad('从 App.tsx 里一条路由都没解析出来', '解析正则和写法对不上了，后面的断言会全部空转')
  console.log('\ncheck-routes: 无法继续')
  process.exit(1)
}
ok(`解析到 ${routes.length} 条路由：${routes.join(' ')}`)

/** 精确路由（不带参数）与带参数的路由分开：后者只能按前缀匹配。 */
const exact = new Set(routes.filter(r => !r.includes(':') && r !== '*'))
const patterns = routes
  .filter(r => r.includes(':') && r !== '*')
  .map(r => new RegExp(`^${r.split('/').map(seg => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}/?$`))

/** 一个目标路径能不能落在路由表里。 */
function resolves(target) {
  if (target === '') return false
  // 去掉 query 与 hash：`/?from=x` 和 `/x#y` 都该按路径本身判定
  const clean = target.split(/[?#]/)[0]
  if (clean === '') return false
  if (exact.has(clean) || exact.has(clean.replace(/\/$/, ''))) return true
  return patterns.some(re => re.test(clean))
}

/* ── 2. 扫出所有站内链接 ───────────────────────────────────────────────── */

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * 从一个表达式里抠出所有以 `/` 开头的字符串字面量。
 *
 * 为什么不是简单地只认 `to="/x"`：真实代码里还有
 * `to={loggedIn ? '/dashboard' : '/open-account'}` 这种三元、
 * 以及 `` to={`/transactions/${id}`} `` 这种模板串。
 * 只认第一种的话，恰好漏掉最容易写错的那几处。
 */
function literalsIn(expr) {
  const found = []
  // 普通引号字符串
  for (const m of expr.matchAll(/'(\/[^']*)'|"(\/[^"]*)"/g)) found.push({ value: m[1] ?? m[2], dynamic: false })
  // 模板串：`${...}` 换成占位符，其余按字面比较
  for (const m of expr.matchAll(/`(\/[^`]*)`/g)) {
    found.push({ value: m[1].replace(/\$\{[^}]*\}/g, 'DYNAMIC'), dynamic: m[1].includes('${') })
  }
  return found
}

const links = []
for (const file of walk(APP)) {
  const source = readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file)
  const push = (expr, line) => {
    for (const { value, dynamic } of literalsIn(expr)) {
      links.push({ target: dynamic ? value.replace(/DYNAMIC/g, 'x') : value, dynamic, file: rel, line })
    }
  }
  for (const m of source.matchAll(/\bto="([^"]*)"/g)) {
    if (m[1].startsWith('/')) links.push({ target: m[1], dynamic: false, file: rel, line: lineOf(source, m.index) })
  }
  for (const m of source.matchAll(/\bto=\{([^}]*)\}/g)) push(m[1], lineOf(source, m.index))
  for (const m of source.matchAll(/\bnavigate\(([^)]*)\)/g)) push(m[1], lineOf(source, m.index))
  // 对象字面量里的 `to:`——**侧边栏导航数组就是这种写法**（`{ to: '/wealth', … }`）。
  // 漏掉它是最难受的一种漏：导航是「每条路由都该有人能走到」那条断言的主要依据，
  // 漏了就会误报出一条根本不存在的孤儿路由（实测踩到：/wealth 被误报）。
  for (const m of source.matchAll(/\bto:\s*'([^']*)'|\bto:\s*"([^"]*)"/g)) {
    const value = m[1] ?? m[2]
    if (value.startsWith('/')) links.push({ target: value, dynamic: false, file: rel, line: lineOf(source, m.index) })
  }
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

if (links.length === 0) {
  bad('一处站内链接都没扫到', '选择器过时了，后面的断言会空转通过')
} else {
  ok(`扫到 ${links.length} 处站内链接`)
}

/* ── 3. 每个链接都要能落到一条路由上 ───────────────────────────────────── */

const broken = links.filter(link => !resolves(link.target))
if (broken.length === 0) {
  ok(`全部 ${links.length} 处站内链接都指向真实存在的路由`)
} else {
  bad(`有 ${broken.length} 处站内链接指向不存在的路由（点下去会静默掉进兜底路由）`,
    broken.map(b => `${b.file}:${b.line} → ${b.target}`).join('\n      '))
}

/* ── 4. 每条路由都要有人能走到 ─────────────────────────────────────────── */

// `/` 由兜底 `<Navigate to="/">` 落到，单独放行；`*` 本身不是页面。
const reachable = new Set(links.map(l => l.target.split(/[?#]/)[0]))
// 兼容旧地址的重定向不是页面，不需要再提供独立入口；其目标仍由链接检查验证。
// 两种写法都认：内联 `<Navigate …/>`，和命名组件（组件体里渲染 `<Navigate>`）。
// 后者不能靠名字猜：`RemindersRedirect` 还要转发 hash，所以它是个组件而不是内联语句。
// 这里直接读组件定义，确认它真的渲染 Navigate 才放行。
const redirectComponents = new Set(
  [...appSource.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g)]
    .filter(match => /<Navigate\b/.test(match[0]))
    .map(match => match[1]),
)
const redirects = new Set([
  ...[...appSource.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<Navigate\b/g)].map(match => match[1]),
  ...[...appSource.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<(\w+)\s*\/>\}/g)]
    .filter(match => redirectComponents.has(match[2]))
    .map(match => match[1]),
])
const orphans = [...exact].filter(route => !reachable.has(route) && !redirects.has(route) && route !== '/' && route !== '')
if (orphans.length === 0) {
  ok('路由表里没有走不到的页面（每条都至少被一处链接指着）')
} else {
  bad(`有 ${orphans.length} 条路由没有任何入口（页面上打不开）`, orphans.join(' '))
}

console.log()
if (failures === 0) console.log('check-routes: 全部通过')
else console.log(`check-routes: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
