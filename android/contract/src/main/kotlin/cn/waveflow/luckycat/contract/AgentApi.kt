package cn.waveflow.luckycat.contract

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.Base64

/** HTTP 层失败。[code] 有语义：**401 在确认通道上表示"支付密码不对，可以再试"**，不是终态。 */
class ApiException(val code: Int, val body: String) : IOException("HTTP $code: $body")

@Serializable
data class VoiceCapability(val asr: Boolean = false, val tts: Boolean = false, val maxSeconds: Int? = null)

@Serializable
data class Health(val ok: Boolean = false, val sessions: Int = 0, val voice: VoiceCapability = VoiceCapability())

/**
 * 建会话的响应。`sessionId` **刻意不给默认值**：缺字段时直接反序列化失败，
 * 而不是回一个空串——空串会让后续请求打到 `/agent-api/sessions//messages`，
 * 报出来的是 404，排查方向全错。
 */
@Serializable
data class SessionCreated(val sessionId: String)

/** 会话是否还在。[started] 记的是"真的往运行时递过提示词"——建过不等于跑过，前端只认这个字段。 */
@Serializable
data class SessionInfo(
    val sessionId: String = "",
    val known: Boolean = false,
    val started: Boolean = false,
    val busy: Boolean = false,
)

@Serializable
data class ConsentAnswer(val ok: Boolean = false, val decision: String? = null, val verified: Boolean? = null)

@Serializable
data class AsrResult(val text: String = "", val seconds: Double? = null, val cost: Double? = null)

/**
 * 桥接 `/agent-api/…` 的客户端。
 *
 * 只有这一处定义接口面：`:app` 与契约测试都用它，桥接一改两边同时红。
 *
 * [token] 对应服务端 `LUCKYCAT_DEMO_TOKEN`（请求头 `x-luckycat-token`）。
 * 服务端没设口令时留空即可。
 */
class AgentApi(
    baseUrl: String,
    private val client: OkHttpClient = OkHttpClient(),
    private val json: Json = DefaultJson,
    private val token: String? = null,
) {
    private val base: HttpUrl = baseUrl.trimEnd('/').toHttpUrl()

    /** 服务在不在、有哪些能力。**响应里没有模型名/厂商名**，别去要。 */
    suspend fun health(): Health = json.decodeFromString(call(builder("GET", "agent-api/health").build()))

    suspend fun createSession(): String {
        val body = call(builder("POST", "agent-api/sessions").post(EMPTY_JSON.toRequestBody(JSON_MEDIA)).build())
        return json.decodeFromString<SessionCreated>(body).sessionId
    }

    /** **只读**问一句这段会话还在不在。不会顺手把它建出来。 */
    suspend fun sessionInfo(sessionId: String): SessionInfo =
        json.decodeFromString(call(builder("GET", "agent-api/sessions/$sessionId").build()))

    /** 发一条消息。返回 202 只是**入队回执**，不代表回答完成——回答从 [streamEvents] 来。 */
    suspend fun sendMessage(sessionId: String, text: String) {
        val payload = buildJsonObject { put("text", text) }.toString()
        call(builder("POST", "agent-api/sessions/$sessionId/messages").post(payload.toRequestBody(JSON_MEDIA)).build())
    }

    /**
     * 订阅事件流。
     *
     * 取消这个 Flow 会**真的把 HTTP 连接掐掉**（`call.cancel()`），
     * 不是留着连接只停止收集——后者会让服务端一直挂着一个订阅者。
     */
    fun streamEvents(sessionId: String): Flow<AgentEvent> = channelFlow {
        val call = client.newCall(builder("GET", "agent-api/sessions/$sessionId/stream").build())
        val reader = launch(Dispatchers.IO) {
            try {
                call.execute().use { res ->
                    if (!res.isSuccessful) throw ApiException(res.code, res.body.string())
                    val source = res.body.source()
                    val parser = SseParser()
                    while (true) {
                        val line = source.readUtf8Line() ?: break
                        val message = parser.feedLine(line) ?: continue
                        send(decodeAgentEvent(json, message.data))
                    }
                }
            } catch (e: IOException) {
                // 收集方取消 → awaitClose 里 call.cancel() → 这里会读到 "Socket closed"。
                // **那不是失败，是取消的正常路径**。不吞掉的话，用户按"停止"就会看到一条报错。
                //
                // 但"真失败"必须往上报：所以判据是 `isActive`，不是"IOException 一律吞"。
                // （web 端踩过同一个坑的反面：那边把真失败吞掉了，静默得查不出来。）
                if (isActive) throw e
            }
        }
        reader.invokeOnCompletion { cause -> close(cause) }
        awaitClose { call.cancel() }
    }

    /**
     * 答复确认卡片。
     *
     * **支付密码只到这里为止**：它进请求体，不进对话、不进模型上下文。
     *
     * 密码错时服务端回 **401 且不结算挑战**（可以再输一次），
     * 所以调用方要把 401 当"重试"，别当"失败"收起卡片。
     */
    suspend fun answerConsent(challengeId: String, approve: Boolean, paymentPassword: String? = null): ConsentAnswer {
        val payload = buildJsonObject {
            put("decision", if (approve) "approve" else "reject")
            if (paymentPassword != null) put("paymentPassword", paymentPassword)
        }.toString()
        val body = call(builder("POST", "agent-api/consent/$challengeId").post(payload.toRequestBody(JSON_MEDIA)).build())
        return json.decodeFromString(body)
    }

    /** 答复提问卡片。超时由服务端管：到点它自己回空答复，客户端不需要抢着取消。 */
    suspend fun answerQuestion(questionId: String, answers: JsonElement) {
        val payload = buildJsonObject { put("answers", answers) }.toString()
        call(builder("POST", "agent-api/questions/$questionId/answer").post(payload.toRequestBody(JSON_MEDIA)).build())
    }

    /** 整段录音转文字。[mimeType] 必须是真实容器类型（桥接按它映射格式）。 */
    suspend fun transcribe(audio: ByteArray, mimeType: String, language: String? = null): AsrResult {
        val payload = buildJsonObject {
            put("audio", Base64.getEncoder().encodeToString(audio))
            put("mimeType", mimeType)
            if (language != null) put("language", language)
        }.toString()
        return json.decodeFromString(call(builder("POST", "agent-api/asr").post(payload.toRequestBody(JSON_MEDIA)).build()))
    }

    /**
     * 流式合成。首帧就是音频，不等整段合成完。
     *
     * 每帧 [TtsFrame.Audio] 是裸 PCM16 LE，直接喂 AudioTrack。
     */
    fun streamSpeech(text: String, voice: String? = null): Flow<TtsFrame> = channelFlow {
        val payload = buildJsonObject {
            put("text", text)
            if (voice != null) put("voice", voice)
        }.toString()
        val call = client.newCall(
            builder("POST", "agent-api/tts/stream").post(payload.toRequestBody(JSON_MEDIA)).build()
        )
        val reader = launch(Dispatchers.IO) {
            try {
                call.execute().use { res ->
                    if (!res.isSuccessful) throw ApiException(res.code, res.body.string())
                    val source = res.body.source()
                    val parser = SseParser()
                    while (true) {
                        val line = source.readUtf8Line() ?: break
                        val message = parser.feedLine(line) ?: continue
                        send(decodeTtsFrame(message))
                    }
                }
            } catch (e: IOException) {
                // 同 streamEvents：取消导致的 socket 关闭不算失败，真失败要上报
                if (isActive) throw e
            }
        }
        reader.invokeOnCompletion { cause -> close(cause) }
        awaitClose { call.cancel() }
    }

    fun close() {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    private fun builder(method: String, path: String): Request.Builder {
        val b = Request.Builder().url(base.newBuilder().addPathSegments(path).build())
        if (token != null) b.header("x-luckycat-token", token)
        return when (method) {
            "GET" -> b.get()
            else -> b
        }
    }

    private suspend fun call(request: Request): String = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { res ->
            val body = res.body.string()
            if (!res.isSuccessful) throw ApiException(res.code, body)
            body
        }
    }

    companion object {
        val DefaultJson: Json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
        private const val EMPTY_JSON = "{}"
    }
}

internal fun decodeTtsFrame(message: SseMessage): TtsFrame {
    val obj = runCatching { AgentApi.DefaultJson.parseToJsonElement(message.data) }
        .getOrNull()
        ?.let { runCatching { it as kotlinx.serialization.json.JsonObject }.getOrNull() }
    return when (message.event) {
        "start" -> TtsFrame.Start(
            format = obj?.stringOrNull("format") ?: "pcm",
            sampleRate = obj?.intOrNull("sampleRate") ?: 24000,
        )
        "audio" -> {
            // 服务端在这一帧放的是**裸 base64 的二进制**，不是 JSON。
            // 拿 JSON 去解会得到一段乱码错误——实测踩过，别改回去。
            val bytes = runCatching { Base64.getDecoder().decode(message.data.trim()) }.getOrNull()
            if (bytes == null) TtsFrame.Failure("音频帧不是合法 base64") else TtsFrame.Audio(bytes)
        }
        "sentence" -> TtsFrame.Sentence(
            kind = obj?.stringOrNull("type") ?: "",
            text = obj?.stringOrNull("text") ?: "",
        )
        "end" -> TtsFrame.End(
            frames = obj?.intOrNull("frames") ?: 0,
            bytes = obj?.intOrNull("bytes") ?: 0,
            truncated = obj?.boolOrNull("truncated") ?: false,
        )
        "error" -> TtsFrame.Failure(obj?.stringOrNull("message") ?: "上游合成失败")
        else -> TtsFrame.Unknown(message.event, message.data)
    }
}
