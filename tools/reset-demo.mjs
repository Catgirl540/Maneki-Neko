/**
 * 演示数据一键归零（清单 §7 / 分工清单-ai.md Phase 0 交付物 7）。
 *
 * 做什么
 * ------
 *   1. 删掉 `server/data/bank.sqlite`（含 -wal/-shm）——下次启动时
 *      `loadDb()` 会重新长出厂演示档案（林小满 u_0001、余额、流水、卡片）。
 *   2. 重建工作人员端六张表，并撒回演示种子：
 *      2 个员工账号、1 张待接工单、1 笔待审单、聊天样例。
 *
 * 为什么删库而不是调 `/api/__demo/reset`
 * ------------------------------------
 *   server/index.mjs 故意把那个重置接口挡成 404（多用户联调入口不能全局归零）。
 *   本脚本是**本地命令行工具**，走文件层，不经过 HTTP。
 *
 * 用法
 * ----
 *   node tools/reset-demo.mjs            # 归零（请先停掉 server）
 *   node tools/reset-demo.mjs --dry-run  # 只打印要做什么，不动文件
 */
import './legacy-sqlite-fixture-disabled.mjs'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const databaseFile = process.env.BANK_DB_FILE ?? join(ROOT, 'server/data/bank.sqlite')
const dryRun = process.argv.includes('--dry-run')

console.log(`[reset-demo] 目标库：${databaseFile}`)
if (dryRun) {
  console.log('[reset-demo] --dry-run：只看不动。')
}

// —— 1. 删库（下次启动由 loadDb()/ensureStaffSchema 重建） ————————
if (!dryRun) {
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const path = databaseFile + suffix
      if (existsSync(path)) rmSync(path)
    }
    console.log('[reset-demo] ✓ 已删除旧库（bank.sqlite 及 WAL 残留）')
  } catch (error) {
    console.error('[reset-demo] ✗ 删库失败。')
    console.error('  最常见原因：server 还开着（Windows 不让删被占用的文件）。')
    console.error('  请先停掉 `node server/index.mjs` 再跑本脚本。')
    console.error(`  系统说：${error?.message ?? error}`)
    process.exit(1)
  }
}

// —— 2. 撒回工作人员端演示种子 ————————————————————————————
// 复用 server 的建表逻辑，保证列名/约束永远与线上一致，不在脚本里手抄 schema。
const { ensureStaffSchema } = await import(
  pathToFileURL(join(ROOT, 'server/staff-api.mjs')).href
)

const NOW = '2026-10-14T09:00:00.000Z'

if (dryRun) {
  console.log('[reset-demo] 将重建 staff_* / tickets / ticket_messages / approvals / audit_logs / customer_access_logs')
  console.log('[reset-demo] 将插入：王小明(csr)、李主管(supervisor)、工单 T_demo0001、审批 A_demo0001、聊天样例')
  process.exit(0)
}

const db = new DatabaseSync(databaseFile)
ensureStaffSchema(db)

// ensureStaffSchema 只在表空时建员工；删库后必然是空的，所以这里能保证两个演示账号在。
// 再幂等插一次演示工单/审批：重复跑本脚本时先清掉上一版种子行。
db.exec("DELETE FROM ticket_messages WHERE ticket_id = 'T_demo0001'")
db.exec("DELETE FROM tickets WHERE id = 'T_demo0001'")
db.exec("DELETE FROM approvals WHERE id = 'A_demo0001'")

const insertTicket = db.prepare(`
  INSERT INTO tickets
    (id, customer_id, channel, reason, priority, status, assignee_id,
     transfer_id, approval_id, agent_transcript, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
insertTicket.run(
  'T_demo0001',
  'u_0001', // 林小满（db.ts seed 的演示客户）
  'app',
  '客户对一笔 60 万元大额转账不放心，要求转人工',
  'high',
  'open',
  null,
  'txn_demo600k',
  'A_demo0001',
  JSON.stringify([
    { role: 'user', text: '我要转 60 万给梁乐怡，不放心，帮我找人工' },
    { role: 'assistant', text: '好的，已为您转接人工客服。' },
  ]),
  NOW,
  NOW,
)

const insertMessage = db.prepare(`
  INSERT INTO ticket_messages (id, ticket_id, sender, text, created_at)
  VALUES (?, ?, ?, ?, ?)
`)
insertMessage.run('msg_demo1', 'T_demo0001', 'system', '已为您接入人工客服', NOW)

const insertApproval = db.prepare(`
  INSERT INTO approvals
    (id, biz_type, biz_payload, risk_summary, applicant_id,
     status, execution_status, execution_error, decided_by, reason, created_at, decided_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
insertApproval.run(
  'A_demo0001',
  'transfer',
  JSON.stringify({ amount: 60_000_000, payeeName: '梁乐怡', transactionId: 'txn_demo600k' }),
  '单笔 600,000 元，超过延迟到账阈值 500,000 元',
  null,
  'pending',
  'pending',
  null,
  null,
  null,
  NOW,
  null,
)

db.close()

console.log('[reset-demo] ✓ 已撒回演示种子：')
console.log('    员工   王小明（客服）/ 李主管（主管），密码都是 123456')
console.log('    工单   T_demo0001（待处理，关联 txn_demo600k）')
console.log('    审批   A_demo0001（待裁决，60 万元超阈值）')
console.log('    客户   林小满 u_0001（下次启动 server 时由 loadDb() 重新长出余额与流水）')
console.log('[reset-demo] 现在可以重新启动 server（node server/index.mjs）。')
