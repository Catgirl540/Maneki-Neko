/**
 * 赛题工程的工具桥接：bank-agent.mjs 的 prepare/execute 委托入口。
 *
 * bank-agent.mjs 只加一行 import + 展开两个 Set + default 分支换委托，
 * 业务逻辑全在这层。工具 schema 在 framework/packages/bank-demo/src/challenge-tools.ts
 * （tsc rootDir 逼它放包内），白名单在 framework/profiles/luckycat/*.patch.yml。
 *
 * 返回值形状与 prepareTransfer 一致：{ path, body, fields, preview, method }，
 * 落进 bank-agent.mjs 的 grants 后走完全一样的确认/密码/防重放流水线。
 */

import { resolvePayee, disambiguationHint } from './payee-resolve.mjs'
import { computeEffectiveRunAt, timeLines } from './scheduled.mjs'

/** 需要支付密码的赛题工具。 */
export const challengePasswordTools = ['bank_schedule_transfer', 'bank_create_invest_plan', 'bank_enroll_insurance']

/** 写操作（consequence 文案区分查询与提交）。 */
export const challengeWritable = ['bank_schedule_transfer', 'bank_cancel_scheduled', 'bank_create_invest_plan', 'bank_pause_invest_plan', 'bank_terminate_invest_plan', 'bank_create_savings_goal', 'bank_update_savings_goal', 'bank_delete_savings_goal', 'bank_set_savings_sweep', 'bank_update_cash_sweep', 'bank_enroll_insurance']

/** 演示缩时窗口（秒），与 scheduled-api.mjs 同源。 */
function demoSeconds() {
  const v = Number(process.env.BANK_SCHEDULER_DEMO_SECONDS ?? 20)
  return Number.isFinite(v) && v >= 0 ? v : 20
}

/**
 * prepare 委托：识别赛题工具并组装确认卡。
 *
 * @param {object} challenge  bank-agent 的 challenge 对象（含 toolName / arguments / sessionId / callId）
 * @param {object} helpers    bank-agent prepare() 的局部工具
 * @param {Function} helpers.get    GET 请求
 * @param {Function} helpers.post   POST 请求
 * @param {Function} helpers.bankError
 * @param {Function} helpers.field
 * @param {Function} helpers.text
 * @param {Function} helpers.amount
 * @param {Function} helpers.money
 * @returns {Promise<{ path: string, body?: object, fields: object[], preview?: object, method?: string } | null>}
 *   返回 null 表示不是赛题工具，让 bank-agent 抛「未支持的银行工具」
 */
export async function challengePrepare(challenge, helpers) {
  const { get, post, bankError, field, text, amount, money } = helpers
  const a = challenge.arguments ?? {}
  const enc = encodeURIComponent

  switch (challenge.toolName) {
    /* ── 收款人消歧 ─────────────────────────────────────────── */
    case 'bank_resolve_payee': {
      const query = text(a.query, '搜索内容')
      if (query.length > 100) throw bankError('搜索内容不超过 100 字')
      return {
        path: '/api/agent/challenge/payee/resolve',
        body: { query },
        fields: [field('搜索内容', query)],
      }
    }

    /* ── 定时转账 ───────────────────────────────────────────── */
    case 'bank_schedule_transfer': {
      const fromAccountId = text(a.fromAccountId, '付款账户编号')
      const payeeName = text(a.payeeName, '收款人姓名')
      const payeeAccountNo = text(a.payeeAccountNo, '收款账号')
      if (payeeAccountNo.length < 8) throw bankError('收款账号不完整，不能只用尾号')
      const payeeBankCode = text(a.payeeBankCode, '收款行代码')
      const payeeBankRegion = a.payeeBankRegion
      if (!['CN', 'HK'].includes(payeeBankRegion)) throw bankError('收款行地区必须为 CN 或 HK')
      const amountCents = amount(a.amountCents)
      const runAt = text(a.runAt, '计划执行时间')
      const runAtMs = Date.parse(runAt)
      if (!Number.isFinite(runAtMs)) throw bankError('计划执行时间不是合法日期')
      if (runAtMs <= Date.now()) throw bankError('计划执行时间必须是将来的时间')
      const memo = typeof a.memo === 'string' ? a.memo.trim() : ''

      // 双时间行：原定业务时间 + 演示缩时后的执行时间
      const { effectiveRunAt, demoCompressed } = computeEffectiveRunAt({
        runAt, now: Date.now(), demoSeconds: demoSeconds(),
      })
      const actionPreview = { runAt, effectiveRunAt, demoCompressed }

      // payload 是 TransferRequest 快照（不含 confirmedQuote）——
      // 执行时点由 submitTransfer 内部现查费率/余额，天然处理报价过期。
      const transferPayload = {
        fromAccountId,
        channel: 'bank',
        scope: payeeBankRegion === 'CN' ? 'domestic' : 'overseas',
        payeeName,
        amount: amountCents,
        memo: memo || '定时转账',
        payeeBankCode,
        payeeBankRegion,
        payeeAccountNo,
      }
      if (a.payeeCurrency !== undefined && a.payeeCurrency !== '') {
        if (!['CNY', 'HKD', 'USD'].includes(a.payeeCurrency)) throw bankError('收款币种必须为 CNY、HKD 或 USD')
        transferPayload.payeeCurrency = a.payeeCurrency
      }

      // 核对付款账户存在（只读，不改余额）
      await get(`/api/accounts/${enc(fromAccountId)}`)

      const fields = [
        field('收款人', payeeName, true),
        field('收款账号', `****${payeeAccountNo.slice(-4)}`),
        field('收款行', `${payeeBankCode} · ${payeeBankRegion}`),
        field('转账金额', money(amountCents), true),
        field('执行时间', runAt),
      ]
      if (demoCompressed) {
        fields.push(field('演示模式', `约 ${Math.round((Date.parse(effectiveRunAt) - Date.now()) / 1000)} 秒后执行（原定 ${runAt}）`))
      }
      if (memo) fields.push(field('备注', memo))

      return {
        path: '/api/agent/challenge/scheduled',
        body: {
          kind: 'transfer',
          title: `定时转账给 ${payeeName}`,
          runAt,
          transfer: transferPayload,
        },
        fields,
        preview: actionPreview,
      }
    }

    /* ── 查看定时动作 ───────────────────────────────────────── */
    case 'bank_list_scheduled': {
      return {
        path: '/api/agent/challenge/scheduled',
        fields: [field('查询内容', '本人已创建的定时动作（定时转账等）')],
      }
    }

    /* ── 取消定时动作 ───────────────────────────────────────── */
    case 'bank_cancel_scheduled': {
      const actionId = text(a.actionId, '定时动作编号')
      return {
        path: `/api/agent/challenge/scheduled/${enc(actionId)}/cancel`,
        body: { reason: typeof a.reason === 'string' ? a.reason.trim() : '用户取消' },
        fields: [field('定时动作编号', actionId, true), field('操作', '取消定时动作')],
      }
    }

    /* ── 理财产品结构化对比 ─────────────────────────────────── */
    case 'bank_wealth_compare': {
      const raw = typeof a.productCodes === 'string' ? a.productCodes.trim() : ''
      const productCodes = raw
        ? raw.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined
      if (productCodes && productCodes.length < 2) throw bankError('对比至少需要 2 个产品')
      return {
        path: '/api/agent/challenge/wealth/compare',
        body: productCodes ? { productCodes } : {},
        fields: [
          field('对比范围', productCodes ? productCodes.join('、') : '全部在售产品'),
          field('对比维度', '风险等级、期限、业绩比较基准、费率、波动率、起购金额'),
        ],
      }
    }

    /* ── 定投计划 ───────────────────────────────────────────── */
    case 'bank_list_invest_plans': {
      return {
        path: '/api/agent/challenge/invest/plans',
        fields: [field('查询内容', '本人已创建的定投计划')],
      }
    }

    case 'bank_create_invest_plan': {
      const productCode = text(a.productCode, '投资产品代码')
      const amountCents = amount(a.amountCents)
      const cycle = text(a.cycle, '定投周期')
      if (!['每周', '每两周'].includes(cycle) && !/^每月\s*\d{1,2}\s*日$/.test(cycle)) {
        throw bankError('定投周期须为「每周」「每两周」或「每月 N 日」（N 为 1-28）')
      }
      const accountId = text(a.accountId, '扣款账户编号')
      await get(`/api/accounts/${encodeURIComponent(accountId)}`)
      return {
        path: '/api/agent/challenge/invest/plans',
        body: { productCode, amountCents, cycle, accountId },
        fields: [
          field('投资产品', productCode, true),
          field('每期金额', money(amountCents), true),
          field('定投周期', cycle, true),
          field('扣款账户', accountId),
        ],
      }
    }

    case 'bank_pause_invest_plan': {
      const planId = text(a.planId, '定投计划编号')
      return {
        path: `/api/agent/challenge/invest/plans/${enc(planId)}/pause`,
        body: {},
        fields: [field('定投计划编号', planId, true), field('操作', '暂停定投')],
      }
    }

    case 'bank_terminate_invest_plan': {
      const planId = text(a.planId, '定投计划编号')
      return {
        path: `/api/agent/challenge/invest/plans/${enc(planId)}/terminate`,
        body: {},
        fields: [field('定投计划编号', planId, true), field('操作', '终止定投（不可恢复）')],
      }
    }

    /* ── 存钱目标 ───────────────────────────────────────────── */
    case 'bank_list_savings_goals': {
      return {
        path: '/api/agent/challenge/savings/goals',
        fields: [field('查询内容', '本人已创建的存钱目标')],
      }
    }

    case 'bank_create_savings_goal': {
      const name = text(a.name, '目标名称')
      const targetAmountCents = amount(a.targetAmountCents)
      const deadline = typeof a.deadline === 'string' && a.deadline.trim() ? a.deadline.trim() : undefined
      return {
        path: '/api/agent/challenge/savings/goals',
        body: { name, targetAmountCents, ...(deadline ? { deadline } : {}) },
        fields: [
          field('目标名称', name, true),
          field('目标金额', money(targetAmountCents), true),
          ...(deadline ? [field('目标日期', deadline)] : []),
        ],
      }
    }

    case 'bank_update_savings_goal': {
      const goalId = text(a.goalId, '存钱目标编号')
      const body = {}
      const fields = [field('目标编号', goalId, true)]
      if (typeof a.name === 'string' && a.name.trim()) { body.name = a.name.trim(); fields.push(field('新名称', body.name)) }
      if (a.targetAmountCents !== undefined && a.targetAmountCents !== '') {
        body.targetAmountCents = amount(a.targetAmountCents)
        fields.push(field('新目标金额', money(body.targetAmountCents)))
      }
      if (typeof a.deadline === 'string') {
        body.deadline = a.deadline === 'none' ? null : a.deadline.trim()
        fields.push(field('新目标日期', body.deadline ?? '无期限'))
      }
      return {
        path: `/api/agent/challenge/savings/goals/${enc(goalId)}`,
        body,
        fields,
      }
    }

    case 'bank_delete_savings_goal': {
      const goalId = text(a.goalId, '存钱目标编号')
      return {
        path: `/api/agent/challenge/savings/goals/${enc(goalId)}/delete`,
        body: {},
        fields: [field('目标编号', goalId, true), field('操作', '删除存钱目标')],
      }
    }

    case 'bank_set_savings_sweep': {
      const goalId = text(a.goalId, '存钱目标编号')
      const enabled = String(a.enabled) === 'true'
      const body = { enabled }
      const fields = [field('目标编号', goalId, true), field('自动归集', enabled ? '开启' : '关闭')]
      if (enabled) {
        body.amountCents = amount(a.amountCents)
        body.cycle = text(a.cycle, '归集周期')
        body.accountId = text(a.accountId, '扣款账户编号')
        fields.push(field('每期金额', money(body.amountCents), true))
        fields.push(field('归集周期', body.cycle, true))
        fields.push(field('扣款账户', body.accountId))
      }
      return {
        path: `/api/agent/challenge/savings/goals/${enc(goalId)}/sweep`,
        body,
        fields,
      }
    }

    /* ── 现金管理 ───────────────────────────────────────────── */
    case 'bank_get_cash_management': {
      return {
        path: '/api/agent/challenge/cash/management',
        fields: [field('查询内容', '现金管理账户状态与归集设置')],
      }
    }

    case 'bank_update_cash_sweep': {
      const enabled = String(a.enabled) === 'true'
      const body = { enabled }
      const fields = [field('自动归集', enabled ? '开启' : '关闭', true)]
      if (a.thresholdCents !== undefined && a.thresholdCents !== '') {
        body.thresholdCents = amount(a.thresholdCents)
        fields.push(field('保留金额', money(body.thresholdCents), true))
      }
      return {
        path: '/api/agent/challenge/cash/sweep',
        body,
        fields,
      }
    }

    /* ── 保险 ───────────────────────────────────────────────── */
    case 'bank_get_insurance': {
      return {
        path: '/api/agent/challenge/insurance',
        fields: [field('查询内容', '保险产品与已有保单')],
      }
    }

    case 'bank_enroll_insurance': {
      const productId = text(a.productId, '保险产品编号')
      const insuredName = text(a.insuredName, '被保人姓名')
      const healthRaw = text(a.healthAnswers, '健康告知答案')
      const answers = healthRaw.split(',').map((s) => s.trim().toLowerCase())
      if (answers.length !== 3) throw bankError('健康告知须回答 3 个问题，以逗号分隔')
      // 任一为「是」→ 拒绝投保并转人工
      if (answers.some((v) => v === 'yes' || v === '是' || v === 'true')) {
        throw bankError('健康告知中存在异常项，无法在线投保。请转人工客服（bank_request_human_support）咨询。', 400)
      }
      return {
        path: '/api/agent/challenge/insurance/enroll',
        body: { productId, insuredName, healthAnswers: healthRaw },
        fields: [
          field('保险产品', productId, true),
          field('被保人', insuredName, true),
          field('健康告知', '3 项均已告知，无异常', true),
          field('免责摘要', '投保前请仔细阅读保险条款。犹豫期后退保可能产生损失。本产品不保证续保。既往症及条款列明的除外责任不在保障范围内。', true),
          field('等待期', '重疾险 90 天 / 医疗险 30 天 / 意外险 0 天，具体以条款为准。等待期内出险不承担赔付责任。', true),
        ],
      }
    }

    default: return null
  }
}

/**
 * execute 前置钩子：对需要密码的赛题工具做执行时点再验。
 * approve() 已验过一次，这里是纵深防御——执行窗口内密码可能已被改。
 *
 * @param {object} input  { sessionId, callId, toolName, arguments }
 * @param {object} g      grant 对象（含 password / preview / body）
 * @param {object} hooks  { call, entry }
 */
export async function challengeExecuteBefore(input, g, hooks) {
  if (input.toolName === 'bank_schedule_transfer' && g.password) {
    await hooks.call(hooks.entry.bankToken, '/api/auth/payment-password/verify', { paymentPassword: g.password })
  }
  if (input.toolName === 'bank_create_invest_plan' && g.password) {
    // 深度防御：先验密码，再注入 body 给 createInvestPlan 用。
    // body 与 g.body 是同一引用（execute 未对本工具重建 body），
    // Object.assign 原地修改即对 call() 可见。
    await hooks.call(hooks.entry.bankToken, '/api/auth/payment-password/verify', { paymentPassword: g.password })
    Object.assign(g.body, { paymentPassword: g.password })
  }
}

/**
 * execute 后置钩子：Phase 1 无后处理，预留 Phase 2 的多步骤计划展开。
 */
export async function challengeExecuteAfter(_input, _g, _data) {
  // Phase 2: bank_create_plan 展开多条 scheduledActions 时在这里处理
}
