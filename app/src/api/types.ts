/* ==========================================================================
   领域模型 —— 前端与后端的共享契约
   金额一律使用「分」为单位的整数（Cents），避免浮点误差。
   这些类型就是后端接口的返回结构，接真后端时前端零改动。
   ========================================================================== */

/** 金额，单位：分 */
export type Cents = number

export type Currency = 'CNY' | 'USD' | 'HKD'

export type AccountKind = 'current' | 'savings' | 'deposit'

export interface User {
  id: string
  name: string
  phone: string
  memberLevel: string
  avatarInitial: string
}

/**
 * 本行给客户的**收款信息** —— 别人要转钱给你时，把这些抄进他那边银行 App 的收款人栏。
 *
 * 真实系统里这是后端按账户 + 转数快登记拼出来的：账户号归银行账户转账用，
 * 转数快标识归转数快用，两者不能混。所以这里也由接口下发，而不是前端自己拼。
 */
export interface ReceivingInfo {
  /** 收款户名：银行账户转账时对方填的户名 */
  holder: string
  /** 收款账户号 */
  accountNo: string
  /** 账户类型说明（活期 / 储蓄…），帮对方确认没抄错 */
  accountLabel: string
  bankName: string
  bankRegion: BankRegion
  /** 转数快手机号：对方用转数快转给你时填这个 */
  fpsMobile: string
  /** 转数快 FPS ID */
  fpsId: string
}

export interface Account {
  id: string
  kind: AccountKind
  label: string
  accountNo: string
  currency: Currency
  balance: Cents
  available: Cents
  /** 年化利率，如 0.0155 表示 1.55% */
  interestRate: number
  /** 本月净变动（收入 - 支出），由后端汇总，用于首页涨跌标签 */
  monthNetChange: Cents
}

export type TransactionDirection = 'in' | 'out'

export type TransactionCategory =
  | 'salary'
  | 'transfer'
  | 'dining'
  | 'shopping'
  | 'housing'
  | 'transport'
  | 'subscription'
  | 'other'

/** 交易状态 */
export type TransactionStatus = 'success' | 'pending' | 'failed'

/**
 * 交易渠道。
 * 决定交易详情页显示哪一组字段：卡类交易有授权码与商户信息，
 * 转账有对方账号与对方银行，账户划转两者都没有。
 */
export type TransactionChannel =
  | 'quickpay' /* 网上交易 */
  | 'card' /* 刷卡消费 */
  | 'transfer' /* 转账汇款 */
  | 'account' /* 账户划转 / 代发入账 */
  | 'interest' /* 利息结算 */

export interface Transaction {
  id: string
  accountId: string
  direction: TransactionDirection
  amount: Cents
  /** 正数为收入，负数为支出，等于 direction 的带符号表达 */
  signedAmount: Cents
  counterparty: string
  memo: string
  category: TransactionCategory
  createdAt: string
  status: TransactionStatus
}

/**
 * 交易附加明细。
 *
 * 刻意与台账行分开：**列表接口不下发这些字段**，只有交易详情接口返回。
 * 列表只要够渲染一行（对方、时间、金额），详情才是「凭证」。
 * 这样接真后端时分页列表的体积不会因为明细字段而膨胀。
 */
export interface TransactionDetail {
  /** 交易编号（凭证号），唯一且不可变，客服核对时以此为准 */
  referenceNo: string
  channel: TransactionChannel
  /** 支付方式，如「招财猫 · 星享借记卡 尾号 8888」 */
  paymentMethod: string
  /** 记账账户 */
  accountLabel: string
  accountNo: string
  /** 记账币种，与账户币种一致 */
  settleCurrency: Currency
  /** 交易前 / 交易后余额，供对账 */
  balanceBefore: Cents
  balanceAfter: Cents
  /**
   * 对方户名（回单上的收款人 / 付款人）。
   * 台账行的 counterparty 是列表标题（可能是「转账 · 陈嘉禾」「本月房租」这类描述），
   * 回单需要的是干净的人名或机构名。
   */
  counterpartyName?: string
  /** 商户编号（收单机构分配） */
  merchantId?: string
  /** 商户注册国家或地区 */
  merchantCountry?: string
  /** 商户注册城市 */
  merchantCity?: string
  /** 对方账号（已脱敏） */
  counterpartyAccountNo?: string
  /** 对方开户行 / 收单机构 / 付款单位 */
  counterpartyBank?: string
  /** 交易发生地点 */
  location?: string
  /** 附言 */
  remark?: string
  /** 卡类 / 快捷支付的授权码 */
  authCode?: string
  /** 外币交易的原交易金额与币种（ISO 4217） */
  originAmount?: Cents
  originCurrency?: Currency
  /**
   * 记账汇率：1 原币 = ? 记账币。
   * 与 ZA / Alipay+ 的口径一致 —— 已包含外币交易手续费，不再单独列示。
   */
  exchangeRate?: number
  /** 汇率说明 */
  exchangeRateNote?: string
}

/** 交易详情接口的返回：台账行 + 附加明细 */
export interface TransactionRecord extends Transaction {
  detail: TransactionDetail
}

export interface Paged<T> {
  items: T[]
  page: number
  size: number
  total: number
}

export type TransferScope = 'domestic' | 'overseas'

/** 转账方式：银行账户 或 转数快（FPS） */
export type TransferChannel = 'bank' | 'fps'

/**
 * 转数快收款标识类型（已登记收款人）。
 * 姓名由转数快中央解析回显给付款人核对，所以界面上不需要用户手填姓名。
 */
export type FpsIdType = 'mobile' | 'email' | 'fpsid'

/**
 * 汇款方式。
 * 'account' = 用收款账号转账；其余三种 = 用转数快标识。
 * 注意：跨境支付通（如工行 → 香港银行）走的是跨境清算，
 * **四种方式都必须指定收款银行**，因为款项要路由到具体收款行；
 * 只有香港本地转数快才是「不选银行、由标识解析」。
 */
export type FpsMethod = FpsIdType | 'account'

/**
 * 转数快标识解析结果。
 * 转数快由 HKICL 集中解析：付款人只输标识，系统回显已登记的收款人姓名与收款银行，
 * 付款人核对后才付款 —— 所以「信息确认」这一步才出现收款人姓名。
 */
export interface FpsResolveResult {
  registered: boolean
  /** 已登记时返回：部分隐藏的户口名称 */
  name?: string
  bankName?: string
  bankCode?: string
  /** 转数快是香港清算网络，登记银行必为香港机构 */
  bankRegion?: BankRegion
  /** 该标识绑定的银行 / SVF 数量 */
  bankCount?: number
  /** 未登记时的说明 */
  reason?: string
}

export interface Payee {
  id: string
  name: string
  channel: TransferChannel
  bankCode?: string
  /** bankCode 属于哪个市场。3 位清算代码两地会撞号，必须成对使用 */
  bankRegion?: BankRegion
  bankName?: string
  accountNo?: string
  /** channel === 'fps' */
  fpsMethod?: FpsMethod
  fpsId?: string
  payeeCurrency?: Currency
  scope: TransferScope
  lastUsedAt: string
}

/** 银行所在市场：内地 / 香港 */
export type BankRegion = 'CN' | 'HK'

/**
 * 收款银行。
 *
 * `code` 是**本市场的清算行别代码（3 位）**，两地的体系不同但结构对应：
 * - 内地 = 人民银行《支付系统银行行别、行号业务标准》的银行行别代码（102 工商、104 中行…）
 * - 香港 = HKICL 清算所银行代码（004 汇丰、012 中银香港…）
 *
 * ⚠️ 两套码表相互独立，**code 单独不唯一**（完整码表里 307 / 308 / 309 / 316
 *    两地都有机构在用）。所以定位一家银行必须带 region —— 真实跨境接口也是用
 *    (国家/地区, 清算代码) 这一对来定位的。
 */
export interface Bank {
  code: string
  region: BankRegion
  name: string
  shortName: string
  /** 近似品牌色，用行标加载失败时的文字色块兜底，不是官方色值 */
  color: string
  /** 官网域名：行标的来源，也用来核对这家银行 */
  domain?: string
  /**
   * 行标路径。已下载到本仓库 `app/public/banks/`，不外链第三方图床
   * （既不靠谱也不该让客户端每次渲染银行列表都去打别人的服务器）。
   * 真后端换成自己托管的官方素材 URL 即可；为空时 UI 退回文字色块。
   */
  logo?: string
  /**
   * 该行**常用借记卡号段**（卡号前 6 位）。
   *
   * 只用于「选定收款行 → 补全卡号前缀」这一个交互：一家银行有几十个 BIN，
   * 这只是最常见的那一个，用户卡号不同时直接覆盖即可。
   *
   * 完整的 BIN 表不下发（十万量级、随发卡行新增号段而变），
   * 反查「输卡号认银行」走 `resolveCardBin` 接口。香港的银行账户号不含机构标识，故为空。
   */
  primaryBin?: string
  /**
   * 本行（虚构机构，不占用真实行别代码与卡号号段）。
   *
   * 本行账户由本行自己核验，不参与卡 BIN 识别 —— 所以界面不会对它的账号
   * 报「暂不支持该银行」。这个标记是给界面判断用的，不写死在代码里比 code === 'LCB' 清楚。
   */
  internal?: boolean
}

/**
 * 卡 BIN 前缀识别请求。
 *
 * 真实转账里「输卡号自动带出发卡行」**不是前端查表**，而是一次银联 / 网联的卡 BIN 查询：
 * BIN 表有十万量级、且会随发卡行新增号段而变化，不可能下发给客户端。所以这里也走接口。
 */
export interface CardBinQuery {
  /** 用户已输入的卡号数字；不足 CARD_BIN_LENGTH 位时调用方不必发起查询 */
  digits: string
  /**
   * 在哪个市场里找。
   * 内地卡是银联卡号，前 6 位即发卡行；香港这侧走的是**银行账户号**，
   * 账号本身不含任何机构标识（这正是香港转账必须手选收款行的原因），故没有 BIN 概念。
   */
  region: BankRegion
}

/** 卡 BIN 前缀识别结果 */
export type CardBinResolution =
  | {
      status: 'matched'
      /** 命中的 BIN（前 6 位） */
      bin: string
      /** 发卡行，已带行标等展示字段，前端不用再查一次名录 */
      bank: Bank
    }
  /** 位数还不够，等用户继续输 */
  | { status: 'incomplete'; need: number }
  /** 前缀不属于任何已支持银行 —— 界面提示「暂不支持该银行」 */
  | { status: 'unsupported' }
  /** 该市场没有卡 BIN 概念（香港银行账户） */
  | { status: 'not-applicable' }

export interface TransferQuoteRequest {
  /** 从哪个账户出账：可用余额与扣账币种都取决于它 */
  fromAccountId: string
  channel: TransferChannel
  scope: TransferScope
  amount: Cents
  /** channel === 'bank' 时必填 */
  bankCode?: string
  /** 与 bankCode 成对：3 位清算代码两地会撞号 */
  bankRegion?: BankRegion
  /** 收款币种。与扣账币种不同时后端要给出换汇报价 */
  payeeCurrency?: Currency
}

/**
 * 换汇报价。
 *
 * 核心约定：**报价必须锁价**。汇率是时效性数据，用户看到的价格和最终成交的价格
 * 必须一致，所以带上 quoteTtlSeconds / quotedAt —— 过期就得重新询价，
 * 不能拿旧价格去成交。
 *
 * 点差已经包含在 rate 里，不再单独收一笔换汇手续费（与 ZA 的回单口径一致：
 * 汇率那行注明「已包括 x% 」。）
 */
export interface FxQuote {
  /** 扣账币种（付款账户的币种） */
  fromCurrency: Currency
  /** 收款币种 */
  toCurrency: Currency
  /** 1 扣账币 = ? 收款币。回单要反向口径（1 原币 = ? 记账币）时取 1 / rate */
  rate: number
  /** 扣账金额（扣账币） */
  fromAmount: Cents
  /** 换汇后收款金额（收款币） */
  toAmount: Cents
  /** 点差，如 0.0035 表示 0.35% */
  spread: number
  /** 报价有效期（秒） */
  quoteTtlSeconds: number
  /** 报价生成时间 */
  quotedAt: string
}

export interface TransferQuote {
  fee: Cents
  /** 预计到账时间文案 */
  etaText: string
  /** 可转出的最大金额 */
  maxAmount: Cents
  /** 该通道的单笔上限 */
  singleLimit: Cents
  /** 是否触发风控二次确认 */
  requiresConfirm: boolean
  confirmReason?: string
  /** 该通道的说明文案 */
  channelNote: string
  /** 需要换汇时才有（扣账币种 ≠ 收款币种） */
  fx?: FxQuote
}

export interface TransferRequest {
  fromAccountId: string
  channel: TransferChannel
  scope: TransferScope
  /** 收款人姓名。FPS 标识方式下由系统解析得到，账号方式下由用户填写 */
  payeeName: string
  amount: Cents
  memo: string
  /** channel === 'bank' 或 'fps' 都必填：跨境转账需要路由到具体收款行 */
  payeeBankCode?: string
  /** 与 payeeBankCode 成对：3 位清算代码两地会撞号，必须带上市场 */
  payeeBankRegion?: BankRegion
  payeeAccountNo?: string
  /** channel === 'fps' */
  fpsMethod?: FpsMethod
  fpsId?: string
  /** FPS 收款币种：转数快同时支持人民币与港币 */
  payeeCurrency?: Currency
  /** 收款地址，选填 */
  payeeAddress?: string
}

export interface TransferRecipientLookup {
  bankCode: string
  bankRegion: BankRegion
  accountOrCardNo: string
  payeeName?: string
}

export interface TransferRecipientResult {
  /** 本行可真实入账的演示用户；其他行由演示清算流程处理。 */
  kind: 'internal' | 'external'
  holderNameMasked?: string
  accountNoMasked: string
  cardLast4?: string
}

export interface TransferResult {
  transactionId: string
  referenceNo: string
  amount: Cents
  fee: Cents
  channel: TransferChannel
  /** 脱敏后的收款标识，用于回执展示 */
  identifier: string
  createdAt: string
  /** 本行收款实时成功；外行演示汇款仅进入模拟清算队列。 */
  settlementStatus?: 'success' | 'pending'
  /** 实际成交的换汇信息（含成交汇率）。锁价成功的凭证就是这里的 rate */
  fx?: FxQuote
}

/* ==========================================================================
   导出：流水数据集 与 电子回单文件
   —— 这两件事都必须由后端产出，前端只负责文件机制。接口先在这里定死，
      真后端接上时业务代码零改动（mock 已经按同一份契约实现了一遍）。
   ========================================================================== */

export interface ExportColumn {
  key: string
  label: string
}

/**
 * 流水导出数据集。
 *
 * 为什么由后端给「列 + 已格式化的值」而不是前端自己拼：
 * 导出哪些字段、金额怎么表达、账号怎么脱敏，是银行的账务与合规口径，
 * 不是前端的展示选择。前端只负责文件机制（转义、BOM、文件名、触发下载）。
 *
 * 真后端若更希望直接流式返回文件，在返回体上加一个 `downloadUrl`
 * 让前端优先使用即可 —— 那是纯增量，不影响现有字段。
 */
export interface ExportDataset {
  /** 导出批次号：客服对账时用它定位这一次导出 */
  batchNo: string
  generatedAt: string
  /** 建议文件名，含时间范围 */
  fileName: string
  total: number
  /** 实际导出数据覆盖的时间范围（按行取首尾），无数据时为 null */
  range: { from: string; to: string } | null
  columns: ExportColumn[]
  /** 每行的值已按银行口径格式化好 */
  rows: Record<string, string>[]
}

export interface ExportQuery {
  /** YYYY-MM-DD，留空表示不限 */
  from?: string
  to?: string
  category?: TransactionCategory | 'all'
  keyword?: string
}

/**
 * 电子回单文件。
 *
 * 真后端返回**带签名的临时下载地址**——银行回单不允许长期公开可访问，
 * 所以给的是有时效的 URL 而不是固定路径。
 * 演示环境没有服务端 PDF 能力，`url` 为 null，前端退回浏览器打印
 * （打印对话框里选「另存为 PDF」）。这个 null 是能力声明，不是错误。
 */
export interface ReceiptFile {
  fileName: string
  /** 签名下载地址；null = 该部署不提供 PDF 生成，请退回浏览器打印 */
  url: string | null
  expiresAt: string | null
}

export type CardStatus = 'active' | 'locked' | 'pending' | 'replaced'

/**
 * 卡面主题（设计属性）。
 * 与卡组织分开：一张 Visa 卡可以是深色也可以是金色，两者互不决定。
 */
export type CardTheme = 'ink' | 'gold'

/**
 * 卡组织（业务属性）。决定卡面上印哪个标：
 * visa → Visa 标；unionpay → 银联标。
 * 注意本行自有品牌不再是卡组织 —— 星享借记卡同样走 Visa 网络。
 */
export type CardNetwork = 'visa' | 'unionpay'

export type CardKind = 'debit' | 'credit'

/**
 * 邮寄地址。
 * 申卡/换卡都要寄实体卡，所以这是开卡的必填项，不是选填资料。
 */
export interface MailingAddress {
  /** 收件人 */
  recipient: string
  phone: string
  /** 省 / 直辖市 */
  region: string
  city: string
  /** 详细地址：街道、门牌、楼层房号 */
  detail: string
  postalCode?: string
}

/**
 * 可申请的卡产品。
 * 费用与权益由后端给 —— 定价是业务口径，不该写死在前端。
 */
export interface CardProduct {
  code: string
  name: string
  theme: CardTheme
  network: CardNetwork
  kind: CardKind
  /** 制卡工本费 */
  issuingFee: Cents
  /** 寄送费 */
  deliveryFee: Cents
  /** 权益说明，逐条展示 */
  perks: string[]
  /** 预计寄达工作日 */
  deliveryDays: number
}

/**
 * 开卡申请。
 *
 * `paymentPassword` 是**支付密码**，不是登录密码 —— 扣钱这一步必须单独验证，
 * 而且只在本次请求里传输，不落库（真后端同理：只做校验，不存明文）。
 */
export interface CardApplication {
  productCode: string
  address: MailingAddress
  /** 6 位数字支付密码 */
  paymentPassword: string
}

/** 换卡申请：同样要寄卡，所以也要地址 + 支付密码 */
export interface CardReplaceRequest {
  address: MailingAddress
  paymentPassword: string
}

export interface BankCard {
  id: string
  /**
   * 卡所绑定的**资金账户**。
   *
   * 卡是支付工具、账户才装钱 —— 刷卡时是从这个账户扣款。
   * 这个字段是必填的：一张不绑账户的卡在业务上不成立。
   */
  accountId: string
  productName: string
  /** 卡号后四位 */
  last4: string
  cardholder: string
  expiry: string
  theme: CardTheme
  network: CardNetwork
  kind: CardKind
  status: CardStatus
  /** 线上支付开关 */
  onlinePayment: boolean
  /** 境外交易开关 */
  overseasPayment: boolean
  dailyLimit: Cents
  /** 申请时填写的邮寄地址，卡还在路上时用于回显 */
  shippingAddress?: MailingAddress
  /** 已收取的制卡费用合计（工本费 + 寄送费） */
  issuingFee?: Cents
}

/**
 * 卡安全码（CVV / CVC）。
 *
 * **刻意不放进 `BankCard`**，也不随 `listCards()` 下发 —— 卡列表接口是渲染列表用的，
 * 里面混进安全码就等于「每次打开卡片页都把安全码传到前端」。真实系统里 CVV 属于
 * 持卡人验证信息，PCI DSS 明确要求授权后不得留存，界面要看也必须单独验身再取。
 *
 * 所以它走一个单独的接口 `revealCardSecrets`：必须带支付密码，且只在**本次响应**里出现，
 * 前端不落 localStorage。有效期本身不是秘密（就印在卡面上），跟着一起回来只是为了
 * 「查看卡片信息」这一处能一次拿全。
 */
export interface CardSecrets {
  /**
   * 完整卡号。
   *
   * 号段取**真实感**的借记卡号段（Visa `402688` / 银联 `620522`），校验位算到满足 Luhn ——
   * 真卡都满足 Luhn，校验位错了会一眼露馅。代价是**理论上可能与某张真卡撞号**，
   * 这是明确做过的取舍：演示要「看起来像真卡」，就不再用 Visa 的测试号段那样牺牲真实感。
   */
  pan: string
  /** 卡有效期 MM/YY —— 印在卡面上，不是秘密 */
  expiry: string
  /** 3 位安全码 */
  cvv: string
  /** 服务端给出的可见时长（秒）。到点界面必须遮盖，不能一直摊着 */
  revealSeconds: number
}

export interface SpendingCategory {
  key: TransactionCategory
  label: string
  amount: Cents
  ratio: number
}

export interface SpendingTrendPoint {
  month: string
  amount: Cents
}

/** 现金流图表的单日数据点 */
export interface CashFlowPoint {
  /** YYYY-MM-DD */
  date: string
  income: Cents
  expense: Cents
}

export interface CashFlow {
  days: number
  points: CashFlowPoint[]
  totalIncome: Cents
  totalExpense: Cents
}

export interface SpendingAnalysis {
  month: string
  total: Cents
  monthOverMonth: number
  categories: SpendingCategory[]
  trend: SpendingTrendPoint[]
}

export interface AutoDebit {
  id: string
  merchant: string
  amount: Cents
  cycle: string
  nextRunAt: string
  enabled: boolean
  category: TransactionCategory
}

export interface SecurityDevice {
  id: string
  name: string
  location: string
  lastActiveAt: string
  current: boolean
}

export interface SecurityLog {
  id: string
  action: string
  detail: string
  createdAt: string
  level: 'info' | 'warn'
}

export interface SecurityOverview {
  /** 0-100 */
  score: number
  level: string
  identityVerified: boolean
  devices: SecurityDevice[]
  logs: SecurityLog[]
  riskRules: { id: string; label: string; description: string; enabled: boolean }[]
}

export interface SupportMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  createdAt: string
  /** 客服给出的可点操作，例如跳转到转账 */
  actions?: { label: string; to: string }[]
}

export interface SupportReply {
  message: SupportMessage
  /** 是否为固定话术（MVP 阶段无真实模型） */
  canned: boolean
}
/* ==========================================================================
   理财（投资与资产）
   --------------------------------------------------------------------------
   字段口径对着监管来，不是随手加的：

   · 《理财公司理财产品销售管理暂行办法》（银保监会令 2021 年第 4 号）
     - 理财产品是**非保本**产品，不得宣传预期收益率（第二十五条）
     - 风险评级至少一级至五级（第三十条）
     - 风险承受能力评估超过一年须重做（第三十一条）
     - 风险揭示书须含「理财非存款、产品有风险、投资须谨慎」，
       并要求投资者**完整抄录**确认语句（第四十九条）
   · 《银行保险机构资产管理产品信息披露管理办法》（2026-09-01 施行）
     - 风险等级用通俗说法前置，R 符号次要
     - 业绩比较基准须说明测算依据，且必须声明「不是预期收益率…不构成收益承诺」
   ========================================================================== */

/**
 * 产品风险等级。至少一级至五级 —— 这是监管的下限，不是产品设计选择。
 * 通俗说法（低/中低/中/中高/高）在 lib/wealth.ts 里映射。
 */
export type RiskLevel = 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

/** 投资者风险承受能力等级 */
export type RiskTolerance = 'C1' | 'C2' | 'C3' | 'C4' | 'C5'

/** 理财产品分类（按投资性质） */
export type WealthCategory =
  | 'cash' /* 现金管理类 */
  | 'fixed' /* 固定收益类 */
  | 'mixed' /* 混合类 */
  | 'equity' /* 权益类 */
  | 'derivative' /* 商品及金融衍生品类 */

/**
 * 业绩比较基准。
 *
 * 新规之后**不允许单独或突出使用绝对数值 / 区间数值**（第二十五条第三项），
 * 所以公式型是第一等公民，数字区间只是存量兼容 —— 取用时一律要带上测算依据说明。
 */
export type Benchmark =
  | {
      kind: 'formula'
      /** 公式型：挂钩指数的表达式 */
      formula: string
      /** 测算依据说明 —— 监管要求必须有 */
      basis: string
    }
  | {
      kind: 'range'
      low: number
      high: number
      /** 数字区间同样要说明测算依据 */
      basis: string
    }

/** 费率。区分「按日计提」与「一次性收取」—— 两者的承担方式完全不同 */
export interface FeeItem {
  label: string
  /** 年化费率，如 0.0015 = 0.15% */
  rate: number
}

export interface NavPoint {
  /** YYYY-MM-DD */
  date: string
  nav: number
}

/** 前十大资产。新规要求公募产品同时披露穿透前与穿透后 */
export interface AssetHolding {
  name: string
  weight: number
  /** true = 穿透后；false = 穿透前 */
  lookThrough: boolean
}

export interface WealthProduct {
  code: string
  name: string
  /** 发行方（理财公司） */
  issuer: string
  category: WealthCategory
  risk: RiskLevel
  /**
   * 是否保本。理财一律非保本，这里写成字面量 false：
   * 类型系统直接堵死「给理财标保本」这条路。
   */
  principalProtected: false
  benchmark: Benchmark
  /** 七日年化，仅现金管理类有（其余用净值表现） */
  sevenDayYield?: number
  /** 最新单位净值 */
  nav: number
  navDate: string
  /** 成立以来年化 */
  sinceInception: number
  /** 近一个月年化波动率，用于说明风险 */
  volatility: number
  minAmount: Cents
  stepAmount: Cents
  /** 期限描述：随时赎回 / 90 天 / 365 天… */
  term: string
  openEnded: boolean
  /** 按日计提、已体现在净值里，投资者看不到单独扣款 */
  ongoingFees: FeeItem[]
  /** 一次性收取、投资者额外承担 */
  transactionFees: FeeItem[]
  navHistory: NavPoint[]
  topHoldings: AssetHolding[]
}

export interface WealthHolding {
  id: string
  productCode: string
  productName: string
  category: WealthCategory
  risk: RiskLevel
  shares: number
  /** 买入确认净值 */
  costNav: number
  /** 投入本金 */
  principal: Cents
  /** 最新市值 */
  marketValue: Cents
  profit: Cents
  profitRate: number
  /** 确认日期 */
  purchasedAt: string
  /** 封闭期结束、可赎回的日期；活期为 null */
  redeemableAt: string | null
  /**
   * 当前是否处于封闭期。
   * 由后端判定而不是前端拿 Date.now() 在渲染期算 —— 那会让渲染变成非纯函数，
   * 而且「能不能赎回」本来就是服务端事实。
   */
  closed: boolean
}

export interface WealthOverview {
  /** 理财账户；未开立时持仓与申购都不可用 */
  account: WealthAccount
  totalValue: Cents
  totalPrincipal: Cents
  totalProfit: Cents
  /** 昨日收益 */
  yesterdayProfit: Cents
  holdings: WealthHolding[]
  risk: RiskAssessment
}

export interface RiskQuestion {
  id: string
  question: string
  options: { label: string; score: number }[]
}

export interface RiskAssessment {
  done: boolean
  level: RiskTolerance
  score: number
  assessedAt: string
  /** 监管：超过一年未评估须重做 */
  expiresAt: string
  /** 是否已过期（过期等同于没做） */
  expired: boolean
}

/**
 * 申购请求。
 *
 * `riskAcknowledgement` 是**投资者完整抄录**的风险确认语句 ——
 * 监管要求的是抄录，不是一个勾选框（第四十九条第七项）。
 */
export interface WealthSubscribeRequest {
  productCode: string
  amount: Cents
  paymentPassword: string
  riskAcknowledgement: string
}

export interface WealthSubscribeResult {
  holding: WealthHolding
  /** 确认信息：监管要求及时告知确认日期、确认份额和金额（第三十九条） */
  confirmedAt: string
  shares: number
  nav: number
  /** 一次性费用合计 */
  fees: Cents
}

export interface WealthRedeemRequest {
  holdingId: string
  /** 赎回份额；省略表示全部赎回 */
  shares?: number
}

export interface WealthRedeemResult {
  holdingId: string
  /** 「T+1」到账：先给受理结果，再给预计到账时间 */
  acceptedAt: string
  shares: number
  /** 预计到账金额（按当前净值估算） */
  estimatedAmount: Cents
  etaText: string
}

/* ==========================================================================
   注册并开立默认储蓄账户
   ========================================================================== */

export interface SmsCodeResult {
  sent: boolean
  expiresAt: string
  /**
   * 仅演示环境返回验证码 —— 真实后端**绝不会**把它下发给前端。
   * 有这个字段才能在纯前端演示里走通流程，所以明确标注出来。
   *
   * **必须是选填**：真后端不返回它，写成必填的话类型系统会骗人 ——
   * 界面会照常渲染 `演示环境验证码：undefined`，而且编译期一句话都不说。
   */
  demoCode?: string
}

/** 注册申请。确认密码只在客户端校验，不进入契约。 */
export interface RegistrationRequest {
  phone: string
  password: string
  holderName: string
  idNumber: string
  smsCode: string
  faceTicket: string
  pledge: string
}

export interface RegistrationResult {
  token: string
  user: User
  account: Account
  openedAt: string
}

/* ==========================================================================
   理财账户（投资账户）
   --------------------------------------------------------------------------
   注册时开的是**储蓄账户**（装钱的地方），
   要买理财还得单独开一个**理财账户**（投资账户）——
   它不装钱，只是把「你」和理财公司之间的委托关系立起来。

   开立前置：
     · 银行卡实名身份已验证（姓名 / 身份证 / 短信 / 人脸）
     · 风险承受能力评估已完成且在有效期内
     · 签署投资协议
     · 绑定一个资金账户（申购扣款、赎回到账都走它）
   ========================================================================== */

export interface WealthAccount {
  opened: boolean
  /** 理财账户号；未开立时为空串 */
  accountNo: string
  openedAt: string
  /** 绑定的资金账户（银行账户 id）—— 申赎款项都走这个账户 */
  settlementAccountId: string
  /** 投资协议签署时间 */
  agreementSignedAt: string
  /** 开立时的风险承受能力快照 */
  riskLevelAtOpening: RiskTolerance
}

export interface WealthAccountOpeningRequest {
  holderName: string
  idNumber: string
  smsCode: string
  /** 人脸核身票据 */
  faceTicket: string
  /** 绑定的资金账户 */
  settlementAccountId: string
  /** 已签署的投资协议文本，服务端逐字校验 */
  agreement: string
}

/**
 * 更换登录手机号。
 *
 * 这是高危操作 —— 手机号是找回密码与接收验证码的唯一凭证，换掉它等于换了账户的钥匙。
 * 所以要求：人脸核身 + 新手机号短信验证，两步都不能省。
 */
export interface ChangePhoneRequest {
  newPhone: string
  /** 发到**新**手机号的验证码 */
  smsCode: string
  faceTicket: string
}
