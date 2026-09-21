/* ==========================================================================
   Mock BankApi —— 纯前端模拟后端
   特性：人为网络延迟、真实的业务校验（余额不足 / 大额二次确认 / 风控）、
        写入 localStorage 持久化，刷新页面数据不丢。
   ========================================================================== */

import { ApiError, type BankApi, type TransactionQuery } from '../contract'
import { CATEGORY_LABEL } from '@/lib/categories'
import {
  digitsOnly,
  maskBankAccount,
  maskFpsValue,
  validateBankAccount,
  validateFpsValue,
} from '@/lib/account'
import { validateAddress } from '@/lib/address'
import {
  RISK_ACKNOWLEDGEMENT,
  WEALTH_INVESTMENT_AGREEMENT,
  canBuyRisk,
  suitabilityMessage,
} from '@/lib/wealth'
import { ACCOUNT_OPENING_PLEDGE } from '@/lib/account-opening'
import {
  formatAmount,
  formatDate,
  formatDateTimeFull,
  formatFxAmount,
  formatRate,
} from '@/lib/format'
import { STORAGE_KEYS, storage } from '@/lib/storage'
import { CHANNEL_LABEL, STATUS_LABEL } from '@/lib/tx'
import { maskPhone } from '@/lib/format'
import type {
  Account,
  AutoDebit,
  BankCard,
  CardBinResolution,
  CardSecrets,
  CardProduct,
  CashFlow,
  CashFlowPoint,
  Cents,
  Currency,
  ExportColumn,
  ExportQuery,
  FpsResolveResult,
  FxQuote,
  Payee,
  Paged,
  ReceivingInfo,
  RegistrationResult,
  ReceiptFile,
  RiskAssessment,
  RiskQuestion,
  SecurityOverview,
  SpendingAnalysis,
  SpendingCategory,
  SpendingTrendPoint,
  SmsCodeResult,
  SupportMessage,
  SupportReply,
  Transaction,
  TransactionCategory,
  TransactionDetail,
  TransactionRecord,
  TransferQuote,
  TransferQuoteRequest,
  TransferRequest,
  TransferResult,
  User,
  WealthAccount,
  WealthAccountOpeningRequest,
  WealthHolding,
  WealthOverview,
  WealthProduct,
  WealthRedeemRequest,
  WealthRedeemResult,
  WealthSubscribeResult,
} from '../types'
import {
  CARD_PAYMENT_METHOD,
  CARD_PRODUCTS,
  USER_FPS_ID,
  cardPan,
  RISK_QUESTIONS,
  WEALTH_PRODUCTS,
  toleranceFromScore,
  FPS_REGISTRY,
  FX_QUOTE_TTL,
  FX_SPREAD,
  findBank,
  PAY_PASSWORD_MAX_ATTEMPTS,
  fxRate,
  loadDb,
  findProfileByPhone,
  activateDb,
  makeReferenceNo,
  monthKey,
  nextId,
  persist,
  toTransactionListItem,
  withBalances,
} from './db'
import { lookupCardBin } from './card-bin'
import type { MockDb } from './db'

const delay = (ms = 220 + Math.random() * 200) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

async function passwordDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 户口名称部分隐藏：梁乐怡 → 梁*怡，Ken Ho → K***o */
function hideMiddle(name: string): string {
  if (name.length <= 1) return name
  if (name.length === 2) return `${name[0]}*`
  return `${name[0]}${'*'.repeat(name.length - 2)}${name.slice(-1)}`
}

/** 大额转账二次确认阈值：¥5,000.00 */
const LARGE_TRANSFER: Cents = 500_000
/** 银行账户转账单笔上限：¥50,000.00 */
const BANK_SINGLE_LIMIT: Cents = 5_000_000
/** FPS（转数快）未登记收款人单笔上限：¥10,000.00 */
const FPS_SINGLE_LIMIT: Cents = 1_000_000
/** 境外转账费率 0.1%，最低 ¥50.00 */
const OVERSEAS_RATE = 0.001
const OVERSEAS_MIN_FEE: Cents = 5_000

/**
 * 安全码在界面上可见的时长（秒）。
 * 到点必须自动遮盖 —— 摊在那里不管，等于把「验一次身」这件事作废。
 */
const CARD_SECRET_REVEAL_SECONDS = 60

const CHANNEL_NOTE = {
  bank: '境内转账实时到账免手续费；境外按 0.1% 计费（最低 ¥50.00）',
  fps: '转数快（FPS）按手机号 / 邮箱 / FPS ID 即时转账，免手续费，通常 5 秒内到账',
} as const

function findAccount(id: string): Account {
  const account = loadDb().accounts.find((a) => a.id === id)
  if (!account) throw new ApiError('账户不存在', 404, 'ACCOUNT_NOT_FOUND')
  return withDerived(account)
}

/** 本地月份键，与 createdAt 的时区保持一致 */
function localMonth(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** 本地日 YYYY-MM-DD。不能用 iso.slice(0, 10) —— 那是 UTC 日，晚上会差一天 */
function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 派生字段在读取时实时计算，而不是落库：
 * 这样转账 / 转入之后 monthNetChange 立刻是准的。
 */
function withDerived(account: Account): Account {
  const month = localMonth(new Date().toISOString())
  const net = loadDb()
    .transactions.filter((t) => t.accountId === account.id && localMonth(t.createdAt) === month)
    .reduce((sum, t) => sum + t.signedAmount, 0)
  return { ...account, monthNetChange: net }
}

/**
 * 生成换汇报价。扣账币种与收款币种相同时返回 undefined —— 不需要换汇。
 * 报价带 quotedAt / quoteTtlSeconds，调用方（UI）据此倒计时并在过期后重新询价。
 */
function buildFxQuote(from: Currency, to: Currency, fromAmount: Cents): FxQuote | undefined {
  if (from === to || fromAmount <= 0) return undefined
  const rate = fxRate(from, to)
  return {
    fromCurrency: from,
    toCurrency: to,
    rate,
    fromAmount,
    toAmount: Math.round(fromAmount * rate),
    spread: FX_SPREAD,
    quoteTtlSeconds: FX_QUOTE_TTL,
    quotedAt: new Date().toISOString(),
  }
}

/** 安全评分由已开启的风控规则实时推导，避免读路径出现不一致 */
function withDerivedSecurity(): SecurityOverview {
  const db = loadDb()
  const enabledRules = db.security.riskRules.filter((r) => r.enabled).length
  const score = Math.min(
    100,
    60 + (db.security.identityVerified ? 12 : 0) + enabledRules * 6,
  )
  return {
    ...db.security,
    score,
    level: score >= 90 ? '防护优秀' : score >= 75 ? '防护良好' : '建议加强',
  }
}

/**
 * 持仓的市值与收益实时从产品净值推导，不落库 ——
 * 净值一变，持仓和总资产要立刻跟着变，存下来只会不一致。
 */
function withDerivedHoldings(db: ReturnType<typeof loadDb>): WealthHolding[] {
  return db.holdings.map((h) => {
    const product = WEALTH_PRODUCTS.find((p) => p.code === h.productCode)
    const nav = product?.nav ?? h.costNav
    const marketValue = Math.round(h.shares * nav)
    const profit = marketValue - h.principal
    return {
      ...h,
      marketValue,
      profit,
      profitRate: h.principal === 0 ? 0 : profit / h.principal,
      closed: h.redeemableAt != null && Date.now() < new Date(h.redeemableAt).getTime(),
    }
  })
}

/**
 * 风险测评结果。
 * 监管：超过一年未评估的投资者，再次购买前必须重新评估
 * （《理财公司理财产品销售管理暂行办法》第三十一条）——
 * 所以过期等同于未测评，购买会被拦下。
 */
function withDerivedRisk(db: ReturnType<typeof loadDb>): RiskAssessment {
  const raw = db.riskAssessment
  if (!raw.done) return { ...raw, expired: true }
  return { ...raw, expired: Date.now() > new Date(raw.expiresAt).getTime() }
}

function productByCode(code: string): WealthProduct {
  const product = WEALTH_PRODUCTS.find((p) => p.code === code)
  if (!product) throw new ApiError('理财产品不存在', 404, 'PRODUCT_NOT_FOUND')
  return product
}

/** 昨日收益：按各持仓份额 × 最近两日净值差 推导，不落库 */
function yesterdayProfitOf(holdings: WealthHolding[]): Cents {
  return holdings.reduce((sum, h) => {
    const product = WEALTH_PRODUCTS.find((p) => p.code === h.productCode)
    const series = product?.navHistory ?? []
    if (series.length < 2) return sum
    const diff = series[series.length - 1].nav - series[series.length - 2].nav
    return sum + Math.round(h.shares * diff)
  }, 0)
}

/** 期限文案 → N 天后的 ISO 时间："90 天" → 90 天后 09:00 */
function inDaysFromNow(term: string): string {
  const days = Number(term.replace(/\D/g, '')) || 90
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

/** 一次性费用（申购费 / 赎回费）。内扣：从申赎金额里直接扣掉 */
function oneOffFee(
  product: WealthProduct,
  amount: Cents,
  kind: '申购' | '赎回',
): { fee: Cents; label: string } {
  const item = product.transactionFees.find((f) => f.label.startsWith(kind))
  if (!item || item.rate === 0) return { fee: 0, label: '免费' }
  return { fee: Math.round(amount * item.rate), label: item.label }
}

/**
 * 理财申赎走的资金账户。
 *
 * 开理财账户时用户**指定**过一个账户（`wealthAccount.settlementAccountId`），
 * 界面也三处明说「申购扣款与赎回到账都走你指定的资金账户」——
 * 所以这里必须用它，不能图省事取 `accounts[0]`：那样用户指定了 B 账户，
 * 钱却从 A 账户扣，界面在说谎。
 *
 * 取不到时退回第一个账户只是**兜底**（老数据 / 账户被销户）：真实后端应当直接报错，
 * 这里静默退回是为了不让演示卡死；真接后端时这一条要改成抛 `SETTLEMENT_ACCOUNT_NOT_FOUND`。
 */
function settlementAccount(db: MockDb): Account {
  return (
    db.accounts.find((a) => a.id === db.wealthAccount.settlementAccountId) ?? db.accounts[0]
  )
}

function findCard(id: string): BankCard {
  const card = loadDb().cards.find((c) => c.id === id)
  if (!card) throw new ApiError('银行卡不存在', 404, 'CARD_NOT_FOUND')
  return card
}

/**
 * 新发卡的安全码。
 *
 * 安全码是**每张卡各自**的（同一账户换一张卡就换一个码），所以新卡不能沿用旧卡的。
 * 真后端由发卡系统生成；这里随机一个 3 位数，格式对即可 ——
 * 检查工具断言的是「3 位数字且不等于别的卡」，不是具体值。
 */
function newCardCvv(): string {
  return String(Math.floor(100 + Math.random() * 900))
}

/**
 * 追加一笔台账。渠道与支付方式由调用方显式给出 ——
 * 这样每笔新交易的凭证要素都是真的，而不是事后从分类里猜出来的。
 * 交易前后余额不落库：它们随账户余额变化，由 getTransaction 读取时回推。
 */
function pushTransaction(
  tx: Omit<Transaction, 'id'>,
  detail: Omit<TransactionDetail, 'referenceNo' | 'balanceBefore' | 'balanceAfter'>,
): TransactionRecord {
  const db = loadDb()
  const id = nextId('txn')
  const created: TransactionRecord = {
    ...tx,
    id,
    detail: { ...detail, referenceNo: makeReferenceNo(id), balanceBefore: 0, balanceAfter: 0 },
  }
  db.transactions.unshift(created)
  persist()
  return created
}

/**
 * 改动余额必须直接改台账里的那一行。
 * 注意不能接收 findAccount() 的返回值 —— 那是 withDerived 生成的副本，
 * 改副本只会让接口响应里余额变了、库里没变，刷新后金额又跳回去。
 */
function applyBalance(accountId: string, delta: Cents): void {
  const row = loadDb().accounts.find((a) => a.id === accountId)
  if (!row) return
  row.balance += delta
  row.available += delta
  persist()
}

/* ---------------------------------------------------------------- 智能客服 */

const CANNED_RULES: { match: RegExp; text: string; actions?: { label: string; to: string }[] }[] = [
  {
    match: /fps|转数快|跨境支付通|手机号转账|邮箱转账|电邮转账/i,
    text: '转数快 / 跨境支付通支持四种汇款方式：收款账户、手机号、电邮、FPS ID。用手机号、电邮或 FPS ID 时，姓名不用你填 —— 系统会到转数快登记册查出收款人登记姓名，在「信息确认」一步给你核对。跨境转账（如从内地汇到香港）无论用哪种方式都要选收款银行，因为款项需要路由到该行。免手续费、实时到账。',
    actions: [{ label: '去转账', to: '/transfer' }],
  },
  {
    match: /转账|汇款|打钱/,
    text: '转账有两种通道：① 银行账户转账 —— 选收款银行 + 填收款账号，境内实时到账免手续费，境外按 0.1% 计费（最低 ¥50.00）；② 转数快 / 跨境支付通 —— 用收款账户、手机号、电邮或 FPS ID，免手续费、实时到账，跨境需指定收款银行。单笔超过 ¥5,000.00 会触发二次确认。',
    actions: [{ label: '去转账', to: '/transfer' }],
  },
  {
    match: /余额|多少钱|账户/,
    text: '你的储蓄账户当前可用余额已同步到「总览」。转账、银行卡和理财资金往来都使用这个主账户。',
    actions: [{ label: '查看总览', to: '/' }],
  },
  {
    match: /锁卡|冻结|丢卡|挂失/,
    text: '丢卡请立刻锁卡：进入「银行卡」，在卡片上点击「立即锁卡」，所有交易会即时拦截。卡片找回后可随时解锁，无需换卡。',
    actions: [{ label: '去锁卡', to: '/cards' }],
  },
  {
    match: /换卡|补卡|卡坏/,
    text: '换卡在「银行卡」页面发起，新卡会在 3 个工作日内寄出。换卡期间旧卡立即失效，卡号会变更，已绑定的自动扣款需要重新签约。',
    actions: [{ label: '去换卡', to: '/cards' }],
  },
  {
    match: /密码|忘.*密码|重置/,
    text: '密码可以在「安全中心」重置：需要先通过短信或人脸完成身份认证，再设置新密码。',
    actions: [{ label: '去安全中心', to: '/security' }],
  },
  {
    match: /限额|额度/,
    text: '借记卡默认单日限额 ¥50,000.00，可以在「银行卡 → 限额设置」里调整。调高限额需要身份认证。',
    actions: [{ label: '调整限额', to: '/cards' }],
  },
  {
    match: /境外|海外|出国|香港/,
    text: '境外转账支持汇丰银行（香港）等收款行，到账时间约 1 个工作日。同时需要在「银行卡」里打开境外交易开关，否则刷卡会被拦截。',
    actions: [{ label: '打开境外交易', to: '/cards' }],
  },
  {
    match: /消费|花销|花了多少|账单/,
    text: '「消费分析」按分类统计了本月支出，并给出近 6 个月的走势，可以按分类筛选流水。',
    actions: [{ label: '查看消费分析', to: '/analysis' }],
  },
  {
    match: /扣款|自动|订阅|会员/,
    text: '「消费分析 → 自动扣款」列出了所有周期性扣款，可以随时关停。关停后已签约的商户不会再次扣款。',
    actions: [{ label: '管理自动扣款', to: '/analysis' }],
  },
  {
    match: /利率|利息|存款/,
    text: '当前活期年化 0.30%，储蓄账户 1.55%，定期存款 2.10%。利息按日计提、按季结息。',
    actions: [{ label: '查看账户', to: '/' }],
  },
  {
    match: /人工|客服|投诉/,
    text: '已为你准备转人工入口。人工客服服务时间 09:00–21:00，非服务时间会转留言工单。',
    actions: [{ label: '转人工客服', to: '/support' }],
  },
]

function cannedReply(text: string): SupportReply {
  const rule = CANNED_RULES.find((r) => r.match.test(text))
  const message: SupportMessage = {
    id: nextId('msg'),
    role: 'agent',
    createdAt: new Date().toISOString(),
    text:
      rule?.text ??
      '我是招财猫银行的智能客服（MVP 演示版，回答为固定话术）。你可以问我：怎么转账、怎么锁卡、密码怎么重置、本月花了多少、自动扣款在哪里管理。',
    actions: rule?.actions,
  }
  return { message, canned: true }
}

/* --------------------------------------------------------- 支付密码 / 收费 */

/**
 * 校验支付密码。
 * 付钱这一步必须单独验证：登录密码泄露不等于能扣钱。
 * 连续输错达阈值即锁定，要求重新登录（真实系统还会要求去柜台或人脸解锁）。
 */
function verifyPayPassword(input: string): void {
  const db = loadDb()
  if (db.payPasswordFailures >= PAY_PASSWORD_MAX_ATTEMPTS) {
    throw new ApiError('支付密码已锁定，请重新登录后再试', 423, 'PAY_PASSWORD_LOCKED')
  }
  if (!/^\d{6}$/.test(input)) {
    throw new ApiError('请输入 6 位数字支付密码', 400, 'INVALID_PAY_PASSWORD')
  }
  if (input !== db.payPassword) {
    db.payPasswordFailures += 1
    persist()
    const left = PAY_PASSWORD_MAX_ATTEMPTS - db.payPasswordFailures
    throw new ApiError(
      left > 0 ? `支付密码不正确，还可尝试 ${left} 次` : '支付密码连续错误，已锁定，请重新登录',
      401,
      'BAD_PAY_PASSWORD',
    )
  }
  db.payPasswordFailures = 0
  persist()
}

/**
 * 扣制卡费用并落一笔流水。
 * 收钱必须留痕 —— 只改余额不记账，对账单上就凭空少了一笔。
 */
function chargeCardFee(amount: Cents, label: string): void {
  if (amount <= 0) return
  const db = loadDb()
  const account = db.accounts[0]
  if (amount > account.available) {
    throw new ApiError('储蓄账户可用余额不足，请先转入后再申请', 400, 'INSUFFICIENT_FUNDS')
  }
  applyBalance(account.id, -amount)
  pushTransaction(
    {
      accountId: account.id,
      direction: 'out',
      amount,
      signedAmount: -amount,
      counterparty: '制卡工本费',
      memo: label,
      category: 'other',
      createdAt: new Date().toISOString(),
      status: 'success',
    },
    {
      channel: 'account',
      paymentMethod: account.label,
      accountLabel: account.label,
      accountNo: account.accountNo,
      settleCurrency: account.currency,
      location: '招财猫银行 App',
      remark: label,
    },
  )
}

/* ------------------------------------------------------------- 导出：列定义 */

/**
 * 流水导出的列定义。
 * 导出哪些字段、金额怎么表达，是银行的账务与合规口径，不是前端展示选择 ——
 * 所以由后端（这里是 mock）给，前端只落文件。
 * 注意：手续费在台账里是**独立的一笔**（对方户名「手续费」），
 * 所以没有单独的「手续费」列，避免同一笔支出被重复计一次。
 */
const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'createdAt', label: '交易时间' },
  { key: 'direction', label: '收支' },
  { key: 'amount', label: '交易金额' },
  { key: 'currency', label: '币种' },
  { key: 'originAmount', label: '原交易金额' },
  { key: 'exchangeRate', label: '记账汇率' },
  { key: 'counterpartyName', label: '对方户名' },
  { key: 'counterpartyAccountNo', label: '对方账号' },
  { key: 'counterpartyBank', label: '对方机构' },
  { key: 'channel', label: '交易渠道' },
  { key: 'category', label: '交易类型' },
  { key: 'status', label: '交易状态' },
  { key: 'balanceAfter', label: '交易后余额' },
  { key: 'referenceNo', label: '交易编号' },
  { key: 'remark', label: '附言' },
]

/* ------------------------------------------------------------------- 实现 */

export function createMockApi(): BankApi {
  return {
    async login(phone, password, smsCode) {
      await delay()
      const db = loadDb()
      if (!/^\d{11}$/.test(phone)) {
        throw new ApiError('请输入 11 位手机号', 400, 'INVALID_PHONE')
      }
      const target = findProfileByPhone(phone)
      if (target === null || await passwordDigest(password) !== target.passwordDigest) {
        throw new ApiError('手机号或密码不正确', 401, 'BAD_CREDENTIALS')
      }
      // 验证码在**密码之后**校验：先报密码错，免得"这个手机号存不存在"
      // 能被"验证码错误"这个提示反推出来。
      // 错误码与状态码**照抄其他几处短信校验**（开户 / 开理财户 / 换手机号）：
      // 同一件事已经有约定的 code 就别另造一个，否则后端要同时实现两套。
      const pending = db.pendingSms
      if (pending === null || digitsOnly(pending.phone) !== digitsOnly(phone)) {
        throw new ApiError('请先获取短信验证码', 400, 'SMS_NOT_SENT')
      }
      if (new Date(pending.expiresAt).getTime() < Date.now()) {
        throw new ApiError('验证码已过期，请重新获取', 400, 'SMS_EXPIRED')
      }
      if (digitsOnly(smsCode) !== pending.code) {
        throw new ApiError('验证码不正确', 400, 'BAD_SMS_CODE')
      }
      // 一次性：用过就作废，不能让同一个码反复登录
      db.pendingSms = null
      persist()
      target.pendingSms = null
      // 重新登录即解除支付密码锁定
      target.payPasswordFailures = 0
      activateDb(target)
      return { token: `mock.${btoa(phone)}.${Date.now()}`, user: target.user }
    },

    async register(req): Promise<RegistrationResult> {
      await delay(760)
      const db = loadDb()
      const phone = digitsOnly(req.phone)
      if (!/^1[3-9]\d{9}$/.test(phone)) throw new ApiError('请输入 11 位手机号', 400, 'INVALID_PHONE')
      if (findProfileByPhone(phone) !== null) throw new ApiError('该手机号已注册', 409, 'PHONE_EXISTS')
      if (req.password.length < 6 || req.password.length > 20) {
        throw new ApiError('登录密码需为 6–20 个字符', 400, 'WEAK_PASSWORD')
      }
      if (!req.holderName.trim()) throw new ApiError('请填写姓名', 400, 'NAME_REQUIRED')
      if (!/^\d{17}[\dXx]$/.test(req.idNumber.trim())) throw new ApiError('请输入 18 位身份证号', 400, 'INVALID_ID')
      const sms = db.pendingSms
      if (!sms || digitsOnly(sms.phone) !== phone) throw new ApiError('请先获取短信验证码', 400, 'SMS_NOT_SENT')
      if (Date.now() > new Date(sms.expiresAt).getTime()) throw new ApiError('验证码已过期，请重新获取', 400, 'SMS_EXPIRED')
      if (digitsOnly(req.smsCode) !== sms.code) throw new ApiError('验证码不正确', 400, 'BAD_SMS_CODE')
      if (!req.faceTicket) throw new ApiError('请先完成人脸识别', 400, 'FACE_REQUIRED')
      if (req.pledge.trim() !== ACCOUNT_OPENING_PLEDGE) {
        throw new ApiError('请确认合法开立和使用账户承诺', 400, 'PLEDGE_REQUIRED')
      }

      const now = new Date().toISOString()
      const account: Account = {
        id: `acc_${Date.now()}`,
        kind: 'savings',
        label: '储蓄账户',
        accountNo: `6222${String(Math.floor(1e12 + Math.random() * 8e12))}`.slice(0, 19),
        currency: 'CNY',
        balance: 0,
        available: 0,
        interestRate: 0.0155,
        monthNetChange: 0,
      }
      const next = structuredClone(db)
      next.user = {
        id: `u_${Date.now()}`,
        name: req.holderName.trim(),
        phone,
        memberLevel: '普通会员',
        avatarInitial: req.holderName.trim().slice(0, 1),
      }
      next.passwordDigest = await passwordDigest(req.password)
      next.accounts = [account]
      next.transactions = []
      next.cards = []
      next.cardSecrets = {}
      next.autoDebits = []
      next.holdings = []
      next.pendingSms = null
      next.wealthAccount = { opened: false, accountNo: '', openedAt: '', settlementAccountId: '', agreementSignedAt: '', riskLevelAtOpening: 'C1' }
      next.riskAssessment = { done: false, level: 'C1', score: 0, assessedAt: '', expiresAt: '', expired: true }
      next.security = { ...next.security, score: 72, level: '基础防护', devices: [], logs: [], identityVerified: true }
      activateDb(next)
      return { token: `mock.${btoa(phone)}.${Date.now()}`, user: next.user, account, openedAt: now }
    },

    async logout() {
      await delay(120)
      // 退出只结束客户端会话。账户资料属于持久数据，不能随登出一起删除。
    },

    async profile(): Promise<User> {
      await delay(140)
      return loadDb().user
    },

    async listAccounts() {
      await delay(160)
      return loadDb().accounts.map(withDerived)
    },

    async getAccount(id) {
      await delay(140)
      return findAccount(id)
    },

    async listTransactions(accountId, query: TransactionQuery = {}) {
      await delay(180)
      const { page = 1, size = 8, category = 'all', keyword = '' } = query
      findAccount(accountId)
      let rows = loadDb().transactions.filter((t) => t.accountId === accountId)
      if (category !== 'all') rows = rows.filter((t) => t.category === category)
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase()
        rows = rows.filter(
          (t) =>
            t.counterparty.toLowerCase().includes(kw) || t.memo.toLowerCase().includes(kw),
        )
      }
      const start = (page - 1) * size
      const result: Paged<Transaction> = {
        items: rows.slice(start, start + size).map(toTransactionListItem),
        page,
        size,
        total: rows.length,
      }
      return result
    },

    async getTransaction(id) {
      await delay(200)
      const db = loadDb()
      const rec = db.transactions.find((t) => t.id === id)
      if (!rec) throw new ApiError('交易不存在或已超出可查询期限', 404, 'TX_NOT_FOUND')

      // 余额按账户**当前**余额回推，所以在转账 / 转入之后看到的仍然是对的
      const account = db.accounts.find((a) => a.id === rec.accountId)
      const ordered = withBalances(
        db.transactions
          .filter((t) => t.accountId === rec.accountId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        account?.balance ?? 0,
      )
      return ordered.find((t) => t.id === id) ?? rec
    },

    async exportTransactions(accountId, query: ExportQuery = {}) {
      await delay(320)
      const db = loadDb()
      const account = findAccount(accountId)

      // 交易后余额按当前余额回推：导出的表里余额列必须自洽，否则对不了账
      const ordered = withBalances(
        db.transactions
          .filter((t) => t.accountId === accountId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        account.balance,
      )

      const { from, to, category = 'all', keyword = '' } = query
      const kw = keyword.trim().toLowerCase()
      const rows = ordered.filter((t) => {
        const day = localDay(t.createdAt)
        if (from && day < from) return false
        if (to && day > to) return false
        if (category !== 'all' && t.category !== category) return false
        if (
          kw &&
          !t.counterparty.toLowerCase().includes(kw) &&
          !t.memo.toLowerCase().includes(kw)
        ) {
          return false
        }
        return true
      })

      // 时间范围按**实际导出的数据**首尾给，而不是回显请求参数
      const days = rows.map((t) => localDay(t.createdAt)).sort()
      const range = days.length ? { from: days[0], to: days[days.length - 1] } : null
      const stamp = range
        ? `${range.from.replace(/-/g, '')}-${range.to.replace(/-/g, '')}`
        : dayKey(new Date())

      return {
        batchNo: `EXP${Date.now().toString().slice(-10)}`,
        generatedAt: new Date().toISOString(),
        fileName: `招财猫银行_交易流水_${stamp}.csv`,
        total: rows.length,
        range,
        columns: EXPORT_COLUMNS,
        rows: rows.map((t) => ({
          createdAt: formatDateTimeFull(t.createdAt),
          direction: t.direction === 'in' ? '收入' : '支出',
          amount: formatAmount(t.amount),
          currency: t.detail.settleCurrency,
          originAmount:
            t.detail.originAmount != null && t.detail.originCurrency
              ? formatFxAmount(t.detail.originAmount, t.detail.originCurrency)
              : '',
          exchangeRate:
            t.detail.exchangeRate != null && t.detail.originCurrency
              ? `1 ${t.detail.originCurrency} = ${t.detail.settleCurrency} ${formatRate(
                  t.detail.exchangeRate,
                )}`
              : '',
          counterpartyName: t.detail.counterpartyName ?? t.counterparty,
          counterpartyAccountNo: t.detail.counterpartyAccountNo ?? '',
          counterpartyBank: t.detail.counterpartyBank ?? '',
          channel: CHANNEL_LABEL[t.detail.channel],
          category: CATEGORY_LABEL[t.category],
          status: STATUS_LABEL[t.status],
          balanceAfter: formatAmount(t.detail.balanceAfter),
          referenceNo: t.detail.referenceNo,
          remark: t.detail.remark ?? '',
        })),
      }
    },

    async getReceipt(id): Promise<ReceiptFile> {
      await delay(260)
      const rec = loadDb().transactions.find((t) => t.id === id)
      if (!rec) throw new ApiError('交易不存在或已超出可查询期限', 404, 'TX_NOT_FOUND')
      return {
        fileName: `招财猫银行_电子回单_${rec.detail.referenceNo}.pdf`,
        // 演示环境没有服务端 PDF 能力，url 给 null —— 这是能力声明，不是错误。
        // 真后端在这里返回带签名的临时下载地址即可，前端会优先用它。
        url: null,
        expiresAt: null,
      }
    },

    async deposit(accountId, amount, channel) {
      await delay(260)
      if (amount <= 0) throw new ApiError('转入金额必须大于 0', 400, 'INVALID_AMOUNT')
      if (amount > 5_000_000) throw new ApiError('单笔转入上限 ¥50,000.00', 400, 'LIMIT_EXCEEDED')
      const account = findAccount(accountId)
      applyBalance(accountId, amount)
      const salary = channel === 'salary'
      pushTransaction(
        {
          accountId,
          direction: 'in',
          amount,
          signedAmount: amount,
          counterparty: salary ? '工资入账' : '主动转入',
          memo: salary ? '工资入账' : '从绑定卡转入',
          category: salary ? 'salary' : 'other',
          createdAt: new Date().toISOString(),
          status: 'success',
        },
        {
          channel: salary ? 'account' : 'card',
          paymentMethod: salary ? '工资代发' : CARD_PAYMENT_METHOD,
          accountLabel: account.label,
          accountNo: account.accountNo,
          settleCurrency: account.currency,
          counterpartyName: salary ? '上海云栖科技有限公司' : undefined,
          counterpartyBank: salary ? undefined : '中国建设银行',
          location: '招财猫银行 App',
          remark: salary ? '本月薪资' : '从绑定卡转入',
        },
      )
      return withDerived(account)
    },

    async listBanks() {
      await delay(100)
      return loadDb().banks
    },

    /**
     * 我的收款信息。
     *
     * 由后端拼而不是前端自己凑：账户号归**银行账户转账**用，转数快标识归**转数快**用，
     * 两者填的位置都不一样；而且要拿哪张账户、户名用中文还是英文，都是账户侧的规则。
     */
    async getReceivingInfo(): Promise<ReceivingInfo> {
      await delay(140)
      const db = loadDb()
      const account = db.accounts[0]
      return {
        holder: db.user.name,
        accountNo: account.accountNo,
        accountLabel: account.label,
        bankName: '招财猫银行',
        bankRegion: 'CN',
        fpsMobile: db.user.phone,
        fpsId: USER_FPS_ID,
      }
    },

    /**
     * 卡 BIN 查询。规则本身在 card-bin.ts（纯函数，能被 tools/check-card-bin.mjs 直接测），
     * 这里只负责模拟一次网络往返。
     */
    async resolveCardBin({ digits, region }): Promise<CardBinResolution> {
      await delay(140)
      return lookupCardBin(loadDb().banks, digits, region)
    },

    async listPayees(): Promise<Payee[]> {
      await delay(140)
      return [...loadDb().payees].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    },

    async resolveFps(idType, fpsId): Promise<FpsResolveResult> {
      await delay(620)
      const value = (fpsId ?? '').replace(/\s/g, '')
      const hit = FPS_REGISTRY.find((r) => r.idType === idType && r.id === value)

      if (!hit) {
        return {
          registered: false,
          reason: '该标识未登记转数快。请核对标识，或改用「收款账户」方式转账。',
        }
      }

      return {
        registered: true,
        // 回显时部分隐藏户口名称，与真实转数快一致（梁乐怡 → 梁*怡）
        name: hideMiddle(hit.name),
        bankName: hit.bankName,
        bankCode: hit.bankCode,
        bankRegion: 'HK',
        bankCount: hit.bankCount,
      }
    },

    async quoteTransfer(req: TransferQuoteRequest): Promise<TransferQuote> {
      await delay(160)
      const db = loadDb()
      // 询价必须针对具体账户：可用余额与扣账币种都取决于它
      const current =
        db.accounts.find((a) => a.id === req.fromAccountId) ?? db.accounts[0]
      const isFps = req.channel === 'fps'
      const singleLimit = isFps ? FPS_SINGLE_LIMIT : BANK_SINGLE_LIMIT

      // FPS 走香港即时结算通道，免手续费
      const fee =
        !isFps && req.scope === 'overseas'
          ? Math.max(Math.round(req.amount * OVERSEAS_RATE), OVERSEAS_MIN_FEE)
          : 0

      const bank = findBank(db.banks, req.bankCode, req.bankRegion)
      const etaText = isFps
        ? '预计 5 秒内到账'
        : req.scope === 'overseas'
          ? '预计 1 个工作日到账'
          : bank?.internal // 本行内部转账实时到账；不要再裸比较行别代码（两地会撞号）
            ? '实时到账'
            : '预计 2 小时内到账'

      // 扣账币种 ≠ 收款币种时才需要换汇
      const fx = buildFxQuote(
        current.currency,
        req.payeeCurrency ?? current.currency,
        req.amount,
      )

      const requiresConfirm = req.amount >= LARGE_TRANSFER
      return {
        fee,
        etaText,
        maxAmount: Math.min(current.available, singleLimit),
        singleLimit,
        requiresConfirm,
        confirmReason: requiresConfirm
          ? `单笔金额超过 ¥${(LARGE_TRANSFER / 100).toLocaleString('zh-CN')}，需二次确认`
          : undefined,
        channelNote: CHANNEL_NOTE[req.channel],
        ...(fx ? { fx } : {}),
      }
    },

    async submitTransfer(req: TransferRequest): Promise<TransferResult> {
      await delay(420)
      const db = loadDb()
      const account = findAccount(req.fromAccountId)
      const isFps = req.channel === 'fps'

      if (req.amount <= 0) throw new ApiError('转账金额必须大于 0', 400, 'INVALID_AMOUNT')

      // —— 收款标识校验 ——
      // 跨境支付通无论用哪种汇款方式都要指定收款银行（款项要路由到具体收款行）
      let identifier: string

      if (isFps) {
        const method = req.fpsMethod ?? 'mobile'
        if (!req.payeeBankCode) throw new ApiError('请选择收款银行', 400, 'BANK_REQUIRED')
        // 3 位清算代码两地会撞号（内地 307 平安 / 香港 307 ABN AMRO），
        // 所以必须 (region, code) 成对校验
        if (!findBank(db.banks, req.payeeBankCode, req.payeeBankRegion)) {
          throw new ApiError('收款银行不存在', 400, 'BANK_NOT_FOUND')
        }

        if (method === 'account') {
          const err = validateFpsValue('account', req.payeeAccountNo ?? '')
          if (err) throw new ApiError(err, 400, 'INVALID_ACCOUNT_NO')
          if (!req.payeeName.trim()) throw new ApiError('请填写收款户名', 400, 'PAYEE_REQUIRED')
          identifier = maskFpsValue('account', req.payeeAccountNo ?? '')
        } else {
          const err = validateFpsValue(method, req.fpsId ?? '')
          if (err) throw new ApiError(err, 400, 'INVALID_FPS_ID')
          identifier = maskFpsValue(method, req.fpsId ?? '')
        }
      } else {
        if (!req.payeeName.trim()) throw new ApiError('请填写收款人', 400, 'PAYEE_REQUIRED')
        const err = validateBankAccount(req.payeeAccountNo ?? '')
        if (err) throw new ApiError(err, 400, 'INVALID_ACCOUNT_NO')
        identifier = maskBankAccount(req.payeeAccountNo ?? '')
      }

      const singleLimit = isFps ? FPS_SINGLE_LIMIT : BANK_SINGLE_LIMIT
      const fee =
        !isFps && req.scope === 'overseas'
          ? Math.max(Math.round(req.amount * OVERSEAS_RATE), OVERSEAS_MIN_FEE)
          : 0
      const total = req.amount + fee

      if (req.amount > singleLimit) {
        throw new ApiError(
          `单笔转账上限 ¥${(singleLimit / 100).toLocaleString('zh-CN')}`,
          400,
          'LIMIT_EXCEEDED',
        )
      }
      if (total > account.available) {
        throw new ApiError('账户可用余额不足', 400, 'INSUFFICIENT_FUNDS')
      }

      // 需要换汇时按**成交时**的汇率再算一次（不是复用询价结果）：
      // 真实系统在这里校验锁价票据是否还在有效期内，过期就报错让前端重新询价
      const fx = buildFxQuote(account.currency, req.payeeCurrency ?? account.currency, req.amount)

      applyBalance(req.fromAccountId, -total)
      const bank = findBank(db.banks, req.payeeBankCode, req.payeeBankRegion)
      const tx = pushTransaction(
        {
          accountId: req.fromAccountId,
          direction: 'out',
          amount: req.amount,
          signedAmount: -req.amount,
          counterparty: `转账 · ${req.payeeName.trim()}`,
          memo:
            req.memo ||
            (isFps
              ? `转数快 FPS 转账至 ${identifier}`
              : `${req.scope === 'overseas' ? '境外' : '境内'}转账至${bank?.shortName ?? '对方银行'}`),
          category: 'transfer',
          createdAt: new Date().toISOString(),
          status: 'success',
        },
        {
          channel: 'transfer',
          paymentMethod: account.label,
          accountLabel: account.label,
          accountNo: account.accountNo,
          settleCurrency: account.currency,
          counterpartyName: req.payeeName.trim(),
          // 收款标识已脱敏：转账详情里只回显掩码，不落明文
          counterpartyAccountNo: identifier,
          counterpartyBank: bank?.name,
          location: '招财猫银行 App',
          remark: req.memo.trim() || undefined,
          // 换汇后回单按银行口径存：原交易金额 = 收款币金额，
          // 记账汇率 = 1 原币（收款币）= ? 记账币（扣账币），即报价的倒数
          ...(fx
            ? {
                originAmount: fx.toAmount,
                originCurrency: fx.toCurrency,
                exchangeRate: 1 / fx.rate,
                exchangeRateNote: `已包括 ${(fx.spread * 100).toFixed(2)}% 换汇点差`,
              }
            : {}),
        },
      )

      if (fee > 0) {
        // 手续费是独立的一笔台账，所以转账详情里不再重复列示 ——
        // 余额回推也就自然对得上（两笔各扣一次）
        pushTransaction(
          {
            accountId: req.fromAccountId,
            direction: 'out',
            amount: fee,
            signedAmount: -fee,
            counterparty: '手续费',
            memo: '境外转账手续费',
            category: 'other',
            createdAt: new Date().toISOString(),
            status: 'success',
          },
          {
            channel: 'account',
            paymentMethod: account.label,
            accountLabel: account.label,
            accountNo: account.accountNo,
            settleCurrency: account.currency,
            location: '招财猫银行 App',
            remark: `境外转账手续费 · ${req.payeeName.trim()}`,
          },
        )
      }

      // 收款人簿：同标识视为同一人，只更新时间；否则新增
      const existing = db.payees.find(
        (p) =>
          `${p.channel}:${p.fpsMethod ?? ''}:${p.fpsId ?? ''}:${p.accountNo ?? ''}` ===
          `${req.channel}:${req.fpsMethod ?? ''}:${(req.fpsId ?? '').replace(/\s/g, '')}:${
            req.payeeAccountNo ?? ''
          }`,
      )
      if (existing) {
        existing.lastUsedAt = new Date().toISOString()
        existing.name = req.payeeName.trim()
      } else {
        db.payees.unshift({
          id: nextId('pay'),
          name: req.payeeName.trim(),
          channel: req.channel,
          scope: isFps ? 'overseas' : req.scope,
          lastUsedAt: new Date().toISOString(),
          bankCode: req.payeeBankCode,
          bankRegion: req.payeeBankRegion,
          bankName: bank?.name ?? '未知银行',
          ...(isFps
            ? {
                fpsMethod: req.fpsMethod ?? 'mobile',
                fpsId: (req.fpsId ?? '').replace(/\s/g, ''),
                payeeCurrency: req.payeeCurrency ?? 'CNY',
                ...(req.fpsMethod === 'account'
                  ? { accountNo: (req.payeeAccountNo ?? '').trim() }
                  : {}),
              }
            : { accountNo: (req.payeeAccountNo ?? '').replace(/\D/g, '') }),
        })
      }
      persist()

      return {
        transactionId: tx.id,
        referenceNo: `LC${Date.now().toString().slice(-10)}`,
        amount: req.amount,
        fee,
        channel: req.channel,
        identifier,
        createdAt: tx.createdAt,
        ...(fx ? { fx } : {}),
      }
    },

    async listCards(): Promise<BankCard[]> {
      await delay(160)
      return loadDb().cards
    },

    async listCardProducts(): Promise<CardProduct[]> {
      await delay(140)
      return CARD_PRODUCTS
    },

    async openCard(req) {
      await delay(700)
      const db = loadDb()
      const product = CARD_PRODUCTS.find((p) => p.code === req.productCode)
      if (!product) throw new ApiError('卡产品不存在', 404, 'PRODUCT_NOT_FOUND')

      // 先验密码再收钱，顺序不能反
      verifyPayPassword(req.paymentPassword)
      const addressError = validateAddress(req.address)
      if (addressError) throw new ApiError(addressError, 400, 'INVALID_ADDRESS')

      const fee = product.issuingFee + product.deliveryFee
      chargeCardFee(
        fee,
        `${product.name} 制卡费${product.deliveryFee > 0 ? '（含寄送费）' : ''}`,
      )

      // 显式构造而不是 spread 旧卡：新卡的字段应当全部明确，不继承别人的地址与费用
      const fresh: BankCard = {
        id: nextId('card'),
        // 新卡绑定储蓄账户：卡本身不装钱，扣款走这个账户
        accountId: db.accounts[0].id,
        productName: product.name,
        last4: String(Math.floor(1000 + Math.random() * 8999)),
        cardholder: db.cards[0]?.cardholder ?? 'LIN XIAOMAN',
        expiry: '05/31',
        theme: product.theme,
        network: product.network,
        kind: product.kind,
        status: 'pending',
        onlinePayment: false,
        overseasPayment: false,
        dailyLimit: 200_000,
        shippingAddress: req.address,
        issuingFee: fee,
      }
      db.cards.push(fresh)
      db.cardSecrets[fresh.id] = { cvv: newCardCvv(), pan: cardPan(fresh.network, fresh.last4) }
      persist()
      return fresh
    },

    async setCardLock(id, locked) {
      await delay(300)
      const card = findCard(id)
      if (card.status === 'replaced') throw new ApiError('该卡已换卡，无法操作', 400, 'CARD_REPLACED')
      card.status = locked ? 'locked' : 'active'
      if (locked) {
        card.onlinePayment = false
        card.overseasPayment = false
      }
      persist()
      return card
    },

    async replaceCard(id, req) {
      await delay(650)
      const db = loadDb()
      const card = findCard(id)
      if (card.status === 'replaced') {
        throw new ApiError('该卡已换卡，无法重复操作', 400, 'CARD_REPLACED')
      }

      verifyPayPassword(req.paymentPassword)
      const addressError = validateAddress(req.address)
      if (addressError) throw new ApiError(addressError, 400, 'INVALID_ADDRESS')

      // 换卡按同卡组织的产品定价；本行自有卡没有对应产品，用固定工本费
      // 换卡按同卡组织的产品定价
      const product = CARD_PRODUCTS.find((p) => p.network === card.network)
      const fee = product ? product.issuingFee + product.deliveryFee : 2_000
      chargeCardFee(fee, `${card.productName} 换卡工本费`)

      card.status = 'replaced'
      persist()

      const fresh: BankCard = {
        ...card,
        id: nextId('card'),
        last4: String(Math.floor(1000 + Math.random() * 8999)),
        status: 'pending',
        onlinePayment: false,
        overseasPayment: false,
        shippingAddress: req.address,
        issuingFee: fee,
      }
      db.cards.push(fresh)
      // 换发的新卡是另一张卡，安全码必须重新生成，不能沿用旧卡的
      db.cardSecrets[fresh.id] = { cvv: newCardCvv(), pan: cardPan(fresh.network, fresh.last4) }
      persist()
      return fresh
    },

    /**
     * 查看卡安全码。
     *
     * 单独一个接口、单独验一次支付密码，而不是塞进卡列表 —— 卡列表是渲染用的，
     * 里面带上 CVV 就等于每次打开卡片页都把安全码传到前端（PCI DSS 也不允许授权后留存）。
     * 所以 `listCards()` 返回的 `BankCard` 里根本没有这个字段，
     * 安全码只出现在这次响应里，前端也不落 localStorage。
     */
    async revealCardSecrets(id, paymentPassword): Promise<CardSecrets> {
      await delay(360)
      const db = loadDb()
      const card = db.cards.find((c) => c.id === id)
      if (!card) throw new ApiError('银行卡不存在', 404, 'CARD_NOT_FOUND')

      // 先验身再看卡状态：反过来的话，密码不对的人也能从报错文案里探到卡的状态
      verifyPayPassword(paymentPassword)

      if (card.status === 'pending') {
        throw new ApiError(
          '卡还在寄送途中，收到并激活后才能查看安全码',
          409,
          'CARD_NOT_DELIVERED',
        )
      }
      if (card.status === 'replaced') {
        throw new ApiError('这张卡已换发，旧卡信息不再可用', 409, 'CARD_REPLACED')
      }

      const secret = db.cardSecrets[id]
      if (!secret) throw new ApiError('该卡暂无安全码记录', 404, 'CARD_SECRET_MISSING')

      return {
        pan: secret.pan,
        expiry: card.expiry,
        cvv: secret.cvv,
        revealSeconds: CARD_SECRET_REVEAL_SECONDS,
      }
    },

    async updateCardSettings(id, patch) {
      await delay(240)
      const card = findCard(id)
      if (card.status === 'locked' && (patch.onlinePayment || patch.overseasPayment)) {
        throw new ApiError('卡片已锁定，请先解锁', 400, 'CARD_LOCKED')
      }
      Object.assign(card, patch)
      persist()
      return card
    },

    /* ------------------------------------------------------------ 开户 */

    async sendSmsCode(phone): Promise<SmsCodeResult> {
      await delay(420)
      const db = loadDb()
      if (!/^1[3-9]\d{9}$/.test(digitsOnly(phone))) {
        throw new ApiError('请输入 11 位手机号', 400, 'INVALID_PHONE')
      }
      const code = String(Math.floor(100000 + Math.random() * 900000))
      db.pendingSms = {
        phone: digitsOnly(phone),
        code,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      }
      persist()
      // 注意：真实后端绝不会把验证码回传。这里返回是为了纯前端演示能走下去，
      // 字段名也点明了 demo，避免有人误以为线上可以这么干。
      return { sent: true, expiresAt: db.pendingSms.expiresAt, demoCode: code }
    },


    /* ------------------------------------------------------------ 理财 */

    async listWealthProducts(): Promise<WealthProduct[]> {
      await delay(220)
      const today = dayKey(new Date())
      return WEALTH_PRODUCTS.map((p) => ({ ...p, navDate: today }))
    },

    async getWealthProduct(code): Promise<WealthProduct> {
      await delay(160)
      return { ...productByCode(code), navDate: dayKey(new Date()) }
    },

    async getWealthOverview(): Promise<WealthOverview> {
      await delay(240)
      const db = loadDb()
      // 未开立理财账户时，不存在可归属给用户的持仓与收益。
      // 旧演示数据可能残留 holdings，但不能在账户闸门前泄露成“收益”。
      const holdings = db.wealthAccount.opened ? withDerivedHoldings(db) : []
      const totalValue = holdings.reduce((sum, h) => sum + h.marketValue, 0)
      const totalPrincipal = holdings.reduce((sum, h) => sum + h.principal, 0)
      return {
        account: db.wealthAccount,
        totalValue,
        totalPrincipal,
        totalProfit: totalValue - totalPrincipal,
        yesterdayProfit: yesterdayProfitOf(holdings),
        holdings,
        risk: withDerivedRisk(db),
      }
    },

    async openWealthAccount(req: WealthAccountOpeningRequest): Promise<WealthAccount> {
      await delay(720)
      const db = loadDb()
      if (db.wealthAccount.opened) {
        throw new ApiError('理财账户已开立，无需重复开户', 400, 'ALREADY_OPENED')
      }
      // 兼容旧本地演示数据：未开户期间的残留持仓不属于新开的理财账户。
      db.holdings = []

      // —— 身份核验：与银行开户同一套口径 ——
      if (!req.holderName.trim()) throw new ApiError('请填写姓名', 400, 'NAME_REQUIRED')
      if (!/^\d{17}[\dXx]$/.test(req.idNumber.trim())) {
        throw new ApiError('请输入 18 位身份证号', 400, 'INVALID_ID')
      }
      const sms = db.pendingSms
      if (!sms) throw new ApiError('请先获取短信验证码', 400, 'SMS_NOT_SENT')
      if (Date.now() > new Date(sms.expiresAt).getTime()) {
        db.pendingSms = null
        persist()
        throw new ApiError('验证码已过期，请重新获取', 400, 'SMS_EXPIRED')
      }
      if (req.smsCode.replace(/\D/g, '') !== sms.code) {
        throw new ApiError('验证码不正确', 400, 'BAD_SMS_CODE')
      }
      if (!req.faceTicket) throw new ApiError('请先完成人脸识别', 400, 'FACE_REQUIRED')

      // —— 风险测评：开投资户的前置，不是可选项 ——
      const risk = withDerivedRisk(db)
      if (!risk.done || risk.expired) {
        throw new ApiError('请先完成风险承受能力评估', 403, 'RISK_ASSESSMENT_REQUIRED')
      }

      // —— 签署投资协议 ——
      if (req.agreement.trim() !== WEALTH_INVESTMENT_AGREEMENT) {
        throw new ApiError('请阅读并签署投资协议', 400, 'AGREEMENT_REQUIRED')
      }

      // —— 绑定资金账户：申赎款项都走它 ——
      const settlement = db.accounts.find((a) => a.id === req.settlementAccountId)
      if (!settlement) throw new ApiError('请选择资金账户', 400, 'SETTLEMENT_REQUIRED')

      db.pendingSms = null
      const now = new Date().toISOString()
      db.wealthAccount = {
        opened: true,
        accountNo: `9${String(Math.floor(1e11 + Math.random() * 8e11))}`.slice(0, 12),
        openedAt: now,
        settlementAccountId: settlement.id,
        agreementSignedAt: now,
        riskLevelAtOpening: risk.level,
      }
      persist()
      return db.wealthAccount
    },

    async listRiskQuestions(): Promise<RiskQuestion[]> {
      await delay(140)
      return RISK_QUESTIONS
    },

    async submitRiskAssessment(answers) {
      await delay(500)
      const db = loadDb()
      if (answers.length !== RISK_QUESTIONS.length) {
        throw new ApiError('请完成全部题目', 400, 'INCOMPLETE_ANSWERS')
      }
      let score = 0
      RISK_QUESTIONS.forEach((q, i) => {
        const option = q.options[answers[i]]
        if (!option) throw new ApiError('答案无效', 400, 'INVALID_ANSWER')
        score += option.score
      })
      const level = toleranceFromScore(score)
      const now = new Date()
      const expires = new Date(now)
      expires.setFullYear(expires.getFullYear() + 1)
      db.riskAssessment = {
        done: true,
        level,
        score,
        assessedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        expired: false,
      }
      persist()
      return withDerivedRisk(db)
    },

    async subscribeWealth(req): Promise<WealthSubscribeResult> {
      await delay(620)
      const db = loadDb()
      const product = productByCode(req.productCode)
      const account = settlementAccount(db)

      // —— 先开理财账户：银行户 ≠ 理财户（ZA 也是这么分的）——
      if (!db.wealthAccount.opened) {
        throw new ApiError('请先开立理财账户', 403, 'WEALTH_ACCOUNT_REQUIRED')
      }

      // —— 适当性：不是提示，是硬拦截 ——
      // 「误导投资者购买与其风险承受能力不相匹配的理财产品」是明令禁止的行为
      const risk = withDerivedRisk(db)
      if (!risk.done || risk.expired) {
        throw new ApiError('请先完成风险承受能力评估', 403, 'RISK_ASSESSMENT_REQUIRED')
      }
      if (!canBuyRisk(risk.level, product.risk)) {
        throw new ApiError(suitabilityMessage(risk.level, product.risk), 403, 'RISK_MISMATCH')
      }

      // —— 风险确认语句必须完整抄录 ——（监管要求抄录，不是一个勾选框）
      if (req.riskAcknowledgement.trim() !== RISK_ACKNOWLEDGEMENT) {
        throw new ApiError(
          `请完整抄录风险确认语句：${RISK_ACKNOWLEDGEMENT}`,
          400,
          'ACKNOWLEDGEMENT_MISMATCH',
        )
      }

      if (req.amount < product.minAmount) {
        throw new ApiError(
          `起购金额 ¥${(product.minAmount / 100).toLocaleString('zh-CN')}`,
          400,
          'BELOW_MIN_AMOUNT',
        )
      }
      if (req.amount % product.stepAmount !== 0) {
        throw new ApiError(
          `追加金额需为 ¥${(product.stepAmount / 100).toLocaleString('zh-CN')} 的整数倍`,
          400,
          'INVALID_STEP',
        )
      }
      if (req.amount > account.available) {
        // 文案要带**实际那个账户**的名字：资金账户是用户自己指定的，
        // 使用后端返回的账户名称，避免客户端自行猜测资金账户
        throw new ApiError(`${account.label}可用余额不足`, 400, 'INSUFFICIENT_FUNDS')
      }

      // 扣钱这一步单独验支付密码，且放在所有校验之后 —— 先验密码再收钱
      verifyPayPassword(req.paymentPassword)

      const { fee } = oneOffFee(product, req.amount, '申购')
      const netAmount = req.amount - fee
      const shares = Number((netAmount / product.nav).toFixed(2))

      applyBalance(account.id, -req.amount)
      pushTransaction(
        {
          accountId: account.id,
          direction: 'out',
          amount: req.amount,
          signedAmount: -req.amount,
          counterparty: `申购 · ${product.name}`,
          memo: `申购 ${product.name}`,
          category: 'other',
          createdAt: new Date().toISOString(),
          status: 'success',
        },
        {
          channel: 'account',
          paymentMethod: account.label,
          accountLabel: account.label,
          accountNo: account.accountNo,
          settleCurrency: account.currency,
          location: '招财猫银行 App',
          remark: fee > 0 ? `申购费 ¥${(fee / 100).toFixed(2)}（内扣）` : '申购费免费',
        },
      )

      // 同一产品合并持仓，按加权平均重算买入净值
      const existing = db.holdings.find((h) => h.productCode === product.code)
      const confirmedAt = new Date().toISOString()
      if (existing) {
        const totalShares = existing.shares + shares
        existing.costNav =
          (existing.shares * existing.costNav + shares * product.nav) / totalShares
        existing.shares = totalShares
        existing.principal += req.amount
      } else {
        db.holdings.push({
          id: nextId('hold'),
          productCode: product.code,
          productName: product.name,
          category: product.category,
          risk: product.risk,
          shares,
          costNav: product.nav,
          principal: req.amount,
          marketValue: 0,
          profit: 0,
          profitRate: 0,
          purchasedAt: confirmedAt,
          redeemableAt: product.openEnded ? null : inDaysFromNow(product.term),
          closed: !product.openEnded,
        })
      }
      persist()

      const holding = withDerivedHoldings(db).find((h) => h.productCode === product.code)!
      return { holding, confirmedAt, shares, nav: product.nav, fees: fee }
    },

    async redeemWealth(req: WealthRedeemRequest): Promise<WealthRedeemResult> {
      await delay(560)
      const db = loadDb()
      const holding = db.holdings.find((h) => h.id === req.holdingId)
      if (!holding) throw new ApiError('持仓不存在', 404, 'HOLDING_NOT_FOUND')
      const product = productByCode(holding.productCode)

      const derived = withDerivedHoldings(db).find((h) => h.id === holding.id)!
      if (derived.closed) {
        throw new ApiError(
          `该产品处于封闭期，${formatDate(derived.redeemableAt!)} 起可赎回`,
          400,
          'IN_CLOSED_PERIOD',
        )
      }

      const shares = req.shares == null ? holding.shares : req.shares
      if (shares <= 0) throw new ApiError('赎回份额必须大于 0', 400, 'INVALID_SHARES')
      if (shares > holding.shares) throw new ApiError('赎回份额超过持有份额', 400, 'EXCEED_SHARES')

      const gross = Math.round(shares * product.nav)
      const { fee } = oneOffFee(product, gross, '赎回')
      const net = gross - fee
      const account = settlementAccount(db)

      applyBalance(account.id, net)
      pushTransaction(
        {
          accountId: account.id,
          direction: 'in',
          amount: net,
          signedAmount: net,
          counterparty: `赎回 · ${product.name}`,
          memo: `赎回 ${product.name}`,
          category: 'other',
          createdAt: new Date().toISOString(),
          status: 'success',
        },
        {
          channel: 'account',
          paymentMethod: account.label,
          accountLabel: account.label,
          accountNo: account.accountNo,
          settleCurrency: account.currency,
          location: '招财猫银行 App',
          remark: fee > 0 ? `赎回费 ¥${(fee / 100).toFixed(2)}（已扣除）` : '赎回费免费',
        },
      )

      // 按份额比例扣减本金，剩下的继续持有
      const ratio = shares / holding.shares
      holding.principal = Math.round(holding.principal * (1 - ratio))
      holding.shares = Number((holding.shares - shares).toFixed(2))
      if (holding.shares <= 0) {
        db.holdings = db.holdings.filter((h) => h.id !== holding.id)
      }
      persist()

      return {
        holdingId: holding.id,
        acceptedAt: new Date().toISOString(),
        shares,
        estimatedAmount: net,
        etaText: '预计 T+1 个工作日到账',
      }
    },

    async getSpending(month?: string): Promise<SpendingAnalysis> {
      await delay(220)
      const db = loadDb()
      const target = month ?? monthKey()
      const prev = monthKey(-1)
      const out = db.transactions.filter((t) => t.direction === 'out')

      const inMonth = (iso: string, key: string) => iso.slice(0, 7) === key
      const monthRows = out.filter((t) => inMonth(t.createdAt, target))
      const prevRows = out.filter((t) => inMonth(t.createdAt, prev))

      const total = monthRows.reduce((sum, t) => sum + t.amount, 0)
      const prevTotal = prevRows.reduce((sum, t) => sum + t.amount, 0)

      const byCategory = new Map<TransactionCategory, Cents>()
      for (const t of monthRows) {
        byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount)
      }
      // 环形图与「最大支出分类」都按金额从大到小排，避免图表顺序误导
      const categories: SpendingCategory[] = [...byCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, amount]) => ({
          key,
          label: CATEGORY_LABEL[key],
          amount,
          ratio: total === 0 ? 0 : amount / total,
        }))

      const trend: SpendingTrendPoint[] = []
      for (let i = 5; i >= 0; i -= 1) {
        const key = monthKey(-i)
        trend.push({
          month: key,
          amount: out
            .filter((t) => inMonth(t.createdAt, key))
            .reduce((sum, t) => sum + t.amount, 0),
        })
      }

      return {
        month: target,
        total,
        monthOverMonth: prevTotal === 0 ? 0 : (total - prevTotal) / prevTotal,
        categories,
        trend,
      }
    },

    async getCashFlow(days = 7): Promise<CashFlow> {
      await delay(200)
      const db = loadDb()
      const points: CashFlowPoint[] = []

      for (let i = days - 1; i >= 0; i -= 1) {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        start.setDate(start.getDate() - i)
        const end = new Date(start)
        end.setDate(end.getDate() + 1)

        const rows = db.transactions.filter((t) => {
          const at = new Date(t.createdAt).getTime()
          return at >= start.getTime() && at < end.getTime()
        })

        points.push({
          date: dayKey(start),
          income: rows
            .filter((t) => t.direction === 'in')
            .reduce((sum, t) => sum + t.amount, 0),
          expense: rows
            .filter((t) => t.direction === 'out')
            .reduce((sum, t) => sum + t.amount, 0),
        })
      }

      return {
        days,
        points,
        totalIncome: points.reduce((sum, p) => sum + p.income, 0),
        totalExpense: points.reduce((sum, p) => sum + p.expense, 0),
      }
    },

    async listAutoDebits(): Promise<AutoDebit[]> {
      await delay(160)
      return loadDb().autoDebits
    },

    async setAutoDebitEnabled(id, enabled) {
      await delay(220)
      const item = loadDb().autoDebits.find((a) => a.id === id)
      if (!item) throw new ApiError('扣款计划不存在', 404, 'AUTODEBIT_NOT_FOUND')
      item.enabled = enabled
      persist()
      return item
    },

    async getSecurityOverview(): Promise<SecurityOverview> {
      await delay(200)
      return withDerivedSecurity()
    },

    async setSecurityRule(id, enabled) {
      await delay(240)
      const db = loadDb()
      const rule = db.security.riskRules.find((r) => r.id === id)
      if (!rule) throw new ApiError('风控规则不存在', 404, 'RULE_NOT_FOUND')
      rule.enabled = enabled
      db.security.logs.unshift({
        id: nextId('log'),
        action: enabled ? '开启风控规则' : '关闭风控规则',
        detail: rule.label,
        createdAt: new Date().toISOString(),
        level: enabled ? 'info' : 'warn',
      })
      persist()
      return withDerivedSecurity()
    },

    async changePhone(req): Promise<User> {
      await delay(640)
      const db = loadDb()
      const next = digitsOnly(req.newPhone)

      if (!/^1[3-9]\d{9}$/.test(next)) throw new ApiError('请输入 11 位手机号', 400, 'INVALID_PHONE')
      if (next === db.user.phone) {
        throw new ApiError('新手机号与当前登录手机号相同', 400, 'SAME_PHONE')
      }
      // 换号是高危操作：先核身
      if (!req.faceTicket) throw new ApiError('请先完成人脸识别', 400, 'FACE_REQUIRED')

      // 再验新号的短信 —— 证明这个号真是你的
      const sms = db.pendingSms
      if (!sms) throw new ApiError('请先获取短信验证码', 400, 'SMS_NOT_SENT')
      if (sms.phone !== next) {
        throw new ApiError('验证码不是发往该手机号的，请重新获取', 400, 'SMS_PHONE_MISMATCH')
      }
      if (Date.now() > new Date(sms.expiresAt).getTime()) {
        db.pendingSms = null
        persist()
        throw new ApiError('验证码已过期，请重新获取', 400, 'SMS_EXPIRED')
      }
      if (req.smsCode.replace(/\D/g, '') !== sms.code) {
        throw new ApiError('验证码不正确', 400, 'BAD_SMS_CODE')
      }

      const previous = db.user.phone
      db.pendingSms = null
      db.user.phone = next
      // 换绑手机号要留痕：这类操作在安全日志里必须是 warn 级
      db.security.logs.unshift({
        id: nextId('log'),
        action: '更换登录手机号',
        detail: `${maskPhone(previous)} → ${maskPhone(next)}`,
        createdAt: new Date().toISOString(),
        level: 'warn',
      })
      persist()
      return db.user
    },

    async changePassword(oldPassword, newPassword) {
      await delay(420)
      const db = loadDb()
      if (await passwordDigest(oldPassword) !== db.passwordDigest) {
        throw new ApiError('原密码不正确', 400, 'BAD_OLD_PASSWORD')
      }
      if (newPassword.length < 6) {
        throw new ApiError('新密码至少 6 位', 400, 'WEAK_PASSWORD')
      }
      db.passwordDigest = await passwordDigest(newPassword)
      db.security.logs.unshift({
        id: nextId('log'),
        action: '修改登录密码',
        detail: '密码已更新，请在其他设备重新登录',
        createdAt: new Date().toISOString(),
        level: 'info',
      })
      persist()
    },

    async verifyIdentity(channel) {
      await delay(600)
      return { ticket: `verify.${channel}.${Date.now()}` }
    },

    async listSupportMessages(): Promise<SupportMessage[]> {
      await delay(120)
      const history = storage.get<SupportMessage[] | null>(STORAGE_KEYS.supportHistory, null)
      if (history?.length) return history
      return [
        {
          id: nextId('msg'),
          role: 'agent',
          createdAt: new Date().toISOString(),
          text: '你好，我是招财猫银行的智能客服。转账、锁卡、密码重置、消费分析都可以问我。',
        },
      ]
    },

    async sendSupportMessage(text) {
      await delay(650)
      return cannedReply(text)
    },
  }
}
