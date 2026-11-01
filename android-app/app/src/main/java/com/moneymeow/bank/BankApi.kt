package com.moneymeow.bank

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * 银行后端客户端：直连 `server/`（PostgreSQL）的 HTTP 接口。
 *
 * 默认使用与客户网页相同的 HTTPS 入口；本地联调可另行设置 baseUrl。
 * 只依赖 JDK 自带的 HttpURLConnection 与 org.json，不额外引入网络库。
 */
object BankApi {
    /** 客户 /api/ 由线上网关转发至演示银行。 */
    var baseUrl: String = "https://bank.waveflow.men"

    private var token: String? = null

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
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
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
                for (index in 0 until items.length()) {
                    val row = items.getJSONObject(index)
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
            for (index in 0 until array.length()) {
                val row = array.getJSONObject(index)
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
        TransferQuoteDto(
            fee = root.getLong("fee"),
            etaText = root.optString("etaText"),
            maxAmount = root.getLong("maxAmount"),
            singleLimit = root.getLong("singleLimit"),
            requiresConfirm = root.optBoolean("requiresConfirm"),
            receiveAmount = root.optJSONObject("fx")?.optLong("toAmount"),
            rate = root.optJSONObject("fx")?.optDouble("rate"),
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
        val root = request("POST", "/api/transfers", body, idempotencyKey)
        TransferResultDto(
            transactionId = root.optString("transactionId"),
            referenceNo = root.optString("referenceNo"),
            amount = root.optLong("amount"),
            fee = root.optLong("fee"),
            identifier = root.optString("identifier"),
            settlementStatus = root.optString("settlementStatus"),
            currency = confirmedQuote.fromCurrency,
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
        )
    }

    suspend fun transaction(id: String): TransactionDetailDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/transactions/$id", null)
        TransactionDetailDto(
            id = root.optString("id"),
            counterparty = root.optString("counterparty"),
            amount = root.optLong("amount"),
            direction = root.optString("direction"),
            category = root.optString("category"),
            status = root.optString("status"),
            createdAt = root.optString("createdAt"),
            memo = root.optString("memo"),
            referenceNo = root.optString("referenceNo"),
            cardLast4 = root.optString("cardLast4"),
            accountLabel = root.optString("accountLabel"),
        )
    }

    suspend fun spending(month: String): SpendingDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/analysis/spending?month=$month", null)
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

    suspend fun cashFlow(days: Int): CashFlowDto = withContext(Dispatchers.IO) {
        val root = request("GET", "/api/analysis/cashflow?days=$days", null)
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
    ): JSONObject =
        org.json.JSONTokener(requestRaw(method, path, body, idempotencyKey)).nextValue() as JSONObject

    private fun requestRaw(
        method: String,
        path: String,
        body: JSONObject?,
        idempotencyKey: String? = null,
    ): String {
        val connection = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8000
            readTimeout = 12000
            setRequestProperty("Accept", "application/json")
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
            idempotencyKey?.let { setRequestProperty("Idempotency-Key", it) }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            body?.let { payload ->
                connection.outputStream.use { it.write(payload.toString().toByteArray()) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (status !in 200..299) {
                val error = runCatching { JSONObject(text) }.getOrNull()
                val message = error?.optString("message").orEmpty()
                val apiCode = error?.optString("code").orEmpty().ifEmpty { null }
                // 支付密码错误也是 401，但它是业务校验失败，不能当成登录过期而清掉会话。
                val isPaymentPasswordFailure = apiCode == "BAD_PAY_PASSWORD"
                // 登录/验证码接口自己会报错，不触发全局登出，避免登录页被反复重置。
                if (status == 401 && !path.startsWith("/api/auth/") && !isPaymentPasswordFailure) {
                    onUnauthorized?.invoke()
                }
                throw BankApiException(status, message.ifEmpty { "请求失败（$status）" }, apiCode)
            }
            return text
        } finally {
            connection.disconnect()
        }
    }
}

class BankApiException(
    val status: Int,
    override val message: String,
    val code: String? = null,
) : Exception(message)

data class LoginResult(val token: String, val name: String, val phone: String)

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
    /** bankCard / phone / fps；目前只有 bankCard 具备完整的确认与提交条件。 */
    val method: String = "bankCard",
)

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


data class ProfileDto(val name: String, val phone: String, val idNumberMasked: String, val address: String, val openedAt: String)

data class TransactionDetailDto(
    val id: String, val counterparty: String, val amount: Long, val direction: String,
    val category: String, val status: String, val createdAt: String, val memo: String,
    val referenceNo: String, val cardLast4: String, val accountLabel: String,
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
    private const val KEY_TOKEN = "token"
    private const val KEY_NAME = "name"
    private const val KEY_PHONE = "phone"

    private lateinit var prefs: android.content.SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        BankApi.setToken(prefs.getString(KEY_TOKEN, null))
    }

    fun save(result: LoginResult) {
        prefs.edit()
            .putString(KEY_TOKEN, result.token)
            .putString(KEY_NAME, result.name)
            .putString(KEY_PHONE, result.phone)
            .apply()
        BankApi.setToken(result.token)
    }

    fun name(): String = prefs.getString(KEY_NAME, "").orEmpty()
    fun phone(): String = prefs.getString(KEY_PHONE, "").orEmpty()

    fun clear() {
        prefs.edit().clear().apply()
        BankApi.setToken(null)
    }
}
