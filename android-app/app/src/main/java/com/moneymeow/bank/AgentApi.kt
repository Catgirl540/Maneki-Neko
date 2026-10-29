package com.moneymeow.bank

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * 智能助手客户端：使用与客户网页相同的 `/agent-api` 入口。
 *
 * 协议与网页 `app/src/api/agent.ts` 一致：
 *  - `POST /sessions` 建会话
 *  - `POST /sessions/:id/messages` 入队一条消息（返回即入队，不代表回答完成）
 *  - `GET  /sessions/:id/stream` SSE 事件流
 * 鉴权沿用银行 Bearer 令牌。
 */
object AgentApi {
    var baseUrl: String = "https://bank.waveflow.men/agent-api"

    private var tokenProvider: () -> String? = { null }

    fun bindToken(provider: () -> String?) {
        tokenProvider = provider
    }

    suspend fun health(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val connection = open("/health", "GET")
            connection.responseCode == 200
        }.getOrDefault(false)
    }

    suspend fun createSession(history: List<Pair<String, String>> = emptyList()): String =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
            if (history.isNotEmpty()) {
                body.put(
                    "history",
                    JSONArray().apply {
                        history.forEach { (role, text) ->
                            put(JSONObject().put("role", role).put("text", text))
                        }
                    },
                )
            }
            val text = request("POST", "/sessions", body)
            org.json.JSONTokener(text).nextValue().let { (it as JSONObject).optString("sessionId") }
        }

    suspend fun sendMessage(sessionId: String, text: String, serviceIds: List<String>) =
        withContext(Dispatchers.IO) {
            val body = JSONObject().put("text", text)
            if (serviceIds.isNotEmpty()) body.put("serviceIds", JSONArray(serviceIds))
            request("POST", "/sessions/$sessionId/messages", body)
            Unit
        }

    /** 确认或拒绝一个待确认事项（敏感操作在确认前不会执行）。 */
    suspend fun decideConsent(
        challengeId: String,
        approve: Boolean,
        paymentPassword: String? = null,
        riskAcknowledgement: String? = null,
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject().put("decision", if (approve) "approve" else "reject")
        if (approve && paymentPassword != null) body.put("paymentPassword", paymentPassword)
        if (approve && riskAcknowledgement != null) body.put("riskAcknowledgement", riskAcknowledgement)
        request("POST", "/consent/$challengeId", body)
        Unit
    }

    /** 订阅事件流；每读到一条 `data: {json}` 就回调一次。阻塞到流结束。 */
    suspend fun stream(sessionId: String, onEvent: (JSONObject) -> Unit) = withContext(Dispatchers.IO) {
        val connection = open("/sessions/$sessionId/stream", "GET").apply {
            setRequestProperty("Accept", "text/event-stream")
            readTimeout = 120_000
        }
        try {
            connection.inputStream.bufferedReader().use { reader: BufferedReader ->
                var data = StringBuilder()
                while (true) {
                    val line = reader.readLine() ?: break
                    when {
                        line.startsWith("data:") -> data.append(line.removePrefix("data:").trim())
                        line.isEmpty() && data.isNotEmpty() -> {
                            runCatching { JSONObject(data.toString()) }.getOrNull()?.let(onEvent)
                            data = StringBuilder()
                        }
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun open(path: String, method: String): HttpURLConnection =
        (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8000
            setRequestProperty("Accept", "application/json")
            tokenProvider()?.let { setRequestProperty("Authorization", "Bearer $it") }
        }

    private fun request(method: String, path: String, body: JSONObject?): String {
        val connection = open(path, method)
        try {
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code !in 200..299) {
                val message = runCatching { JSONObject(text).optString("error") }.getOrDefault("")
                throw BankApiException(code, message.ifEmpty { "助手服务请求失败（$code）" })
            }
            return text
        } finally {
            connection.disconnect()
        }
    }
}

/** 能力标签 → 服务端 serviceId（与 `app/src/components/layout/services.ts` 一致）。 */
fun serviceIdOf(label: String): String = when (label) {
    "智能转账" -> "transfer"
    "理财顾问" -> "wealth"
    "账单分析" -> "analysis"
    "银行卡管家" -> "cards"
    "换汇助手" -> "exchange"
    "储蓄规划" -> "savings"
    "借款测算" -> "credit"
    "保险咨询" -> "insurance"
    "安全助手" -> "security"
    else -> "support"
}
