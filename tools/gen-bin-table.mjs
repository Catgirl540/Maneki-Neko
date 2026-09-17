#!/usr/bin/env node
/* ==========================================================================
   生成内地卡 BIN 表（app/src/api/mock/bin-table.ts）

   数据来源
   --------
   hexindai/bcbc —— China UnionPay Bank Card BIN Checker（Go 实现）
     https://github.com/hexindai/bcbc
     data/bin.csv  列：bin,bank,type,length
     data/name.csv 列：bank,name
   经 cdn.jsdelivr.net 代理 GitHub 原始文件（本环境 raw.githubusercontent.com 不可达）。

   为什么不自己维护这张表
   ----------------------
   卡 BIN 是**银联分配、发卡行使用**的公开路由数据，不是可以凭印象编的东西：
   写错一位，用户就会把钱转进另一家银行。所以这张表只能来自已发布的 BIN 码表，
   并且只保留能被名录对上的部分 —— 表里每一行都能反查到来源。

   筛选规则（三步，都会打印被丢掉的量）
   ------------------------------------
   1. 只保留本行收款银行名录里的 19 家内地银行（按人民银行行别代码对接）
   2. 只保留 type=DC（借记卡）。**贷记卡不能作为转账收款方**，收录进来会让
      「输入卡号自动选银行」把信用卡号也认成有效收款账户 —— 那是错的
   3. 只保留 6 位 BIN。真实 BIN 长度 6–9 位不等（本表里有 621056801 这种 9 位），
      但 6 位覆盖绝大多数卡，且能让「输满 6 位就出结果」这条交互规则成立。
      9 位 BIN 需要最长前缀匹配，MVP 不做，已在 README 记为边界

   用法：node tools/gen-bin-table.mjs
   ========================================================================== */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'app/src/api/mock/bin-table.ts')
const CDN = 'https://cdn.jsdelivr.net/gh/hexindai/bcbc@HEAD/data'

/**
 * 本行名录里的 19 家内地银行。
 * 左 = bcbc 的银行代码，右 = [人民银行行别代码, 行名]。
 * 行别代码必须与 db.ts 的 CN_BANKS 完全一致，否则生成的表接不上（下面会断言）。
 */
const ROSTER = {
  ICBC: ['102', '中国工商银行'],
  ABC: ['103', '中国农业银行'],
  BOC: ['104', '中国银行'],
  CCB: ['105', '中国建设银行'],
  COMM: ['301', '交通银行'],
  CMB: ['308', '招商银行'],
  CITIC: ['302', '中信银行'],
  CEB: ['303', '中国光大银行'],
  HXBANK: ['304', '华夏银行'],
  CMBC: ['305', '中国民生银行'],
  GDB: ['306', '广发银行'],
  SPABANK: ['307', '平安银行'],
  CIB: ['309', '兴业银行'],
  SPDB: ['310', '上海浦东发展银行'],
  EGBANK: ['315', '恒丰银行'],
  CZBANK: ['316', '浙商银行'],
  BOHAIB: ['318', '渤海银行'],
  HSBANK: ['319', '徽商银行'],
  PSBC: ['403', '中国邮政储蓄银行'],
}

async function fetchCsv(name) {
  const res = await fetch(`${CDN}/${name}`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const text = await res.text()
  const [head, ...lines] = text.trim().split('\n')
  const cols = head.split(',')
  return lines
    .filter((l) => l.trim())
    .map((l) => {
      const parts = l.split(',')
      return Object.fromEntries(cols.map((c, i) => [c, (parts[i] ?? '').trim()]))
    })
}

const bins = await fetchCsv('bin.csv')
const names = await fetchCsv('name.csv')
console.log(`源表：bin.csv ${bins.length} 行，name.csv ${names.length} 行`)

const nameOf = Object.fromEntries(names.map((r) => [r.bank, r.name]))

/**
 * 已知的历史更名：上游码表沿用旧名，本行名录用现名。
 * 显式登记而不是把校验放宽 —— 校验的价值就在于「对不上时必须有人来解释」，
 * 一旦改成只警告，抄错行名也会被一起放过。306/307 的更名见 db.ts 的注释。
 */
const RENAMED = {
  GDB: '广东发展银行', // 2011 年更名广发银行
  SPABANK: '深圳发展银行', // 2012 年与平安银行合并后更名
}

for (const [code, [, zh]] of Object.entries(ROSTER)) {
  const upstream = nameOf[code]
  if (upstream === zh) continue
  if (RENAMED[code] === upstream) {
    console.log(`  · ${code} 上游旧名「${upstream}」→ 本表「${zh}」（已登记的更名）`)
    continue
  }
  throw new Error(`${code}: 上游行名「${upstream}」≠ 本表「${zh}」，未经登记，先核对再生成`)
}

const dropped = { notInRoster: 0, notDebit: 0, notSixDigits: 0, notUnionPay: 0 }
const byBin = new Map() // bin -> code
const conflicts = []

for (const r of bins) {
  const entry = ROSTER[r.bank]
  if (!entry) { dropped.notInRoster++; continue }
  if (r.type !== 'DC') { dropped.notDebit++; continue }
  if (!/^\d{6}$/.test(r.bin)) { dropped.notSixDigits++; continue }
  // 62 开头 = 银联。这套码表里也有 Visa/Master/JCB 段，转账收款只会是银联卡
  if (!r.bin.startsWith('62')) { dropped.notUnionPay++; continue }

  const prev = byBin.get(r.bin)
  if (prev && prev !== r.bank) {
    // 上游表里同一个 BIN 挂在两家银行下 —— 这种行一律不要，
    // 宁可少认一家，也不能把卡号认到错误的银行
    conflicts.push({ bin: r.bin, a: prev, b: r.bank })
    byBin.delete(r.bin)
    continue
  }
  byBin.set(r.bin, r.bank)
}

if (conflicts.length) {
  console.warn(`  ⚠ 丢弃 ${conflicts.length} 个归属冲突的 BIN：`)
  for (const c of conflicts) console.warn(`     ${c.bin}: ${c.a} / ${c.b}`)
}

const rows = [...byBin.entries()]
  .map(([bin, code]) => ({ bin, code: ROSTER[code][0], bank: ROSTER[code][1] }))
  .sort((a, b) => a.bin.localeCompare(b.bin))

// —— 每家银行都得有 BIN，否则「选银行补全前缀」对它是死功能 ——
const covered = new Set(rows.map((r) => r.code))
const missing = Object.values(ROSTER).filter(([code]) => !covered.has(code))
if (missing.length) throw new Error(`这些银行一条 BIN 都没有：${missing.map((m) => m[1]).join('、')}`)

console.log(
  `保留 ${rows.length} 条 BIN，覆盖 ${covered.size}/19 家。丢弃：` +
    `非名录 ${dropped.notInRoster}、非借记卡 ${dropped.notDebit}、` +
    `非 6 位 ${dropped.notSixDigits}、非银联 ${dropped.notUnionPay}`,
)

const perBank = {}
for (const r of rows) perBank[r.code] = (perBank[r.code] ?? 0) + 1
console.log('  各行条数：' + Object.entries(perBank).map(([c, n]) => `${c}:${n}`).join(' '))

// —— 主 BIN：每行挑一个已知的、最常用的借记卡 BIN，供「选银行补全前缀」使用 ——
const PRIMARY = {
  '102': '622202', '103': '622848', '104': '621661', '105': '621700', '301': '622260',
  '308': '622588', '302': '622690', '303': '622660', '304': '622630', '305': '622622',
  '306': '622568', '307': '622298', '309': '622908', '310': '622521', '315': '622384',
  '316': '621019', '318': '622884', '319': '622877', '403': '621599',
}
// 主 BIN 必须是本表里真实存在的一条 —— 不能是「我记得的」那个
for (const [code, bin] of Object.entries(PRIMARY)) {
  if (!rows.some((r) => r.code === code && r.bin === bin))
    throw new Error(`主 BIN ${bin}（行别 ${code}）不在生成的表里，请从该行 BIN 中重挑`)
}

const body = `/* 本文件由 tools/gen-bin-table.mjs 生成，请勿手改 —— 改数据请改生成器再跑一遍。 */

/**
 * 内地银行卡 BIN 表（人民银行行别代码 ↔ 银联卡号前 6 位）。
 *
 * 数据来源：hexindai/bcbc 的 data/bin.csv（China UnionPay Bank Card BIN Checker），
 * 经 cdn.jsdelivr.net 代理取得。只保留本行名录里 19 家内地银行的**借记卡**银联 BIN。
 *
 * 卡 BIN 是银联分配、发卡行使用的公开路由数据。这张表直接决定「输卡号认银行」认对认错，
 * 所以只能来自已发布的码表，不能凭印象编 —— 写错一位就是把钱转进另一家银行。
 *
 * 边界（见 README）：
 * - **贷记卡 BIN 不收录**：信用卡不能作为转账收款方，收录会让识别把信用卡号也放行
 * - **只收 6 位 BIN**：真实 BIN 长度 6–9 位不等，9 位需要最长前缀匹配，MVP 不做
 * - **只收 62 开头**：转运收款只会是银联卡；这套码表里还有 Visa/Master/JCB 段
 */
export interface CardBinEntry {
  /** 卡号前 6 位 */
  bin: string
  /** 人民银行行别代码，与 db.ts 的 CN_BANKS[].code 对应 */
  code: string
}

export const CN_CARD_BINS: CardBinEntry[] = [
${rows.map((r) => `  { bin: '${r.bin}', code: '${r.code}' }, // ${r.bank}`).join('\n')}
]

/**
 * 各行主 BIN：选定收款银行时用它补全卡号前缀。
 * 只是「该行最常用的一张借记卡的号段」，不是唯一号段 —— 用户卡号不同时直接覆盖即可。
 */
export const PRIMARY_BIN: Record<string, string> = {
${Object.entries(PRIMARY).map(([c, b]) => `  '${c}': '${b}',`).join('\n')}
}
`

writeFileSync(OUT, body)
console.log(`已写入 ${OUT}`)
