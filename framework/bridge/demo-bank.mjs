/**
 * 占位银行后端：把**前端那份 mock**挂到 HTTP 上。
 *
 * ## 为什么是"复用"而不是"再写一份"
 *
 * 银行数据（账户、流水、理财、卡片、安全中心…）原来只活在前端
 * `app/src/api/mock/` 里（65K 逻辑 + 63K 数据）。安卓端要显示这些页面，
 * 就得有数据。给安卓再抄一份 Kotlin 版必然与网页版漂开——同一笔流水两边
 * 余额不一样，是这种项目最典型的烂尾方式。
 *
 * 所以这里直接 **import 前端那份 TS**：一份数据、一处逻辑。代价是桥接进程
 * 要在 Node 里跑 TS（见下），好处是"改 mock 两边同时变"。
 *
 * `/api/*` 路径直接从 `app/src/api/contract.ts` 的 `routes` 推导，
 * 不另行维护一份路由清单。所以真后端上线时
 * 客户端只要换 `VITE_API_BASE_URL` / 安卓换 baseUrl，业务代码零改动。
 *
 * ## 怎么在 Node 里跑起前端 TS
 *
 * `tools/ts-resolve-hook.mjs` 用 Node 的 `registerHooks` + 应用自带的 typescript
 * 现场转译，并解析 `@/` 别名。它是**运行时注册**的（不是 `--import`），
 * 所以桥接的启动命令不用改：`node bridge/demo-server.mjs` 照旧。
 *
 * ## 浏览器 API 垫片
 *
 * mock 通过 `lib/storage.ts` 读写 `window.localStorage`。那个封装把调用都包在
 * try/catch 里，所以在 Node 上**不垫也不会崩**——但那样 `persist()` 是空操作，
 * 状态只活在模块级 cache 里，进程一重启就回到出厂数据。
 * 这里垫一个**文件兜底**的实现，让改过的余额、新加的收款人活过重启。
 *
 * ## 与前端 mock 的一处**有意偏离**
 *
 * 前端 mock 的 `logout()` 会 `resetDb()`（本地数据，退出即重置，合理）。
 * 放到服务端就成了"任何人退出登录 = 所有人的演示数据被清空"，所以这里
 * **把 logout 做成空操作**，重置改走显式的 `POST /api/__demo/reset`。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  ['POST', 'cardSpend', 'spendOnCard', (id, b) => [id, b]],
  ['POST', 'cardActivate', 'activateCard', (id, b) => [id, b.paymentPassword]],

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
  ['POST', 'savingsGoalSweep', 'setSavingsSweep', (id, b) => [id, b]],
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
  ['POST', 'investPlanPause', 'pauseInvestPlan', (id) => [id]],
  ['POST', 'investPlanTerminate', 'terminateInvestPlan', (id) => [id]],
  ['GET', 'insurance', 'getInsurance', () => []],
  ['POST', 'insuranceEnroll', 'enrollInsurance', (id, b) => [b]],
]

/** 与 http.ts 的 `listTransactions` 拼参数保持一致（`size` 不是 `pageSize`）。 */
function transactionQuery(q) {
  const out = {}
  if (q.get('page') !== null) out.page = Number(q.get('page'))
  if (q.get('size') !== null) out.size = Number(q.get('size'))
  const category = q.get('category')
  if (category !== null && category !== 'all') out.category = category
  const keyword = q.get('keyword')
  if (keyword !== null) out.keyword = keyword
  // 与 server/bank-api.mjs 的 transactionQuery 保持同一组筛选键。
  const currency = q.get('currency')
  if (currency !== null) out.currency = currency
  const direction = q.get('direction')
  if (direction !== null && direction !== 'all') out.direction = direction
  for (const key of ['from', 'to']) {
    const v = q.get(key)
    if (v !== null && v !== '') out[key] = v
  }
  return out
}

function exportQuery(q) {
  const out = {}
  for (const key of ['from', 'to', 'keyword']) {
    const v = q.get(key)
    if (v !== null) out[key] = v
  }
  const currency = q.get('currency')
  if (currency !== null) out.currency = currency
  const category = q.get('category')
  if (category !== null && category !== 'all') out.category = category
  const direction = q.get('direction')
  if (direction !== null && direction !== 'all') out.direction = direction
  return out
}

/**
 * 把 `window.localStorage` 垫成"内存 + 落文件"的实现。
 *
 * 必须在**动态 import mock 之前**装好——`db.ts` 在模块顶层就会去读。
 */
function installBrowserShim(stateFile, storageAdapter) {
  if (storageAdapter) {
    const memory = new Map()
    globalThis.window = {
      localStorage: storageAdapter,
      sessionStorage: {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => { memory.set(key, String(value)) },
        removeItem: (key) => { memory.delete(key) },
        clear: () => { memory.clear() },
      },
    }
    return { backing: { clear: () => storageAdapter.clear() }, flush: () => {} }
  }
  const backing = new Map()

  if (stateFile && existsSync(stateFile)) {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
      for (const [k, v] of Object.entries(saved)) backing.set(k, v)
    } catch (e) {
      // 坏了就当没有：宁可回到出厂演示数据，也不要让整个服务起不来
      console.warn(`[demo-bank] 状态文件读不动，按出厂数据启动：${e?.message}`)
    }
  }

  const flush = () => {
    if (!stateFile) return
    try {
      mkdirSync(dirname(stateFile), { recursive: true })
      writeFileSync(stateFile, JSON.stringify(Object.fromEntries(backing)))
    } catch (e) {
      console.warn(`[demo-bank] 状态写不进去：${e?.message}`)
    }
  }

  const makeStorage = () => ({
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => { backing.set(k, String(v)); flush() },
    removeItem: (k) => { backing.delete(k); flush() },
    clear: () => { backing.clear(); flush() },
  })

  const localStorage = makeStorage()
  globalThis.window = { localStorage, sessionStorage: makeStorage() }
  return { backing, flush }
}

/** 用哨兵值调一次路径构造器，把参数位切出来。 */
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

async function readBody(req, limitBytes = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload ?? null), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    // 与桥接其余接口口径一致（演示服务只给本机/自家页面用，不带 cookie）
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * 找"同时有 `tools/ts-resolve-hook.mjs` 与 `app/src/api/mock/index.ts` 的那一层"。
 *
 * **不能写死相对深度**：开发仓库里 `framework/bridge/` 往上两跳才是仓库根，
 * 而服务器上是把 `framework/*` 平铺到 `~/luckycat/` 的（`~/luckycat/bridge`、
 * `~/luckycat/app`、`~/luckycat/tools`），根就是 `~/luckycat` 自己。
 * 按固定跳数写，两种布局只能对一个——实测在服务器上就找错了地方。
 *
 * @param start - 从哪里开始往上找。
 * @returns 找到的目录；找不到返回 `null`。
 */
function findAssetRoot(start) {
  let dir = start
  for (let depth = 0; depth < 5; depth += 1) {
    if (
      existsSync(join(dir, 'tools/ts-resolve-hook.mjs')) &&
      existsSync(join(dir, 'app/src/api/mock/index.ts'))
    ) {
      return dir
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/**
 * 建占位后端。
 *
 * @param options.stateFile - 状态落盘路径；不传就纯内存（测试用）。
 * @param options.searchFrom - 从哪个目录开始向上找 app 源码与转译钩子。
 * @param options.auth - 可选的服务端会话适配器；不传时保留原演示桥接行为。
 * @param options.storage - 可选的 localStorage 适配器，供 SQLite 后端持久化。
 * @param options.reviewThreshold - 大额转账延迟到账阈值（整数分或取值函数）。
 *   传函数 = 阈值运行时可改，每笔转账现读（清单 §9.1）。传了才启用在途窗口
 *   （清单 §9）：≥ 阈值的转账先冻结、进窗口；不传 = 一律立即到账（浏览器 mock 同款）。
 * @param options.holdWindowMs - 在途窗口时长（毫秒），默认 5 分钟，演示可调小。
 * @param options.onTransferHeld - 转账进窗口时的回调（server 侧建拦截窗口记录）。
 * @param options.onHoldClosed - 窗口了结时的回调（到账/拦截/撤销，server 侧关单）。
 * @returns `{ handle, reset, stats, getHeldTransfer, settleHeldTransfer, tickHolds, searchCustomers, getCustomerProfile, performCustomerAction }`
 */

/** 手机号脱敏：`138****8000`（员工端客户查询用，清单 §6 敏感字段默认脱敏）。 */
function maskPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length < 7) return digits
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

/** 从档案里推几条可审计的风险标签（demo 级，只做两条确定性规则）。 */
function riskTagsFor(profile) {
  const tags = []
  if (profile.transactions.some((t) => t.pendingReason === 'inflight')) tags.push('大额转账关注')
  if (profile.cards.some((c) => c.status === 'locked')) tags.push('有锁卡')
  return tags
}

export async function createDemoBank({
  stateFile,
  searchFrom,
  auth,
  storage,
  reviewThreshold,
  holdWindowMs,
  onTransferHeld,
  onHoldClosed,
} = {}) {
  const start = searchFrom ?? fileURLToPath(new URL('../..', import.meta.url))
  const root = findAssetRoot(start)
  if (root === null) {
    throw new Error(
      `找不到 app 源码与转译钩子（从 ${start} 往上找了 5 层）。` +
        '占位银行后端需要 app/src/api/mock 与 tools/ts-resolve-hook.mjs 同时存在。',
    )
  }
  const hookPath = join(root, 'tools/ts-resolve-hook.mjs')
  const mockPath = join(root, 'app/src/api/mock/index.ts')
  const dbPath = join(root, 'app/src/api/mock/db.ts')
  const contractPath = join(root, 'app/src/api/contract.ts')

  const shim = installBrowserShim(stateFile, storage)

  // 运行时注册转译钩子：必须在 import .ts **之前**
  await import(pathToFileURL(hookPath).href)

  const [mockModule, contractModule, dbModule] = await Promise.all([
    import(pathToFileURL(mockPath).href),
    import(pathToFileURL(contractPath).href),
    // 出厂重置要用 db.ts 的 resetDb：它清的是那个模块级 cache，
    // 而 mock 与它共用同一个模块实例，所以 api 会立刻看到新数据。
    import(pathToFileURL(dbPath).href),
  ])
  const {
    createMockApi,
    getHeldTransfer: mockGetHeldTransfer,
    settleHeldTransfer: mockSettleHeldTransfer,
    settleExpiredHolds: mockSettleExpiredHolds,
    settleClearingTransactions: mockSettleClearing,
    appendStaffNotice,
  } = mockModule
  const { routes, ApiError } = contractModule
  const { resetDb, findProfileByPhone, findProfileByUserId, listAllProfiles, activateDb, ledgerBalances } = dbModule
  dbModule.loadDb()

  const api = createMockApi(
    reviewThreshold === undefined
      ? {}
      : { reviewThreshold, holdWindowMs: holdWindowMs ?? 5 * 60_000 },
  )
  // reviewThreshold 允许是函数：mock 内部每笔转账现读，员工端改完立刻生效。
  const patterns = compilePatterns(routes)
  // mock 原本是单标签页内存对象。HTTP 桥接会同时服务多个用户，
  // 所以请求先按 bearer token 切到对应档案，并串行执行以避免切档串号。
  let requestQueue = Promise.resolve()
  const exclusive = (work) => {
    const next = requestQueue.then(work, work)
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
    const value = req.headers.authorization ?? ''
    const match = /^Bearer mock\.([^.]+)\./.exec(value)
    if (match === null) return
    try {
      const phone = Buffer.from(match[1], 'base64').toString('utf8')
      const profile = findProfileByPhone(phone)
      if (profile !== null) activateDb(profile)
    } catch {
      // 坏 token 交给真正的鉴权层处理；占位后端不在这里伪造安全边界。
    }
  }

  // ── 完整性断言：路由表与 BankApi 必须**双向**对齐 ─────────────────────
  // 漏一条的后果是"某个页面在真后端上才会 404"，所以宁可在启动时就炸。
  const implemented = new Set(ROUTES.map(([, , method]) => method))
  const onApi = new Set(Object.keys(api))
  const missing = [...onApi].filter((m) => !implemented.has(m))
  const extra = [...implemented].filter((m) => !onApi.has(m))
  if (missing.length > 0) throw new Error(`占位后端漏了这些 BankApi 方法：${missing.join(', ')}`)
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
   * 处理一个请求。**返回 true 表示这个请求归占位后端管**（已响应），
   * 调用方据此决定要不要继续往下走 404。
   */
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false

    // 演示专用：显式重置出厂数据。刻意放在 `__demo` 命名空间下，
    // 一眼能看出它不是交接契约的一部分。
    if (url.pathname === '/api/__demo/reset') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { message: '只支持 POST', code: 'METHOD_NOT_ALLOWED' })
        return true
      }
      if (typeof resetDb === 'function') {
        resetDb()
      } else {
        shim.backing.clear()
        shim.flush()
      }
      sendJson(res, 200, { ok: true })
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
      const body = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : {}
      if (auth && entry.bankMethod === 'updateCardSettings' && body.dailyLimit !== undefined) {
        const allowed = [200_000, 500_000, 1_000_000, 5_000_000]
        if (!allowed.includes(body.dailyLimit)) {
          sendJson(res, 400, { message: '请选择有效的单日限额档位', code: 'INVALID_DAILY_LIMIT' })
          return true
        }
      }
      // 有意偏离前端 mock：退出登录**不**清空共享数据（否则一个人退出 = 所有人被重置）
      const result = await exclusive(async () => {
        const phone = await activateRequestProfile(req, entry.routeName)
        if (entry.bankMethod === 'logout') {
          if (auth) await auth.logout(req)
          return undefined
        }
        let value
        try {
          value = await api[entry.bankMethod](...entry.makeArgs(match.arg, body, url.searchParams))
        } catch (error) {
          if (auth?.failure && entry.bankMethod === 'login') await auth.failure(typeof body.phone === 'string' && /^\d{11}$/.test(body.phone) ? findProfileByPhone(body.phone)?.user : null)
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
        if (auth && entry.bankMethod === 'changePhone') {
          await auth.phoneChanged(phone, value.phone)
        }
        if (auth && (entry.bankMethod === 'login' || entry.bankMethod === 'register')) {
          return { ...value, token: await auth.issue(value.user, req) }
        }
        return value
      })
      sendJson(res, 200, result === undefined ? { ok: true } : result)
    } catch (e) {
      if (ApiError !== undefined && e instanceof ApiError) {
        sendJson(res, e.status ?? 500, { message: e.message, code: e.code })
      } else {
        sendJson(res, e?.status ?? 500, {
          message: e?.message ?? '占位后端内部错误',
          code: e?.code ?? 'DEMO_BACKEND_ERROR',
        })
      }
    }
    return true
  }

  /** 出厂重置：丢掉落盘状态并重建数据库。 */
  function reset() {
    if (typeof resetDb === 'function') resetDb()
    else {
      shim.backing.clear()
      shim.flush()
    }
  }

  return {
    handle,
    transferRequirements: (req) => exclusive(async () => {
      await activateRequestProfile(req, 'profile')
      return { confirmedQuoteVersion: 1, confirmedRecipient: true }
    }),
    wealthRequirements: (req) => exclusive(async () => {
      await activateRequestProfile(req, "profile")
      return { riskAcknowledgementText: mockModule.RISK_ACKNOWLEDGEMENT }
    }),
    verifyPaymentPassword: (req, password) => exclusive(async () => {
      await activateRequestProfile(req, "profile")
      mockModule.verifyPayPassword(password)
    }),
    reset,
    stats: () => ({ routes: ROUTES.length, staticRoutes: patterns.staticOnes.length, stateFile }),

    /**
     * 员工端给客户投递留言（契约 v1.3 的 visibleToCustomer）。
     * 存的是**全局**的 support.staffNotices，条目自带 customerId，
     * 读的那一侧（listSupportMessages）按当前登录人过滤。
     * 走 exclusive 与切档操作串行，避免和档案读写抢 storage。
     */
    publishSupportNotice({ customerId, ticketId, staffName, text, createdAt }) {
      return exclusive(async () => {
        // 先确认客户存在：给不存在的人留言只会落一条永远没人看的垃圾
        const profile = findProfileByUserId(customerId)
        if (profile === null) {
          throw Object.assign(new Error('客户不存在'), { status: 404, code: 'NOT_FOUND' })
        }
        return appendStaffNotice({ customerId, ticketId, staffName, text, createdAt })
      })
    },

    /** 查在途中的转账指令（员工端/agent 提审用）。走同一队列，避免切档串号。 */
    getHeldTransfer({ customerId, transactionId }) {
      return exclusive(async () => {
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
    settleHeldTransfer({ customerId, transactionId, outcome, reason }) {
      return exclusive(async () => {
        const before = dbModule.loadDb()
        const profile = findProfileByUserId(customerId)
        if (profile === null) {
          throw Object.assign(new Error('客户不存在'), { status: 404, code: 'NOT_FOUND' })
        }
        try {
          activateDb(profile)
          const result = await mockSettleHeldTransfer(transactionId, outcome, reason)
          if (onHoldClosed) {
            await onHoldClosed({ customerId, transactionId, outcome, reason })
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
        // 记录扫描前的当前档案，扫完还原。
        // listAllProfiles() 以「当前档案」开头，若扫完不还原，当前档会随每次扫描
        // 在多个客户之间来回翻转；未登录的短信/登录请求正读这个当前档，
        // 一旦翻转就串档（fresh 库上表现为验证码对不上 → SMS_NOT_SENT）。
        const before = dbModule.loadDb()
        const closed = []
        for (const profile of listAllProfiles()) {
          activateDb(profile)
          const ids = await mockSettleExpiredHolds()
          for (const transactionId of ids) {
            closed.push({ customerId: profile.user.id, transactionId })
          }
          // 清算单只改状态、不动资金，也没有员工端窗口要关，
          // 所以不进 closed —— 别让 onHoldClosed 误以为是拦截窗口了结。
          mockSettleClearing()
        }
        activateDb(before)
        if (onHoldClosed) {
          for (const item of closed) {
            await onHoldClosed({ ...item, outcome: 'settled', reason: '窗口到点，自动到账' })
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
          // 界面展示的是脱敏号（138****8000），员工照着抄回来搜也必须命中；
          // 去掉星号的紧缩形态一并进靶子，容忍「1388000」这类手输片段
          const masked = maskPhone(phone)
          const haystack = `${name} ${phone} ${id} ${masked} ${masked.replace(/\*/g, '')}`.toLowerCase()
          if (kw && !haystack.includes(kw)) continue
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
          accounts: profile.accounts.map((a) => ({ id: a.id, label: a.label, currency: a.currency, balance: a.balance, available: a.available, currencyBalances: ledgerBalances(profile).map(row => ({ id: row.id, currency: row.currency, balance: row.balance, available: row.available })) })),
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
