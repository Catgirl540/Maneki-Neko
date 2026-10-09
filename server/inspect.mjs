import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const databaseFile = process.env.BANK_DB_FILE ?? join(root, 'server/data/bank.sqlite')
const output = process.argv[2]
const db = new DatabaseSync(databaseFile, { readOnly: true })

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((row) => row.name)
  const cards = db.prepare(`
    SELECT owner_id, id, account_id, product_name, network, status, last4,
           online_payment, overseas_payment, daily_limit_cents
    FROM virtual_cards ORDER BY owner_id, id
  `).all()
  const accounts = db.prepare(`
    SELECT owner_id, id, account_no, label, currency, balance_cents, available_cents
    FROM bank_accounts ORDER BY owner_id, account_no
  `).all()
  const recent = db.prepare(`
    SELECT owner_id, account_id, direction, amount_cents, counterparty, status, created_at
    FROM bank_transactions ORDER BY created_at DESC, rowid DESC LIMIT 12
  `).all()
  const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
  const lines = [
    '# 虚拟银行数据库预览',
    '',
    `数据库：\`${databaseFile}\``,
    '',
    `表：${tables.map((name) => `\`${name}\``).join('、')}`,
    '',
    `虚拟银行卡：${cards.length} 张`,
    '',
    '| 用户 ID | 卡 ID | 资金账户 | 产品 | 卡组织 | 状态 | 尾号 | 线上支付 | 境外支付 | 单日限额（元） |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: |',
    ...cards.map((card) => `| ${escape(card.owner_id)} | ${escape(card.id)} | ${escape(card.account_id)} | ${escape(card.product_name)} | ${escape(card.network)} | ${escape(card.status)} | ${escape(card.last4)} | ${card.online_payment ? '开' : '关'} | ${card.overseas_payment ? '开' : '关'} | ${(card.daily_limit_cents / 100).toFixed(2)} |`),
    '',
    `资金账户：${accounts.length} 个`,
    '',
    '| 用户 ID | 账户 ID | 账户号 | 名称 | 币种 | 余额 | 可用余额 |',
    '| --- | --- | --- | --- | --- | ---: | ---: |',
    ...accounts.map((account) => `| ${escape(account.owner_id)} | ${escape(account.id)} | ${escape(account.account_no)} | ${escape(account.label)} | ${escape(account.currency)} | ${(account.balance_cents / 100).toFixed(2)} | ${(account.available_cents / 100).toFixed(2)} |`),
    '',
    '最近流水',
    '',
    '| 用户 ID | 账户 ID | 收支 | 金额 | 对方 | 状态 | 时间 |',
    '| --- | --- | --- | ---: | --- | --- | --- |',
    ...recent.map((tx) => `| ${escape(tx.owner_id)} | ${escape(tx.account_id)} | ${tx.direction === 'in' ? '收入' : '支出'} | ${(tx.amount_cents / 100).toFixed(2)} | ${escape(tx.counterparty)} | ${escape(tx.status)} | ${escape(tx.created_at)} |`),
    '',
    '此预览不包含完整卡号或安全码。重新运行命令可刷新内容。',
    '',
  ]
  const markdown = lines.join('\n')
  if (output) {
    writeFileSync(output, markdown, 'utf8')
    console.log(`已生成：${output}`)
  } else {
    console.log(markdown)
  }
} finally {
  db.close()
}
