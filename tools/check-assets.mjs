/**
 * 静态资源引用检查（纯静态，不需要浏览器 / dev server）。
 *
 * 前端里凡是写成 `/banks/xxx.png`、`/brands/visa.svg` 这种**绝对路径**的引用，
 * 都必须真的有对应文件落在 `app/public/` 下 —— 写错一个字母就是一个破图，
 * 而且只在运行时才暴露。
 *
 *   node tools/check-assets.mjs
 */
import { readdir, readFile, access } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'app/src')
const PUBLIC = path.join(ROOT, 'app/public')

/** 只扫这些顶层目录下的绝对引用，避免把 /api/... 之类的后端路由也当成资源 */
const PREFIXES = ['/banks/', '/brands/', '/fonts/']
const EXTRA_FILES = ['/favicon.svg']

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

const files = (
  await readdir(SRC, { recursive: true, withFileTypes: true })
)
  .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
  .map((e) => path.join(e.parentPath, e.name))

const refs = new Map() // 资源路径 -> 引用它的文件
for (const file of files) {
  const text = await readFile(file, 'utf8')
  for (const m of text.matchAll(/'(\/[A-Za-z0-9_\-./]+\.(?:png|jpe?g|svg|ico|webp|woff2?))'/g)) {
    const ref = m[1]
    if (!PREFIXES.some((p) => ref.startsWith(p)) && !EXTRA_FILES.includes(ref)) continue
    if (!refs.has(ref)) refs.set(ref, [])
    refs.get(ref).push(path.relative(ROOT, file))
  }
}

const missing = []
for (const [ref, users] of refs) {
  try {
    await access(path.join(PUBLIC, ref))
  } catch {
    missing.push(`${ref}（被 ${[...new Set(users)].join(', ')} 引用）`)
  }
}

const byPrefix = PREFIXES.map(
  (p) => `${p} ${[...refs.keys()].filter((r) => r.startsWith(p)).length} 个`,
).join(' · ')

report(refs.size > 0 && missing.length === 0, '静态资源引用都能在 app/public/ 下找到', [
  `扫描 ${files.length} 个源文件，命中 ${refs.size} 个资源引用（${byPrefix}）`,
  missing.length ? `缺失：\n        ${missing.join('\n        ')}` : '全部命中',
])

// 本行的行标是从组件几何生成出来的静态文件（见 tools/gen-luckycat-logo.mjs）。
// 生成物必须和源保持一致：标改过却忘了重生成的话，界面上是新标、收款银行列表里还是旧标，
// 而且两边都不会报错 —— 这种漂移只能靠「重新生成一遍再比对」抓。
const { spawnSync } = await import('node:child_process')
const gen = spawnSync(
  process.execPath,
  ['--import', path.join(ROOT, 'tools/ts-resolve-hook.mjs'), path.join(ROOT, 'tools/gen-luckycat-logo.mjs'), '--check'],
  { encoding: 'utf8' },
)
report(gen.status === 0, '本行行标（cn-LCB.svg）与 cat-mark.ts 的几何一致', [
  (gen.stdout || gen.stderr || '').trim() || '（无输出）',
])

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
