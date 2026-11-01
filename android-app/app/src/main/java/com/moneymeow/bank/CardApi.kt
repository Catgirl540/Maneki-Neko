package com.moneymeow.bank

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * 银行卡接口客户端。
 *
 * `BankApi` 里现有的卡片方法只覆盖列表与锁卡；申卡、换卡、激活、挂失/解挂、
 * 交易设置和查看卡号安全码在服务端都已存在（见 `server/bank-api.mjs` 的 `/api/cards*`），
 * 但 `BankApi` 没有对应封装。为避免改动多人同时在改的 `BankApi.kt`，这里单独封装，
 * 复用同一个 baseUrl、Bearer 令牌和 401 语义。
 *
 * 所有方法只返回服务端结果；失败抛出 [BankApiException]，界面不得自行伪造成功。
 */
object CardApi {
    private fun baseUrl(): String = BankApi.baseUrl

    suspend fun cards(): List<BankCard> = withContext(Dispatchers.IO) {
        val array = JSONArray(requestRaw("GET", "/api/cards", null))
        buildList {
            for (index in 0 until array.length()) {
                add(array.getJSONObject(index).toBankCard())
            }
        }
    }

    suspend fun products(): List<CardProduct> = withContext(Dispatchers.IO) {
        val array = JSONArray(requestRaw("GET", "/api/cards/products", null))
        buildList {
            for (index in 0 until array.length()) {
                val row = array.getJSONObject(index)
                add(
                    CardProduct(
                        code = row.optString("code"),
                        name = row.optString("name"),
                        network = row.optString("network"),
                        issuingFee = row.optLong("issuingFee"),
                        deliveryFee = row.optLong("deliveryFee"),
                        held = row.optBoolean("held"),
                        perks = row.optJSONArray("perks")?.let { perks ->
                            buildList { for (i in 0 until perks.length()) add(perks.optString(i)) }
                        }.orEmpty(),
                        deliveryDays = row.optInt("deliveryDays"),
                        feeQuote = row.optJSONObject("feeQuote")?.let { quote ->
                            CardFeeQuote(
                                listFee = quote.optLong("listFee"),
                                payable = quote.optLong("payable"),
                                waived = quote.optLong("waived"),
                            )
                        },
                    )
                )
            }
        }
    }

    suspend fun openCard(
        productCode: String,
        address: MailingAddress,
        paymentPassword: String,
    ): BankCard = withContext(Dispatchers.IO) {
        JSONObject(requestRaw(
            "POST",
            "/api/cards/open",
            JSONObject()
                .put("productCode", productCode)
                .put("paymentPassword", paymentPassword)
                .put("address", address.toJson()),
        )).toBankCard()
    }

    suspend fun setCardLock(cardId: String, locked: Boolean): BankCard = withContext(Dispatchers.IO) {
        JSONObject(requestRaw("POST", "/api/cards/$cardId/lock", JSONObject().put("locked", locked)))
            .toBankCard()
    }

    suspend fun updateSettings(cardId: String, patch: JSONObject): BankCard = withContext(Dispatchers.IO) {
        JSONObject(requestRaw("PATCH", "/api/cards/$cardId/settings", patch)).toBankCard()
    }

    suspend fun activateCard(cardId: String, paymentPassword: String): BankCard = withContext(Dispatchers.IO) {
        JSONObject(requestRaw(
            "POST",
            "/api/cards/$cardId/activate",
            JSONObject().put("paymentPassword", paymentPassword),
        )).toBankCard()
    }

    suspend fun reportCardLost(cardId: String, paymentPassword: String): BankCard = withContext(Dispatchers.IO) {
        JSONObject(requestRaw(
            "POST",
            "/api/cards/$cardId/lost",
            JSONObject().put("paymentPassword", paymentPassword),
        )).toBankCard()
    }

    suspend fun recoverCard(cardId: String, paymentPassword: String): BankCard = withContext(Dispatchers.IO) {
        JSONObject(requestRaw(
            "POST",
            "/api/cards/$cardId/recover",
            JSONObject().put("paymentPassword", paymentPassword),
        )).toBankCard()
    }

    suspend fun replaceCard(
        cardId: String,
        address: MailingAddress,
        paymentPassword: String,
    ): BankCard = withContext(Dispatchers.IO) {
        JSONObject(requestRaw(
            "POST",
            "/api/cards/$cardId/replace",
            JSONObject()
                .put("paymentPassword", paymentPassword)
                .put("address", address.toJson()),
        )).toBankCard()
    }

    suspend fun revealCardSecrets(cardId: String, paymentPassword: String): CardSecrets =
        withContext(Dispatchers.IO) {
            val root = JSONObject(requestRaw(
                "POST",
                "/api/cards/$cardId/secrets",
                JSONObject().put("paymentPassword", paymentPassword),
            ))
            CardSecrets(
                pan = root.optString("pan"),
                expiry = root.optString("expiry"),
                cvv = root.optString("cvv"),
                revealSeconds = root.optInt("revealSeconds", 60),
            )
        }

    /** 与服务端 `server/lib/address.mjs` 保持同一套字段与顺序。 */
    fun validateAddress(address: MailingAddress): String? {
        if (address.recipient.isBlank()) return "请填写收件人姓名"
        val phone = address.phone.filter(Char::isDigit)
        if (phone.isBlank()) return "请填写手机号"
        if (!Regex("^1[3-9]\\d{9}$").matches(phone)) return "请输入 11 位手机号"
        if (address.region.isBlank()) return "请填写省 / 直辖市"
        if (address.city.isBlank()) return "请填写城市"
        if (address.detail.isBlank()) return "请填写详细地址"
        if (address.detail.trim().length < 5) return "详细地址至少 5 个字"
        if (address.postalCode.isNotBlank() && !Regex("^\\d{6}$").matches(address.postalCode.trim())) {
            return "邮政编码为 6 位数字"
        }
        return null
    }

    fun formatAddress(address: MailingAddress): String =
        listOf(address.region, address.city, address.detail).filter { it.isNotBlank() }.joinToString(" ")

    private fun requestRaw(method: String, path: String, body: JSONObject?): String {
        val connection = (URL(baseUrl() + path).openConnection() as HttpURLConnection).apply {
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
                // 支付密码错误同样是 401，但属于业务校验失败，不能触发全局登出。
                val isPaymentPasswordFailure = apiCode == "BAD_PAY_PASSWORD"
                if (status == 401 && !path.startsWith("/api/auth/") && !isPaymentPasswordFailure) {
                    BankApi.onUnauthorized?.invoke()
                }
                throw BankApiException(status, message.ifEmpty { "请求失败（$status）" }, apiCode)
            }
            return text
        } finally {
            connection.disconnect()
        }
    }
}

data class MailingAddress(
    val recipient: String = "",
    val phone: String = "",
    /** 省 / 直辖市 */
    val region: String = "",
    val city: String = "",
    val detail: String = "",
    val postalCode: String = "",
) {
    fun toJson(): JSONObject = JSONObject()
        .put("recipient", recipient.trim())
        .put("phone", phone.trim())
        .put("region", region.trim())
        .put("city", city.trim())
        .put("detail", detail.trim())
        .put("postalCode", postalCode.trim())
}

data class CardFeeQuote(
    val listFee: Long,
    val payable: Long,
    val waived: Long,
)

data class CardProduct(
    val code: String,
    val name: String,
    val network: String,
    val issuingFee: Long,
    val deliveryFee: Long,
    val held: Boolean,
    val perks: List<String>,
    val deliveryDays: Int,
    val feeQuote: CardFeeQuote?,
) {
    /** 实付以后端报价为准；没有报价时退回标价合计，仅用于展示。 */
    val payableFee: Long get() = feeQuote?.payable ?: (issuingFee + deliveryFee)
}

data class CardChannelLimits(val online: Long, val offline: Long, val overseas: Long)
data class CardMerchantLimits(val dining: Long, val shopping: Long, val other: Long)

data class BankCard(
    val id: String,
    val accountId: String,
    val productName: String,
    val last4: String,
    val cardholder: String,
    val expiry: String,
    val theme: String,
    val network: String,
    val kind: String,
    val status: String,
    val onlinePayment: Boolean,
    val overseasPayment: Boolean,
    val dailyLimit: Long,
    val paymentEnabled: Boolean?,
    val channelLimits: CardChannelLimits?,
    val merchantLimits: CardMerchantLimits?,
    val shippingAddress: MailingAddress?,
    val issuingFee: Long?,
    val replacedFromId: String?,
    val lostFromStatus: String?,
)

data class CardSecrets(
    val pan: String,
    val expiry: String,
    val cvv: String,
    val revealSeconds: Int,
)

private fun JSONObject.toBankCard(): BankCard = BankCard(
    id = getString("id"),
    accountId = optString("accountId"),
    productName = optString("productName"),
    last4 = optString("last4"),
    cardholder = optString("cardholder"),
    expiry = optString("expiry"),
    theme = optString("theme"),
    network = optString("network"),
    kind = optString("kind"),
    status = optString("status"),
    onlinePayment = optBoolean("onlinePayment"),
    overseasPayment = optBoolean("overseasPayment"),
    dailyLimit = optLong("dailyLimit"),
    paymentEnabled = if (has("paymentEnabled")) optBoolean("paymentEnabled") else null,
    channelLimits = optJSONObject("channelLimits")?.let {
        CardChannelLimits(
            online = it.optLong("online"),
            offline = it.optLong("offline"),
            overseas = it.optLong("overseas"),
        )
    },
    merchantLimits = optJSONObject("merchantLimits")?.let {
        CardMerchantLimits(
            dining = it.optLong("dining"),
            shopping = it.optLong("shopping"),
            other = it.optLong("other"),
        )
    },
    shippingAddress = optJSONObject("shippingAddress")?.toMailingAddress(),
    issuingFee = if (has("issuingFee")) optLong("issuingFee") else null,
    replacedFromId = if (has("replacedFromId") && !isNull("replacedFromId")) optString("replacedFromId") else null,
    lostFromStatus = if (has("lostFromStatus") && !isNull("lostFromStatus")) optString("lostFromStatus") else null,
)

private fun JSONObject.toMailingAddress(): MailingAddress = MailingAddress(
    recipient = optString("recipient"),
    phone = optString("phone"),
    region = optString("region"),
    city = optString("city"),
    detail = optString("detail"),
    postalCode = optString("postalCode"),
)
