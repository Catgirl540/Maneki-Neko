/** 维护文档门禁：检查当前入口的约束链接和已知旧模型说法；历史归档不参与。 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const read = file => readFileSync(join(root, file), 'utf8')
const entries = ['AGENTS.md', 'CLIENTS.md', 'README.md', 'app/README.md', 'server/README.md', 'docs/api/README.md']
for (const file of entries) assert.match(read(file), /(?:docs\/product|\.\.\/product|\.\.\/docs\/product)\/account-model\.md/, `${file} 缺少账户模型入口`)
const markdown = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
  const file = `${dir}/${entry.name}`
  return entry.isDirectory() ? markdown(file) : entry.name.endsWith('.md') ? [file] : []
})
const files = [...entries, ...markdown('docs/api'), ...markdown('framework/knowledge'), ...markdown('framework/skills')]
const obsolete = [
  /三张卡分别对应三个独立/,
  /为另外两个账户创建零余额账户/,
  /转给我的其他银行卡账户/,
  /目标币种账户不存在则自动开立/,
  /自动开立同币种子账户/,
  /每位用户一个主储蓄账户/,
  /账户余额、其他资金账户、近期交易/,
]
for (const file of new Set(files)) for (const pattern of obsolete) assert(!pattern.test(read(file)), `${file} 仍有旧账户模型说明：${pattern}`)
const model = read('docs/product/account-model.md')
for (const rule of ['只有一个储蓄资金账户', '卡片不单独存钱', '首次兑换仅初始化目标币种余额', '理财账户是投资资格', '不能重置数据库']) assert(model.includes(rule), `账户模型缺少约束：${rule}`)
console.log(`PASS ${new Set(files).size} 份维护文档：模型入口齐全，已知多账户旧说法未回流`)
