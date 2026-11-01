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
 *  - `GET  /services`       能力清单（唯一来源是服务端 framework/agent-services.json）
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

    /**
     * 一条可选的智能服务。
     *
     * 能力清单由服务端下发（`GET /agent-api/services`），安卓不再维护标签与 id 的对照表；
     * 客户端只按 `id` 映射图标，未知 id 用通用图标兜底。
     */
    data class AgentService(
        val id: String,
        val order: Int,
        val label: String,
        val description: String,
    )

    /**
     * 读取能力清单。失败时抛 [BankApiException]，由界面决定隐藏入口并在稍后重试；
     * 刻意不在客户端留本地兜底列表，否则又会出现第二份真相。
     */
    suspend fun listServices(): List<AgentService> = withContext(Dispatchers.IO) {
        val payload = JSONObject(request("GET", "/services", null))
        val rows = payload.optJSONArray("services") ?: JSONArray()
        (0 until rows.length()).mapNotNull { index ->
            val row = rows.optJSONObject(index) ?: return@mapNotNull null
            val id = row.optString("id").trim()
            val label = row.optString("label").trim()
            if (id.isEmpty() || label.isEmpty()) return@mapNotNull null
            AgentService(
                id = id,
                order = row.optInt("order", Int.MAX_VALUE),
                label = label,
                description = row.optString("description").trim(),
            )
        }.sortedWith(compareBy({ it.order }, { it.id }))
    }

    suspend fun health(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val connection = open("/health", "GET")
            try {
                connection.responseCode == 200 && JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).let { it.optBoolean("ok") && it.optString("bankDataSource") == "http" }
            } finally { connection.disconnect() }
        }.getOrDefault(false)
    }

    internal suspend fun imRequest(method: String, path: String, body: JSONObject? = null): Any = withContext(Dispatchers.IO) {
        require(path == "/im/bindings" || path == "/im/weixin/qr" || path == "/im/reminders" || Regex("^/im/reminders/rem-[A-Za-z0-9_-]+$").matches(path) ||
            Regex("^/im/weixin/qr/[A-Za-z0-9_-]+(/(verify|cancel|confirm))?$").matches(path) ||
            Regex("^/im/bindings/im-[A-Za-z0-9_-]+$").matches(path))
        org.json.JSONTokener(request(method, path, body)).nextValue()
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
