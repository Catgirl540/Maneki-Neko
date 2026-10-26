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
  /** 由 AUM 派生的会员等级；展示文案取 MEMBER_TIER_RULES[tier].label */
  memberTier: MemberTier
  avatarInitial: string
}

/**
 * 本行给客户的**收款信息** —— 别人要转钱给你时，把这些抄进他那边银行 App 的收款人栏。
 *
 * 真实系统里这是后端按账户 + 转数快登记拼出来的：账户号归银行账户转账用，
 * 转数快标识归转数快用，两者不能混。所以这里也由接口下发，而不是前端自己拼。
 */
export interface ReceivingInfo {
  fpsRegistered: boolean
  fpsRegistrations: { idType: FpsIdType; id: string; accountId: string; region: 'HK'; currency: 'HKD'; registeredAt: string }[]
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

/** 同一资金账户下的币种余额；id 是记账分区标识，不是新账户号。 */
export type CurrencyBalance = Omit<Account, 'currencyBalances'>

export interface Account {
  id: string
  kind: AccountKind
  label: string
  accountNo: string
  currency: Currency
  balance: Cents
  available: Cents
  currencyBalances?: CurrencyBalance[]
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
  /**
   * 后台分类状态。
   * `pending` = 分类器还在判定（页面显示「正在分类」），`done` = 已回写分类，
   * `failed` = 模型链全部重试失败，分类保持 other。
   * 没有该字段的老数据视为已分类。
   */
  classificationState?: 'pending' | 'done' | 'failed'
  /**
   * pending 的原因：`inflight` = 在途（大额转账延迟到账窗口，期间可撤销/可被拦截）；
   * `clearing` = 外行汇款模拟清算。服务端填，前端只渲染（清单 §9.2）。
   * 没有这个字段的 pending 是老数据，按「处理中」显示。
   */
  pendingReason?: 'inflight' | 'clearing'
  /**
   * 在途截止时刻（ISO）。到点自动到账；此前用户可撤销、员工可拦截。
   * 只有 pendingReason='inflight' 的行才有。
   */
  holdUntil?: string
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
  /**
   * 卡类交易所属的卡 id。
   * 单日限额按卡累计，没有这个字段就只能从支付方式字符串里猜尾号 —— 不可靠。
   * 老数据没有该字段，按「不计入按卡限额」处理。
   */
  cardId?: string
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
  /** 模拟消费时填写的账单详情（店铺 · 商品），与摘要同源 */
  merchantNote?: string
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
  businessType?: 'exchange'
  legacyAccountId?: string
  detail: TransactionDetail
  /**
   * 在途转账的指令快照（清单 §9.4：入窗时冻结，到账按它执行）。
   * 只有 pendingReason='inflight' 的行才有；到账/拦截/撤销后随行一起消失。
   */
  heldRequest?: TransferRequest
  /** 冻结的本金与手续费合计；旧在途数据未记录时按本金解冻。 */
  heldFrozenAmount?: Cents
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
  /** 境外转账费被会员权益减免（金卡+）；false / 缺省表示正常收费 */
  feeWaived?: boolean
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

export interface ConfirmedTransferQuote {
  version: 1
  fromCurrency: Currency
  fee: Cents
  /** 客户确认的价格；null 表示无需换汇。 */
  fx: Pick<FxQuote, 'fromCurrency' | 'toCurrency' | 'rate' | 'fromAmount' | 'toAmount' | 'spread'> | null
  /** 银行受理前的有效期；已受理在途指令保留原价格条件。 */
  submitBefore: number
}

export interface TransferRequest {
  /** 助手确认卡绑定的价格条件；不通过条件校验就不冻结或扣款。 */
  confirmedQuote?: ConfirmedTransferQuote
  /** FPS 登记解析结果，提交时与登记册再次核对。 */
  confirmedRecipient?: { name: string; bankCode: string; bankRegion: 'HK' }

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
  /** settlementStatus=pending 的原因：`inflight` = 大额延迟到账窗口（清单 §9），`clearing` = 模拟清算 */
  pendingReason?: 'inflight' | 'clearing'
  /** 在途截止时刻（ISO）。到点自动到账，此前可撤销 / 可被拦截 */
  holdUntil?: string
  /** 实际成交的换汇信息（含成交汇率）。锁价成功的凭证就是这里的 rate */
  fx?: FxQuote
}

/**
 * 撤销在途转账的结果（清单 §9.3）。
 * 撤销只解除可用余额冻结，**不发生扣款**——指令从未执行过。
 */
export interface TransferRecallResult {
  transactionId: string
  /** 撤销后这笔指令的流水状态（failed = 未执行资金操作） */
  status: TransactionStatus
  /** 流水上留下的说明，客服与客户看到同一句话 */
  memo: string
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

/**
 * 导出条件：口径必须和列表接口一致，否则「按当前筛选导出」会导出一份
 * 比屏幕上的列表更大的数据集，对账时看不出差异。
 */
export interface ExportQuery {
  /** 本地日 YYYY-MM-DD（含当天），留空表示不限 */
  from?: string
  to?: string
  category?: TransactionCategory | 'all'
  keyword?: string
  /** 多币种对账：按币种导出；与该记账分区币种不符时导出为空 */
  currency?: Currency | 'all'
  /** 收支方向：`all` 或省略表示不限 */
  direction?: TransactionDirection | 'all'
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
  /** 当前客户已持有同卡组织非历史卡（每位客户每个卡组织至多一张） */
  held?: boolean
  /** 按当前会员等级计算的实付报价；无减免时与标价一致 */
  feeQuote?: CardFeeQuote
}

/** 制卡 / 换卡实付报价：减免次数由后端核销 */
export interface CardFeeQuote {
  /** 标价合计（制卡费 + 寄送费） */
  listFee: Cents
  /** 本次实付金额 */
  payable: Cents
  /** 会员减免的金额；0 表示无减免 */
  waived: Cents
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
  /** 按卡关闭消费开关（与锁卡是两件事：锁卡是冻结，这里是停用消费） */
  paymentEnabled?: boolean
  /** 渠道消费限额：线上 / 线下 / 境外 */
  channelLimits?: { online: Cents; offline: Cents; overseas: Cents }
  /** 商户类别限额：餐饮 / 购物 / 其他 */
  merchantLimits?: { dining: Cents; shopping: Cents; other: Cents }
  /** 申请时填写的邮寄地址，卡还在路上时用于回显 */
  shippingAddress?: MailingAddress
  /** 已收取的制卡费用合计（工本费 + 寄送费） */
  issuingFee?: Cents
  /** 换发来源卡 id；新开卡为 null，换发卡指向已停用的旧卡 */
  replacedFromId?: string | null
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

/** 模拟消费请求：平台与金额，扣哪张卡由路径里的卡 id 决定 */
export interface SpendRequest {
  /** 预设平台 id（见 shared/spend-platforms.mjs） */
  platform: string
  amount: Cents
  /** 账单详情（可选）：店铺/商品说明，写进流水摘要，如「嗉泰面（大朗店）· 猪扒包」 */
  note?: string
  /** 自由商家（platform 为 custom/stripe 时必填）：商户名称，2–40 字单行 */
  merchant?: string
}

/**
 * 模拟消费回执。
 *
 * 分类由服务端分类器判定后随回执返回 —— 前端不猜，页面按它显示「已计入餐饮」这类提示。
 * 分类器不可用时是 other，与既有自动分类的降级口径一致。
 */
export interface SpendReceipt {
  transaction: Transaction
  category: TransactionCategory
  /** 后台分类状态：pending 时页面显示「正在分类」并轮询交易详情 */
  classificationState?: 'pending' | 'done' | 'failed'
  /** 扣款后的账户余额快照（该卡绑定账户的币种分区） */
  available: Cents
  currency: Currency
}

/** 现金流图表的单日数据点 */
export interface CashFlowPoint {
  /** YYYY-MM-DD */
  date: string
  income: Cents
  expense: Cents
}

export interface CashFlow {
  timeZone?: 'Asia/Shanghai'
  asOf?: string
  ignoredDates?: { invalidDate: number; futureDate: number }
  currency?: Currency
  byCurrency?: Partial<Record<Currency, Omit<CashFlow, 'byCurrency'>>>
  days: number
  points: CashFlowPoint[]
  totalIncome: Cents
  totalExpense: Cents
}

export interface SpendingAnalysis {
  timeZone?: 'Asia/Shanghai'
  asOf?: string
  ignoredDates?: { invalidDate: number; futureDate: number }
  periodStatus?: 'complete' | 'partial' | 'future'
  previousMonth?: string
  previousTotal?: Cents
  monthOverMonthComparable?: boolean
  currency?: Currency
  byCurrency?: Partial<Record<Currency, Omit<SpendingAnalysis, 'byCurrency'>>>
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
  active?: boolean
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
  /** staff = 工作人员端发来的真人留言（不是智能客服，也不是你自己） */
  role: 'user' | 'agent' | 'staff'
  text: string
  createdAt: string
  /** staff 消息带发送人姓名，客户端显示「人工客服 · 王小明」 */
  staffName?: string
  /** 客服给出的可点操作，例如跳转到转账 */
  actions?: { label: string; to: string }[]
}

/** 员工端投递过来的留言在存储层的形态（比 SupportMessage 多一路 customerId 用来分发） */
export interface StaffNotice {
  id: string
  customerId: string
  ticketId: string
  staffName: string
  text: string
  createdAt: string
}

/** 客户可见人工工单；不含员工内部处置资料。 */
export type SupportTicketStatus = 'open' | 'processing' | 'waiting' | 'suspended' | 'resolved'
export interface SupportTicket {
  ticketId: string
  reason: string
  status: SupportTicketStatus
  /** 会员 VIP 通道：金卡及以上工单优先处理 */
  priority?: 'normal' | 'vip'
  createdAt: string
  updatedAt: string
}
export interface SupportTicketDetail extends SupportTicket {
  messages: { id: string; sender: 'customer' | 'staff' | 'system'; text: string; createdAt: string }[]
}
export type SupportTicketPage = Paged<SupportTicket>
export interface HumanSupportRequest {
  requestId: string
  reason: string
  transcript?: { role: 'user' | 'assistant'; text: string }[]
}

export interface SupportReply {
  message: SupportMessage
  /** 是否为固定引导通道；没有实时银行查询或业务执行 */
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
  /** 会员优先申购窗口结束时间（ISO）；窗口内仅 priorityTier 及以上可申购 */
  priorityOpenAt?: string
  /** 优先申购所需最低会员等级，如 platinum */
  priorityTier?: MemberTier
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
  status?: 'unassessed' | 'expired' | 'valid'
  eligible?: boolean
  done: boolean
  level: RiskTolerance | null
  score: number | null
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
  /** 开户时设置的支付密码：6 位数字。支付密码不再使用演示固定值 */
  paymentPassword: string
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
     · 复用银行开户时已验证的实名资料，再通过短信与人脸确认本人操作
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
  /** 发送到当前实名账户绑定手机号的验证码 */
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

/**
 * 修改或重置支付密码。
 *
 * 两条路径互斥：
 * - `oldPassword`：已记得原密码的常规修改，走与付款一致的校验（计错误次数、可能已锁定）。
 * - `faceTicket`：忘记原密码或已被锁定时，用本人核身来重置 —— 这也是锁定后的唯一出口。
 * 成功后错误次数清零。新密码必须是 6 位数字。
 */
export interface ChangePaymentPasswordRequest {
  /** 常规修改时必填的原支付密码 */
  oldPassword?: string
  /** 核身重置时必填的人脸票据 */
  faceTicket?: string
  newPassword: string
}

/* ==========================================================================
   账户域扩展 —— 多币种划转 / 存钱计划 / 银行卡一次性卡号
   --------------------------------------------------------------------------
   币种间划转复用账户内部换汇（不是向外部账户转账），复用现成汇率口径
   （见 db.ts 的 fxRate / FX_SPREAD）。存钱计划、虚拟卡为新增域。
   ========================================================================== */

/** 账户内部换汇报价请求。 */
export interface ExchangeQuoteRequest {
  /** 扣账账户（币种 = fromCurrency） */
  fromAccountId: string
  /** 目标币种 */
  toCurrency: Currency
  /** 扣账金额（扣账币） */
  amount: Cents
}

/** 账户内部换汇。报价锁价口径与转账一致，见 FxQuote。 */
export interface ExchangeQuote {
  quoteId: string
  fx: FxQuote
  /** 目标币种账户；不存在时后端会自动开立一个同币种子账户 */
  toAccountNo: string
  /** 换汇后目标账户可用余额（预估） */
  toAvailableAfter: Cents
}

export interface ExchangeRequest {
  quoteId: string
  fromAccountId: string
  toCurrency: Currency
  amount: Cents
  /** 6 位数字支付密码 */
  paymentPassword: string
}

export interface ExchangeResult {
  transactionId: string
  referenceNo: string
  fromAccountId: string
  toAccountId: string
  fx: FxQuote
  createdAt: string
}

/** 存钱计划：自动归集规则 */
export interface SavingsSweep {
  amount: Cents
  cycle: string
  accountId: string
}

export interface SavingsGoal {
  id: string
  name: string
  /** 成就/目标图标标识，前端映射到本地图标 */
  icon: string
  targetAmount: Cents
  savedAmount: Cents
  /** 目标日期 YYYY-MM-DD；无期限为 null */
  deadline: string | null
  createdAt: string
  /** 定期自动归集；未开启为 null */
  sweep: SavingsSweep | null
}

export interface SavingsGoalRequest {
  name: string
  targetAmount: Cents
  icon?: string
  deadline?: string | null
}

export interface SavingsGoalUpdate {
  name?: string
  targetAmount?: Cents
  icon?: string
  deadline?: string | null
}

/** 消费凑整转存规则 */
export interface SavingsRoundupRule {
  enabled: boolean
  /** 凑整到多少元（分） */
  roundupTo: Cents
  /** 单日上限（分） */
  dailyCap: Cents
  accountId: string
  /** 转入目标 */
  goalId: string | null
}

/** 存钱打卡与徽章 */
export interface SavingsStreak {
  days: number
  longestDays: number
  lastSavedAt: string
  badges: { id: string; label: string; earned: boolean; hint: string }[]
}

/** 存钱奖励 / 利息加成 */
export interface SavingsReward {
  id: string
  title: string
  description: string
  /** qualified=已达标待入账，credited=已入账 */
  status: 'qualified' | 'credited'
  amount: Cents
  creditedAt: string | null
}

export interface SavingsOverview {
  totalSaved: Cents
  goals: SavingsGoal[]
  roundup: SavingsRoundupRule
  streak: SavingsStreak
  rewards: SavingsReward[]
}

export interface SavingsRuleUpdate {
  enabled?: boolean
  roundupTo?: Cents
  dailyCap?: Cents
  accountId?: string
  goalId?: string | null
}

/** 银行卡：动态一次性卡号 */
export interface VirtualCardRequest {
  /** 单笔限额（分） */
  amountLimit: Cents
  /** 可用商户备注（选填，空 = 不限） */
  merchantNote?: string
  /** 有效期（小时） */
  validHours: number
}

export interface VirtualCard {
  id: string
  /** 一次性卡号 */
  pan: string
  cvv: string
  expiry: string
  amountLimit: Cents
  merchantNote: string
  createdAt: string
  expiresAt: string
}

/** 银行卡消费开关与限额（扩展 updateCardSettings） */
export interface CardLimitPatch {
  /** 按卡关闭消费；与锁卡是两件事 */
  paymentEnabled?: boolean
  /** 渠道限额 */
  channelLimits?: { online: Cents; offline: Cents; overseas: Cents }
  /** 商户类别限额 */
  merchantLimits?: { dining: Cents; shopping: Cents; other: Cents }
}

/* ==========================================================================
   我的域扩展 —— 邀请与奖励 / 会员中心
   ========================================================================== */

export interface InviteCode {
  code: string
  link: string
  createdAt: string
}

export interface InviteFriend {
  id: string
  name: string
  maskedPhone: string
  /** registered=已注册，account_opened=已开户，reward_earned=奖励达标 */
  stage: 'registered' | 'account_opened' | 'reward_earned'
  joinedAt: string
  reward: Cents
}

export interface InviteReward {
  id: string
  title: string
  description: string
  status: 'credited' | 'pending'
  amount: Cents
  createdAt: string
}

export interface InvitationsOverview {
  invite: InviteCode
  friends: InviteFriend[]
  rewards: InviteReward[]
  totalEarned: Cents
}

/** 会员等级：纯资产分层，由 AUM 派生，不提供付费订阅 */
export type MemberTier = 'standard' | 'gold' | 'platinum' | 'diamond'

/** 一次月度评定结果；缺快照的日子按 0 计入，只可能低估不会高估 */
export interface MembershipEvaluation {
  /** 本次评定对应的月份 `YYYY-MM`（本月等级由它决定） */
  for: string
  /** 上月日均 AUM（分）：储蓄 + 理财持仓 + 现金管理 */
  avgAssets: Cents
  /** 上月有日终快照的天数 */
  coveredDays: number
  /** 上月总天数 */
  daysInMonth: number
  evaluatedAt: string
}

/**
 * 当前档位权益集合。业务函数只消费这一份，不在各接口里散写 if-else。
 * 高等级含低等级全部权益。
 */
export interface Entitlements {
  /** 境外转账手续费 ×0（金卡+） */
  freeTransferFee: boolean
  /** 境外汇款手续费减免（钻石） */
  freeOverseasRemit: boolean
  /** 客服工单 VIP 优先（金卡+） */
  vipChannel: boolean
  /** 生日礼遇：文档标「暂缓」，恒为 false */
  birthdayGift: boolean
  /** 专属客户经理（白金+） */
  dedicatedManager: boolean
  /** 专属理财顾问（钻石） */
  dedicatedAdvisor: boolean
  /** 理财优先购（白金+） */
  wealthPriority: boolean
  /** 机场 / 高铁贵宾厅年度额度 */
  loungePassesPerYear: number
  // —— 旧的两项已接通权益并存 ——
  /** 制卡/换卡费年度减免次数 */
  cardFeeWaiversPerYear: number
  /** 制卡费费率：1 原价 / 0.5 半价 / 0 全免 */
  cardFeeRate: number
  /** 减免是否含寄送费 */
  includeShipping: boolean
  /** 换汇点差系数：0.7 = 七折 */
  fxFeeRate: number
}

/** 贵宾厅年度额度与核销情况 */
export interface LoungeQuota {
  year: number
  perYear: number
  used: number
  remaining: number
}

export interface MembershipOverview {
  tier: MemberTier
  /** 等级中文名，如「白金会员」 */
  tierLabel: string
  /** 当前月均 AUM；尚无评定为 0 */
  aum: Cents
  /** 下一档；已是最高档为 null */
  nextTier: MemberTier | null
  /** 下一档 AUM 门槛；已是最高档为 null */
  nextThreshold: Cents | null
  /** 当前档生效权益文案（递进：含低档） */
  benefits: string[]
  entitlements: Entitlements
  /** 当前等级生效起点；无评定历史时为 null */
  since: string | null
  /** 最近一次月度评定；新客尚无快照时为 null */
  evaluation: MembershipEvaluation | null
  /** 降级缓冲提示；不在缓冲期为 null */
  downgradeWarning: string | null
  lounge: LoungeQuota
  /** 评级与权益使用记录 */
  records: { id: string; label: string; amount: Cents; createdAt: string }[]
}

/* ==========================================================================
   工资与备用金（Cashflow）
   ========================================================================== */

export interface SalaryRecord {
  id: string
  /** 归属月份 YYYY-MM */
  month: string
  amount: Cents
  paidAt: string
}

/** 工资入账计划：发薪日与到账预测 */
export interface SalaryPlan {
  /** 每月发薪日，1–28 */
  salaryDay: number
  /** 预计月薪（分） */
  amount: Cents
  employer: string
  accountId: string
  /** 下次发薪日 YYYY-MM-DD */
  nextPayday: string
  history: SalaryRecord[]
}

export interface SalaryUpdate {
  salaryDay?: number
  amount?: Cents
  accountId?: string
  employer?: string
}

/** 备用金（小额透支额度） */
export interface OverdraftFacility {
  active: boolean
  creditLimit: Cents
  used: Cents
  available: Cents
  /** 年化利率，如 0.058 表示 5.8% */
  apr: number
  activatedAt: string | null
  /** 计息口径说明 */
  interestNote: string
}

/* ==========================================================================
   借款与分期（Credit）
   ========================================================================== */

export interface LoanProduct {
  id: string
  name: string
  description: string
  minAmount: Cents
  maxAmount: Cents
  minTermMonths: number
  maxTermMonths: number
  /** 年化利率（起） */
  apr: number
  /** 最快放款说明，如「实时到账」 */
  disbursement: string
  tags: string[]
}

export interface Loan {
  id: string
  productName: string
  principal: Cents
  outstanding: Cents
  termMonths: number
  monthlyPayment: Cents
  apr: number
  nextDueDate: string
  paidPeriods: number
  totalPeriods: number
  status: 'active' | 'repaid' | 'reviewing'
  createdAt: string
}

/** 把某笔消费转成的分期计划 */
export interface InstallmentPlan {
  transactionId?: string
  id: string
  title: string
  merchant: string
  totalAmount: Cents
  remainingAmount: Cents
  periods: number
  paidPeriods: number
  monthlyPayment: Cents
  nextDueDate: string
  /** 总手续费率，如 0.024 表示 2.4% */
  feeRate: number
  createdAt: string
}

/** 信用培养进度（还款打卡） */
export interface CreditBuilder {
  score: number
  level: string
  streakMonths: number
  nextMilestone: string
  tips: string[]
}

export interface CreditOverview {
  creditLimit: Cents
  availableCredit: Cents
  products: LoanProduct[]
  loans: Loan[]
  installments: InstallmentPlan[]
  builder: CreditBuilder
}

export interface LoanApplyRequest {
  productId: string
  amount: Cents
  termMonths: number
  purpose: string
  /** 放款账户 */
  accountId: string
  /** 6 位数字支付密码 */
  paymentPassword: string
}

export interface InstallmentConvertRequest {
  /** 待分期的交易 id */
  transactionId: string
  periods: number
}

/* ==========================================================================
   理财扩展 —— 现金管理 / 投资与定投 / 保险保障
   ========================================================================== */

export interface CashManagementProduct {
  id: string
  name: string
  /** 7 日年化，如 0.0219 表示 2.19% */
  sevenDayYield: number
  minAmount: Cents
  /** 是否随时可取 */
  flexible: boolean
}

/** 活钱管理：自动把超过保留额的活期转入货币基金 */
export interface CashManagement {
  balance: Cents
  totalYield: Cents
  sevenDayYield: number
  accountId: string
  sweepEnabled: boolean
  /** 活期保留金额（分） */
  sweepThreshold: Cents
  products: CashManagementProduct[]
}

export interface CashSweepUpdate {
  enabled?: boolean
  threshold?: Cents
  accountId?: string
}

export interface InvestProduct {
  id: string
  code: string
  name: string
  /** fund 基金 / etf 指数基金 / stock 股票 / robo 智能投顾 */
  category: 'fund' | 'etf' | 'stock' | 'robo'
  nav: number
  risk: 'low' | 'medium' | 'high'
  /** 近一年收益率，如 0.082 表示 8.2% */
  oneYearReturn: number
  minAmount: Cents
}

/** 定投计划 */
export interface InvestPlan {
  accountId?: string
  id: string
  productCode: string
  productName: string
  amount: Cents
  /** 周期说明，如「每月 8 日」 */
  cycle: string
  nextRunAt: string
  executedRuns: number
  totalInvested: Cents
  status: 'active' | 'paused' | 'cancelled'
  revision?: number
  updatedAt?: string
  createdAt: string
}

export interface InvestmentsOverview {
  /** 当前仅保存计划，没有自动扣款执行器 */
  executionMode?: 'plan-only'
  holding: Cents
  totalReturn: Cents
  plans: InvestPlan[]
  products: InvestProduct[]
}

export interface InvestPlanRequest {
  productCode: string
  amount: Cents
  cycle: string
  accountId: string
  /** 6 位数字支付密码 */
  paymentPassword: string
}

export interface InvestPlanUpdate {
  status: 'active' | 'paused' | 'cancelled'
  expectedRevision: number
  /** 恢复计划时必填，暂停/取消不需要 */
  paymentPassword?: string
}

export interface InsuranceProduct {
  id: string
  name: string
  /** 重疾 / 医疗 / 意外 / 寿险 */
  category: string
  insurer: string
  /** 年缴保费（分） */
  premiumPerYear: Cents
  /** 保额（分） */
  coverage: Cents
  highlight: string
  tags: string[]
}

export interface InsurancePolicy {
  id: string
  productName: string
  insurer: string
  premium: Cents
  coverage: Cents
  status: 'active' | 'expired' | 'pending'
  effectiveAt: string
  expireAt: string
  insuredName: string
}

export interface InsuranceOverview {
  totalCoverage: Cents
  policies: InsurancePolicy[]
  products: InsuranceProduct[]
}

export interface InsuranceEnrollRequest {
  productId: string
  insuredName: string
  /** 6 位数字支付密码 */
  paymentPassword: string
}
