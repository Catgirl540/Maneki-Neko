package com.moneymeow.bank

import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * 全 App 唯一的 HTTP I/O 实现：建连、写 body、读响应、错误体解析、401 通知、断连。
 *
 * 为什么集中到一处：`BankApi` 之外的几个 API 对象（卡片、更多服务、安全设置、流水）
 * 各自抄了一份 `HttpURLConnection` 逻辑，超时和 401 语义互相不一致，网络异常文案也会
 * 直接把 `Unable to resolve host …` 抛到界面上。这里只负责 I/O，不含读缓存、幂等键
 * 和业务校验——那些留在各自的 API 对象里。
 *
 * 无状态、不做缓存：缓存由 [BankApi] 自己维护。
 */
internal object BankHttp {

    /**
     * 发起一次请求并返回响应体文本；非 2xx 抛 [BankApiException]。
     *
     * @param notifyUnauthorized 401 时是否触发全局登出。资金恢复流程会用「抓取时刻的旧令牌」
     *   重放请求，那种场景必须传 false，避免把当前会话误清。
     */
    fun raw(
        method: String,
        path: String,
        body: JSONObject? = null,
        baseUrl: String = BankApi.baseUrl,
        token: String? = BankApi.currentToken(),
        connectTimeoutMs: Int = 8_000,
        readTimeoutMs: Int = 12_000,
        extraHeaders: Map<String, String> = emptyMap(),
        notifyUnauthorized: Boolean = true,
    ): String {
        val connection = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = connectTimeoutMs
            readTimeout = readTimeoutMs
            setRequestProperty("Accept", "application/json")
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
            extraHeaders.forEach { (name, value) -> setRequestProperty(name, value) }
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
                // 支付密码错误也是 401，但它只是业务校验失败，不能当成登录过期而清掉会话。
                val isPaymentPasswordFailure = apiCode == "BAD_PAY_PASSWORD"
                // 登录/验证码接口自己会报错，不触发全局登出，避免登录页被反复重置。
                if (status == 401 && notifyUnauthorized && !isPaymentPasswordFailure && !path.startsWith("/api/auth/")) {
                    BankApi.onUnauthorized?.invoke()
                }
                throw BankApiException(status, message.ifEmpty { "请求失败（$status）" }, apiCode)
            }
            return text
        } catch (io: java.io.IOException) {
            // 系统异常文案（如 Unable to resolve host）不直接展示给客户。
            throw BankApiException(503, "网络连接失败，请检查网络后重试", "NETWORK_ERROR")
        } finally {
            connection.disconnect()
        }
    }
}
