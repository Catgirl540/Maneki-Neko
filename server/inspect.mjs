import { writeFileSync } from 'node:fs'
import { createPgClient } from './pg-client.mjs'

const [output, ...extra] = process.argv.slice(2)
if (extra.length || !/^postgres(?:ql)?:\/\//i.test(process.env.BANK_DATABASE_URL ?? '')) {
  console.error('Usage: BANK_DATABASE_URL=<PostgreSQL URL> node server/inspect.mjs [output.md]')
  process.exit(2)
}
const db = createPgClient(process.env.BANK_DATABASE_URL)
const escape = value => String(value instanceof Date ? value.toISOString() : value ?? '').replaceAll('|', '\\|').replace(/[\r\n]/g, ' ')
const mask = value => { const number = String(value ?? ''); return number.length > 4 ? `****${number.slice(-4)}` : '****' }
const amount = value => {
  if (value == null) return '尚无银行快照'
  const integer = BigInt(value), absolute = integer < 0n ? -integer : integer
  return `${integer < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}
try {
  const data = await db.transaction(async () => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const info = (await db.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0]
    const tables = (await db.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN (current_schema(),'banking','accounting','regulatory') ORDER BY table_schema,table_name")).rows
    const cards = (await db.query('SELECT owner_id,id,account_id,product_name,network,status,last4,daily_limit_cents FROM virtual_cards ORDER BY owner_id,id LIMIT 200')).rows
    const legacy = (await db.query('SELECT owner_id,id,account_no,label,currency,balance_cents,available_cents FROM bank_accounts ORDER BY owner_id,id LIMIT 200')).rows
    const accounts = (await db.query('SELECT owner_id,id,provider_id,masked_account,label,currency,state,bank_balance_cents,bank_available_cents,balance_observed_at FROM banking.account_links ORDER BY created_at,id LIMIT 200')).rows
    const payments = (await db.query('SELECT id,owner_id,source_account_id,amount_cents,currency,status,created_at FROM banking.payment_intents ORDER BY created_at DESC,id DESC LIMIT 20')).rows
    const recent = (await db.query('SELECT owner_id,account_id,direction,amount_cents,status,created_at FROM bank_transactions ORDER BY created_at DESC,seq DESC LIMIT 20')).rows
    return { info, tables, cards, legacy, accounts, payments, recent }
  })
  const { info, tables, cards, legacy, accounts, payments, recent } = data
  const lines = [
    '# PostgreSQL 数据库运维预览', '',
    `数据库：${escape(info.database)}；兼容域：${escape(info.schema)}。`, '',
    '本报告使用同一只读事务快照；账户及卡片最多各 200 条，支付及历史流水各 20 条。银行托管资金与历史演示投影分别列示。', '',
    `表：${tables.map(row => `\`${escape(row.table_schema)}.${escape(row.table_name)}\``).join('、')}`, '',
    '## 合作银行托管账户', '',
    '| 客户 ID | 托管账户 ID | 银行接入 ID | 脱敏账户 | 名称 | 币种 | 状态 | 银行余额（元） | 银行可用额（元） | 银行快照时间 |',
    '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- |',
    ...accounts.map(row => `| ${escape(row.owner_id)} | ${escape(row.id)} | ${escape(row.provider_id)} | ${escape(row.masked_account)} | ${escape(row.label)} | ${escape(row.currency)} | ${escape(row.state)} | ${amount(row.bank_balance_cents)} | ${amount(row.bank_available_cents)} | ${escape(row.balance_observed_at)} |`), '',
    '## 银行支付指令', '',
    '| 支付 ID | 客户 ID | 来源账户 | 金额（元） | 币种 | 状态 | 创建时间 |',
    '| --- | --- | --- | ---: | --- | --- | --- |',
    ...payments.map(row => `| ${escape(row.id)} | ${escape(row.owner_id)} | ${escape(row.source_account_id)} | ${amount(row.amount_cents)} | ${escape(row.currency)} | ${escape(row.status)} | ${escape(row.created_at)} |`), '',
    '## 历史兼容账户（演示数据）', '',
    '| 客户 ID | 账户 ID | 脱敏账号 | 名称 | 币种 | 历史余额（元） | 历史可用额（元） |',
    '| --- | --- | --- | --- | --- | ---: | ---: |',
    ...legacy.map(row => `| ${escape(row.owner_id)} | ${escape(row.id)} | ${mask(row.account_no)} | ${escape(row.label)} | ${escape(row.currency)} | ${amount(row.balance_cents)} | ${amount(row.available_cents)} |`), '',
    '## 历史兼容卡片（演示数据）', '',
    '| 客户 ID | 卡 ID | 账户 ID | 产品 | 卡组织 | 状态 | 尾号 | 单日限额（元） |',
    '| --- | --- | --- | --- | --- | --- | --- | ---: |',
    ...cards.map(row => `| ${escape(row.owner_id)} | ${escape(row.id)} | ${escape(row.account_id)} | ${escape(row.product_name)} | ${escape(row.network)} | ${escape(row.status)} | ${escape(row.last4)} | ${amount(row.daily_limit_cents)} |`), '',
    '## 最近历史流水（演示数据）', '',
    '| 客户 ID | 账户 ID | 收支 | 金额（元） | 状态 | 时间 |',
    '| --- | --- | --- | ---: | --- | --- |',
    ...recent.map(row => `| ${escape(row.owner_id)} | ${escape(row.account_id)} | ${row.direction === 'in' ? '收入' : '支出'} | ${amount(row.amount_cents)} | ${escape(row.status)} | ${escape(row.created_at)} |`), '',
    '报告不读取密码、银行授权凭据、完整卡号、CVV、身份证件或收款人加密内容。历史投影不代表银行实际托管余额。', '',
  ]
  const markdown = lines.join('\n')
  if (output) { writeFileSync(output, markdown, { encoding: 'utf8', mode: 0o600 }); console.log('已生成 PostgreSQL 运维预览文件') }
  else console.log(markdown)
} catch {
  console.error('PostgreSQL inspection failed; verify read access and owner bootstrap without printing connection credentials')
  process.exitCode = 1
} finally { await db.close() }
