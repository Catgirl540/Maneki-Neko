/**
 * 卡 BIN 识别（输卡号 → 认发卡行）的检查。
 *
 * 为什么不是纯静态解析：这段逻辑一旦认错，用户就会把钱转进另一家银行。
 * 所以这里**直接 import 应用里真正在跑的那份实现**（api/mock/card-bin.ts）
 * 和真正下发的那份数据（api/mock/bin-table.ts），跑真实用例 ——
 * 而不是照着源码再抄一遍实现来「验证」它，那种检查抄错了两边一起错，还会给出确信的错答案。
 *
 * 依赖 tools/ts-resolve-hook.mjs 把 `@/` 和免扩展名的相对导入解析到 src。
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/check-card-bin.mjs
 */
import { lookupCardBin } from '../app/src/api/mock/card-bin.ts'
import { CN_CARD_BINS, PRIMARY_BIN } from '../app/src/api/mock/bin-table.ts'
import { loadDb } from '../app/src/api/mock/db.ts'
import { CARD_BIN_LENGTH } from '../app/src/lib/account.ts'

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

// loadDb 在 Node 下拿不到 localStorage，会去建一份种子库 —— 正是我们要的「名录原始状态」
const banks = loadDb().banks
const cnBanks = banks.filter((b) => b.region === 'CN')
/** 本行是虚构机构，不占真实行别代码与号段，天然不该有 BIN —— 单独摘出来，不让它混进覆盖率 */
const internalBanks = cnBanks.filter((b) => b.internal)
const realCnBanks = cnBanks.filter((b) => !b.internal)
const bankOf = (code) => banks.find((b) => b.code === code && b.region === 'CN')
const nameOf = (code) => bankOf(code)?.name ?? `(名录里没有 ${code})`

console.log(`名录：内地 ${cnBanks.length} 家（其中本行 ${internalBanks.length} 家）/ 香港 ${banks.length - cnBanks.length} 家`)
console.log(`BIN 表：${CN_CARD_BINS.length} 条，主号段 ${Object.keys(PRIMARY_BIN).length} 条\n`)

/* ------------------------------------------------ ① 数据不变量 */

// 一个 BIN 只能属于一家银行 —— 这条一破，识别就会随机认错行
const byBin = new Map()
const dupes = []
for (const e of CN_CARD_BINS) {
  if (byBin.has(e.bin)) dupes.push(`${e.bin}: ${byBin.get(e.bin)} / ${e.code}`)
  byBin.set(e.bin, e.code)
}
report(dupes.length === 0, '① 一个 BIN 只对应一家银行（识别不会认错行）', [
  `${CN_CARD_BINS.length} 条 BIN，唯一 ${byBin.size} 条`,
  ...(dupes.length ? [`重复：${dupes.join('、')}`] : []),
])

const malformed = CN_CARD_BINS.filter((e) => !/^62\d{4}$/.test(e.bin))
report(malformed.length === 0, `② BIN 都是 6 位数字且以 62 开头（银联）`, [
  malformed.length ? `不合格：${malformed.map((e) => e.bin).join('、')}` : '全部合格',
])

const orphan = [...new Set(CN_CARD_BINS.map((e) => e.code))].filter((c) => !bankOf(c))
report(orphan.length === 0, '③ 表里每个行别代码都能在内地名录里解析到', [
  orphan.length ? `名录里没有：${orphan.join('、')}` : '全部命中',
])

// 少一家 = 「选银行补全前缀」对那家是死功能，而且用户会以为是卡号错了
const uncovered = realCnBanks.filter((b) => !CN_CARD_BINS.some((e) => e.code === b.code))
report(uncovered.length === 0, '④ 内地每一家真实银行都至少有一条 BIN', [
  uncovered.length ? `没有号段：${uncovered.map((b) => b.name).join('、')}` : `${realCnBanks.length} 家全覆盖`,
])

// 本行是虚构机构：给了它号段就等于凭空编一个真实银行的 BIN 出来
const internalWithBin = internalBanks.filter(
  (b) => b.primaryBin || CN_CARD_BINS.some((e) => e.code === b.code),
)
// 本行也要有前缀，但**不能来自公开码表**：它是我们自己的账号格式（8820…）。
// 第一版把本行排除在识别之外，结果是「从别家切回本行时没有前缀可补」——
// 界面上写着招财猫银行、卡号栏却留着工商的 622202，转出去必然失败。
const internalWithSourcedBin = internalBanks.filter((b) =>
  CN_CARD_BINS.some((e) => e.code === b.code),
)
const internalNoPrefix = internalBanks.filter((b) => !b.primaryBin)
report(
  internalWithSourcedBin.length === 0 && internalNoPrefix.length === 0,
  '④′ 本行有自己的账号前缀，但不来自公开码表',
  [
    `本行：${internalBanks.map((b) => `${b.name}（${b.code}）前缀 ${b.primaryBin ?? '无'}`).join('、') || '（无）'}`,
    internalWithSourcedBin.length
      ? `❌ 混进了公开码表：${internalWithSourcedBin.map((b) => b.name).join('、')}`
      : '未混进 CN_CARD_BINS（那张表每行都得能反查到公开来源）',
  ],
)

// 本行前缀不能和任何真实银行的 BIN 撞号，否则界面会把它认成别家
const ownBin = internalBanks[0]?.primaryBin
const clash = ownBin ? CN_CARD_BINS.filter((e) => e.bin === ownBin) : []
report(ownBin != null && clash.length === 0, '④″ 本行前缀不与任何真实银行号段撞号', [
  `本行前缀 ${ownBin ?? '（无）'}${clash.length ? ` ❌ 撞上 ${clash.map((c) => c.code).join('、')}` : '，公开码表里没有这一条'}`,
])

/* ------------------------------------------------ ⑤ 主号段（选银行 → 补全前缀） */

const badPrimary = Object.entries(PRIMARY_BIN).filter(
  ([code, bin]) => !CN_CARD_BINS.some((e) => e.code === code && e.bin === bin),
)
report(badPrimary.length === 0, '⑤ 主号段都真实存在于表中、且属于该行', [
  badPrimary.length
    ? `对不上：${badPrimary.map(([c, b]) => `${c}/${b}`).join('、')}`
    : `${Object.keys(PRIMARY_BIN).length} 条全部命中`,
])

// 界面是拿名录里的 bank.primaryBin 补全的 —— 没下发就等于这个功能没生效（本行除外，它就不该有）
const noPrimary = realCnBanks.filter((b) => !b.primaryBin)
report(noPrimary.length === 0, '⑥ 每家内地真实银行都把主号段随名录下发了', [
  noPrimary.length ? `缺 primaryBin：${noPrimary.map((b) => b.name).join('、')}` : '全部下发',
])

/* ------------------------------------------------ ⑦ 行为：输卡号 → 认银行 */

const cases = [
  ['622202', '102'],
  ['622588', '308'],
  ['622690', '302'],
  ['621700', '105'],
  ['621599', '403'],
]
const wrong = cases.filter(([digits, code]) => {
  const r = lookupCardBin(banks, digits, 'CN')
  return r.status !== 'matched' || r.bank.code !== code
})
report(wrong.length === 0, '⑦ 已知号段能认到正确的银行', [
  ...cases.map(([d, c]) => {
    const r = lookupCardBin(banks, d, 'CN')
    const got = r.status === 'matched' ? r.bank.name : r.status
    return `${d} → ${got}${r.status === 'matched' && r.bank.code === c ? '' : ` ❌ 应为 ${nameOf(c)}`}`
  }),
])

// 卡号是一位一位敲的，中间会带用户加的分隔符
const messy = [
  ['6222 0200 0000 0000', 'matched'],
  ['  622202  ', 'matched'],
  ['6222-0200-0000-0000', 'matched'],
]
const messyBad = messy.filter(([input, want]) => lookupCardBin(banks, input, 'CN').status !== want)
report(messyBad.length === 0, '⑧ 带空格 / 连字符的输入同样能识别', [
  ...messy.map(([i]) => `${JSON.stringify(i)} → ${lookupCardBin(banks, i, 'CN').status}`),
])

/* ------------------------------------------------ ⑨ 三种「查不到」要分得开 */

const incomplete = lookupCardBin(banks, '62220', 'CN')
report(
  incomplete.status === 'incomplete' && incomplete.need === CARD_BIN_LENGTH - 5,
  '⑨ 位数不够回 incomplete（不是错误，是让用户接着输）',
  [`'62220' → ${JSON.stringify(incomplete)}`],
)

const unknown = lookupCardBin(banks, '999999', 'CN')
report(unknown.status === 'unsupported', '⑩ 没收录的号段回 unsupported（界面提示「暂不支持该银行」）', [
  `'999999' → ${unknown.status}`,
])

const hk = lookupCardBin(banks, '622202', 'HK')
report(hk.status === 'not-applicable', '⑪ 香港回 not-applicable（银行账户号没有 BIN 这回事）', [
  `region=HK → ${hk.status}`,
])

// 信用卡号段不能认出来：信用卡不能作为转账收款方
const credit = lookupCardBin(banks, '625965', 'CN')
report(credit.status === 'unsupported', '⑫ 贷记卡号段认不出来（信用卡不能作为收款账户）', [
  `'625965'（建行龙卡 IC 信用卡）→ ${credit.status}`,
])

// 表里有、名录里没有 = 两边不同步，应当当成不认识，而不是编一家银行出来
const desynced = lookupCardBin(banks.filter((b) => b.code !== '102'), '622202', 'CN')
report(desynced.status === 'unsupported', '⑬ 表与名录不同步时不硬认（不凭空编银行）', [
  `挖掉工商后查 622202 → ${desynced.status}`,
])

/* ------------------------------------------------ ⑭ 种子数据不能借真实银行的号段 */

// 曾经踩过：本行账户写成 622202…（工商银行的真实 BIN），于是「常用收款人 → 陈嘉禾
// （招财猫银行）」一选中，卡号识别就把收款行翻成了中国工商银行。
const internalCodes = new Set(internalBanks.map((b) => b.code))
const borrowed = []
for (const p of loadDb().payees) {
  if (!internalCodes.has(p.bankCode) || !p.accountNo) continue
  const r = lookupCardBin(banks, p.accountNo, 'CN')
  // 认回**本行**是对的；要挑的是「本行的收款人被认成别家银行」——
  // 原始 bug 就是 LCB 的收款人解析成了中国工商银行
  if (r.status === 'matched' && r.bank.code !== p.bankCode) {
    borrowed.push(`${p.name} → ${p.accountNo} 被认成${r.bank.name}（名录里是 ${p.bankName}）`)
  }
}
report(borrowed.length === 0, '⑭ 本行收款人的账号没有被认成别家银行', [
  borrowed.length ? borrowed.join('；') : `本行收款人 ${internalBanks.length ? loadDb().payees.filter((p) => internalCodes.has(p.bankCode)).length : 0} 个，账号均不落在他行号段里`,
])

// 而且要**正着认出来**：本行账号前缀必须解析回本行（不然就是「谁都不认」，
// 界面会退回「输入卡号前 6 位自动识别」这句废话）
const ownProbe = loadDb().payees.find((p) => internalCodes.has(p.bankCode))?.accountNo ?? ''
const ownHit = lookupCardBin(banks, ownProbe, 'CN')
report(
  ownHit.status === 'matched' && ownHit.bank.internal === true,
  '⑮ 本行账号前缀能反查回本行',
  [`${ownProbe} → ${ownHit.status === 'matched' ? ownHit.bank.name : ownHit.status}`],
)

console.log(
  failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`,
)
process.exit(failures === 0 ? 0 : 1)
