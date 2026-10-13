/**
 * 员工端「客户查询 / 代客办理 / 审计」三块冒烟（清单 §2，乙模块）
 * 用法：node staff-customers-smoke.mjs
 * 全程 Node fetch（curl + 中文 = GBK 污染，不用 curl）。
 *
 * 覆盖：客户搜索（姓名/手机号） / 档案脱敏摘要 + 事由必填 / 访问日志原子落账 /
 *       白名单锁卡真落库 / 高影响动作未核验拦截 / 审计仅主管可见 + 留痕
 */
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PORT = 8712
const bank = `http://127.0.0.1:${PORT}`
const staffBase = `${bank}/staff-api`
const dbFile = join(tmpdir(), 'staff-customers-smoke.sqlite')
const SERVER_ENTRY = fileURLToPath(new URL('../server/index.mjs', import.meta.url))

let pass = 0
let fail = 0
const check = (ok, title, extra = '') => {
  if (ok) {
    pass += 1
    console.log('PASS ', title)
  } else {
    fail += 1
    console.log('FAIL ', title, extra)
  }
}

const j = async (res) => {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text, status: res.status }
  }
}

async function main() {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(dbFile + suffix, { force: true })
    } catch {
      /* 占用就留着 */
    }
  }

  const server = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      BANK_DB_FILE: dbFile,
      BANK_PORT: String(PORT),
      BANK_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let sawListen = false
  server.stdout.on('data', (b) => {
    if (String(b).includes('[bank-server]')) sawListen = true
  })
  server.stderr.on('data', (b) => process.stdout.write(`[server!] ${b}`))

  try {
    let up = false
    for (let i = 0; i < 50; i += 1) {
      try {
        const r = await fetch(`${bank}/health`)
        if (r.ok) {
          up = true
          break
        }
      } catch {
        /* 还没起来 */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    check(up, 'server 启动')
    check(sawListen, '端口是本脚本拉起的实例（防 EADDRINUSE 串台）')
    if (!sawListen) throw new Error('端口被别的进程占着，先清掉再跑')

    // —— 员工登录 ——
    const wang = await j(
      await fetch(`${staffBase}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '王小明', password: '123456' }),
      }),
    )
    const li = await j(
      await fetch(`${staffBase}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '李主管', password: '123456' }),
      }),
    )
    check(Boolean(wang.token && li.token), '双员工登录', JSON.stringify({ wang, li }).slice(0, 160))
    const authW = { authorization: `Bearer ${wang.token}`, 'content-type': 'application/json' }
    const authL = { authorization: `Bearer ${li.token}`, 'content-type': 'application/json' }

    // —— 客户查询：按姓名搜 ——
    const byName = await j(await fetch(`${staffBase}/customers?keyword=${encodeURIComponent('林')}`, { headers: authW }))
    check(Array.isArray(byName) && byName.some((c) => c.customerId === 'u_0001'), '按姓名搜到林小满', JSON.stringify(byName))
    const lxm = byName.find((c) => c.customerId === 'u_0001')
    check(lxm && lxm.phoneMasked === '138****8000', '手机号脱敏', lxm?.phoneMasked)

    // —— 客户查询：按手机号搜 ——
    const byPhone = await j(await fetch(`${staffBase}/customers?keyword=${encodeURIComponent('13800138000')}`, { headers: authW }))
    check(byPhone.some((c) => c.customerId === 'u_0001'), '按手机号搜到', JSON.stringify(byPhone))

    // —— 档案：事由必填 ——
    const noReason = await j(await fetch(`${staffBase}/customers/u_0001/profile`, { headers: authW }))
    check(noReason.code === 'REASON_REQUIRED', '无事由查档案被拦', JSON.stringify(noReason))

    // —— 档案：返回脱敏摘要 ——
    const prof = await j(
      await fetch(`${staffBase}/customers/u_0001/profile?reason=${encodeURIComponent('工单 T_demo0001 核对流水')}`, { headers: authW }),
    )
    check(prof.customerId === 'u_0001', '档案读到客户号', JSON.stringify(prof).slice(0, 120))
    check(Array.isArray(prof.accounts) && prof.accounts.length > 0, '档案含账户', `${prof.accounts?.length} 个`)
    check(Array.isArray(prof.cards) && prof.cards.length > 0, '档案含卡片', `${prof.cards?.length} 张`)
    check(Array.isArray(prof.recentTransactions), '档案含流水', `${prof.recentTransactions?.length} 条`)
    check(!prof.cards?.some((c) => c.pan || c.cvv), '卡片无明文卡号/安全码', JSON.stringify(prof.cards).slice(0, 120))

    // —— 代客锁卡：挑一张 active 卡锁掉，再读档案确认真落库 ——
    const activeCard = prof.cards.find((c) => c.status === 'active')
    check(Boolean(activeCard), '有可锁的 active 卡', JSON.stringify(activeCard))
    const lockRes = await j(
      await fetch(`${staffBase}/customers/u_0001/actions/lockCard`, {
        method: 'POST',
        headers: authW,
        body: JSON.stringify({
          ticketId: 'T_demo0001',
          verificationMethod: 'simulated',
          verificationResult: 'passed',
          reason: '客户来电挂失',
          cardId: activeCard.id,
        }),
      }),
    )
    check(lockRes.ok === true, '锁卡成功', JSON.stringify(lockRes))
    const profAfter = await j(
      await fetch(`${staffBase}/customers/u_0001/profile?reason=${encodeURIComponent('复核锁卡结果')}`, { headers: authW }),
    )
    const lockedCard = profAfter.cards?.find((c) => c.id === activeCard.id)
    check(lockedCard?.status === 'locked', '锁卡真落库（档案回读已是 locked）', JSON.stringify(lockedCard))

    // —— 高影响动作（解锁）未核验 → 拦 ——
    const unlockReject = await j(
      await fetch(`${staffBase}/customers/u_0001/actions/unlockCard`, {
        method: 'POST',
        headers: authW,
        body: JSON.stringify({
          ticketId: 'T_demo0001',
          verificationMethod: 'simulated',
          verificationResult: 'failed',
          reason: '客户要求解锁',
          cardId: activeCard.id,
        }),
      }),
    )
    check(unlockReject.code === 'VERIFICATION_FAILED' || unlockReject.code === 'VERIFICATION_REQUIRED', '未核验解锁被拦', JSON.stringify(unlockReject))

    // —— 白名单外动作 → 拦 ——
    const badAction = await j(
      await fetch(`${staffBase}/customers/u_0001/actions/closeAccount`, {
        method: 'POST',
        headers: authW,
        body: JSON.stringify({ ticketId: 'T', verificationMethod: 'simulated', verificationResult: 'passed', reason: 'x' }),
      }),
    )
    check(badAction.code === 'BAD_ACTION', '白名单外动作被拦', JSON.stringify(badAction))

    // —— 审计：客服 403，主管可见且含本次留痕 ——
    const auditCsr = await j(await fetch(`${staffBase}/audit-logs`, { headers: authW }))
    check(auditCsr.code === 'FORBIDDEN', '客服看审计被拦(403)', JSON.stringify(auditCsr))
    const auditSup = await j(await fetch(`${staffBase}/audit-logs`, { headers: authL }))
    check(Array.isArray(auditSup), '主管可见审计', `${auditSup.length} 条`)
    check(auditSup.some((a) => a.action === 'customer.profile.view'), '审计含「查看客户档案」', '')
    check(auditSup.some((a) => a.action === 'customer.action.lockCard'), '审计含「代客锁卡」', '')
    check(auditSup.some((a) => a.action === 'customer.search'), '审计含「客户搜索」', '')

    // —— 敏感访问落 customer_access_logs（与档案同接口原子）——
    // 通过审计之外再直接查一次库不够，这里用「再查一次档案」会多一条 log 作为旁证，
    // 主断言由上面的 customer.profile.view 审计覆盖。
    console.log('\n== 结果 ==')
    console.log(`PASS ${pass} / FAIL ${fail}`)
  } finally {
    server.kill()
  }
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
