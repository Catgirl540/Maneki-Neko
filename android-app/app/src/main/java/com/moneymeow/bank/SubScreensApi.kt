package com.moneymeow.bank

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * SubScreens 专用的补充接口。
 *
 * `BankApi.kt` 由并行工作维护，这里只补换汇与安全设置页需要、但 `BankApi`
 * 尚未暴露的契约：完整换汇报价（含 `quoteTtlSeconds`）、完整安全总览、
 * 风控规则开关和支付密码修改。鉴权、错误码与 401 处理沿用 `BankApi` 的规则。
 */
internal object SubScreensApi {
    /** 换汇报价。`quoteTtlSeconds` 是服务端下发的真实有效期，不能拿 `quotedAt` 当过期时间。 */
    data class ExchangeQuoteDetailDto(
        val quoteId: String,
        val fromCurrency: String,
        val toCurrency: String,
        val rate: Double,
        val fromAmount: Long,
        val toAmount: Long,
        /** 服务端未下发或数值无效时为 null，界面不得把它显示成 0 点差。 */
        val spread: Double?,
        val quoteTtlSeconds: Int,
    )

    data class SecurityRuleDto(
        val id: String,
        val label: String,
        val description: String,
        val enabled: Boolean,
    )

    /** `active` 为 null 表示服务端未下发会话状态，不能据此断言已失效。 */
    data class SecurityDeviceDto(
        val id: String,
        val name: String,
        val location: String,
        val lastActiveAt: String,
        val current: Boolean,
        val active: Boolean?,
    )

    data class SecurityLogDto(
        val id: String,
        val action: String,
        val detail: String,
        val createdAt: String,
        val level: String,
    )

    data class AccountSecurityDto(
        val frozen: Boolean,
        val failedAttempts: Int,
        val maxAttempts: Int,
        val reason: String,
    )

    data class SecurityOverviewDto(
        val score: Int,
        val level: String,
        val identityVerified: Boolean,
        val devices: List<SecurityDeviceDto>,
        val logs: List<SecurityLogDto>,
        val riskRules: List<SecurityRuleDto>,
        val accountSecurity: AccountSecurityDto,
    )

    suspend fun quoteExchange(
        fromAccountId: String,
        toCurrency: String,
        amount: Long,
    ): ExchangeQuoteDetailDto = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("fromAccountId", fromAccountId)
            .put("toCurrency", toCurrency)
            .put("amount", amount)
        val root = request("POST", "/api/exchange/quote", body)
        val fx = root.optJSONObject("fx")
            ?: throw BankApiException(502, "报价缺少汇率信息，请重新获取", "INVALID_QUOTE")
        val quote = ExchangeQuoteDetailDto(
            quoteId = root.optString("quoteId"),
            fromCurrency = fx.optString("fromCurrency"),
            toCurrency = fx.optString("toCurrency"),
            rate = fx.optDouble("rate", 0.0),
            fromAmount = fx.optLong("fromAmount", -1L),
            toAmount = fx.optLong("toAmount", 0L),
            spread = if (fx.has("spread") && !fx.isNull("spread")) {
                fx.optDouble("spread").takeIf { it.isFinite() && it >= 0.0 }
            } else {
                null
            },
            quoteTtlSeconds = fx.optInt("quoteTtlSeconds", 0),
        )
        if (quote.quoteId.isBlank() ||
            quote.fromCurrency.isBlank() ||
            quote.toCurrency != toCurrency ||
            quote.fromAmount != amount ||
            !quote.rate.isFinite() || quote.rate <= 0.0 ||
            quote.toAmount <= 0L ||
            quote.quoteTtlSeconds <= 0
        ) {
            throw BankApiException(502, "报价异常，请重新获取", "INVALID_QUOTE")
        }
        quote
    }

    suspend fun securityOverview(): SecurityOverviewDto = withContext(Dispatchers.IO) {
        parseSecurityOverview(request("GET", "/api/security/overview", null))
    }

    /** 服务端直接回最新总览（含重算后的评分与新增日志），无需再查一次。 */
    suspend fun setSecurityRule(id: String, enabled: Boolean): SecurityOverviewDto =
        withContext(Dispatchers.IO) {
            parseSecurityOverview(
                request("PATCH", "/api/security/rules/$id", JSONObject().put("enabled", enabled)),
            )
        }

    /**
     * 修改支付密码。
     *
     * 记得原密码时传 [oldPassword]（与付款共用校验，连续输错 5 次冻结账号）；
     * 忘记原密码时先由 [BankApi.verifyIdentity] 取得人脸票据，再传 [faceTicket] 重置。
     * 冻结账号由服务端返回 423，客户端也应提前禁用入口。
     */
    suspend fun changePaymentPassword(
        oldPassword: String?,
        newPassword: String,
        faceTicket: String? = null,
    ): Unit = withContext(Dispatchers.IO) {
        require(Regex("^\\d{6}$").matches(newPassword)) { "请设置 6 位数字支付密码" }
        val body = JSONObject().put("newPassword", newPassword)
        if (!oldPassword.isNullOrEmpty()) {
            require(Regex("^\\d{6}$").matches(oldPassword)) { "请输入 6 位数字支付密码" }
            body.put("oldPassword", oldPassword)
        } else if (!faceTicket.isNullOrEmpty()) {
            body.put("faceTicket", faceTicket)
        } else {
            throw BankApiException(400, "请先完成人脸核身", "FACE_REQUIRED")
        }
        request("POST", "/api/security/payment-password", body)
        Unit
    }

    private fun parseSecurityOverview(root: JSONObject): SecurityOverviewDto {
        val account = root.optJSONObject("accountSecurity")
        val devices = root.optJSONArray("devices")?.let { array ->
            buildList {
                for (i in 0 until array.length()) {
                    val row = array.getJSONObject(i)
                    add(
                        SecurityDeviceDto(
                            id = row.optString("id"),
                            name = row.optString("name"),
                            location = row.optString("location"),
                            lastActiveAt = row.optString("lastActiveAt"),
                            current = row.optBoolean("current", false),
                            active = if (row.has("active") && !row.isNull("active")) {
                                row.optBoolean("active")
                            } else {
                                null
                            },
                        ),
                    )
                }
            }
        }.orEmpty()
        val logs = root.optJSONArray("logs")?.let { array ->
            buildList {
                for (i in 0 until array.length()) {
                    val row = array.getJSONObject(i)
                    add(
                        SecurityLogDto(
                            id = row.optString("id"),
                            action = row.optString("action"),
                            detail = row.optString("detail"),
                            createdAt = row.optString("createdAt"),
                            level = row.optString("level").ifEmpty { "info" },
                        ),
                    )
                }
            }
        }.orEmpty()
        val rules = root.optJSONArray("riskRules")?.let { array ->
            buildList {
                for (i in 0 until array.length()) {
                    val row = array.getJSONObject(i)
                    add(
                        SecurityRuleDto(
                            id = row.optString("id"),
                            label = row.optString("label"),
                            description = row.optString("description"),
                            enabled = row.optBoolean("enabled", false),
                        ),
                    )
                }
            }
        }.orEmpty()
        // 关键字段缺失时宁可报错，也不能把“未知”渲染成 0 分、未核验或账号正常。
        val score = (root.opt("score") as? Number)?.toInt()
        val level = root.optString("level")
        val identityVerified = root.opt("identityVerified") as? Boolean
        val frozen = account?.opt("frozen") as? Boolean
        if (score == null || score !in 0..100 || level.isBlank() ||
            identityVerified == null || account == null || frozen == null
        ) {
            throw BankApiException(502, "安全信息格式异常，请稍后重试", "INVALID_SECURITY_OVERVIEW")
        }
        return SecurityOverviewDto(
            score = score,
            level = level,
            identityVerified = identityVerified,
            devices = devices,
            logs = logs,
            riskRules = rules,
            accountSecurity = AccountSecurityDto(
                frozen = frozen,
                failedAttempts = account.optInt("failedAttempts", 0).coerceAtLeast(0),
                maxAttempts = account.optInt("maxAttempts", 5).coerceAtLeast(1),
                reason = account.optString("reason").orEmpty(),
            ),
        )
    }

    private fun request(method: String, path: String, body: JSONObject?): JSONObject =
        org.json.JSONTokener(requestRaw(method, path, body)).nextValue() as JSONObject

    private fun requestRaw(method: String, path: String, body: JSONObject?): String {
        val connection = (URL(BankApi.baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8000
            readTimeout = 12000
            setRequestProperty("Accept", "application/json")
            BankApi.currentToken()?.let { setRequestProperty("Authorization", "Bearer $it") }
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
                // 支付密码错误也是 401，但它只是业务校验失败，不能当成登录过期。
                val isPaymentPasswordFailure = apiCode == "BAD_PAY_PASSWORD"
                if (status == 401 && !isPaymentPasswordFailure) BankApi.onUnauthorized?.invoke()
                throw BankApiException(status, message.ifEmpty { "请求失败（$status）" }, apiCode)
            }
            return text
        } finally {
            connection.disconnect()
        }
    }
}
