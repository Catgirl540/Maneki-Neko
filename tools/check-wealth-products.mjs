/** 文档目录与双端演示产品一致性；仅读取纯目录，不加载或持久化客户档案。 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const server = await import('../server/domain/state.mjs')
const browser = await import('../app/src/api/mock/db.ts')
const fields = ['code','name','issuer','category','risk','principalProtected','benchmark','sevenDayYield','nav','sinceInception','volatility','minAmount','stepAmount','term','openEnded','ongoingFees','transactionFees','priorityTier','topHoldings']
const normalized = products => products.map(product => Object.fromEntries(fields.map(field => [field, product[field]])))
assert.deepEqual(normalized(browser.WEALTH_PRODUCTS), normalized(server.WEALTH_PRODUCTS), '浏览器与服务端普通理财配置不一致')
const user = { id: 'documentation-only', name: '文档夹具', phone: '13900009999', memberTier: 'standard', avatarInitial: '文' }
const serverDomains = server.emptyCustomerDomains(user, 'documentation-only')
const browserDomains = browser.emptyCustomerDomains(user, 'documentation-only')
assert.deepEqual(browserDomains.investments.products, serverDomains.investments.products, '两端定投目录不一致')
assert.deepEqual(browserDomains.cashManagement.products, serverDomains.cashManagement.products, '两端旧活钱目录不一致')
const money = cents => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const percent = rate => `${(rate * 100).toFixed(2)}%`
const table = (head, rows) => [head, head.map(() => '---'), ...rows].map(row => `| ${row.join(' | ')} |`).join('\n')
const categories = { cash: '现金管理', fixed: '固定收益', mixed: '混合', equity: '权益', derivative: '商品及衍生品' }
const products = server.WEALTH_PRODUCTS
const fee = (product, name) => percent(product.ongoingFees.find(fee => fee.label === name)?.rate ?? 0)
const once = (product, name) => { const item = product.transactionFees.find(fee => fee.label.startsWith(name)); return item ? `${percent(item.rate)}${item.holdingDaysLessThan ? `（持有不满 ${item.holdingDaysLessThan} 天的部分）` : ''}` : '0.00%' }
const blocks = {
  'wealth-catalog': table(['代码', '虚构产品', '类型 / 风险', '起购（元）', '递增（元）', '期限 / 开放性'], products.map(product => [ `\`${product.code}\``, product.name, `${categories[product.category]} / ${product.risk}`, money(product.minAmount), money(product.stepAmount), `${product.term} / ${product.openEnded ? '开放式' : '封闭期内不可赎回'}` ])),
  'wealth-fees': table(['代码', '管理费/年', '托管费/年', '销售服务费/年', '申购费', '赎回费'], products.map(product => [ `\`${product.code}\``, fee(product, '固定管理费'), fee(product, '托管费'), fee(product, '销售服务费'), once(product, '申购'), once(product, '赎回') ])),
  'wealth-benchmarks': table(['代码', '虚构业绩比较基准'], products.map(product => [ `\`${product.code}\``, product.benchmark.kind === 'formula' ? product.benchmark.formula : `${percent(product.benchmark.low)}–${percent(product.benchmark.high)}（年化区间）` ])),
  'wealth-indicators': table(['代码', '固定单位净值', '七日年化', '成立以来年化', '近一月年化波动率'], products.map(product => [ `\`${product.code}\``, product.nav.toFixed(4), product.sevenDayYield == null ? '不适用' : percent(product.sevenDayYield), percent(product.sinceInception), percent(product.volatility) ])),
  'wealth-investments': table(['代码', '虚构定投产品', '风险', '起投（元）', '演示净值', '演示近一年收益'], serverDomains.investments.products.map(product => [ `\`${product.code}\``, product.name, product.risk, money(product.minAmount), product.nav.toFixed(4), percent(product.oneYearReturn) ])),
  'wealth-cash': table(['标识', '旧活钱条目', '起投展示（元）', '演示七日年化'], serverDomains.cashManagement.products.map(product => [ `\`${product.id}\``, product.name, money(product.minAmount), percent(product.sevenDayYield) ])),
}
const path = new URL('../docs/product/wealth-products.md', import.meta.url)
let doc = readFileSync(path, 'utf8')
const write = process.argv.includes('--write')
for (const [id, content] of Object.entries(blocks)) {
  const start = `<!-- ${id}:start -->`, end = `<!-- ${id}:end -->`
  const from = doc.indexOf(start), to = doc.indexOf(end)
  assert(from >= 0 && to > from, `缺少 ${id} 文档标记`)
  const expected = `\n${content}\n`
  if (write) doc = doc.slice(0, from + start.length) + expected + doc.slice(to)
  else assert.equal(doc.slice(from + start.length, to).replace(/\r\n/g, '\n'), expected, `${id} 已偏离当前产品；核对目录后运行 --write`)
}
for (const phrase of ['虚构配置', 'holdingDaysLessThan: 7', '先进先出', '分金额 ÷ 单位净值', '即时增加资金账户余额', 'sandbox-immediate', '不创建自动执行任务', '不是第二个储蓄账户']) assert(doc.includes(phrase), `缺少实现边界：${phrase}`)
if (write) writeFileSync(path, doc)
console.log(`PASS ${products.length} 款普通理财、${serverDomains.investments.products.length} 款定投、${serverDomains.cashManagement.products.length} 款旧活钱：双端目录一致，文档${write ? '已更新' : '一致'}，未读写客户库`)
