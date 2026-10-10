/**
 * 大额转账「延迟到账 + 拦截窗口」全链冒烟（清单 §9）
 * 用法：node transfer-hold-smoke.mjs
 * 全程 Node fetch（curl + 中文 = GBK 污染，不用 curl）。
 *
 * 覆盖：小额不进窗口 / 大额冻结可用余额 / 用户撤销 / 员工拦截（枚举理由）/
 *       立即到账 / 窗口到点自动到账 / 角色与重复处置校验 / 审计留痕
 */
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const PORT = 8711
const bank = `http://127.0.0.1:${PORT}`
const staffBase = `${bank}/staff-api`
const dbFile = join(tmpdir(), 'transfer-hold-smoke.sqlite')
/** 演示/冒烟用短窗口：5 秒够触发自动到账，又不至于把脚本拖太长 */
const HOLD_SECONDS = '5'

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
      /* 占用就留着，后面断言会炸出来 */
    }
  }

  const server = spawn(
    process.execPath,
    ['D:/Github/maneki-neko/Maneki-Neko/server/index.mjs'],
    {
      env: {
        ...process.env,
        BANK_DB_FILE: dbFile,
        BANK_PORT: String(PORT),
        BANK_HOST: '127.0.0.1',
        BANK_TRANSFER_REVIEW_CENTS: '500000',
        BANK_TRANSFER_HOLD_SECONDS: HOLD_SECONDS,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let sawListen = false
  server.stdout.on('data', (b) => {
    process.stdout.write(`[server] ${b}`)
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

    // —— 客户登录（林小满） ——
    const sms = await j(
      await fetch(`${bank}/api/auth/sms-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '13800138000' }),
      }),
    )
    check(Boolean(sms.demoCode), '取验证码', JSON.stringify(sms))
    const login = await j(
      await fetch(`${bank}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '13800138000', password: '123456', smsCode: sms.demoCode }),
      }),
    )
    check(Boolean(login.token), '客户登录', JSON.stringify(login).slice(0, 200))
    const cus = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' }

    const readAcc = async () => {
      const accounts = await j(await fetch(`${bank}/api/accounts`, { headers: cus }))
      return (accounts.accounts ?? accounts)[0]
    }
    const acc = await readAcc()
    check(Boolean(acc?.id), '读到账户', JSON.stringify(acc).slice(0, 160))
    const balanceStart = acc.balance
    const availableStart = acc.available ?? acc.balance

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
    check(wang.token && li.token, '双员工登录', JSON.stringify({ wang, li }).slice(0, 160))
    const authW = { authorization: `Bearer ${wang.token}`, 'content-type': 'application/json' }
    const authL = { authorization: `Bearer ${li.token}`, 'content-type': 'application/json' }

    const mkTransfer = async (amount, payeeName, memo) =>
      j(
        await fetch(`${bank}/api/transfers`, {
          method: 'POST',
          headers: cus,
          body: JSON.stringify({
            fromAccountId: acc.id,
            channel: 'bank',
            scope: 'domestic',
            payeeName,
            payeeAccountNo: '6222021234567890',
            amount,
            memo,
          }),
        }),
      )

    const findPendingFor = async (transactionId) => {
      const list = await j(await fetch(`${staffBase}/approvals`, { headers: authW }))
      const rows = list.approvals ?? list
      return rows.find((a) => a.payload?.transactionId === transactionId && a.status === 'pending')
    }

    // ── 场景 A：小额（对照组，不该进在途窗口） ──
    const small = await mkTransfer(10_000, '苏晚', '下午茶')
    check(small.pendingReason !== 'inflight' && Boolean(small.transactionId), '小额不进在途窗口', JSON.stringify(small))

    // ── 场景 B：大额 → 在途（冻结可用余额）→ 用户撤销 ──
    const held1 = await mkTransfer(600_000, '梁乐怡', '大额货款')
    check(held1.pendingReason === 'inflight' && held1.settlementStatus === 'pending', '大额进在途', JSON.stringify(held1))
    check(Boolean(held1.holdUntil), '返回窗口截止时刻', JSON.stringify(held1))
    check(Boolean(held1.transactionId), '拿到在途指令号', JSON.stringify(held1))

    const afterHold = await readAcc()
    check(afterHold.balance === balanceStart - 10_000, '在途不动余额（本金只冻可用）',
      `${afterHold.balance} vs ${balanceStart - 10_000}`)
    check(afterHold.available === availableStart - 10_000 - 600_000, '在途冻结可用余额',
      `${afterHold.available} vs ${availableStart - 10_000 - 600_000}`)

    const a1 = await findPendingFor(held1.transactionId)
    check(Boolean(a1), '自动生成处置单', JSON.stringify(a1 ?? {}).slice(0, 240))
    check(a1?.riskSummary?.includes('自动到账'), '风险摘要写明自动到账', a1?.riskSummary)
    check(a1?.payload?.request?.amount === 600_000, '参数快照冻结金额', JSON.stringify(a1?.payload))
    check(Boolean(a1?.payload?.holdUntil), '快照里冻结窗口截止', JSON.stringify(a1?.payload))

    // 客服不能处置
    const csrDecide = await fetch(`${staffBase}/approvals/${a1.approvalId}/decide`, {
      method: 'POST',
      headers: authW,
      body: JSON.stringify({ decision: 'intercept', reasonCode: '疑似诈骗' }),
    })
    check(csrDecide.status === 403, '客服处置 403', String(csrDecide.status))

    // transfer 类不接受 approved/rejected
    const badDecision = await fetch(`${staffBase}/approvals/${a1.approvalId}/decide`, {
      method: 'POST',
      headers: authL,
      body: JSON.stringify({ decision: 'approved' }),
    })
    check(badDecision.status === 400, '转账单拒收 approved', String(badDecision.status))

    // 用户撤销（§9.3）
    const recall = await j(
      await fetch(`${bank}/api/transfers/${held1.transactionId}/recall`, {
        method: 'POST',
        headers: cus,
        body: JSON.stringify({}),
      }),
    )
    check(recall.status === 'failed' || recall.status === 'recalled', '撤销返回状态', JSON.stringify(recall))
    check(String(recall.memo ?? '').includes('撤销'), '撤销备注', String(recall.memo))

    const afterRecall = await readAcc()
    check(afterRecall.available === availableStart - 10_000, '撤销解冻可用',
      `${afterRecall.available} vs ${availableStart - 10_000}`)
    check(afterRecall.balance === balanceStart - 10_000, '撤销不动余额', `${afterRecall.balance}`)

    // 撤销后处置单应被关掉
    const a1After = await findPendingFor(held1.transactionId)
    check(!a1After, '撤销后处置单已关闭', JSON.stringify(a1After))
    const listAfterRecall = await j(await fetch(`${staffBase}/approvals`, { headers: authW }))
    const a1Closed = (listAfterRecall.approvals ?? listAfterRecall).find(
      (a) => a.payload?.transactionId === held1.transactionId,
    )
    check(a1Closed?.status === 'recalled', '处置单标 recalled', JSON.stringify(a1Closed))

    // ── 场景 C：大额 → 员工拦截（枚举理由） ──
    const held2 = await mkTransfer(700_000, '苏晚', '装修款')
    check(held2.pendingReason === 'inflight', '第二笔在途', JSON.stringify(held2))
    const a2 = await findPendingFor(held2.transactionId)
    check(Boolean(a2), '第二笔处置单', JSON.stringify(a2 ?? {}).slice(0, 200))
    if (!a2) throw new Error('第二笔处置单缺失')

    // 拦截不给理由 → 400
    const noReason = await fetch(`${staffBase}/approvals/${a2.approvalId}/decide`, {
      method: 'POST',
      headers: authL,
      body: JSON.stringify({ decision: 'intercept' }),
    })
    check(noReason.status === 400, '拦截不给理由 400', String(noReason.status))

    // 自由文本理由 → 400（只收枚举）
    const freeText = await fetch(`${staffBase}/approvals/${a2.approvalId}/decide`, {
      method: 'POST',
      headers: authL,
      body: JSON.stringify({ decision: 'intercept', reasonCode: '看着不爽' }),
    })
    check(freeText.status === 400, '自由文本理由 400', String(freeText.status))

    const intercept = await j(
      await fetch(`${staffBase}/approvals/${a2.approvalId}/decide`, {
        method: 'POST',
        headers: authL,
        body: JSON.stringify({ decision: 'intercept', reasonCode: '疑似诈骗', reasonDetail: '客户称本人未发起' }),
      }),
    )
    check(intercept.status === 'intercepted', '主管拦截', JSON.stringify(intercept))
    check(intercept.executionStatus === 'failed', '拦截执行态=failed（指令从未执行）', JSON.stringify(intercept))
    check(String(intercept.reason ?? '').includes('疑似诈骗'), '拦截理由落库', String(intercept.reason))

    const afterIntercept = await readAcc()
    check(afterIntercept.available === availableStart - 10_000, '拦截解冻可用',
      `${afterIntercept.available} vs ${availableStart - 10_000}`)
    check(afterIntercept.balance === balanceStart - 10_000, '拦截不动余额', `${afterIntercept.balance}`)

    // ── 场景 D：大额 → 主管立即到账（settle） ──
    const held3 = await mkTransfer(500_000, '苏晚', '货款立即到')
    check(held3.pendingReason === 'inflight', '第三笔在途', JSON.stringify(held3))
    const a3 = await findPendingFor(held3.transactionId)
    check(Boolean(a3), '第三笔处置单', JSON.stringify(a3 ?? {}).slice(0, 200))
    if (!a3) throw new Error('第三笔处置单缺失')

    const settle = await j(
      await fetch(`${staffBase}/approvals/${a3.approvalId}/decide`, {
        method: 'POST',
        headers: authL,
        body: JSON.stringify({ decision: 'settle' }),
      }),
    )
    check(settle.status === 'settled', '立即到账', JSON.stringify(settle))
    check(settle.executionStatus === 'succeeded', '执行成功', JSON.stringify(settle))

    const afterSettle = await readAcc()
    check(afterSettle.balance === balanceStart - 10_000 - 500_000, '到账后扣款',
      `${afterSettle.balance} vs ${balanceStart - 10_000 - 500_000}`)
    check(afterSettle.available === afterSettle.balance, '到账后可用=余额',
      `${afterSettle.available} vs ${afterSettle.balance}`)

    // 重复处置应 409
    const again = await fetch(`${staffBase}/approvals/${a3.approvalId}/decide`, {
      method: 'POST',
      headers: authL,
      body: JSON.stringify({ decision: 'intercept', reasonCode: '疑似诈骗' }),
    })
    check(again.status === 409, '重复处置 409', String(again.status))

    // ── 场景 E：大额 → 窗口到点自动到账（没人拦 = 默认放行） ──
    // 注意阈值是 ≥500000，400000 会走普通转账不进窗口
    const held4 = await mkTransfer(550_000, '苏晚', '等窗口到点')
    check(held4.pendingReason === 'inflight', '第四笔在途', JSON.stringify(held4))
    const a4 = await findPendingFor(held4.transactionId)
    check(Boolean(a4), '第四笔处置单', JSON.stringify(a4 ?? {}).slice(0, 200))

    // 等到窗口过期 + 扫账周期
    const waitMs = Number(HOLD_SECONDS) * 1000 + 2500
    console.log(`  … 等 ${waitMs}ms 窗口到点`)
    await new Promise((r) => setTimeout(r, waitMs))

    const afterAuto = await readAcc()
    check(afterAuto.balance === balanceStart - 10_000 - 500_000 - 550_000, '自动到账扣款',
      `${afterAuto.balance} vs ${balanceStart - 10_000 - 500_000 - 550_000}`)
    check(afterAuto.available === afterAuto.balance, '自动到账后可用=余额',
      `${afterAuto.available} vs ${afterAuto.balance}`)

    const listAfterAuto = await j(await fetch(`${staffBase}/approvals`, { headers: authW }))
    const a4After = (listAfterAuto.approvals ?? listAfterAuto).find(
      (a) => a.payload?.transactionId === held4.transactionId,
    )
    check(a4After?.status === 'settled', '自动到账处置单标 settled', JSON.stringify(a4After))
    check(a4After?.executionStatus === 'succeeded', '自动到账执行成功', JSON.stringify(a4After))

    // —— 审计里应有 approval.* 记录 ——
    const audit = await j(await fetch(`${staffBase}/audit-logs`, { headers: authL }))
    const logs = audit.logs ?? audit
    check(
      Array.isArray(logs) && logs.some((l) => String(l.action).startsWith('approval.')),
      '审计留痕 approval.*',
      JSON.stringify(logs).slice(0, 200),
    )

    console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
    process.exitCode = fail === 0 ? 0 : 1
  } finally {
    server.kill()
  }
}

main().catch((e) => {
  console.error('冒烟脚本异常：', e)
  process.exitCode = 1
})
