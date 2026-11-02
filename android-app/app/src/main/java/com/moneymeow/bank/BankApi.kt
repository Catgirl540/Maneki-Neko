package com.moneymeow.bank

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * 银行后端客户端：直连 `server/`（PostgreSQL）的 HTTP 接口。
 *
 * 默认使用与客户网页相同的 HTTPS 入口；本地联调可另行设置 baseUrl。
 * 底层 I/O 统一走 [BankHttp]（不引入网络库），本对象只负责读缓存、幂等键与资金恢复。
 */
object BankApi {
    /** 客户 /api/ 由线上网关转发至演示银行。 */
    var baseUrl: String = BuildConfig.BANK_BASE_URL

    private var token: String? = null

    /** 读接口短期缓存：切页先出上次结果；下拉刷新或任何写操作后失效。 */
    private data class CachedRead(val body: String, val at: Long)
    private val readCache = java.util.concurrent.ConcurrentHashMap<String, CachedRead>()
    private const val READ_CACHE_TTL_MS = 60_000L

    /** 下拉刷新入口：清掉读缓存，让页面重新拉取。 */
    fun invalidateReads() {
        readCache.clear()
    }

    private fun readCacheKey(authToken: String?, path: String): String =
        (authToken?.hashCode() ?: 0).toString() + "|" + path

    private fun readCacheable(method: String, path: String, authToken: String?): Boolean =
        method == "GET" && authToken != null &&
            !path.startsWith("/api/auth/") &&
            !path.startsWith("/api/idempotency/") &&
            !path.contains("/secrets")

    /** 令牌失效（401）时回调，由应用层清登录态并回登录页。 */
    var onUnauthorized: (() -> Unit)? = null

    fun setToken(value: String?) {
        token = value
    }

    fun hasToken(): Boolean = !token.isNullOrEmpty()

    /** 供 AgentApi 复用同一个 Bearer 令牌。 */
    fun currentToken(): String? = token

    suspend fun sendSmsCode(phone: String): String? = withContext(Dispatchers.IO) {
        val body = JSONObject().put("phone", phone)
        val response = request("POST", "/api/auth/sms-code", body)
        response.optString("demoCode").ifEmpty { null }
    }

    suspend fun login(phone: String, password: String, smsCode: String): LoginResult =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("phone", phone)
                .put("password", password)
                .put("smsCode", smsCode)
            val response = request("POST", "/api/auth/login", body)
            val newToken = response.getString("token")
            token = newToken
            val user = response.optJSONObject("user")
            LoginResult(
                token = newToken,
                name = user?.optString("name").orEmpty(),
                phone = user?.optString("phone").orEmpty(),
                displayName = user?.optString("displayName").orEmpty(),
                nickname = user?.optString("nickname").orEmpty(),
                customNickname = user?.optString("customNickname").orEmpty(),
            )
        }

    suspend fun changeLoginPassword(oldPassword: String, newPassword: String): Unit = withContext(Dispatchers.IO) {
        require(PasswordPolicy.isValid(newPassword)) { PasswordPolicy.requirements }
        requestRaw(
            "POST", "/api/security/password",
            JSONObject().put("oldPassword", oldPassword).put("newPassword", newPassword),
        )
        Unit
    }

    /** 人脸核身票据；注册与开理财户时交给服务端消费，票据 5 分钟内有效。 */
    suspend fun verifyIdentity(channel: String = "face"): String = withContext(Dispatchers.IO) {
        val root = request("POST", "/api/security/verify", JSONObject().put("channel", channel))
        root.optString("ticket").ifEmpty {
            throw BankApiException(502, "身份核验未返回有效票据", "IDENTITY_TICKET_MISSING")
        }
    }

    suspend fun changePhone(newPhone: String, smsCode: String, faceTicket: String): Unit = withContext(Dispatchers.IO) {
        val session = SessionStore.credentials().second ?: throw BankApiException(401, "请重新登录", "UNAUTHORIZED")
        val root = JSONObject(requestRaw("PATCH", "/api/auth/phone", JSONObject().put("newPhone", newPhone).put("smsCode", smsCode).put("faceTicket", faceTicket), authToken = session))
        if (SessionStore.credentials().second == session) SessionStore.save(LoginResult(session, SessionStore.name(), root.optString("phone", newPhone)))
    }

    /**
     * 注册并开立唯一的储蓄账户。
     *
     * 与网页 `OpenAccountPage` 使用同一契约：手机号 / 登录密码 / 支付密码 /
     * 实名信息 / 短信验证码 / 人脸票据 / 合法开立账户承诺，服务端逐项校验。
     */
    suspend fun register(
        phone: String,
        password: String,
        paymentPassword: String,
        holderName: String,
        idNumber: String,
        smsCode: String,
        faceTicket: String,
        pledge: String,
    ): RegistrationResultDto = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("phone", phone)
            .put("password", password)
            .put("paymentPassword", paymentPassword)
            .put("holderName", holderName)
            .put("idNumber", idNumber)
            .put("smsCode", smsCode)
            .put("faceTicket", faceTicket)
            .put("pledge", pledge)
        val root = request("POST", "/api/auth/register", body)
        val newToken = root.getString("token")
        token = newToken
        val user = root.optJSONObject("user")
        val account = root.optJSONObject("account")
        RegistrationResultDto(
            token = newToken,
            name = user?.optString("name").orEmpty(),
            phone = user?.optString("phone").orEmpty(),
            accountId = account?.optString("id").orEmpty(),
            accountLabel = account?.optString("label").orEmpty(),
            accountNo = account?.optString("accountNo").orEmpty(),
            openedAt = root.optString("openedAt"),
        )
    }

    suspend fun accounts(): List<AccountDto> = withContext(Dispatchers.IO) {
        val text = requestRaw("GET", "/api/accounts", null)
        val array = org.json.JSONTokener(text).nextValue() as JSONArray
        buildList {
            array.forEachObject { item ->
                val balances = item.optJSONArray("currencyBalances")
                add(
                    AccountDto(
                        id = item.getString("id"),
                        accountNo = item.optString("accountNo"),
                        label = item.optString("label"),
                        currency = item.optString("currency"),
                        balance = item.optLong("balance"),
                        available = item.optLong("available", item.optLong("balance")),
                        currencyBalances = buildList {
                            if (balances != null) {
                                for (i in 0 until balances.length()) {
                                    val row = balances.getJSONObject(i)
                                    add(
                                        CurrencyBalanceDto(
                                            id = row.optString("id"),
                                            currency = row.optString("currency"),
                                            label = row.optString("label"),
                                            balance = row.optLong("balance"),
                                            available = row.optLong("available", row.optLong("balance")),
                                        )
                                    )
                                }
                            }
                        },
                    )
                )
            }
        }
    }

    suspend fun transactions(accountId: String, size: Int = 8): List<TransactionDto> =
        withContext(Dispatchers.IO) {
            val text = requestRaw("GET", "/api/accounts/$accountId/transactions?page=1&size=$size", null)
            val page = org.json.JSONTokener(text).nextValue() as JSONObject
            val items = page.optJSONArray("items") ?: JSONArray()
            buildList {
                items.forEachObject { row ->
                    add(
                        TransactionDto(
                            id = row.getString("id"),
                            direction = row.optString("direction"),
                            amount = row.optLong("amount"),
                            counterparty = row.optString("counterparty"),
                            category = row.optString("category"),
                            memo = row.optString("memo"),
                            createdAt = row.optString("createdAt"),
                        )
                    )
                }
            }
        }

    suspend fun cards(): List<CardDto> = withContext(Dispatchers.IO) {
        val text = requestRaw("GET", "/api/cards", null)
        val array = org.json.JSONTokener(text).nextValue() as JSONArray
        buildList {
            array.forEachObject { row ->
                add(
                    CardDto(
                        id = row.getString("id"),
                        productName = row.optString("productName"),
                        last4 = row.optString("last4"),
                        cardholder = row.optString("cardholder"),
                        expiry = row.optString("expiry"),
                        network = row.optString("network"),
                        theme = row.optString("theme"),
                        status = row.optString("status"),
                        onlinePayment = row.optBoolean("onlinePayment"),
                        overseasPayment = row.optBoolean("overseasPayment"),
                        dailyLimit = row.optLong("dailyLimit"),
                    )
                )
            }
        }
    }

    suspend fun setCardLock(cardId: String, locked: Boolean): Unit = withContext(Dispatchers.IO) {
        request("POST", "/api/cards/$cardId/lock", JSONObject().put("locked", locked))
        Unit
    }

    suspend fun wealthOverview(): WealthOverviewDto = withContext(Dispatchers.IO) {
        val root = org.json.JSONTokener(requestRaw("GET", "/api/wealth/overview", null)).nextValue() as JSONObject
        val account = root.optJSONObject("account")
        val risk = root.optJSONObject("risk")
        WealthOverviewDto(
            opened = account?.optBoolean("opened") ?: false,
            wealthAccountNo = account?.optString("accountNo").orEmpty(),
            wealthOpenedAt = account?.optString("openedAt").orEmpty(),
            settlementAccountId = account?.optString("settlementAccountId").orEmpty(),
            totalValue = root.optLong("totalValue"),
            totalPrincipal = root.optLong("totalPrincipal"),
            totalProfit = root.optLong("totalProfit"),
            yesterdayProfit = root.optLong("yesterdayProfit"),
            holdings = root.optJSONArray("holdings")?.let { array ->
                buildList {
                    for (i in 0 until array.length()) {
                        add(parseHolding(array.getJSONObject(i)))
                    }
                }
            }.orEmpty(),
            riskLevel = risk?.optString("level")?.ifEmpty { null },
            riskScore = if (risk == null || risk.isNull("score")) null else risk.optInt("score"),
            riskDone = risk?.optBoolean("done") ?: false,
            riskExpired = risk?.optBoolean("expired") ?: false,
            riskStatus = risk?.optString("status").orEmpty(),
            riskEligible = risk?.optBoolean("eligible") ?: false,
            riskExpiresAt = risk?.optString("expiresAt").orEmpty(),
        )
    }

    suspend fun wealthProducts(): List<WealthProductDto> = withContext(Dispatchers.IO) {
        val text = requestRaw("GET", "/api/wealth/products", null)
        val array = org.json.JSONTokener(text).nextValue() as JSONArray
        buildList {
            for (i in 0 until array.length()) {
                add(parseWealthProduct(array.getJSONObject(i)))
            }
        }
    }

    /** 单只产品详情；网页与安卓共用同一组披露字段。 */
    suspend fun wealthProduct(code: String): WealthProductDto = withContext(Dispatchers.IO) {
        parseWealthProduct(request("GET", "/api/wealth/products/$code", null))
    }

    /**
     * 开立理财账户（投资账户）—— 不装钱，只建立委托关系。
     *
     * 前置：已实名、短信验证码、人脸票据、有效期内风险测评、签署投资协议、
     * 绑定一个 CNY 资金账户（申购扣款与赎回到账都走它）。
     */
    suspend fun openWealthAccount(
        smsCode: String,
        faceTicket: String,
        settlementAccountId: String,
        agreement: String,
    ): WealthAccountDto = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("smsCode", smsCode)
            .put("faceTicket", faceTicket)
            .put("settlementAccountId", settlementAccountId)
            .put("agreement", agreement)
        val root = request("POST", "/api/wealth/account/open", body)
        WealthAccountDto(
            opened = root.optBoolean("opened"),
            accountNo = root.optString("accountNo"),
            openedAt = root.optString("openedAt"),
            settlementAccountId = root.optString("settlementAccountId"),
            agreementSignedAt = root.optString("agreementSignedAt"),
            riskLevelAtOpening = root.optString("riskLevelAtOpening"),
        )
    }

    suspend fun riskQuestions(): List<RiskQuestionDto> = withContext(Dispatchers.IO) {
        val text = requestRaw("GET", "/api/wealth/risk/questions", null)
        val array = org.json.JSONTokener(text).nextValue() as JSONArray
        buildList {
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                val options = row.optJSONArray("options")
                add(
                    RiskQuestionDto(
                        id = row.optString("id"),
                        question = row.optString("question"),
                        options = buildList {
                            if (options != null) {
                                for (j in 0 until options.length()) {
                                    val option = options.getJSONObject(j)
                                    add(
                                        RiskOptionDto(
                                            label = option.optString("label"),
                                            score = option.optInt("score"),
                                        )
                                    )
                                }
                            }
                        },
                    )
                )
            }
        }
    }

    /** 提交全部题目（选项下标）；服务端按共享判分规则计算 C1–C5。 */
    suspend fun submitRiskAssessment(answers: List<Int>): RiskAssessmentDto = withContext(Dispatchers.IO) {
        val array = JSONArray()
        answers.forEach { array.put(it) }
        val root = request("POST", "/api/wealth/risk/assess", JSONObject().put("answers", array))
        parseRisk(root)
    }

    /** 申购并返回确认结果（确认份额、净值、费用、确认时间）。 */
    suspend fun subscribeWealthDetailed(
        productCode: String,
        amount: Long,
        paymentPassword: String,
        acknowledgement: String,
    ): WealthSubscribeResultDto = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("productCode", productCode)
            .put("amount", amount)
            .put("paymentPassword", paymentPassword)
            .put("riskAcknowledgement", acknowledgement)
        val root = request("POST", "/api/wealth/subscribe", body)
        val holding = root.optJSONObject("holding")
        WealthSubscribeResultDto(
            holdingId = holding?.optString("id").orEmpty(),
            productName = holding?.optString("productName").orEmpty(),
            shares = root.optDouble("shares", 0.0),
            nav = root.optDouble("nav", 0.0),
            fees = root.optLong("fees"),
            confirmedAt = root.optString("confirmedAt"),
            holdingMarketValue = holding?.optLong("marketValue") ?: 0L,
            holdingPrincipal = holding?.optLong("principal") ?: 0L,
        )
    }

    /** 赎回；[shares] 省略表示全部赎回，返回实际记账结果。 */
    suspend fun redeemWealthDetailed(holdingId: String, shares: Double? = null): WealthRedeemResultDto =
        withContext(Dispatchers.IO) {
            val body = JSONObject().put("holdingId", holdingId)
            if (shares != null) body.put("shares", shares)
            val root = request("POST", "/api/wealth/redeem", body)
            WealthRedeemResultDto(
                holdingId = root.optString("holdingId"),
                acceptedAt = root.optString("acceptedAt"),
                shares = root.optDouble("shares", 0.0),
                estimatedAmount = root.optLong("estimatedAmount"),
                fees = root.optLong("fees"),
                settlementMode = root.optString("settlementMode"),
                settledAt = root.optString("settledAt"),
                etaText = root.optString("etaText"),
            )
        }

    private fun parseRisk(root: JSONObject): RiskAssessmentDto = RiskAssessmentDto(
        done = root.optBoolean("done"),
        level = root.optString("level").ifEmpty { null },
        score = if (root.isNull("score")) null else root.optInt("score"),
        assessedAt = root.optString("assessedAt"),
        expiresAt = root.optString("expiresAt"),
        expired = root.optBoolean("expired"),
        status = root.optString("status"),
        eligible = root.optBoolean("eligible"),
    )

    private fun parseHolding(row: JSONObject): HoldingDto = HoldingDto(
        id = row.optString("id"),
        productCode = row.optString("productCode"),
        productName = row.optString("productName"),
        risk = row.optString("risk"),
        shares = row.optDouble("shares", 0.0),
        principal = row.optLong("principal"),
        marketValue = row.optLong("marketValue"),
        profit = row.optLong("profit"),
        profitRate = row.optDouble("profitRate", 0.0),
        purchasedAt = row.optString("purchasedAt"),
        redeemableAt = if (row.isNull("redeemableAt")) null else row.optString("redeemableAt").ifEmpty { null },
        redeemableShares = row.optDouble(
            "redeemableShares",
            if (row.optBoolean("closed")) 0.0 else row.optDouble("shares", 0.0),
        ),
        closed = row.optBoolean("closed"),
    )

    private fun parseWealthProduct(row: JSONObject): WealthProductDto {
        val benchmark = row.optJSONObject("benchmark")
        val benchmarkText = when (benchmark?.optString("kind")) {
            "range" -> String.format(
                java.util.Locale.US,
                "%.2f%%–%.2f%%",
                benchmark.optDouble("low") * 100,
                benchmark.optDouble("high") * 100,
            )
            "formula" -> benchmark.optString("formula")
            else -> benchmark?.optString("formula").orEmpty()
        }
        return WealthProductDto(
            code = row.optString("code"),
            name = row.optString("name"),
            issuer = row.optString("issuer"),
            risk = row.optString("risk"),
            category = row.optString("category"),
            nav = row.optDouble("nav", 0.0),
            navDate = row.optString("navDate"),
            sevenDayYield = if (row.isNull("sevenDayYield")) null else row.optDouble("sevenDayYield"),
            sinceInception = row.optDouble("sinceInception", 0.0),
            volatility = row.optDouble("volatility", 0.0),
            minAmount = row.optLong("minAmount"),
            stepAmount = row.optLong("stepAmount"),
            term = row.optString("term"),
            openEnded = row.optBoolean("openEnded"),
            priorityRestricted = row.optBoolean("priorityRestricted"),
            benchmark = benchmarkText,
            benchmarkBasis = benchmark?.optString("basis").orEmpty(),
            ongoingFees = parseFees(row.optJSONArray("ongoingFees")),
            transactionFees = parseFees(row.optJSONArray("transactionFees")),
        )
    }

    private fun parseFees(array: JSONArray?): List<WealthFeeDto> = buildList {
        if (array == null) return@buildList
        for (i in 0 until array.length()) {
            val row = array.getJSONObject(i)
            add(
                WealthFeeDto(
                    label = row.optString("label"),
                    rate = row.optDouble("rate", 0.0),
                    holdingDaysLessThan = if (row.isNull("holdingDaysLessThan")) null else row.optInt("holdingDaysLessThan"),
                )
            )
        }
    }

    /**
     * 转账安全能力声明。只有 `transferPaymentPassword` 为 true 且报价确认版本为 1 时，
     * 客户端才允许提交转账；查询失败一律按“不可用”处理。
     */
    suspend fun transferRequirements(): TransferRequirementsDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/agent/transfer/requirements", null)
        TransferRequirementsDto(
            transferPaymentPassword = root.optBoolean("transferPaymentPassword", false),
            confirmedQuoteVersion = root.optInt("confirmedQuoteVersion", 0),
            confirmedRecipient = root.optBoolean("confirmedRecipient", false),
        )
    }

    /** 提交前核对收款账号；本行账号还会校验户名，失败则不能进入确认页。 */
    suspend fun resolveTransferRecipient(
        bankCode: String,
        bankRegion: String,
        accountOrCardNo: String,
        payeeName: String,
    ): TransferRecipientDto = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("bankCode", bankCode)
            .put("bankRegion", bankRegion)
            .put("accountOrCardNo", accountOrCardNo)
            .put("payeeName", payeeName)
        val root = request("POST", "/api/transfers/recipient", body)
        TransferRecipientDto(
            kind = root.optString("kind"),
            holderNameMasked = root.optString("holderNameMasked"),
            accountNoMasked = root.optString("accountNoMasked"),
            cardLast4 = root.optString("cardLast4"),
        )
    }

    suspend fun resolveFps(method: String, identifier: String): FpsRecipientDto = withContext(Dispatchers.IO) {
        require(method in setOf("mobile", "email", "fpsid"))
        val root = request("POST", "/api/fps/resolve", JSONObject().put("idType", method).put("fpsId", identifier))
        if (!root.optBoolean("registered")) throw BankApiException(400, root.optString("reason", "该标识未登记转数快"), "FPS_NOT_REGISTERED")
        FpsRecipientDto(root.getString("name"), root.getString("bankCode"), root.getString("bankRegion")).also {
            require(it.name.isNotBlank() && it.bankCode.isNotBlank() && it.bankRegion == "HK") { "转数快登记资料不完整" }
        }
    }

    /** 转账报价：手续费、到账时间、单笔上限。 */
    suspend fun transferQuote(
        fromAccountId: String,
        channel: String,
        scope: String,
        amount: Long,
        bankCode: String,
        bankRegion: String,
        payeeCurrency: String,
    ): TransferQuoteDto = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("fromAccountId", fromAccountId)
            .put("channel", channel)
            .put("scope", scope)
            .put("amount", amount)
            .put("bankCode", bankCode)
            .put("bankRegion", bankRegion)
            .put("payeeCurrency", payeeCurrency)
        val root = request("POST", "/api/transfers/quote", body)
        val fx = root.optJSONObject("fx")?.let {
            TransferFxConfirmation(
                fromCurrency = it.getString("fromCurrency"), toCurrency = it.getString("toCurrency"),
                rate = it.getDouble("rate"), fromAmount = it.getLong("fromAmount"),
                toAmount = it.getLong("toAmount"), spread = it.getDouble("spread"),
            )
        }
        TransferQuoteDto(
            fee = root.getLong("fee"),
            etaText = root.optString("etaText"),
            maxAmount = root.getLong("maxAmount"),
            singleLimit = root.getLong("singleLimit"),
            requiresConfirm = root.optBoolean("requiresConfirm"),
            receiveAmount = root.optJSONObject("fx")?.optLong("toAmount"),
            rate = root.optJSONObject("fx")?.optDouble("rate"),
            fx = fx,
            fxTtlSeconds = root.optJSONObject("fx")?.optLong("quoteTtlSeconds"),
            receivedAt = System.currentTimeMillis(),
        )
    }

    /**
     * 提交转账：返回交易号与清算状态。
     *
     * 提交前在同一流程内查询安全能力；服务端未声明支持支付密码或报价确认时拒绝提交。
     * `paymentPassword` 只随本次请求发送，不写入任何本地存储。
     */
    suspend fun submitTransfer(
        fromAccountId: String,
        channel: String,
        scope: String,
        payeeName: String,
        amount: Long,
        memo: String,
        bankCode: String,
        bankRegion: String,
        payeeAccountNo: String,
        payeeCurrency: String,
        paymentPassword: String,
        confirmedQuote: TransferConfirmation,
        idempotencyKey: String? = null,
        fpsMethod: String? = null,
        fpsId: String? = null,
        confirmedRecipient: FpsRecipientDto? = null,
    ): TransferResultDto = withContext(Dispatchers.IO) {
        if (paymentPassword.length != 6 || !paymentPassword.all(Char::isDigit)) {
            throw BankApiException(400, "请输入 6 位数字支付密码", "INVALID_PAY_PASSWORD_FORMAT")
        }
        if (payeeCurrency !in listOf("CNY", "USD", "HKD")) {
            throw BankApiException(400, "请选择有效的到账币种", "INVALID_CURRENCY")
        }
        val support = try {
            transferRequirements()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: BankApiException) {
            if (error.status == 401) throw error
            throw BankApiException(
                503,
                "无法确认转账支付密码保护，请稍后再试",
                "TRANSFER_SECURITY_UNAVAILABLE",
            )
        } catch (error: Exception) {
            throw BankApiException(
                503,
                "无法确认转账支付密码保护，请稍后再试",
                "TRANSFER_SECURITY_UNAVAILABLE",
            )
        }
        if (!support.transferPaymentPassword || support.confirmedQuoteVersion != 1) {
            throw BankApiException(
                503,
                "银行服务暂不支持安全转账，请稍后再试",
                "TRANSFER_SECURITY_UNAVAILABLE",
            )
        }
        val body = JSONObject()
            .put("fromAccountId", fromAccountId)
            .put("channel", channel)
            .put("scope", scope)
            .put("payeeName", payeeName)
            .put("amount", amount)
            .put("memo", memo)
            .put("payeeBankCode", bankCode)
            .put("payeeBankRegion", bankRegion)
            .put("payeeAccountNo", payeeAccountNo)
            .put("payeeCurrency", payeeCurrency)
            .put("paymentPassword", paymentPassword)
            .put("confirmedQuote", confirmedQuote.toJson())
        if (channel == "fps") {
            require(fpsMethod in setOf("account", "mobile", "email", "fpsid")) { "请选择转数快标识类型" }
            body.put("fpsMethod", fpsMethod)
            if (fpsMethod != "account") {
                require(support.confirmedRecipient && confirmedRecipient != null) { "转数快收款人尚未核对" }
                body.put("fpsId", fpsId).put("confirmedRecipient", confirmedRecipient.toJson())
            }
        }
        val root = request("POST", "/api/transfers", body, idempotencyKey)
        TransferResultDto(
            transactionId = root.optString("transactionId"),
            referenceNo = root.optString("referenceNo"),
            amount = root.optLong("amount"),
            fee = root.optLong("fee"),
            identifier = root.optString("identifier"),
            settlementStatus = root.optString("settlementStatus"),
            currency = confirmedQuote.fromCurrency,
            fx = root.optJSONObject("fx")?.let { TransferFxConfirmation(it.getString("fromCurrency"), it.getString("toCurrency"), it.getDouble("rate"), it.getLong("fromAmount"), it.getLong("toAmount"), it.getDouble("spread")) },
        )
    }


    /* ─────────── 其余业务（除 IM 与助手） ─────────── */

    suspend fun profile(): ProfileDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/auth/profile", null)
        ProfileDto(
            name = root.optString("name"),
            phone = root.optString("phone"),
            idNumberMasked = root.optString("idNumberMasked"),
            address = root.optString("address"),
            openedAt = root.optString("openedAt"),
            avatarId = root.optString("avatarId"),
            displayName = root.optString("displayName"),
            maskedName = root.optString("maskedName"),
            nickname = root.optString("nickname"),
            customNickname = root.optString("customNickname"),
        )
    }

    /** 设置自定义昵称；传空串恢复默认称呼。昵称只影响展示，不改实名。 */
    suspend fun updateNickname(nickname: String): ProfileDto = withContext(Dispatchers.IO) {
        NameDisplay.validateNickname(nickname)?.let { throw BankApiException(400, it, "INVALID_NICKNAME") }
        val root = request("PATCH", "/api/auth/profile/nickname", JSONObject().put("nickname", NameDisplay.normalizeNickname(nickname)))
        ProfileDto(
            name = root.optString("name"),
            phone = root.optString("phone"),
            idNumberMasked = root.optString("idNumberMasked"),
            address = root.optString("address"),
            openedAt = root.optString("openedAt"),
            avatarId = root.optString("avatarId"),
            displayName = root.optString("displayName"),
            maskedName = root.optString("maskedName"),
            nickname = root.optString("nickname"),
            customNickname = root.optString("customNickname"),
        )
    }

    /** 头像只接受头像池里的 id；服务端会再次校验，非法值返回 400。 */
    suspend fun updateAvatar(avatarId: String): ProfileDto = withContext(Dispatchers.IO) {
        if (avatarId !in AvatarPool.ids) throw BankApiException(400, "请选择头像池里的头像", "INVALID_AVATAR")
        val root = request("PATCH", "/api/auth/profile/avatar", JSONObject().put("avatarId", avatarId))
        ProfileDto(
            name = root.optString("name"),
            phone = root.optString("phone"),
            idNumberMasked = root.optString("idNumberMasked"),
            address = root.optString("address"),
            openedAt = root.optString("openedAt"),
            avatarId = root.optString("avatarId"),
            displayName = root.optString("displayName"),
            maskedName = root.optString("maskedName"),
            nickname = root.optString("nickname"),
            customNickname = root.optString("customNickname"),
        )
    }

    suspend fun transaction(id: String): TransactionDetailDto = withContext(Dispatchers.IO) {
        require(id.matches(Regex("[A-Za-z0-9_-]+")))
        val root = request("GET", "/api/transactions/$id", null)
        val detail = root.optJSONObject("detail") ?: JSONObject()
        TransactionDetailDto(
            id = root.getString("id"), counterparty = root.optString("counterparty"), amount = root.getLong("amount"),
            direction = root.getString("direction"), category = root.optString("category"), status = root.getString("status"),
            createdAt = root.getString("createdAt"), memo = root.optString("memo"), referenceNo = detail.optString("referenceNo"),
            cardLast4 = detail.optString("paymentMethod"), accountLabel = detail.optString("accountLabel"),
            currency = detail.getString("settleCurrency"), pendingReason = root.optString("pendingReason"), holdUntil = root.optString("holdUntil"),
            accountNo = detail.optString("accountNo"), otherAccountNo = detail.optString("counterpartyAccountNo"), otherBank = detail.optString("counterpartyBank"),
            fee = detail.optLong("fee"), originAmount = if (detail.has("originAmount")) detail.getLong("originAmount") else null,
            originCurrency = detail.optString("originCurrency"), exchangeRate = if (detail.has("exchangeRate")) detail.getDouble("exchangeRate") else null,
        )
    }

    internal suspend fun recallTransfer(id: String): JSONObject = withContext(Dispatchers.IO) {
        require(id.matches(Regex("[A-Za-z0-9_-]+")))
        request("POST", "/api/transfers/$id/recall", JSONObject())
    }

    internal suspend fun savedPayees(keyword: String): JSONArray = withContext(Dispatchers.IO) {
        JSONArray(requestRaw("GET", "/api/payees?keyword=" + java.net.URLEncoder.encode(keyword, "UTF-8"), null))
    }

    /** 删除通讯录里的收款人（`DELETE /api/payees/:id`）：只删记录，不影响已有转账与流水。 */
    internal suspend fun deletePayee(id: String) = withContext(Dispatchers.IO) {
        require(id.matches(Regex("[A-Za-z0-9_-]+"))) { "收款人编号无效" }
        request("DELETE", "/api/payees/$id", null)
    }

    internal suspend fun payeeRemark(id: String, remark: String): JSONObject = withContext(Dispatchers.IO) {
        require(id.matches(Regex("[A-Za-z0-9_-]+")))
        request("PATCH", "/api/payees/$id", JSONObject().put("remark", remark))
    }

    /**
     * 新增收款人（`POST /api/payees`）：与转账页共用同一份通讯录。
     *
     * 同一手机号或同一账号已存在时后端不新建第二条，而是补齐缺的那一项并返回原记录
     * （状态 2xx），所以这里不需要处理 409；真正冲突只在两项都指不到同一个人时才会报错。
     */
    internal suspend fun addPayee(identity: SplitIdentity): JSONObject = withContext(Dispatchers.IO) {
        require(identity.name.isNotBlank()) { "请填写收款人姓名" }
        require(identity.phone.matches(Regex("1[3-9]\\d{9}")) || identity.accountNo.matches(Regex("\\d{12,19}"))) { "请填写手机号或本行账号" }
        request("POST", "/api/payees", JSONObject().put("name", identity.name).apply {
            if (identity.phone.isNotEmpty()) put("phone", identity.phone)
            if (identity.accountNo.isNotEmpty()) put("accountNo", identity.accountNo)
        })
    }

    internal suspend fun membershipData(redeem: Boolean = false): JSONObject = withContext(Dispatchers.IO) {
        request(if (redeem) "POST" else "GET", if (redeem) "/api/membership/lounge-pass" else "/api/membership", if (redeem) JSONObject() else null)
    }

    suspend fun spending(month: String, currency: String = "CNY"): SpendingDto = withContext(Dispatchers.IO) {
        require(month.matches(Regex("[0-9]{4}-(0[1-9]|1[0-2])")) && currency in setOf("CNY", "USD", "HKD"))
        val response = request("GET", "/api/analysis/spending?month=$month", null)
        val root = response.optJSONObject("byCurrency")?.optJSONObject(currency) ?: if (currency == "CNY") response else throw BankApiException(502, "银行未返回所选币种统计", "INVALID_STATISTICS")
        require(root.optString("month") == month) { "银行返回的统计月份不一致" }
        SpendingDto(
            month = root.optString("month"),
            total = root.optLong("total"),
            previousMonth = root.optString("previousMonth"),
            monthOverMonth = if (root.isNull("monthOverMonth")) null else root.optDouble("monthOverMonth"),
            comparable = root.optBoolean("monthOverMonthComparable"),
            categories = root.optJSONArray("categories")?.let { arr ->
                buildList {
                    for (i in 0 until arr.length()) {
                        val row = arr.getJSONObject(i)
                        add(SpendingCategoryDto(row.optString("key"), row.optString("label"), row.optLong("amount"), row.optDouble("ratio")))
                    }
                }
            }.orEmpty(),
            trend = root.optJSONArray("trend")?.let { arr ->
                buildList {
                    for (i in 0 until arr.length()) {
                        val row = arr.getJSONObject(i)
                        add(TrendPointDto(row.optString("month"), row.optLong("amount")))
                    }
                }
            }.orEmpty(),
        )
    }

    suspend fun cashFlow(days: Int, currency: String = "CNY"): CashFlowDto = withContext(Dispatchers.IO) {
        require(days in 1..366 && currency in setOf("CNY", "USD", "HKD"))
        val response = request("GET", "/api/analysis/cashflow?days=$days", null)
        val root = response.optJSONObject("byCurrency")?.optJSONObject(currency) ?: if (currency == "CNY") response else throw BankApiException(502, "银行未返回所选币种现金流", "INVALID_STATISTICS")
        CashFlowDto(
            totalIncome = root.optLong("totalIncome"),
            totalExpense = root.optLong("totalExpense"),
        )
    }

    suspend fun membership(): MembershipDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/membership", null)
        MembershipDto(
            tier = root.optString("tier"),
            tierLabel = root.optString("tierLabel"),
            aum = root.optLong("aum"),
            nextTier = root.optString("nextTier"),
            nextThreshold = root.optLong("nextThreshold"),
            benefits = root.optJSONArray("benefits")?.let { arr ->
                buildList { for (i in 0 until arr.length()) add(arr.getString(i)) }
            }.orEmpty(),
        )
    }

    suspend fun securityOverview(): SecurityDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/security/overview", null)
        SecurityDto(
            score = root.optInt("score"),
            level = root.optString("level"),
            identityVerified = root.optBoolean("identityVerified"),
            devices = root.optJSONArray("devices")?.let { arr ->
                buildList {
                    for (i in 0 until arr.length()) {
                        val row = arr.getJSONObject(i)
                        add(DeviceDto(row.optString("name"), row.optString("location"), row.optString("lastActiveAt")))
                    }
                }
            }.orEmpty(),
        )
    }

    suspend fun autoDebits(): List<AutoDebitDto> = withContext(Dispatchers.IO) {
        val text = requestRaw("GET", "/api/autodebits", null)
        val arr = org.json.JSONTokener(text).nextValue() as JSONArray
        buildList {
            for (i in 0 until arr.length()) {
                val row = arr.getJSONObject(i)
                add(
                    AutoDebitDto(
                        id = row.optString("id"),
                        merchant = row.optString("merchant"),
                        amount = row.optLong("amount"),
                        cycle = row.optString("cycle"),
                        nextRunAt = row.optString("nextRunAt"),
                        enabled = row.optBoolean("enabled"),
                    )
                )
            }
        }
    }

    suspend fun savingsOverview(): SavingsDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/savings/overview", null)
        SavingsDto(
            totalSaved = root.optLong("totalSaved"),
            goals = root.optJSONArray("goals")?.let { arr ->
                buildList {
                    for (i in 0 until arr.length()) {
                        val row = arr.getJSONObject(i)
                        val sweep = row.optJSONObject("sweep")
                        add(
                            SavingsGoalDto(
                                id = row.optString("id"),
                                name = row.optString("name"),
                                targetAmount = row.optLong("targetAmount"),
                                savedAmount = row.optLong("savedAmount"),
                                deadline = row.optString("deadline"),
                                sweepText = sweep?.let { formatCents(it.optLong("amount")) + " · " + it.optString("cycle") }.orEmpty(),
                            )
                        )
                    }
                }
            }.orEmpty(),
            roundupEnabled = root.optJSONObject("roundup")?.optBoolean("enabled") ?: false,
            roundupTo = root.optJSONObject("roundup")?.optLong("roundupTo") ?: 0L,
            roundupDailyCap = root.optJSONObject("roundup")?.optLong("dailyCap") ?: 0L,
        )
    }

    suspend fun invitations(): InvitationDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/invitations", null)
        InvitationDto(
            code = root.optJSONObject("invite")?.optString("code").orEmpty(),
            friends = root.optJSONArray("friends")?.let { arr ->
                buildList {
                    for (i in 0 until arr.length()) {
                        val row = arr.getJSONObject(i)
                        add(InviteFriendDto(row.optString("name"), row.optString("maskedPhone"), row.optString("stage")))
                    }
                }
            }.orEmpty(),
        )
    }

    suspend fun insurance(): InsuranceDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/wealth/insurance", null)
        InsuranceDto(
            totalCoverage = root.optLong("totalCoverage"),
            policies = root.optJSONArray("policies")?.let { arr ->
                buildList {
                    for (i in 0 until arr.length()) {
                        val row = arr.getJSONObject(i)
                        add(
                            PolicyDto(
                                productName = row.optString("productName"),
                                insurer = row.optString("insurer"),
                                premium = row.optLong("premium"),
                                coverage = row.optLong("coverage"),
                                status = row.optString("status"),
                                expireAt = row.optString("expireAt"),
                            )
                        )
                    }
                }
            }.orEmpty(),
        )
    }

    suspend fun cardProducts(): List<CardProductDto> = withContext(Dispatchers.IO) {
        val text = requestRaw("GET", "/api/cards/products", null)
        val arr = org.json.JSONTokener(text).nextValue() as JSONArray
        buildList {
            for (i in 0 until arr.length()) {
                val row = arr.getJSONObject(i)
                add(
                    CardProductDto(
                        code = row.optString("code"),
                        name = row.optString("name"),
                        network = row.optString("network"),
                        issuingFee = row.optLong("issuingFee"),
                        deliveryFee = row.optLong("deliveryFee"),
                        held = row.optBoolean("held"),
                    )
                )
            }
        }
    }

    suspend fun exchangeQuote(fromAccountId: String, toCurrency: String, amount: Long): ExchangeQuoteDto =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("fromAccountId", fromAccountId)
                .put("toCurrency", toCurrency)
                .put("amount", amount)
            val root = request("POST", "/api/exchange/quote", body)
            // 服务端把汇率信息放在 fx 子对象里；直接读根节点会得到 0。
            val fx = root.optJSONObject("fx")
            ExchangeQuoteDto(
                quoteId = root.optString("quoteId"),
                rate = fx?.optDouble("rate", 0.0) ?: 0.0,
                toAmount = fx?.optLong("toAmount") ?: 0L,
                fee = 0L,
                expiresAt = fx?.optString("quotedAt").orEmpty(),
            )
        }

    suspend fun exchange(quoteId: String, fromAccountId: String, toCurrency: String, amount: Long, paymentPassword: String): Unit =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("quoteId", quoteId)
                .put("fromAccountId", fromAccountId)
                .put("toCurrency", toCurrency)
                .put("amount", amount)
                .put("paymentPassword", paymentPassword)
            request("POST", "/api/exchange", body)
            Unit
        }

    /** 兼容旧调用：真实提交后丢弃回执；新界面请用 [subscribeWealthDetailed] 展示确认信息。 */
    suspend fun subscribeWealth(productCode: String, amount: Long, paymentPassword: String, acknowledgement: String) {
        subscribeWealthDetailed(productCode, amount, paymentPassword, acknowledgement)
    }

    /** 兼容旧调用：全部赎回并丢弃回执；新界面请用 [redeemWealthDetailed]。 */
    suspend fun redeemWealth(holdingId: String) {
        redeemWealthDetailed(holdingId)
    }

    suspend fun openCard(productCode: String, paymentPassword: String, recipient: String, phone: String, region: String, detail: String): Unit =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("productCode", productCode)
                .put("paymentPassword", paymentPassword)
                .put("address", JSONObject().put("recipient", recipient).put("phone", phone).put("region", region).put("detail", detail))
            request("POST", "/api/cards/open", body)
            Unit
        }

    /** 交易分类中文名（与网页 `lib/categories.ts` 一致）。 */
    fun categoryLabel(key: String): String = when (key) {
        "salary" -> "工资入账"
        "transfer" -> "转账"
        "dining" -> "餐饮"
        "shopping" -> "购物"
        "housing" -> "房租"
        "transport" -> "交通"
        "subscription" -> "订阅服务"
        else -> "其他"
    }

    private fun request(
        method: String,
        path: String,
        body: JSONObject?,
        idempotencyKey: String? = null,
    ): JSONObject {
        val label = when {
            method == "DELETE" && Regex("^/api/transfers/scheduled/[^/]+$").matches(path) -> "取消定时转账"
            method == "DELETE" && Regex("^/api/transfers/splits/[^/]+$").matches(path) -> "取消 AA 收款"
            method == "PATCH" && path.startsWith("/api/wealth/investments/plan/") -> "定投计划状态"
            method != "POST" -> null
            path == "/api/wealth/investments/plan" -> "保存定投计划"
            path == "/api/linked/birthdays" -> "生日资金预留"
            Regex("^/api/linked/birthdays/[^/]+/(cancel|order)$").matches(path) -> "生日计划操作"
            path == "/api/transfers" -> "转账"
            Regex("^/api/transfers/[^/]+/recall$").matches(path) -> "撤销在途转账"
            path == "/api/transfers/scheduled" -> "定时转账"
            path == "/api/transfers/splits" -> "AA 收款"
            Regex("^/api/transfers/aa-payments/[^/]+/pay$").matches(path) -> "AA 付款"
            Regex("^/api/transfers/splits/[^/]+/(payments|reminders)$").matches(path) -> "AA 收款操作"
            path == "/api/exchange" -> "换汇"
            path == "/api/wealth/subscribe" -> "理财申购"
            path == "/api/wealth/redeem" -> "理财赎回"
            path == "/api/cards/open" -> "开卡"
            Regex("^/api/cards/[^/]+/replace$").matches(path) -> "换卡"
            else -> null
        }
        val raw = if (label == null) requestRaw(method, path, body, idempotencyKey)
            else protectedFinancialRequest(method, path, body, label, idempotencyKey)
        return org.json.JSONTokener(raw).nextValue() as JSONObject
    }

    internal fun protectedFinancialRequest(method: String, path: String, body: JSONObject?, label: String, existingKey: String? = null): String {
        val (phone, capturedToken) = SessionStore.credentials()
        if (phone.isBlank() || capturedToken.isNullOrBlank()) throw BankApiException(401, "请重新登录", "UNAUTHORIZED")
        val support = JSONObject(requestRaw("GET", "/api/idempotency/capabilities", null, authToken = capturedToken))
        val owner = support.optString("ownerId")
        if (support.optInt("version") != 1 || !support.optBoolean("atomicSeal") || owner.isBlank())
            throw BankApiException(503, "银行暂不支持安全恢复，请稍后再试", "RECOVERY_UNAVAILABLE")
        val key = FinancialRecovery.begin(label, existingKey, owner, capturedToken)
        try {
            val raw = requestRaw(method, path, body, key, capturedToken)
            val receipt = org.json.JSONTokener(raw).nextValue() as? JSONObject
            if (receipt == null || !financialReceiptValid(path, receipt)) throw BankApiException(502, "银行返回的结果无效，请核查操作状态", "INVALID_RECOVERY_RESULT")
            FinancialRecovery.completed(owner, capturedToken, key)
            return raw
        }
        finally { FinancialRecovery.finished(owner, capturedToken, key) }
    }

    internal fun financialReceiptValid(path: String, receipt: JSONObject): Boolean = when {
        path == "/api/transfers" -> receipt.optString("transactionId").isNotBlank() && receipt.optString("settlementStatus") in setOf("success", "pending")
        path.endsWith("/recall") -> receipt.optString("transactionId").isNotBlank() && receipt.has("status")
        path == "/api/exchange" -> receipt.optString("transactionId").isNotBlank() && receipt.optJSONObject("fx") != null
        path == "/api/wealth/subscribe" -> receipt.optJSONObject("holding")?.optString("id")?.isNotBlank() == true && receipt.has("shares")
        path == "/api/wealth/redeem" -> receipt.optString("holdingId").isNotBlank() && receipt.has("settlementMode")
        path.startsWith("/api/wealth/investments/plan") -> receipt.optString("id").isNotBlank() && receipt.has("revision") && receipt.has("status")
        path.startsWith("/api/linked/birthdays") -> receipt.optString("id").isNotBlank() && receipt.has("reservation") && receipt.has("status")
        path.endsWith("/spend") -> receipt.optJSONObject("transaction")?.optString("id")?.isNotBlank() == true && receipt.has("available") && receipt.has("currency")
        path.startsWith("/api/cards/") -> receipt.optString("id").isNotBlank()
        path.endsWith("/reminders") -> receipt.optJSONObject("collection")?.optString("id")?.isNotBlank() == true
        path.startsWith("/api/transfers/") -> receipt.optString("id").isNotBlank() && receipt.has("version") && receipt.has("status")
        else -> false
    }

    suspend fun refreshFinancialRecovery() {
        val capturedToken = SessionStore.credentials().second ?: return
        val owner = withContext(Dispatchers.IO) {
            val support = JSONObject(requestRaw("GET", "/api/idempotency/capabilities", null, authToken = capturedToken))
            if (support.optInt("version") != 1 || !support.optBoolean("atomicSeal")) "" else support.optString("ownerId")
        }
        if (SessionStore.credentials().second == capturedToken && owner.isNotBlank()) FinancialRecovery.refresh(owner, capturedToken)
    }

    internal suspend fun paymentPlanList(path: String): org.json.JSONArray = withContext(Dispatchers.IO) {
        require(path in setOf("/api/transfers/scheduled", "/api/transfers/splits", "/api/transfers/aa-payments", "/api/banks"))
        org.json.JSONArray(requestRaw("GET", path, null))
    }

    internal suspend fun paymentPlanWrite(method: String, path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        require(method in setOf("POST", "DELETE"))
        require(path == "/api/transfers/scheduled" || path == "/api/transfers/splits" ||
            Regex("^/api/transfers/(scheduled|splits)/[A-Za-z0-9_-]+(/(payments|reminders))?$").matches(path) ||
            Regex("^/api/transfers/aa-payments/[A-Za-z0-9_-]+/pay$").matches(path))
        request(method, path, body)
    }

    internal suspend fun budgetRequest(method: String, path: String, body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        require(method in setOf("GET", "POST", "PATCH", "DELETE"))
        require(path == "/api/budgets" || Regex("^/api/budgets/[A-Za-z0-9_-]+(/passes)?$").matches(path))
        request(method, path, body)
    }

    internal suspend fun savingsRequest(method: String, path: String, body: JSONObject? = null): Any = withContext(Dispatchers.IO) {
        require(method in setOf("GET", "POST", "PATCH", "DELETE"))
        require(path in setOf("/api/savings/overview", "/api/savings/goals", "/api/savings/roundup", "/api/wealth/investments", "/api/wealth/investments/plan", "/api/wealth/cash-management", "/api/wealth/cash-management/sweep", "/api/linked/birthdays", "/api/linked/birthdays/preview") ||
            Regex("^/api/(savings/goals|wealth/investments/plan)/[A-Za-z0-9_-]+$").matches(path) || Regex("^/api/linked/birthdays/[A-Za-z0-9_-]+/(cancel|order)$").matches(path))
        if (path.startsWith("/api/wealth/investments/plan") || path.startsWith("/api/linked/birthdays") && !path.endsWith("/preview")) {
            if (method != "GET") return@withContext request(method, path, body)
        }
        val raw = requestRaw(method, path, body)
        if (raw.isBlank()) JSONObject() else org.json.JSONTokener(raw).nextValue()
    }

    internal suspend fun supportRequest(method: String, path: String, body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        require(method in setOf("GET", "POST"))
        require(path == "/api/support/tickets" || Regex("^/api/support/tickets/T_[A-Za-z0-9_]+(/messages)?$").matches(path))
        request(method, path, body)
    }

    suspend fun resolveFinancialOperation(key: String): String = withContext(Dispatchers.IO) {
        require(key.matches(Regex("[A-Za-z0-9_.:-]{8,128}")))
        val reply = request("POST", "/api/idempotency/$key/resolve", JSONObject())
        when (reply.optString("status")) {
            "sealed" -> "银行确认该操作未完成，并已终结原编号。确认后可重新办理。"
            "completed" -> {
                val data = reply.optJSONObject("result")
                val reference = data?.optString("referenceNo").orEmpty().ifBlank { data?.optString("transactionId").orEmpty() }
                val state = data?.optString("settlementStatus").orEmpty().ifBlank { data?.optString("status").orEmpty() }
                val statusText = when (state) {
                    "pending" -> "业务仍在处理中。"
                    "failed", "rejected" -> "业务未成功。"
                    else -> "请在相应业务页面查看最终状态。"
                }
                buildString {
                    append("银行已处理原请求。$statusText")
                    if (reference.isNotBlank()) append("\n参考编号：$reference")
                    val fx = data?.optJSONObject("fx")
                    if (fx != null && fx.has("fromAmount") && fx.has("toAmount")) {
                        append("\n卖出：${formatCents(fx.optLong("fromAmount"), fx.optString("fromCurrency"))}")
                        append("\n买入：${formatCents(fx.optLong("toAmount"), fx.optString("toCurrency"))}")
                        if (fx.has("rate")) append("\n成交汇率：${fx.optDouble("rate")}")
                    }
                    if (data?.has("shares") == true) append("\n份额：${data.optDouble("shares")}")
                    if (data?.has("fees") == true) append("\n费用：${formatCents(data.optLong("fees"))}")
                    val eta = data?.optString("etaText").orEmpty()
                    if (eta.isNotBlank()) append("\n$eta")
                }
            }
            else -> throw BankApiException(502, "银行返回的核查结果无效，请稍后重试", "INVALID_RECOVERY_RESULT")
        }
    }

    private fun requestRaw(
        method: String,
        path: String,
        body: JSONObject?,
        idempotencyKey: String? = null,
        authToken: String? = token,
    ): String {
        val cacheable = readCacheable(method, path, authToken)
        if (cacheable) {
            readCache[readCacheKey(authToken, path)]?.let { cached ->
                if (System.currentTimeMillis() - cached.at < READ_CACHE_TTL_MS) return cached.body
            }
        }
        try {
            // I/O 由 BankHttp 统一实现；这里只保留读缓存、幂等键与「旧令牌不登出」的判断。
            val text = BankHttp.raw(
                method = method,
                path = path,
                body = body,
                token = authToken,
                extraHeaders = idempotencyKey?.let { mapOf("Idempotency-Key" to it) }.orEmpty(),
                notifyUnauthorized = token == authToken,
            )
            if (cacheable) readCache[readCacheKey(authToken, path)] = CachedRead(text, System.currentTimeMillis())
            return text
        } finally {
            // 任何写操作都可能改变读结果，直接整体失效，避免脏数据。
            if (method != "GET") readCache.clear()
        }
    }
}

class BankApiException(
    val status: Int,
    override val message: String,
    val code: String? = null,
) : Exception(message)

data class LoginResult(
    val token: String,
    val name: String,
    val phone: String,
    val displayName: String = "",
    val nickname: String = "",
    val customNickname: String = "",
)

data class AccountDto(
    val id: String,
    val accountNo: String,
    val label: String,
    val currency: String,
    val balance: Long,
    val available: Long,
    val currencyBalances: List<CurrencyBalanceDto>,
)

data class CurrencyBalanceDto(
    val id: String,
    val currency: String,
    val label: String,
    val balance: Long,
    val available: Long,
)

/** 转出流程的草稿：表单页填写，金额页与确认页复用。 */
data class TransferDraft(
    val channel: String = "bank",
    val payeeName: String = "",
    val payeeAccountNo: String = "",
    val bankCode: String = "CMB",
    val bankRegion: String = "CN",
    val amountCents: Long = 500_00,
    /** bankCard / fps；FPS 标识必须经过服务端登记解析。 */
    val method: String = "bankCard",
    val fpsMethod: String = "mobile",
    val fpsId: String = "",
)

data class FpsRecipientDto(val name: String, val bankCode: String, val bankRegion: String) {
    fun toJson(): JSONObject = JSONObject().put("name", name).put("bankCode", bankCode).put("bankRegion", bankRegion)
}

data class TransferRequirementsDto(
    val transferPaymentPassword: Boolean,
    val confirmedQuoteVersion: Int,
    val confirmedRecipient: Boolean,
)

data class TransferRecipientDto(
    val kind: String,
    val holderNameMasked: String,
    val accountNoMasked: String,
    val cardLast4: String,
)

data class TransferQuoteDto(
    val fee: Long,
    val etaText: String,
    val maxAmount: Long,
    val singleLimit: Long,
    val requiresConfirm: Boolean,
    val receiveAmount: Long?,
    val rate: Double?,
    val fx: TransferFxConfirmation? = null,
    val fxTtlSeconds: Long? = null,
    val receivedAt: Long = 0,
)

/** 客户在确认页看到的报价条件；提交时原样回传，服务端逐项复核。 */
data class TransferConfirmation(
    val fromCurrency: String,
    val fee: Long,
    val submitBefore: Long,
    val fx: TransferFxConfirmation? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("version", 1)
        put("fromCurrency", fromCurrency)
        put("fee", fee)
        put("fx", fx?.toJson() ?: JSONObject.NULL)
        put("submitBefore", submitBefore)
    }
}

data class TransferFxConfirmation(
    val fromCurrency: String,
    val toCurrency: String,
    val rate: Double,
    val fromAmount: Long,
    val toAmount: Long,
    val spread: Double,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("fromCurrency", fromCurrency)
        .put("toCurrency", toCurrency)
        .put("rate", rate)
        .put("fromAmount", fromAmount)
        .put("toAmount", toAmount)
        .put("spread", spread)
}

data class TransferResultDto(
    val transactionId: String,
    val referenceNo: String,
    val amount: Long,
    val fee: Long,
    val identifier: String,
    val settlementStatus: String,
    val currency: String = "CNY",
    val fx: TransferFxConfirmation? = null,
)

data class CardDto(
    val id: String,
    val productName: String,
    val last4: String,
    val cardholder: String,
    val expiry: String,
    val network: String,
    val theme: String,
    val status: String,
    val onlinePayment: Boolean,
    val overseasPayment: Boolean,
    val dailyLimit: Long,
)

data class HoldingDto(
    val id: String,
    val productCode: String,
    val productName: String,
    val risk: String,
    /** 份额是小数，不是金额分；不能用 formatCents 显示。 */
    val shares: Double,
    val principal: Long,
    val marketValue: Long,
    val profit: Long,
    val profitRate: Double,
    val purchasedAt: String,
    val redeemableAt: String?,
    val redeemableShares: Double,
    val closed: Boolean,
)

data class WealthOverviewDto(
    val opened: Boolean,
    val wealthAccountNo: String,
    val wealthOpenedAt: String,
    val settlementAccountId: String,
    val totalValue: Long,
    val totalPrincipal: Long,
    val totalProfit: Long,
    val yesterdayProfit: Long,
    val holdings: List<HoldingDto>,
    val riskLevel: String?,
    val riskScore: Int?,
    val riskDone: Boolean,
    val riskExpired: Boolean,
    val riskStatus: String,
    val riskEligible: Boolean,
    val riskExpiresAt: String,
) {
    val riskValid: Boolean get() = riskDone && !riskExpired
}

data class WealthProductDto(
    val code: String,
    val name: String,
    val issuer: String,
    val risk: String,
    val category: String,
    val nav: Double,
    val navDate: String,
    val sevenDayYield: Double?,
    val sinceInception: Double,
    val volatility: Double,
    val minAmount: Long,
    val stepAmount: Long,
    val term: String,
    val openEnded: Boolean,
    val priorityRestricted: Boolean,
    val benchmark: String,
    val benchmarkBasis: String,
    val ongoingFees: List<WealthFeeDto>,
    val transactionFees: List<WealthFeeDto>,
)

data class WealthFeeDto(
    val label: String,
    val rate: Double,
    val holdingDaysLessThan: Int?,
)

data class RiskOptionDto(val label: String, val score: Int)
data class RiskQuestionDto(val id: String, val question: String, val options: List<RiskOptionDto>)

data class RiskAssessmentDto(
    val done: Boolean,
    val level: String?,
    val score: Int?,
    val assessedAt: String,
    val expiresAt: String,
    val expired: Boolean,
    val status: String,
    val eligible: Boolean,
) {
    val valid: Boolean get() = done && !expired
}

data class WealthAccountDto(
    val opened: Boolean,
    val accountNo: String,
    val openedAt: String,
    val settlementAccountId: String,
    val agreementSignedAt: String,
    val riskLevelAtOpening: String,
)

data class RegistrationResultDto(
    val token: String,
    val name: String,
    val phone: String,
    val accountId: String,
    val accountLabel: String,
    val accountNo: String,
    val openedAt: String,
)

data class WealthSubscribeResultDto(
    val holdingId: String,
    val productName: String,
    val shares: Double,
    val nav: Double,
    val fees: Long,
    val confirmedAt: String,
    val holdingMarketValue: Long,
    val holdingPrincipal: Long,
)

data class WealthRedeemResultDto(
    val holdingId: String,
    val acceptedAt: String,
    val shares: Double,
    val estimatedAmount: Long,
    val fees: Long,
    val settlementMode: String,
    val settledAt: String,
    val etaText: String,
)

data class TransactionDto(
    val id: String,
    val direction: String,
    val amount: Long,
    val counterparty: String,
    val category: String,
    val memo: String,
    val createdAt: String,
)


data class ProfileDto(
    val name: String,
    val phone: String,
    val idNumberMasked: String,
    val address: String,
    val openedAt: String,
    val avatarId: String = "",
    val displayName: String = "",
    val maskedName: String = "",
    val nickname: String = "",
    val customNickname: String = "",
)

data class TransactionDetailDto(
    val id: String, val counterparty: String, val amount: Long, val direction: String,
    val category: String, val status: String, val createdAt: String, val memo: String,
    val referenceNo: String, val cardLast4: String, val accountLabel: String,
    val currency: String, val pendingReason: String, val holdUntil: String,
    val accountNo: String, val otherAccountNo: String, val otherBank: String, val fee: Long,
    val originAmount: Long?, val originCurrency: String, val exchangeRate: Double?,
)

data class SpendingCategoryDto(val key: String, val label: String, val amount: Long, val ratio: Double)
data class TrendPointDto(val month: String, val amount: Long)

data class SpendingDto(
    val month: String, val total: Long, val previousMonth: String,
    val monthOverMonth: Double?, val comparable: Boolean,
    val categories: List<SpendingCategoryDto>, val trend: List<TrendPointDto>,
)

data class CashFlowDto(val totalIncome: Long, val totalExpense: Long)

data class MembershipDto(
    val tier: String, val tierLabel: String, val aum: Long,
    val nextTier: String, val nextThreshold: Long, val benefits: List<String>,
)

data class DeviceDto(val name: String, val location: String, val lastActiveAt: String)
data class SecurityDto(val score: Int, val level: String, val identityVerified: Boolean, val devices: List<DeviceDto>)

data class AutoDebitDto(
    val id: String, val merchant: String, val amount: Long,
    val cycle: String, val nextRunAt: String, val enabled: Boolean,
)

data class SavingsGoalDto(
    val id: String, val name: String, val targetAmount: Long,
    val savedAmount: Long, val deadline: String, val sweepText: String,
)

data class SavingsDto(
    val totalSaved: Long, val goals: List<SavingsGoalDto>,
    val roundupEnabled: Boolean, val roundupTo: Long, val roundupDailyCap: Long,
)

data class InviteFriendDto(val name: String, val maskedPhone: String, val stage: String)
data class InvitationDto(val code: String, val friends: List<InviteFriendDto>)

data class PolicyDto(
    val productName: String, val insurer: String, val premium: Long,
    val coverage: Long, val status: String, val expireAt: String,
)

data class InsuranceDto(val totalCoverage: Long, val policies: List<PolicyDto>)

data class CardProductDto(
    val code: String, val name: String, val network: String,
    val issuingFee: Long, val deliveryFee: Long, val held: Boolean,
)

data class ExchangeQuoteDto(val quoteId: String, val rate: Double, val toAmount: Long, val fee: Long, val expiresAt: String)

/** 金额格式化：后端是整数分。 */
fun formatCents(cents: Long, currency: String = "CNY"): String {
    val symbol = when (currency) {
        "HKD" -> "HK$"
        "USD" -> "US$"
        else -> "¥"
    }
    val sign = if (cents < 0) "-" else ""
    val abs = kotlin.math.abs(cents)
    val yuan = (abs / 100).toString().reversed().chunked(3).joinToString(",").reversed()
    val fraction = (abs % 100).toString().padStart(2, '0')
    return "$sign$symbol$yuan.$fraction"
}

/** 登录态持久化：令牌存 SharedPreferences，重启应用仍可复用。 */
object SessionStore {
    private const val PREFS = "money_meow_session"
    /** 旧版本明文令牌的键：只用于一次性迁移到加密存储。 */
    private const val KEY_TOKEN_LEGACY = "token"
    /** 加密后的令牌（Base64(iv + 密文)），密钥由 Android Keystore 保管。 */
    private const val KEY_TOKEN = "tokenSealed"
    private const val KEY_NAME = "name"
    private const val KEY_PHONE = "phone"
    private const val KEY_DISPLAY = "displayName"
    private const val KEY_NICKNAME = "nickname"

    private lateinit var prefs: android.content.SharedPreferences

    /** 读出令牌：优先解密新格式；老版本留下的明文令牌顺便迁移并清掉。 */
    private fun readToken(): String? {
        TokenVault.decrypt(prefs.getString(KEY_TOKEN, null))?.let { return it }
        val legacy = prefs.getString(KEY_TOKEN_LEGACY, null) ?: return null
        val sealed = TokenVault.encrypt(legacy)
        prefs.edit().apply {
            if (sealed != null) putString(KEY_TOKEN, sealed)
            remove(KEY_TOKEN_LEGACY)
        }.apply()
        return legacy
    }

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        FinancialRecovery.init(context)
        BankApi.setToken(readToken())
    }

    @Synchronized fun save(result: LoginResult) {
        // 令牌必须以密文落盘：SharedPreferences 本身不提供加密。
        val sealed = TokenVault.encrypt(result.token)
        prefs.edit().apply {
            if (sealed != null) putString(KEY_TOKEN, sealed) else remove(KEY_TOKEN)
            remove(KEY_TOKEN_LEGACY)
        }.apply()
        prefs.edit()
            .putString(KEY_NAME, result.name)
            .putString(KEY_PHONE, result.phone)
            .putString(KEY_DISPLAY, result.displayName.ifEmpty { NameDisplay.of(result.name) })
            .putString(KEY_NICKNAME, result.nickname.ifEmpty { NameDisplay.nicknameOf(result.customNickname, result.displayName.ifEmpty { NameDisplay.of(result.name) }) })
            .apply()
        BankApi.setToken(result.token)
    }

    fun name(): String = prefs.getString(KEY_NAME, "").orEmpty()
    fun phone(): String = prefs.getString(KEY_PHONE, "").orEmpty()

    /** 列表里用「姓氏 + 称呼」，不直接露全名；没有缓存时按全名现算。 */
    fun displayName(): String =
        prefs.getString(KEY_DISPLAY, "").orEmpty().ifEmpty { NameDisplay.of(name()) }

    /** 展示用昵称：自定义优先，否则回退到称呼。 */
    fun nickname(): String =
        prefs.getString(KEY_NICKNAME, "").orEmpty().ifEmpty { displayName() }

    /** 改完昵称后就地更新缓存，首页与「我的」不用重新登录即可看到新值。 */
    @Synchronized fun updateNickname(value: String) {
        prefs.edit().putString(KEY_NICKNAME, value).apply()
    }

    @Synchronized fun credentials(): Pair<String, String?> = phone() to readToken()

    @Synchronized fun clear() {
        prefs.edit().clear().apply()
        BankApi.setToken(null)
    }

    /** 令牌是否仍然可用（Keystore 密钥失效时会被判定为不可用，等同未登录）。 */
    fun hasToken(): Boolean = readToken() != null
}
