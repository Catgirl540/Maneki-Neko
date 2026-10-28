package com.moneymeow.bank

import android.content.Context
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
 * 模拟器访问宿主机用 `10.0.2.2`；真机联调时把 BASE_URL 换成局域网地址即可。
 * 只依赖 JDK 自带的 HttpURLConnection 与 org.json，不额外引入网络库。
 */
object BankApi {
    /** 后端地址：Android 模拟器里 10.0.2.2 指向宿主机 127.0.0.1。 */
    var baseUrl: String = "http://10.0.2.2:8080"

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
            totalValue = root.optLong("totalValue"),
            totalPrincipal = root.optLong("totalPrincipal"),
            totalProfit = root.optLong("totalProfit"),
            yesterdayProfit = root.optLong("yesterdayProfit"),
            holdings = root.optJSONArray("holdings")?.let { array ->
                buildList {
                    for (i in 0 until array.length()) {
                        val row = array.getJSONObject(i)
                        add(
                            HoldingDto(
                                id = row.optString("id"),
                                productName = row.optString("productName"),
                                shares = row.optLong("shares"),
                                marketValue = row.optLong("marketValue"),
                                profit = row.optLong("profit"),
                                closed = row.optBoolean("closed"),
                            )
                        )
                    }
                }
            }.orEmpty(),
            riskLevel = risk?.optString("level")?.ifEmpty { null },
            riskDone = risk?.optBoolean("done") ?: false,
            riskExpiresAt = risk?.optString("expiresAt").orEmpty(),
        )
    }

    suspend fun wealthProducts(): List<WealthProductDto> = withContext(Dispatchers.IO) {
        val text = requestRaw("GET", "/api/wealth/products", null)
        val array = org.json.JSONTokener(text).nextValue() as JSONArray
        buildList {
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                add(
                    WealthProductDto(
                        code = row.optString("code"),
                        name = row.optString("name"),
                        risk = row.optString("risk"),
                        category = row.optString("category"),
                        nav = row.optDouble("nav", 0.0),
                        sevenDayYield = if (row.isNull("sevenDayYield")) null else row.optDouble("sevenDayYield"),
                        minAmount = row.optLong("minAmount"),
                        stepAmount = row.optLong("stepAmount"),
                        term = row.optString("term"),
                        openEnded = row.optBoolean("openEnded"),
                    )
                )
            }
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
    ): TransferQuoteDto = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("fromAccountId", fromAccountId)
            .put("channel", channel)
            .put("scope", scope)
            .put("amount", amount)
            .put("bankCode", bankCode)
            .put("bankRegion", bankRegion)
        val root = request("POST", "/api/transfers/quote", body)
        TransferQuoteDto(
            fee = root.optLong("fee"),
            etaText = root.optString("etaText"),
            maxAmount = root.optLong("maxAmount"),
            singleLimit = root.optLong("singleLimit"),
            requiresConfirm = root.optBoolean("requiresConfirm"),
        )
    }

    /** 提交转账：返回交易号与清算状态。 */
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
    ): TransferResultDto = withContext(Dispatchers.IO) {
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
        val root = request("POST", "/api/transfers", body)
        TransferResultDto(
            transactionId = root.optString("transactionId"),
            referenceNo = root.optString("referenceNo"),
            amount = root.optLong("amount"),
            fee = root.optLong("fee"),
            identifier = root.optString("identifier"),
            settlementStatus = root.optString("settlementStatus").ifEmpty { "success" },
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

    suspend fun subscribeWealth(productCode: String, amount: Long, paymentPassword: String, acknowledgement: String): Unit =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("productCode", productCode)
                .put("amount", amount)
                .put("paymentPassword", paymentPassword)
                .put("riskAcknowledgement", acknowledgement)
            request("POST", "/api/wealth/subscribe", body)
            Unit
        }

    suspend fun redeemWealth(holdingId: String): Unit = withContext(Dispatchers.IO) {
        request("POST", "/api/wealth/redeem", JSONObject().put("holdingId", holdingId))
        Unit
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

    private fun request(method: String, path: String, body: JSONObject?): JSONObject =
        org.json.JSONTokener(requestRaw(method, path, body)).nextValue() as JSONObject

    private fun requestRaw(method: String, path: String, body: JSONObject?): String {
        val connection = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8000
            readTimeout = 12000
            setRequestProperty("Accept", "application/json")
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            body?.let { payload ->
                connection.outputStream.use { it.write(payload.toString().toByteArray()) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code !in 200..299) {
                val message = runCatching { JSONObject(text).optString("message") }.getOrDefault("")
                // 登录/验证码接口自己会报错，不触发全局登出，避免登录页被反复重置。
                if (code == 401 && !path.startsWith("/api/auth/")) onUnauthorized?.invoke()
                throw BankApiException(code, message.ifEmpty { "请求失败（$code）" })
            }
            return text
        } finally {
            connection.disconnect()
        }
    }
}

class BankApiException(val status: Int, override val message: String) : Exception(message)

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
)

data class TransferQuoteDto(
    val fee: Long,
    val etaText: String,
    val maxAmount: Long,
    val singleLimit: Long,
    val requiresConfirm: Boolean,
)

data class TransferResultDto(
    val transactionId: String,
    val referenceNo: String,
    val amount: Long,
    val fee: Long,
    val identifier: String,
    val settlementStatus: String,
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
    val productName: String,
    val shares: Long,
    val marketValue: Long,
    val profit: Long,
    val closed: Boolean,
)

data class WealthOverviewDto(
    val opened: Boolean,
    val totalValue: Long,
    val totalPrincipal: Long,
    val totalProfit: Long,
    val yesterdayProfit: Long,
    val holdings: List<HoldingDto>,
    val riskLevel: String?,
    val riskDone: Boolean,
    val riskExpiresAt: String,
)

data class WealthProductDto(
    val code: String,
    val name: String,
    val risk: String,
    val category: String,
    val nav: Double,
    val sevenDayYield: Double?,
    val minAmount: Long,
    val stepAmount: Long,
    val term: String,
    val openEnded: Boolean,
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
