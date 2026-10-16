package cn.waveflow.luckycat.contract.bank

import kotlinx.serialization.Serializable

/**
 * 银行后端的领域类型。**只移当前界面要用的那几个**，不是整份 `types.ts` 搬过来。
 *
 * 全部字段都带默认值、配 `ignoreUnknownKeys`：后端加字段不会让客户端崩，
 * 但**我们用到**的字段一旦改名/缺失，反序列化会立刻失败——这正是想要的告警方式。
 *
 * 金额一律是**分**（`Cents`），不是元。前端 TS 里也是这个约定（`type Cents = number`），
 * 显示时才除以 100。用浮点存钱的坑不用多说。
 */
typealias Cents = Long

@Serializable
data class BankUser(
    val id: String = "",
    val name: String = "",
    val phone: String = "",
    val memberLevel: String = "",
    val avatarInitial: String = "",
)

@Serializable
data class SmsCodeResult(
    val sent: Boolean = false,
    val expiresAt: String = "",
    /** **演示专用**：真后端绝不会把验证码回传。字段名点明是 demo。 */
    val demoCode: String = "",
)

@Serializable
data class LoginResult(
    val token: String = "",
    val user: BankUser = BankUser(),
)

@Serializable
data class Account(
    val id: String = "",
    /** 当前为 savings；保留字段便于未来扩展产品。 */
    val kind: String = "",
    val label: String = "",
    val accountNo: String = "",
    val currency: String = "CNY",
    val balance: Cents = 0,
    val available: Cents = 0,
    /** 年化利率，0.0155 表示 1.55%。 */
    val interestRate: Double = 0.0,
    /** 本月净变动（收入 - 支出），后端汇总好的。 */
    val monthNetChange: Cents = 0,
)

@Serializable
data class Transaction(
    val id: String = "",
    val accountId: String = "",
    /** `in` / `out`。 */
    val direction: String = "",
    val amount: Cents = 0,
    /** 正数收入、负数支出，与 [direction] 是同一个意思的带符号表达。 */
    val signedAmount: Cents = 0,
    val counterparty: String = "",
    val memo: String = "",
    val category: String = "other",
    val createdAt: String = "",
    /** success / pending / failed。 */
    val status: String = "success",
) {
    val isIncome: Boolean get() = direction == "in"
}

/**
 * 交易附加明细。
 *
 * 与台账行**刻意分开**：列表接口不下发这些，只有详情接口返回。
 * 列表只要够渲染一行（对方、时间、金额），详情才是「凭证」。
 */
@Serializable
data class TransactionDetail(
    /** 交易编号（凭证号），唯一且不可变，客服核对时以此为准。 */
    val referenceNo: String = "",
    val channel: String = "",
    val paymentMethod: String = "",
    val accountLabel: String = "",
    val accountNo: String = "",
    val settleCurrency: String = "CNY",
    val balanceBefore: Cents = 0,
    val balanceAfter: Cents = 0,
    val counterpartyName: String? = null,
    val merchantId: String? = null,
    val merchantCountry: String? = null,
    val merchantCity: String? = null,
    val counterpartyAccountNo: String? = null,
    val counterpartyBank: String? = null,
    val location: String? = null,
    val remark: String? = null,
    val authCode: String? = null,
    val originAmount: Cents? = null,
    val originCurrency: String? = null,
    val exchangeRate: Double? = null,
    val exchangeRateNote: String? = null,
)

/**
 * 交易详情 = 台账行 + 明细。
 *
 * TS 那边是 `interface TransactionRecord extends Transaction`。Kotlin 的 data class
 * **不能继承 data class**（也不能像 kotlinx 那样把父类字段"拍平"进 JSON），
 * 所以这里把台账行的字段再列一遍。重复是明确的、有意的：
 * 换一种写法（比如只放一个 `transaction` 字段）就对不上后端的扁平 JSON 了。
 */
@Serializable
data class TransactionRecord(
    val id: String = "",
    val accountId: String = "",
    val direction: String = "",
    val amount: Cents = 0,
    val signedAmount: Cents = 0,
    val counterparty: String = "",
    val memo: String = "",
    val category: String = "other",
    val createdAt: String = "",
    val status: String = "success",
    val detail: TransactionDetail = TransactionDetail(),
) {
    val isIncome: Boolean get() = direction == "in"
}

@Serializable
data class Paged<T>(
    val items: List<T> = emptyList(),
    val page: Int = 1,
    val size: Int = 20,
    val total: Int = 0,
)

// ── 转账 ────────────────────────────────────────────────────────────────

/**
 * 收款人。[channel] 是 `bank`（银行账户）或 `fps`（转数快）。
 *
 * `bankCode` 与 `bankRegion` **必须成对使用**：3 位清算代码两地会撞号
 * （004 在香港是汇丰、在内地是另一家），只带一个会转错行。
 */
@Serializable
data class Payee(
    val id: String = "",
    val name: String = "",
    val channel: String = "bank",
    val bankCode: String? = null,
    val bankRegion: String? = null,
    val bankName: String? = null,
    val accountNo: String? = null,
    val fpsMethod: String? = null,
    val fpsId: String? = null,
    val payeeCurrency: String? = null,
    /** `domestic` / `overseas`。 */
    val scope: String = "domestic",
    val lastUsedAt: String? = null,
)

/** 转账报价。[requiresConfirm] 表示这段通道要不要走风控二次确认。 */
@Serializable
data class TransferQuote(
    val fee: Cents = 0,
    val etaText: String = "",
    val maxAmount: Cents = 0,
    val singleLimit: Cents = 0,
    val requiresConfirm: Boolean = false,
    val confirmReason: String? = null,
    val channelNote: String = "",
)

@Serializable
data class TransferRequest(
    val fromAccountId: String,
    val channel: String,
    val scope: String,
    val payeeName: String,
    val amount: Cents,
    val memo: String = "",
    val payeeBankCode: String? = null,
    val payeeBankRegion: String? = null,
    val payeeAccountNo: String? = null,
    val fpsId: String? = null,
    val fpsMethod: String? = null,
)

@Serializable
data class TransferResult(
    val transactionId: String = "",
    val referenceNo: String = "",
    val amount: Cents = 0,
    val fee: Cents = 0,
    val channel: String = "",
    /** 脱敏后的收款标识，用于回执展示。 */
    val identifier: String = "",
    val createdAt: String = "",
)

// ── 银行卡 ──────────────────────────────────────────────────────────────

/**
 * 一张卡。
 *
 * **这里没有完整卡号、没有 CVV**——卡密走单独的接口并且**要支付密码**
 * （`revealCardSecrets`）。列表接口不下发它们，是刻意的：
 * 拿得到列表的人不该顺手拿到能盗刷的东西。
 */
@Serializable
data class BankCard(
    val id: String = "",
    val accountId: String = "",
    val productName: String = "",
    /** 只给后四位。 */
    val last4: String = "",
    val cardholder: String = "",
    /** `MM/YY`。 */
    val expiry: String = "",
    val theme: String = "",
    /** visa / unionpay / mastercard… */
    val network: String = "",
    /** debit / credit。 */
    val kind: String = "debit",
    /** `active` / `locked` / `pending`（待激活）/ `replaced`。 */
    val status: String = "active",
    val onlinePayment: Boolean = false,
    val overseasPayment: Boolean = false,
    val dailyLimit: Cents = 0,
    val shippingAddress: MailingAddress? = null,
    val issuingFee: Cents? = null,
)

@Serializable
data class CardProduct(
    val code: String = "",
    val name: String = "",
    val theme: String = "",
    val network: String = "",
    val kind: String = "debit",
    /** 制卡费（分）。 */
    val issuingFee: Cents = 0,
    val deliveryFee: Cents = 0,
    val perks: List<String> = emptyList(),
    val deliveryDays: Int = 0,
)

@Serializable
data class MailingAddress(
    val recipient: String = "",
    val phone: String = "",
    val region: String = "",
    val city: String = "",
    val detail: String = "",
    val postalCode: String = "",
)

@Serializable
data class CardApplication(val productCode: String, val address: MailingAddress, val paymentPassword: String)

@Serializable
data class CardReplaceRequest(val address: MailingAddress, val paymentPassword: String)

/** Only held in memory for the server-provided reveal period. */
@Serializable
data class CardSecrets(
    val pan: String = "",
    /** Compatibility with old demo fixtures. */
    val cardNo: String = "",
    val cvv: String = "",
    val expiry: String = "",
    val demo: Boolean = false,
    val revealSeconds: Int = 30,
) {
    val number: String get() = pan.ifBlank { cardNo }
}

// ── 理财 ────────────────────────────────────────────────────────────────

/**
 * 业绩比较基准。**不是承诺收益**：`low`/`high` 是一个区间，
 * 而且 `basis` 明说它是怎么测算出来的。界面必须把区间和 basis 都显示出来——
 * 只显示一个数字会让用户以为那是保证收益。
 */
@Serializable
data class WealthBenchmark(
    /** `range` / `fixed` / `index`。 */
    val kind: String = "range",
    val low: Double = 0.0,
    val high: Double = 0.0,
    val basis: String = "",
)

@Serializable
data class WealthProduct(
    val code: String = "",
    val name: String = "",
    val issuer: String = "",
    /** cash / fixed / fund / hybrid…，界面按它分组。 */
    val category: String = "",
    /** R1..R5 风险等级。 */
    val risk: String = "",
    /** 是否保本。**绝大多数理财不保本**，这条要显眼。 */
    val principalProtected: Boolean = false,
    val benchmark: WealthBenchmark = WealthBenchmark(),
    val sevenDayYield: Double? = null,
    val nav: Double? = null,
    val navDate: String? = null,
    val sinceInception: Double? = null,
    val volatility: Double? = null,
    /** 起购金额（分）。 */
    val minAmount: Cents = 0,
    /** 递增金额（分）。 */
    val stepAmount: Cents = 0,
    val term: String = "",
    val openEnded: Boolean = false,
)

@Serializable
data class WealthAccount(
    val opened: Boolean = false,
    val accountNo: String = "",
)

/** 一笔持仓。`profit` 与 `profitRate` 由后端算好，前端不自己算（口径要一致）。 */
@Serializable
data class WealthHolding(
    val id: String = "",
    val productCode: String = "",
    val productName: String = "",
    val category: String = "",
    val risk: String = "",
    val shares: Long = 0,
    val principal: Cents = 0,
    val marketValue: Cents = 0,
    val profit: Cents = 0,
    val profitRate: Double = 0.0,
    val purchasedAt: String = "",
    val redeemableAt: String? = null,
    val closed: Boolean = false,
)

@Serializable
data class RiskOption(val label: String = "", val score: Int = 0)

@Serializable
data class RiskQuestion(
    val id: String = "",
    val question: String = "",
    val options: List<RiskOption> = emptyList(),
)

/**
 * 风险承受能力评估结果。
 *
 * **监管要求满一年重做**，所以 [expired] 为真时**等同于没做**——
 * 界面不能因为它 `done` 就放行。
 */
@Serializable
data class RiskAssessment(
    val done: Boolean = false,
    /** C1..C5。注意 `C` 是**投资者**、`R` 是**产品**，两套不能混。 */
    val level: String = "C1",
    val score: Int = 0,
    val assessedAt: String = "",
    val expiresAt: String = "",
    val expired: Boolean = true,
) {
    /** 能不能开理财账户 / 申购。**过期等于没做。** */
    val usable: Boolean get() = done && !expired
}

/**
 * 开理财账户。**银行账户 ≠ 理财账户**：理财账户不装钱，
 * 它立的是"你"与理财公司之间的委托关系，申赎都走绑定的资金账户。
 */
@Serializable
data class WealthAccountOpeningRequest(
    val holderName: String,
    val idNumber: String,
    val smsCode: String,
    /** 人脸核身票据，与开储蓄账户同一套。 */
    val faceTicket: String,
    /** 绑定的资金账户，申赎款项都走它。 */
    val settlementAccountId: String,
    /** 已签署的投资协议文本，**服务端逐字校验**。 */
    val agreement: String,
)

@Serializable
data class WealthOverview(
    val account: WealthAccount = WealthAccount(),
    val totalValue: Cents = 0,
    val totalPrincipal: Cents = 0,
    val totalProfit: Cents = 0,
    val yesterdayProfit: Cents = 0,
    /** 当前的风险测评。**过期等于没做**。 */
    val risk: RiskAssessment = RiskAssessment(),
    val holdings: List<WealthHolding> = emptyList(),
)

// ── 安全中心 ────────────────────────────────────────────────────────────

@Serializable
data class SecurityDevice(
    val id: String = "",
    val name: String = "",
    val location: String = "",
    val lastActiveAt: String = "",
    /** 是不是当前这台设备。 */
    val current: Boolean = false,
)

@Serializable
data class SecurityLog(
    val id: String = "",
    val action: String = "",
    val detail: String = "",
    val createdAt: String = "",
    /** `info` / `warn` / `danger`，界面据此配色。 */
    val level: String = "info",
)

/**
 * 一条风控规则。
 *
 * [description] 是**给用户看的**，必须完整显示出来——"境外交易拦截"这五个字
 * 看不出它到底拦什么，用户关掉它之前有权知道自己在关什么。
 */
@Serializable
data class SecurityRule(
    val id: String = "",
    val label: String = "",
    val description: String = "",
    val enabled: Boolean = true,
)

@Serializable
data class SecurityOverview(
    /** 安全评分 0-100。 */
    val score: Int = 0,
    /** 「防护优秀」这类通俗说法。 */
    val level: String = "",
    val identityVerified: Boolean = false,
    val devices: List<SecurityDevice> = emptyList(),
    val logs: List<SecurityLog> = emptyList(),
    val riskRules: List<SecurityRule> = emptyList(),
)

// ── 分析（消费 / 现金流）────────────────────────────────────────────────

@Serializable
data class SpendingCategory(
    val key: String = "",
    val label: String = "",
    val amount: Cents = 0,
    /** 占比 0..1。**后端算好的**——前端不自己算，口径要一致。 */
    val ratio: Double = 0.0,
)

@Serializable
data class SpendingTrendPoint(val month: String = "", val amount: Cents = 0)

@Serializable
data class SpendingAnalysis(
    /** `2026-09`。 */
    val month: String = "",
    val total: Cents = 0,
    /** 环比，`-0.29` 表示比上月少 29%。 */
    val monthOverMonth: Double = 0.0,
    val categories: List<SpendingCategory> = emptyList(),
    val trend: List<SpendingTrendPoint> = emptyList(),
)

@Serializable
data class CashFlowPoint(val date: String = "", val income: Cents = 0, val expense: Cents = 0)

@Serializable
data class CashFlow(
    val days: Int = 30,
    val points: List<CashFlowPoint> = emptyList(),
    val totalIncome: Cents = 0,
    val totalExpense: Cents = 0,
)

// ── 开户 ────────────────────────────────────────────────────────────────

/** 人脸/短信核身票据。**没有它开不了户**——后端会回 `FACE_REQUIRED`。 */
@Serializable
data class IdentityTicket(val ticket: String = "")

/**
 * 注册并开立唯一储蓄账户。
 *
 * **后端逐项校验**（`app/src/api/mock/index.ts` 的 `register`）：
 * 姓名不能空、身份证要 18 位、验证码要是刚发过且没用过的、
 * 人脸票据必须有、承诺语句要**逐字**一致。少一项就是一个明确的错误码，
 * 密码、人脸票据与承诺都不能省。
 */
@Serializable
data class RegistrationRequest(
    val phone: String,
    val password: String,
    val holderName: String,
    /** 18 位身份证号。 */
    val idNumber: String,
    val smsCode: String,
    val faceTicket: String,
    /** 合法开立和使用账户承诺，**逐字校验**。 */
    val pledge: String,
)

@Serializable
data class RegistrationResult(
    val token: String = "",
    val user: BankUser = BankUser(),
    val account: Account = Account(),
    val openedAt: String = "",
)
