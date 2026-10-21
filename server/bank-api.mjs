// HTTP adapter for server-owned banking business rules. All mutations are committed as a single unit.
import { randomUUID } from 'node:crypto'
import { maskPhone } from './lib/format.mjs'

/** Deterministic sandbox status tags; no inferred risk score or credit decision. */
function riskTagsFor(profile) {
  const tags = []
  if (profile.transactions.some(row => row.pendingReason === 'inflight')) tags.push('大额转账关注')
  if (profile.cards.some(row => row.status === 'locked')) tags.push('有锁卡')
  return tags
}

/** 用来把 `routes.xxx(SENTINEL)` 里的参数位找出来，从而推出路径模板。 */
const SENTINEL = '\u0000ARG\u0000'

/**
 * 后端路由表：[HTTP 动词, `routes` 里的键, BankApi 方法, 造参数]
 *
 * 造参数签名：`(路径参数, 请求体, query) => 调用 BankApi 方法时展开的数组`。
 * 这份表是照着 `app/src/api/http.ts` 的 `createHttpApi` **逐条反过来写的**；
 * 漏了会被下面的完整性断言当场抓住，不会静默少一个接口。
 */
const ROUTES = [
  // —— 身份 ——
  ['POST', 'login', 'login', (id, b) => [b.phone, b.password, b.smsCode]],
  ['POST', 'register', 'register', (id, b) => [b]],
  ['POST', 'logout', 'logout', () => []],
  ['GET', 'profile', 'profile', () => []],

  // —— 账户与流水 ——
  ['GET', 'accounts', 'listAccounts', () => []],
  ['GET', 'account', 'getAccount', (id) => [id]],
  ['GET', 'transactions', 'listTransactions', (id, b, q) => [id, transactionQuery(q)]],
  ['GET', 'transactionsExport', 'exportTransactions', (id, b, q) => [id, exportQuery(q)]],
  ['GET', 'transaction', 'getTransaction', (id) => [id]],
  ['GET', 'receipt', 'getReceipt', (id) => [id]],
  ['POST', 'deposit', 'deposit', (id, b) => [id, b.amount, b.channel]],

  // —— 开户 ——
  ['POST', 'smsCode', 'sendSmsCode', (id, b) => [b.phone]],

  // —— 转账 ——
  ['GET', 'banks', 'listBanks', () => []],
  ['GET', 'receiving', 'getReceivingInfo', () => []],
  ['POST', 'fpsRegistration', 'registerFps', (id, b) => [b]],
  ['POST', 'cardBin', 'resolveCardBin', (id, b) => [b]],
  ['GET', 'payees', 'listPayees', () => []],
  ['DELETE', 'payee', 'deletePayee', (id) => [id]],
  ['POST', 'fpsResolve', 'resolveFps', (id, b) => [b.idType, b.fpsId]],
  ['POST', 'transferQuote', 'quoteTransfer', (id, b) => [b]],
  ['POST', 'transferRecipient', 'resolveTransferRecipient', (id, b) => [b]],
  ['POST', 'transfers', 'submitTransfer', (id, b) => [b]],
  ['POST', 'transferRecall', 'recallTransfer', (id) => [id]],

  // —— 银行卡 ——
  ['GET', 'cards', 'listCards', () => []],
  ['GET', 'cardProducts', 'listCardProducts', () => []],
  ['POST', 'cardOpen', 'openCard', (id, b) => [b]],
  ['POST', 'cardLock', 'setCardLock', (id, b) => [id, b.locked]],
  ['POST', 'cardReplace', 'replaceCard', (id, b) => [id, b]],
  ['POST', 'cardSecrets', 'revealCardSecrets', (id, b) => [id, b.paymentPassword]],
  ['PATCH', 'cardSettings', 'updateCardSettings', (id, b) => [id, b]],

  // —— 理财 ——
  ['GET', 'wealthProducts', 'listWealthProducts', () => []],
  ['GET', 'wealthProduct', 'getWealthProduct', (id) => [id]],
  ['GET', 'wealthOverview', 'getWealthOverview', () => []],
  ['POST', 'wealthAccountOpen', 'openWealthAccount', (id, b) => [b]],
  ['GET', 'wealthRiskQuestions', 'listRiskQuestions', () => []],
  ['POST', 'wealthRiskAssess', 'submitRiskAssessment', (id, b) => [b.answers]],
  ['POST', 'wealthSubscribe', 'subscribeWealth', (id, b) => [b]],
  ['POST', 'wealthRedeem', 'redeemWealth', (id, b) => [b]],

  // —— 财务管理 ——
  ['GET', 'spending', 'getSpending', (id, b, q) => [q.get('month') ?? undefined]],
  ['GET', 'cashFlow', 'getCashFlow', (id, b, q) => [q.get('days') === null ? undefined : Number(q.get('days'))]],
  ['GET', 'autoDebits', 'listAutoDebits', () => []],
  ['PATCH', 'autoDebit', 'setAutoDebitEnabled', (id, b) => [id, b.enabled]],

  // —— 安全中心 ——
  ['GET', 'security', 'getSecurityOverview', () => []],
  ['PATCH', 'securityRule', 'setSecurityRule', (id, b) => [id, b.enabled]],
  ['PATCH', 'changePhone', 'changePhone', (id, b) => [b]],
  ['POST', 'changePassword', 'changePassword', (id, b) => [b.oldPassword, b.newPassword]],
  ['POST', 'paymentPassword', 'changePaymentPassword', (id, b) => [b]],
  ['POST', 'verifyIdentity', 'verifyIdentity', (id, b) => [b.channel]],

  // —— 客服（固定话术那套；真 agent 走 /agent-api，不是这里）——
  ['GET', 'supportHistory', 'listSupportMessages', () => []],
  ['POST', 'supportChat', 'sendSupportMessage', (id, b) => [b.text]],
  ['POST', 'supportTickets', 'requestHumanSupport', (id, b) => [b]],
  ['GET', 'supportTickets', 'listSupportTickets', (id, b, q) => [Number(q.get('page') ?? 1)]],
  ['GET', 'supportTicket', 'getSupportTicket', id => [id]],
  ['POST', 'supportTicketMessages', 'replySupportTicket', (id, b) => [id, b]],

  // —— 账户域扩展：多币种划转 / 存钱计划 / 一次性卡号 ——
  ['POST', 'exchangeQuote', 'quoteExchange', (id, b) => [b]],
  ['POST', 'exchange', 'submitExchange', (id, b) => [b]],
  ['GET', 'savingsOverview', 'getSavingsOverview', () => []],
  ['POST', 'savingsGoals', 'createSavingsGoal', (id, b) => [b]],
  ['PATCH', 'savingsGoal', 'updateSavingsGoal', (id, b) => [id, b]],
  ['DELETE', 'savingsGoal', 'deleteSavingsGoal', (id) => [id]],
  ['PATCH', 'savingsRoundup', 'updateSavingsRoundup', (id, b) => [b]],
  ['POST', 'virtualCard', 'createVirtualCard', (id, b) => [id, b]],

  // —— 我的域扩展：邀请 / 会员 ——
  ['GET', 'invitations', 'getInvitations', () => []],
  ['GET', 'membership', 'getMembership', () => []],
  ['POST', 'membershipLoungePass', 'redeemLoungePass', () => []],

  // —— 工资与备用金 ——
  ['GET', 'salaryPlan', 'getSalaryPlan', () => []],
  ['PATCH', 'salaryPlan', 'updateSalary', (id, b) => [b]],
  ['GET', 'overdraft', 'getOverdraft', () => []],
  ['POST', 'overdraftActivate', 'activateOverdraft', (id, b) => [b.active]],

  // —— 借款与分期 ——
  ['GET', 'creditOverview', 'getCreditOverview', () => []],
  ['POST', 'creditApply', 'applyLoan', (id, b) => [b]],
  ['POST', 'creditInstallment', 'convertToInstallment', (id, b) => [id, b]],

  // —— 理财扩展：现金管理 / 投资与定投 / 保险 ——
  ['GET', 'cashManagement', 'getCashManagement', () => []],
  ['PATCH', 'cashManagementSweep', 'updateCashSweep', (id, b) => [b]],
  ['GET', 'investments', 'getInvestments', () => []],
  ['POST', 'investPlan', 'createInvestPlan', (id, b) => [b]],
  ['PATCH', 'investPlanStatus', 'updateInvestPlan', (id, b) => [id, b]],
  ['GET', 'insurance', 'getInsurance', () => []],
  ['POST', 'insuranceEnroll', 'enrollInsurance', (id, b) => [b]],
]

/**
 * 日期与方向参数在这里校验：静默忽略非法值会让筛选条件"看起来生效了"
 * 却返回全量流水，对账时最难发现。
 */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function queryError(message, code) {
  return Object.assign(new Error(message), { status: 400, code })
}

/** `YYYY-MM-DD` 且是真实存在的日期（拒绝 2026-02-31 这类）。 */
function dayParam(q, key) {
  const raw = q.get(key)
  if (raw === null || raw === '') return undefined
  if (!DAY_PATTERN.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00`))) {
    throw queryError(`${key} 须为 YYYY-MM-DD`, 'INVALID_DATE')
  }
  const parsed = new Date(`${raw}T00:00:00`)
  const [year, month, day] = raw.split('-').map(Number)
  if (parsed.getFullYear() !== year || parsed.getMonth() + 1 !== month || parsed.getDate() !== day) {
    throw queryError(`${key} 须为 YYYY-MM-DD`, 'INVALID_DATE')
  }
  return raw
}

function directionParam(q) {
  const raw = q.get('direction')
  if (raw === null || raw === '' || raw === 'all') return undefined
  if (raw !== 'in' && raw !== 'out') throw queryError('direction 只能是 in 或 out', 'INVALID_DIRECTION')
  return raw
}

/** 与 http.ts 的 `listTransactions` 拼参数保持一致（`size` 不是 `pageSize`）。 */
function transactionQuery(q) {
  const out = {}
  if (q.get('page') !== null) out.page = Number(q.get('page'))
  if (q.get('size') !== null) out.size = Number(q.get('size'))
  const currency = q.get('currency')
  if (currency !== null) out.currency = currency
  const category = q.get('category')
  if (category !== null && category !== 'all') out.category = category
  const keyword = q.get('keyword')
  if (keyword !== null) out.keyword = keyword
  const direction = directionParam(q)
  if (direction !== undefined) out.direction = direction
  const from = dayParam(q, 'from')
  if (from !== undefined) out.from = from
  const to = dayParam(q, 'to')
  if (to !== undefined) out.to = to
  return out
}

function exportQuery(q) {
  const out = {}
  for (const key of ['from', 'to']) {
    const day = dayParam(q, key)
    if (day !== undefined) out[key] = day
  }
  const keyword = q.get('keyword')
  if (keyword !== null) out.keyword = keyword
  const currency = q.get('currency')
  if (currency !== null) out.currency = currency
  const category = q.get('category')
  if (category !== null && category !== 'all') out.category = category
  const direction = directionParam(q)
  if (direction !== undefined) out.direction = direction
  return out
}

/**
 * 把 `window.localStorage` 垫成"内存 + 落文件"的实现。
 *
 * 必须在**动态 import mock 之前**装好——`db.ts` 在模块顶层就会去读。
 */
function installBrowserShim(_unused, storageAdapter) {
  const memory = new Map()
  globalThis.window = { localStorage: storageAdapter, sessionStorage: {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key), clear: () => memory.clear(),
  } }
}

function compilePatterns(routes) {
  const staticOnes = []
  const parametric = []
  for (const [name, build] of Object.entries(routes)) {
    const sample = build(SENTINEL)
    const at = sample.indexOf(SENTINEL)
    if (at < 0) staticOnes.push({ name, prefix: sample })
    else {
      parametric.push({
        name,
        prefix: sample.slice(0, at),
        suffix: sample.slice(at + SENTINEL.length),
      })
    }
  }
  // **按字面量长度从长到短**。"具体度"必须排序，不能靠 routes 的书写顺序：
  // `/api/accounts/{id}` 与 `/api/accounts/{id}/transactions` 的 prefix 相同，
  // 若前者先匹配，后者会被整段当成 id 吞掉（实测踩到：
  // `/api/accounts/acc_0001/transactions` 回 "账户不存在"）。
  parametric.sort(
    (a, b) => b.prefix.length + b.suffix.length - (a.prefix.length + a.suffix.length),
  )
  return { staticOnes, parametric }
}

/**
 * 匹配路径。
 *
 * **静态路由必须优先于带参数的路由**，否则固定路径可能被
 * `/api/accounts/{id}` 抢走，所以这里分两轮匹配，不能靠顺序碰运气。
 */
function matchPath(patterns, pathname) {
  for (const p of patterns.staticOnes) {
    if (pathname === p.prefix) return { name: p.name, arg: undefined }
  }
  for (const p of patterns.parametric) {
    if (pathname.length < p.prefix.length + p.suffix.length) continue
    if (!pathname.startsWith(p.prefix)) continue
    if (p.suffix !== '' && !pathname.endsWith(p.suffix)) continue
    const raw = pathname.slice(p.prefix.length, pathname.length - p.suffix.length)
    return { name: p.name, arg: decodeURIComponent(raw) }
  }
  return null
}

async function readBody(req, limitBytes = 192 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) throw Object.assign(new Error('请求体过大'), { status: 413, code: 'PAYLOAD_TOO_LARGE' })
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch {
    throw Object.assign(new Error('请求体必须是合法 JSON 对象'), { status: 400, code: 'INVALID_JSON' })
  }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload ?? null), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    // 与桥接其余接口口径一致（演示服务只给本机/自家页面用，不带 cookie）
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  res.end(body)
}

export async function createBankApi({
  auth,
  storage,
  reviewThreshold,
  holdWindowMs,
  onTransferHeld,
  onHoldClosed,
  security,
  database,
  classify: classifyFn,
} = {}) {
  if (!storage || !database || !auth || !security) throw new Error('Bank API requires database, authentication and security gateway')
  installBrowserShim(undefined, storage)
  const [mockModule, contractModule, dbModule] = await Promise.all([
    import('./domain/index.mjs'), import('./api/contract.mjs'), import('./domain/state.mjs'),
  ])
  const {
    createBankBusinessApi,
    appendStaffNotice,
    getHeldTransfer: mockGetHeldTransfer,
    settleHeldTransfer: mockSettleHeldTransfer,
    settleExpiredHolds: mockSettleExpiredHolds,
    settleClearingTransactions: mockSettleClearing,
  } = mockModule
  const { routes, ApiError } = contractModule
  const { findProfileByPhone, findProfileByUserId, listAllProfiles, activateDb, ledgerBalances, findBalance } = dbModule
  await storage.beginUnitOfWork()
  try { dbModule.loadDb(); await storage.commitUnitOfWork() }
  catch (error) { await storage.rollbackUnitOfWork(); throw error }

  const api = createBankBusinessApi(
    { reviewThreshold, holdWindowMs: holdWindowMs ?? 5 * 60_000, security, classify: classifyFn },
  )
  // reviewThreshold 允许是函数：mock 内部每笔转账现读，员工端改完立刻生效。
  const patterns = compilePatterns(routes)
  // mock 原本是单标签页内存对象。HTTP 桥接会同时服务多个用户，
  // 所以请求先按 bearer token 切到对应档案，并串行执行以避免切档串号。
  let requestQueue = Promise.resolve()
  const exclusive = (work, { requestId = randomUUID() } = {}) => {
    const next = requestQueue.then(async () => {
      await storage.beginUnitOfWork({ requestId })
      dbModule.discardCache()
      try {
        const value = await work()
        await storage.commitUnitOfWork()
        return value
      } catch (error) {
        let paymentFailure
        if (error?.code === 'BAD_PAY_PASSWORD') {
          const profile = dbModule.loadDb()
          paymentFailure = { id: profile.user.id, failures: profile.payPasswordFailures }
        }
        await storage.rollbackUnitOfWork()
        dbModule.discardCache()
        // Security counters survive a rejected request; business state does not.
        await security.afterRollback(error)
        if (paymentFailure) {
          const profile = dbModule.findProfileByUserId(paymentFailure.id)
          if (profile) {
            dbModule.activateDb(profile)
            dbModule.loadDb().payPasswordFailures = paymentFailure.failures
            dbModule.persist()
            await storage.flush()
          }
        }
        throw error
      }
    })
    requestQueue = next.catch(() => {})
    return next
  }


  async function activateRequestProfile(req, routeName) {
    if (auth) {
      const phone = await auth.resolve(req, routeName)
      const profile = phone === null ? dbModule.loadDb() : findProfileByPhone(phone)
      if (profile === null) {
        throw Object.assign(new Error('用户不存在'), { status: 401, code: 'UNAUTHORIZED' })
      }
      activateDb(profile)
      return phone
    }
  }

  // ── 完整性断言：路由表与 BankApi 必须**双向**对齐 ─────────────────────
  // 漏一条的后果是"某个页面在真后端上才会 404"，所以宁可在启动时就炸。
  const implemented = new Set(ROUTES.map(([, , method]) => method))
  const onApi = new Set(Object.keys(api))
  const missing = [...onApi].filter((m) => !implemented.has(m))
  const extra = [...implemented].filter((m) => !onApi.has(m))
  if (missing.length > 0) throw new Error(`银行服务漏了这些 BankApi 方法：${missing.join(', ')}`)
  if (extra.length > 0) throw new Error(`路由表里有 BankApi 上不存在的方法：${extra.join(', ')}`)

  const known = new Set(patterns.staticOnes.map((p) => p.name).concat(patterns.parametric.map((p) => p.name)))
  const unknownRoute = ROUTES.map(([, name]) => name).filter((n) => !known.has(n))
  if (unknownRoute.length > 0) throw new Error(`路由表引用了 contract.ts 里没有的 routes 键：${unknownRoute.join(', ')}`)

  // ── 路由冲突自检：每条路由用自己的样例路径必须**匹配回自己** ──────────
  // 这条是通用的：以后 contract.ts 加了新路径（比如 `/api/x/{id}/y` 和
  // `/api/x/{id}` 撞了），启动时就会炸，而不是等到某个页面莫名 404。
  for (const [name, build] of Object.entries(routes)) {
    const sample = build('__probe__')
    const hit = matchPath(patterns, sample)
    if (hit === null || hit.name !== name) {
      throw new Error(
        `路由冲突：样例路径 ${sample} 匹配到了 ${hit === null ? '（无）' : hit.name}，` +
          `本应是 ${name}。检查路径模板的具体度排序。`,
      )
    }
  }

  const table = new Map()
  for (const [verb, routeName, bankMethod, makeArgs] of ROUTES) {
    const path = routes[routeName]()
    table.set(`${verb} ${path}`, { bankMethod, makeArgs, routeName })
  }

  /**
   * 处理一个请求。**返回 true 表示这个请求归银行服务管**（已响应），
   * 调用方据此决定要不要继续往下走 404。
   */
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false

    if (url.pathname === '/api/__demo/reset') {
      sendJson(res, 404, { message: '接口不存在', code: 'NOT_FOUND' })
      return true
    }

    const match = matchPath(patterns, url.pathname)
    if (match === null) {
      sendJson(res, 404, { message: `未知接口：${req.method} ${url.pathname}`, code: 'NOT_FOUND' })
      return true
    }

    const entry = table.get(`${req.method} ${routes[match.name]()}`)
    if (entry === undefined) {
      sendJson(res, 405, { message: `${url.pathname} 不支持 ${req.method}`, code: 'METHOD_NOT_ALLOWED' })
      return true
    }

    try {
      // Legacy portfolios are historical demo records, never commercial bank balances.
      const liveSafe = new Set(['login','register','logout','profile','sendSmsCode','verifyIdentity','changePhone','changePassword','changePaymentPassword','getSecurityOverview','listSupportMessages','sendSupportMessage','requestHumanSupport','listSupportTickets','getSupportTicket','replySupportTicket'])
      if (security.mode === 'live' && !liveSafe.has(entry.bankMethod)) throw Object.assign(new Error('合作银行尚未接入或尚未授权此项能力'), { status: 503, code: 'BANK_NOT_CONNECTED' })
      const body = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : {}
      if (entry.bankMethod === 'login') await security.run(req, () => security.loginAttempt(body.phone))
      const requestId = randomUUID()
      if (auth && entry.bankMethod === 'updateCardSettings' && body.dailyLimit !== undefined) {
        const allowed = [200_000, 500_000, 1_000_000, 5_000_000]
        if (!allowed.includes(body.dailyLimit)) {
          sendJson(res, 400, { message: '请选择有效的单日限额档位', code: 'INVALID_DAILY_LIMIT' })
          return true
        }
      }
      // 有意偏离前端 mock：退出登录**不**清空共享数据（否则一个人退出 = 所有人被重置）
      const result = await security.run(req, () => exclusive(async () => {
        const phone = await activateRequestProfile(req, entry.routeName)
        if (entry.bankMethod === 'logout') {
          if (auth) await auth.logout(req)
          return undefined
        }
        const replay = await security.idempotent(req, entry.bankMethod, body)
        if (replay?.hit) return replay.value
        await security.before(req, entry.bankMethod, body)
        let value
        try {
          value = await api[entry.bankMethod](...entry.makeArgs(match.arg, body, url.searchParams))
        } catch (error) {
          if (entry.bankMethod === 'login') error.loginOwner = typeof body.phone === 'string' && /^\d{11}$/.test(body.phone) ? findProfileByPhone(body.phone)?.user?.id ?? null : null
          throw error
        }
        if (auth?.security && entry.bankMethod === 'getSecurityOverview') return auth.security(req, value)
        // 大额转账进在途窗口：通知 server 侧建记录（清单 §9.4，只在真后端演示开启）
        if (entry.bankMethod === 'submitTransfer' && value?.pendingReason === 'inflight' && onTransferHeld) {
          await onTransferHeld({
            customerId: dbModule.loadDb().user.id,
            request: body,
            result: value,
          })
        }
        // 用户撤销：mock 内部已了结流水，这里补一刀关掉员工端的窗口记录
        if (entry.bankMethod === 'recallTransfer' && onHoldClosed) {
          await onHoldClosed({
            customerId: dbModule.loadDb().user.id,
            transactionId: match.arg,
            outcome: 'recalled',
            reason: '用户主动撤销',
          })
        }
        await security.idempotent(req, entry.bankMethod, body, value)
        await database.db.prepare('INSERT INTO bank_request_audit (id,owner_id,method,path,result,created_at) VALUES(?,?,?,?,?,?)').run(requestId, dbModule.loadDb().user.id, req.method, url.pathname, 'success', new Date().toISOString())
        if (entry.bankMethod === 'changePassword') await auth.revokeOthers(req)
        if (auth && entry.bankMethod === 'changePhone') {
          await auth.phoneChanged(phone, value.phone)
        }
        if (auth && (entry.bankMethod === 'login' || entry.bankMethod === 'register')) {
          return { ...value, token: await auth.issue(value.user, req) }
        }
        return value
      }, { requestId }))
      sendJson(res, 200, result === undefined ? { ok: true } : result)
    } catch (e) {
      if (ApiError !== undefined && e instanceof ApiError) {
        sendJson(res, e.status ?? 500, { message: e.message, code: e.code })
      } else {
        sendJson(res, e?.status ?? 500, {
          message: e?.status && e.status < 500 ? e.message : '银行服务暂时不可用',
          code: e?.code ?? 'INTERNAL_ERROR',
        })
      }
    }
    return true
  }

  return {
    handle,
    transferRequirements: (req) => exclusive(async () => {
      if (security.mode !== 'sandbox') throw Object.assign(new Error('合作银行尚未接入转账能力'), { status: 503, code: 'BANK_NOT_CONNECTED' })
      await activateRequestProfile(req, 'profile')
      return { confirmedQuoteVersion: 1, confirmedRecipient: true }
    }),
    wealthRequirements: (req) => exclusive(async () => {
      if (security.mode !== 'sandbox') throw Object.assign(new Error('合作银行尚未接入此产品能力'), { status: 503, code: 'BANK_NOT_CONNECTED' })
      await activateRequestProfile(req, "profile")
      return { riskAcknowledgementText: mockModule.RISK_ACKNOWLEDGEMENT }
    }),
    verifyPaymentPassword: (req, password) => exclusive(async () => {
      await activateRequestProfile(req, "profile")
      mockModule.verifyPayPassword(password)
    }),
    stats: () => ({ routes: ROUTES.length, staticRoutes: patterns.staticOnes.length }),

    /** 查在途中的转账指令（员工端/agent 提审用）。走同一队列，避免切档串号。 */
    publishSupportNotice(notice) {
      return exclusive(async () => {
        if (!findProfileByUserId(notice.customerId)) throw Object.assign(new Error('客户不存在'), { status: 404, code: 'NOT_FOUND' })
        return appendStaffNotice(notice)
      })
    },
    getHeldTransfer({ customerId, transactionId }) {
      return exclusive(async () => {
        if (security.mode !== 'sandbox') throw Object.assign(new Error('合作银行尚未接入转账查询'), { status: 503, code: 'BANK_NOT_CONNECTED' })
        // 切档只为读这份指令，读完还原——否则会把「当前登录档案」留成这个客户，
        // 未登录的短信/登录请求就会串档（验证码对不上 → SMS_NOT_SENT）。
        const before = dbModule.loadDb()
        const profile = findProfileByUserId(customerId)
        if (profile === null) return null
        try {
          activateDb(profile)
          return mockGetHeldTransfer(transactionId)
        } finally {
          activateDb(before)
        }
      })
    },

    /**
     * 了结在途转账（员工端窗口操作）。内部切到客户档案，
     * 到账走 submitTransfer 同一条业务路。了结后通知 server 关单。
     */
    settleHeldTransfer({ customerId, transactionId, outcome, reason, actorId, actorType }) {
      return exclusive(async () => {
        if (security.mode !== 'sandbox') throw Object.assign(new Error('合作银行尚未接入此结算能力'), { status: 503, code: 'BANK_NOT_CONNECTED' })
        const before = dbModule.loadDb()
        const profile = findProfileByUserId(customerId)
        if (profile === null) {
          throw Object.assign(new Error('客户不存在'), { status: 404, code: 'NOT_FOUND' })
        }
        try {
          activateDb(profile)
          const result = await mockSettleHeldTransfer(transactionId, outcome, reason)
          if (onHoldClosed) {
            await onHoldClosed({ customerId, transactionId, outcome, reason, actorId, actorType })
          }
          return result
        } finally {
          activateDb(before)
        }
      })
    },

    /**
     * 定时扫账（清单 §9.1 / §9.2）：
     * - 到点的在途指令自动到账（没人拦 = 默认放行）
     * - 模拟清算单翻 success，含孤儿 pending 兜底（钱已扣，绝不许停在 pending）
     * 跨用户逐档案切换——每个档案是独立台账，只扫当前档会漏掉别人的到期转账。
     * 返回本次自动到账的笔数。
     */
    tickHolds() {
      return exclusive(async () => {
        if (security.mode !== 'sandbox') throw Object.assign(new Error('合作银行尚未接入此结算能力'), { status: 503, code: 'BANK_NOT_CONNECTED' })
        // 记录扫描前的当前档案，扫完还原。
        // listAllProfiles() 以「当前档案」开头，若扫完不还原，当前档会随每次扫描
        // 在多个客户之间来回翻转；未登录的短信/登录请求正读这个当前档，
        // 一旦翻转就串档（fresh 库上表现为验证码对不上 → SMS_NOT_SENT）。
        const before = dbModule.loadDb()
        const closed = []
        for (const profile of listAllProfiles()) {
          activateDb(profile)
          const ids = await mockSettleExpiredHolds()
          for (const item of ids) {
            closed.push({ customerId: profile.user.id, ...item })
          }
          // 清算单只改状态、不动资金，也没有员工端窗口要关，
          // 所以不进 closed —— 别让 onHoldClosed 误以为是拦截窗口了结。
          mockSettleClearing()
        }
        activateDb(before)
        if (onHoldClosed) {
          for (const item of closed) {
            await onHoldClosed({ ...item, reason: item.reason ?? '窗口到点，自动到账' })
          }
        }
        return closed.length
      })
    },

    /** 员工端客户查询：跨档案按姓名/手机号/客户 id 搜，返回脱敏摘要（清单 §6）。 */
    searchCustomers(keyword) {
      return exclusive(async () => {
        const kw = String(keyword ?? '').trim().toLowerCase()
        const out = []
        for (const profile of listAllProfiles()) {
          const { id, name, phone } = profile.user
          if (kw && !`${name} ${phone} ${id}`.toLowerCase().includes(kw)) continue
          out.push({
            customerId: id,
            name,
            phoneMasked: maskPhone(phone),
            riskTags: riskTagsFor(profile),
          })
        }
        return out
      })
    },

    /** 员工端客户 360：读账户/卡/最近流水摘要（脱敏，不碰支付密码/卡安全码）。 */
    getCustomerProfile(customerId) {
      return exclusive(async () => {
        if (security.mode !== 'sandbox') throw Object.assign(new Error('合作银行尚未接入客户资金查询'), { status: 503, code: 'BANK_NOT_CONNECTED' })
        const profile = findProfileByUserId(customerId)
        if (profile === null) {
          throw Object.assign(new Error('客户不存在'), { status: 404, code: 'NOT_FOUND' })
        }
        const txs = [...profile.transactions]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 20)
        return {
          customerId: profile.user.id,
          name: profile.user.name,
          phoneMasked: maskPhone(profile.user.phone),
          accounts: profile.accounts.map((a) => ({ id: a.id, accountNo: a.accountNo, label: a.label, currency: a.currency, balance: a.balance, available: a.available, currencyBalances: ledgerBalances(profile).map(row => ({ id: row.id, currency: row.currency, balance: row.balance, available: row.available })) })),
          cards: profile.cards.map((c) => ({ id: c.id, last4: c.last4, status: c.status, dailyLimit: c.dailyLimit, onlinePayment: c.onlinePayment, overseasPayment: c.overseasPayment })),
          autoDebits: (profile.autoDebits ?? []).map((a) => ({
            id: a.id,
            merchant: a.merchant,
            amount: a.amount,
            cycle: a.cycle,
            enabled: a.enabled,
          })),
          recentTransactions: txs.map((t) => ({
            id: t.id,
            amount: t.signedAmount,
            currency: findBalance(profile, t.accountId)?.currency ?? t.detail?.settleCurrency,
            counterparty: t.counterparty,
            status: t.status,
            ...(t.pendingReason ? { pendingReason: t.pendingReason } : {}),
            createdAt: t.createdAt,
          })),
        }
      })
    },

    /**
     * 员工端代客办理：切到客户档案，复用客户端既有卡/代扣业务规则（清单 §2 P1）。
     * 不复制校验逻辑 —— 锁卡联动（onlinePayment/overseasPayment 一并关）由 mock 自己保证。
     */
    performCustomerAction({ customerId, action, payload }) {
      return exclusive(async () => {
        if (security.mode !== 'sandbox') throw Object.assign(new Error('合作银行尚未接入此代客办理能力'), { status: 503, code: 'BANK_NOT_CONNECTED' })
        const before = dbModule.loadDb()
        const profile = findProfileByUserId(customerId)
        if (profile === null) {
          throw Object.assign(new Error('客户不存在'), { status: 404, code: 'NOT_FOUND' })
        }
        try {
          activateDb(profile)
          switch (action) {
            case 'lockCard':
              return await api.setCardLock(payload.cardId, true)
            case 'unlockCard':
              return await api.setCardLock(payload.cardId, false)
            case 'updateCardSettings':
              return await api.updateCardSettings(payload.cardId, payload.patch)
            case 'patchAutodebit':
              return await api.setAutoDebitEnabled(payload.autoDebitId, payload.enabled)
            default:
              throw Object.assign(new Error('不支持的代客动作'), { status: 400, code: 'BAD_ACTION' })
          }
        } finally {
          activateDb(before)
        }
      })
    },
  }
}
