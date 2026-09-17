/**
 * 收款银行名录的数据校验（纯静态解析 db.ts，不需要浏览器 / dev server）。
 *
 * 「接入真实数据」这件事本身的正确性没法靠肉眼保证，所以把不变量固化成检查项：
 *   ① (region, code) 唯一 —— 这是定位一家银行的键
 *   ② code 是 3 位数字（本行 LCB 是虚构机构，用内部代码，单独放行）
 *   ③ 同一市场内不出现重名
 *   ④ 确实存在两地撞号的 code —— 撞号是真实存在的，也是 region 必须随行的理由
 *   ⑤ 转数快登记册引用的银行都能在香港名录里解析到
 *   ⑥ 收款人簿里引用的 (bankCode, bankRegion) 都能解析到
 *
 *   node tools/check-bank-data.mjs
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const src = await readFile(path.join(ROOT, 'app/src/api/mock/db.ts'), 'utf8')

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/** 从 `const XXX: Bank[] = [ ... ]` 里抽出所有 { code, region, name, ... } 条目 */
function parseBankArray(name) {
  const start = src.indexOf(`const ${name}: Bank[] = [`)
  if (start < 0) throw new Error(`找不到 ${name}`)
  const open = src.indexOf('[', start)
  // 数组到第一个 "]\n\n" 结束（文件里每个数组后面都跟空行）
  const close = src.indexOf('\n]', open)
  const body = src.slice(open, close)
  return [...body.matchAll(/\{([^}]*)\}/g)].map((m) => {
    const field = (key) => m[1].match(new RegExp(`${key}: '([^']*)'`))?.[1]
    return {
      code: field('code'),
      region: field('region'),
      name: field('name'),
      domain: field('domain'),
      logo: field('logo'),
    }
  })
}

const cn = parseBankArray('CN_BANKS')
const hk = parseBankArray('HK_BANKS')
const all = [...cn, ...hk]

console.log(`内地 ${cn.length} 家 · 香港 ${hk.length} 家 · 合计 ${all.length} 家\n`)

// ① (region, code) 唯一
const keys = all.map((b) => `${b.region}-${b.code}`)
const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i)
report(dupKeys.length === 0, '① (region, code) 唯一', [
  dupKeys.length ? `重复：${[...new Set(dupKeys)].join(', ')}` : '无重复',
])

// ② code 形态
const badCodes = all.filter((b) => b.code !== 'LCB' && !/^\d{3}$/.test(b.code))
report(badCodes.length === 0, '② code 为 3 位数字（本行 LCB 除外）', [
  badCodes.length ? `异常：${badCodes.map((b) => `${b.region}/${b.code}`).join(', ')}` : '全部合规',
])

// ③ 同市场内不重名
const perRegionDup = []
for (const region of ['CN', 'HK']) {
  const names = all.filter((b) => b.region === region).map((b) => b.name)
  const dup = names.filter((n, i) => names.indexOf(n) !== i)
  if (dup.length) perRegionDup.push(`${region}: ${[...new Set(dup)].join(', ')}`)
}
report(perRegionDup.length === 0, '③ 同一市场内不出现重名', [
  perRegionDup.length ? perRegionDup.join(' | ') : '无重名',
])

// ④ 所有银行查找都必须带上 region —— 两套码表相互独立，裸 code 查是错的
const srcFiles = await Promise.all(
  (
    await readdir(path.join(ROOT, 'app/src'), { recursive: true, withFileTypes: true })
  )
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => readFile(path.join(e.parentPath, e.name), 'utf8')),
)
/** 取出 `banks.find(...)` 这类调用的完整文本（括号配平），再看里面有没有 region */
function bankLookupCalls(text) {
  const out = []
  // banks.find(...) / banks.data?.find(...) 都要覆盖
  for (const m of text.matchAll(/banks[\w.?]*\.(?:find|some|filter)\(/g)) {
    let depth = 0
    const start = m.index + m[0].length - 1
    for (let j = start; j < text.length; j += 1) {
      if (text[j] === '(') depth += 1
      else if (text[j] === ')') {
        depth -= 1
        if (depth === 0) {
          out.push(text.slice(start, j + 1))
          break
        }
      }
    }
  }
  return out
}

const lookupCalls = srcFiles.flatMap(bankLookupCalls)
const bareLookups = lookupCalls.filter((call) => !/region/.test(call))
report(lookupCalls.length > 0 && bareLookups.length === 0, '④ 银行查找一律带 region（不用裸 code 查）', [
  `检查了 ${lookupCalls.length} 处 banks.find/some/filter 调用`,
  bareLookups.length
    ? `裸查 ${bareLookups.length} 处：${[...new Set(bareLookups)].join(' / ')}`
    : '全部带 region，或走 findBank(banks, code, region)',
])

// ⑤ 转数快登记册
const fpsBlock = src.slice(src.indexOf('export const FPS_REGISTRY'), src.indexOf('\n]', src.indexOf('export const FPS_REGISTRY')))
const fpsRefs = [...fpsBlock.matchAll(/bankCode: '([^']*)', bankName: '([^']*)'/g)].map((m) => ({
  code: m[1],
  name: m[2],
}))
const hkCodes = new Set(hk.map((b) => b.code))
const badFps = fpsRefs.filter((r) => !hkCodes.has(r.code))
report(badFps.length === 0 && fpsRefs.length > 0, '⑤ 转数快登记册的银行都能在香港名录里解析', [
  `引用 ${fpsRefs.length} 处，解析失败 ${badFps.length} 处`,
  badFps.length
    ? `失败：${badFps.map((b) => `${b.code}(${b.name})`).join(', ')} —— 转数快是香港清算网络，不该挂在内地银行上`
    : '全部命中',
])

// ⑥ 收款人簿
const payeeBlock = src.slice(src.indexOf('payees: ['), src.indexOf('cards: ['))
const payeeRefs = [...payeeBlock.matchAll(/bankCode: '([^']*)',\s*\n\s*bankRegion: '([^']*)'/g)].map(
  (m) => ({ code: m[1], region: m[2] }),
)
const allKeys = new Set(all.map((b) => `${b.region}-${b.code}`))
const badPayees = payeeRefs.filter((r) => !allKeys.has(`${r.region}-${r.code}`))
report(payeeRefs.length > 0 && badPayees.length === 0, '⑥ 收款人簿引用的 (bankCode, bankRegion) 都能解析', [
  `引用 ${payeeRefs.length} 处（含 fps 之外的 3 处 bank 通道），解析失败 ${badPayees.length} 处`,
  badPayees.length ? `失败：${badPayees.map((b) => `${b.region}/${b.code}`).join(', ')}` : '全部命中',
])

// ⑦ logo 路径必须真的有对应文件（写错一个字母就是一个破图）
const { access } = await import('node:fs/promises')
// 注意字符类是 [^']+ 而不是 [^/]+：后者不排除引号，会**跨条目**匹配
// （把下一条的 `logo: '` 当成自己的闭合引号），49 家被数成 28 家。
const logoRefs = [...src.matchAll(/logo: '(\/banks\/[^']+)'/g)].map((m) => m[1])
const missing = []
for (const ref of logoRefs) {
  try {
    await access(path.join(ROOT, 'app/public', ref))
  } catch {
    missing.push(ref)
  }
}
const banksWithDomain = all.filter((b) => b.domain).length
report(logoRefs.length > 0 && missing.length === 0, '⑦ Bank.logo 指向的文件都存在', [
  `已挂行标 ${logoRefs.length} 家 / 有域名可抓的 ${banksWithDomain} 家 / 共 ${all.length} 家`,
  missing.length ? `找不到文件：${missing.join(', ')}` : '全部命中 app/public/banks/',
])

// ⑧ 每家只能引用**自己那份**行标文件
//
// 同品牌的两家机构（内地行 + 它的香港分行：光大、浦发、中行、工行…）标识确实一模一样，
// 于是很容易图省事让其中一家指向另一家的文件。文件内容相同没问题，**引用别人的路径**不行：
// 那个文件一旦重做、改格式或删掉，这一家就静默变成破图，而且改的人根本不知道有第二个引用方。
// 这条检查是写出来的：批量 sed 把 cn-310 和 hk-345 两行一起改了，抓到后才发现。
const borrowedLogo = []
for (const bank of all) {
  const logo = src.match(
    new RegExp(`\\{ code: '${bank.code}', region: '${bank.region}'[^}]*logo: '([^']+)'`),
  )?.[1]
  if (!logo) continue
  const own = `/banks/${bank.region.toLowerCase()}-${bank.code}.`
  if (!logo.startsWith(own)) borrowedLogo.push(`${bank.region}-${bank.code} ${bank.name} → ${logo}`)
}
report(borrowedLogo.length === 0, '⑧ 行标文件各用各的，不引用他行的文件', [
  borrowedLogo.length ? `借用了别家：${borrowedLogo.join('；')}` : '全部指向自己的文件',
])

// 顺带把名录打出来，方便肉眼核一遍名字
console.log('\n内地（人民银行行别代码）：')
console.log('  ' + cn.map((b) => `${b.code} ${b.name}`).join('  |  '))
console.log('\n香港（HKICL 银行代码）：')
console.log('  ' + hk.map((b) => `${b.code} ${b.name}`).join('  |  '))

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
