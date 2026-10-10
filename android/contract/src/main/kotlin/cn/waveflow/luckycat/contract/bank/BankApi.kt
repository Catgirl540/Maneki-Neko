package cn.waveflow.luckycat.contract.bank

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * 银行后端的错误。
 *
 * 错误形状与 `app/src/api/http.ts` 一致：**`{ message, code }` + HTTP 状态码**，
 * 不是桥接那边用的 `{ error }`——两套东西，别混。
 *
 * [code] 是机器可判别的错误码，界面只在少数地方用它分支
 * （例如支付密码错要清空重输）。**判错一律看 HTTP 状态码**，
 * 不要用 200 + code 表示业务失败。
 */
class BankApiException(
    val status: Int,
    override val message: String,
    val code: String? = null,
) : IOException("HTTP $status: $message")

/**
 * 银行后端（`/api/…`）的客户端。
 *
 * 路径与 `app/src/api/contract.ts` 的 `routes` 一一对应；
 * 请求与响应类型以 `app/src/api/types.ts` 为准。
 * 演示环境里这一层由 `framework/bridge/demo-bank.mjs` 提供，
 * 真后端上线时只需换 [baseUrl]。
 *
 * [baseUrl] 传**主机根**（`https://bank.waveflow.cn`），`/api` 前缀由这里自己拼
 * ——与 [cn.waveflow.luckycat.contract.AgentApi] 同一个约定，别带前缀进来。
 */
class BankApi(
    baseUrl: String,
    private val client: OkHttpClient = OkHttpClient(),
    private val json: Json = DefaultJson,
    /**
     * 取当前登录令牌。**用 provider 而不是固定值**：令牌是登录**之后**才有的，
     * 而客户端只该建一个（连接池、线程池都挂在它身上）。
     * 演示后端不校验 Authorization，但真后端会——所以这里提前按真后端写。
     */
    private val tokenProvider: () -> String? = { null },
) {
    private val base: HttpUrl = baseUrl.trimEnd('/').toHttpUrl()

    init {
        val path = base.encodedPath
        require(path.isEmpty() || path == "/") {
            "baseUrl 要传主机根（例如 https://bank.waveflow.cn），不要带路径；" +
                "实际收到的是 \"$baseUrl\"，路径为 \"$path\"。" +
                "路由前缀 /api 由 BankApi 自己拼，带上会变成 /api/api/…"
        }
    }

    /** 发短信验证码。演示环境会把码回传在 [SmsCodeResult.demoCode] 里。 */
    suspend fun sendSmsCode(phone: String): SmsCodeResult {
        val payload = buildJsonObject { put("phone", phone) }.toString()
        return json.decodeFromString(call("POST", "auth/sms-code", payload))
    }

    /** 登录。三步都要过：手机号格式、密码、短信验证码。 */
    suspend fun login(phone: String, password: String, smsCode: String): LoginResult {
        val payload = buildJsonObject {
            put("phone", phone)
            put("password", password)
            put("smsCode", smsCode)
        }.toString()
        return json.decodeFromString(call("POST", "auth/login", payload))
    }

    suspend fun profile(): BankUser = json.decodeFromString(call("GET", "auth/profile"))

    suspend fun listAccounts(): List<Account> = json.decodeFromString(call("GET", "accounts"))

    suspend fun getAccount(id: String): Account = json.decodeFromString(call("GET", "accounts/$id"))

    /**
     * 分页流水。
     *
     * 参数名是 **`size` 不是 `pageSize`** —— 与 `http.ts` 的 `listTransactions`
     * 保持一致；后端按 `size` 取值，传错了不会报错，只会静默用默认页大小。
     */
    suspend fun listTransactions(
        accountId: String,
        page: Int? = null,
        size: Int? = null,
        category: String? = null,
        keyword: String? = null,
    ): Paged<Transaction> {
        val url = url("accounts/$accountId/transactions") {
            if (page != null) addQueryParameter("page", page.toString())
            if (size != null) addQueryParameter("size", size.toString())
            if (category != null && category != "all") addQueryParameter("category", category)
            if (keyword != null) addQueryParameter("keyword", keyword)
        }
        return json.decodeFromString(call("GET", url))
    }

    suspend fun getTransaction(id: String): TransactionRecord =
        json.decodeFromString(call("GET", "transactions/$id"))

    suspend fun listPayees(): List<Payee> = json.decodeFromString(call("GET", "payees"))

    // ── 理财 ────────────────────────────────────────────────────────────

    suspend fun listWealthProducts(): List<WealthProduct> =
        json.decodeFromString(call("GET", "wealth/products"))

    suspend fun getWealthProduct(code: String): WealthProduct =
        json.decodeFromString(call("GET", "wealth/products/$code"))

    // ── 理财账户 ────────────────────────────────────────────────────────

    suspend fun listRiskQuestions(): List<RiskQuestion> =
        json.decodeFromString(call("GET", "wealth/risk/questions"))

    /**
     * 提交风险测评。
     *
     * @param answers - **选项的下标**（不是分值），顺序与题目一一对应。
     *   后端要求题数完全对得上，少一题就回 `INCOMPLETE_ANSWERS`。
     */
    suspend fun submitRiskAssessment(answers: List<Int>): RiskAssessment {
        val payload = buildJsonObject {
            put("answers", kotlinx.serialization.json.JsonArray(answers.map { JsonPrimitive(it) }))
        }.toString()
        return json.decodeFromString(call("POST", "wealth/risk/assess", payload))
    }

    /** 开理财账户。**要求测评已完成且没过期**，否则回 403 `RISK_ASSESSMENT_REQUIRED`。 */
    suspend fun openWealthAccount(request: WealthAccountOpeningRequest): WealthAccount {
        val payload = json.encodeToString(WealthAccountOpeningRequest.serializer(), request)
        return json.decodeFromString(call("POST", "wealth/account/open", payload))
    }

    /** 总览：理财账户是否开立 + 总市值/收益 + 持仓。 */
    suspend fun getWealthOverview(): WealthOverview =
        json.decodeFromString(call("GET", "wealth/overview"))

    // ── 分析 ────────────────────────────────────────────────────────────

    suspend fun getSpending(month: String? = null): SpendingAnalysis {
        val url = url("analysis/spending") { if (month != null) addQueryParameter("month", month) }
        return json.decodeFromString(call("GET", url))
    }

    suspend fun getCashFlow(days: Int? = null): CashFlow {
        val url = url("analysis/cashflow") { if (days != null) addQueryParameter("days", days.toString()) }
        return json.decodeFromString(call("GET", url))
    }

    // ── 开户 ────────────────────────────────────────────────────────────

    /**
     * 核身。`channel` 是 `face` 或 `sms`。
     *
     * @returns 票据，要放进 [RegistrationRequest.faceTicket]。
     *   **真实现里这是活体检测的结果**；演示后端直接给一张票。
     */
    suspend fun verifyIdentity(channel: String): IdentityTicket {
        val payload = buildJsonObject { put("channel", channel) }.toString()
        return json.decodeFromString(call("POST", "security/verify", payload))
    }

    /**
     * 开户。**要过三道验证**：短信验证码、人脸票据、承诺勾选——
     * 这不是"点一下就开了"。验证码先调 [sendSmsCode] 拿（演示环境会回传），
     * 人脸票据先调 [verifyIdentity]。
     */
    suspend fun register(request: RegistrationRequest): RegistrationResult {
        val payload = json.encodeToString(RegistrationRequest.serializer(), request)
        return json.decodeFromString(call("POST", "auth/register", payload))
    }

    // ── 安全中心 ────────────────────────────────────────────────────────

    suspend fun getSecurityOverview(): SecurityOverview =
        json.decodeFromString(call("GET", "security/overview"))

    /** 开关一条风控规则。**返回整个总览**，所以界面直接换掉状态即可，不用重拉。 */
    suspend fun setSecurityRule(id: String, enabled: Boolean): SecurityOverview {
        val payload = buildJsonObject { put("enabled", enabled) }.toString()
        return json.decodeFromString(call("PATCH", "security/rules/$id", payload))
    }

    // ── 银行卡 ──────────────────────────────────────────────────────────

    suspend fun listCards(): List<BankCard> = json.decodeFromString(call("GET", "cards"))

    suspend fun listCardProducts(): List<CardProduct> =
        json.decodeFromString(call("GET", "cards/products"))

    /** 锁卡 / 解锁。锁了之后所有交易都会被拒。 */
    suspend fun setCardLock(id: String, locked: Boolean): BankCard {
        val payload = buildJsonObject { put("locked", locked) }.toString()
        return json.decodeFromString(call("POST", "cards/$id/lock", payload))
    }

    /**
     * 改卡的开关与限额。[patch] 里只放要改的字段。
     *
     * 用 PATCH 是因为这是**部分更新**：只传 `onlinePayment` 不该把
     * `dailyLimit` 一起重置掉。
     */
    suspend fun updateCardSettings(
        id: String,
        patch: JsonObject,
    ): BankCard = json.decodeFromString(call("PATCH", "cards/$id/settings", patch.toString()))

    /**
     * 查卡密。**必须带支付密码**，而且密码只到这里为止。
     *
     * 演示环境返回占位值；真后端会返回真卡号——所以这个响应**绝不能进日志**。
     */
    suspend fun revealCardSecrets(id: String, paymentPassword: String): CardSecrets {
        val payload = buildJsonObject { put("paymentPassword", paymentPassword) }.toString()
        return json.decodeFromString(call("POST", "cards/$id/secrets", payload))
    }

    /** 转账报价。**报价与提交是两步**：用户要先看到手续费与到账时间再决定。 */
    suspend fun quoteTransfer(request: TransferRequest): TransferQuote {
        val payload = json.encodeToString(TransferRequest.serializer(), request)
        return json.decodeFromString(call("POST", "transfers/quote", payload))
    }

    suspend fun submitTransfer(request: TransferRequest): TransferResult {
        val payload = json.encodeToString(TransferRequest.serializer(), request)
        return json.decodeFromString(call("POST", "transfers", payload))
    }

    /**
     * 关掉调度线程池与连接池。
     *
     * **必须是 `suspend`**：`connectionPool.evictAll()` 关 HTTPS 连接时会写
     * `close_notify`，那是真实网络写，在主线程上会被 StrictMode 拦下来。
     * 详见 [cn.waveflow.luckycat.contract.AgentApi.close] 的说明（实测踩过）。
     */
    suspend fun close() = withContext(Dispatchers.IO) {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    private fun url(path: String, block: HttpUrl.Builder.() -> Unit = {}): HttpUrl =
        base.newBuilder().addPathSegments("api/$path").apply(block).build()

    private suspend fun call(method: String, path: String, body: String? = null): String =
        call(method, url(path), body)

    private suspend fun call(method: String, url: HttpUrl, body: String? = null): String =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(url)
            tokenProvider()?.let { builder.header("Authorization", "Bearer $it") }
            when (method) {
                "GET" -> builder.get()
                "POST" -> builder.post((body ?: "{}").toRequestBody(JSON_MEDIA))
                "PATCH" -> builder.patch((body ?: "{}").toRequestBody(JSON_MEDIA))
                else -> error("未支持的动词：$method")
            }
            client.newCall(builder.build()).execute().use { res ->
                val text = res.body.string()
                if (!res.isSuccessful) throw parseFailure(res.code, text)
                text
            }
        }

    /** 把 `{ message, code }` 解出来；解不动就退回原始文本，别把错误吞成空字符串。 */
    private fun parseFailure(status: Int, text: String): BankApiException {
        val obj = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull()
        val message = obj?.stringOrNull("message") ?: text.ifBlank { "请求失败（$status）" }
        return BankApiException(status, message, obj?.stringOrNull("code"))
    }

    companion object {
        val DefaultJson: Json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}

private fun JsonObject.stringOrNull(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content
