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

/**
 * 一条要发给 agent 的图片。
 *
 * [data] 是**裸 base64**（不带 `data:` 前缀——那会被上游当成非法音频/图片）。
 * [mimeType] 必须是**真实容器类型**：桥接按它判能不能收，写错会得到 415。
 */
@Serializable
data class ImageAttachment(val data: String, val mimeType: String)

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
 * **`baseUrl` 传主机根**（`https://bank.waveflow.cn`、`http://10.0.2.2:8788`），
 * **不要带 `/agent-api` 前缀**——`/agent-api` 是桥接固定的路由前缀（见 P6），
 * 由这个类自己拼。传成 `https://bank.waveflow.cn/agent-api` 会拼出
 * `/agent-api/agent-api/health`，服务端回 404 而且报错信息看着像路径写错了，
 * 实际是**约定搞混**。所以构造时就挡下来（见 [init]），不靠记性。
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

    /**
     * **流式请求专用的客户端**：读超时放到 60 秒。
     *
     * OkHttp 默认读超时是 **10 秒**，而 SSE 是长连接——桥接每 **15 秒**发一次
     * `: ping` 保活，10 秒的超时根本等不到下一次心跳，于是每条订阅都会在
     * 空闲 10 秒后被自己掐断，抛 `SocketTimeoutException`。
     *
     * 症状很有迷惑性：回复正常收到，**十几秒之后**界面上才冒一条"网络不给力"。
     * 实测踩到三次才顺着 logcat 找到这里。
     *
     * 取 60 秒而不是"永不超时"：心跳是 15 秒一次，60 秒足够容忍抖动，
     * 而真的断了的连接还能在一分钟内被发现（永不超时的话它会一直挂着）。
     */
    private val streamClient: OkHttpClient = client.newBuilder()
        .readTimeout(STREAM_READ_TIMEOUT_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
        .build()

    init {
        val path = base.encodedPath
        require(path.isEmpty() || path == "/") {
            "baseUrl 要传主机根（例如 https://bank.waveflow.cn），不要带路径；" +
                "实际收到的是 \"$baseUrl\"，路径为 \"$path\"。" +
                "路由前缀 /agent-api 由 AgentApi 自己拼，带上会变成 /agent-api/agent-api/…"
        }
    }

    /** 服务在不在、有哪些能力。**响应里没有模型名/厂商名**，别去要。 */
    suspend fun health(): Health = json.decodeFromString(call(builder("GET", "agent-api/health").build()))

    suspend fun createSession(): String {
        val body = call(builder("POST", "agent-api/sessions").post(EMPTY_JSON.toRequestBody(JSON_MEDIA)).build())
        return json.decodeFromString<SessionCreated>(body).sessionId
    }

    /** **只读**问一句这段会话还在不在。不会顺手把它建出来。 */
    suspend fun sessionInfo(sessionId: String): SessionInfo =
        json.decodeFromString(call(builder("GET", "agent-api/sessions/$sessionId").build()))

    /**
     * 发一条消息。返回 202 只是**入队回执**，不代表回答完成——回答从 [streamEvents] 来。
     *
     * [image] 选填，但**文字与图片不能都空**（桥接会回 400）——只有图没文字是允许的，
     * 那是"发一张截图问这是什么"的正常用法。
     */
    suspend fun sendMessage(sessionId: String, text: String, image: ImageAttachment? = null) {
        val payload = buildJsonObject {
            put("text", text)
            if (image != null) {
                put("image", buildJsonObject {
                    put("data", image.data)
                    put("mimeType", image.mimeType)
                })
            }
        }.toString()
        call(builder("POST", "agent-api/sessions/$sessionId/messages").post(payload.toRequestBody(JSON_MEDIA)).build())
    }

    /**
     * 订阅事件流。
     *
     * 取消这个 Flow 会**真的把 HTTP 连接掐掉**（`call.cancel()`），
     * 不是留着连接只停止收集——后者会让服务端一直挂着一个订阅者。
     */
    fun streamEvents(sessionId: String): Flow<AgentEvent> = channelFlow {
        // 用 streamClient 而不是 client：SSE 是长连接，默认 10 秒读超时活不过心跳间隔
        val call = streamClient.newCall(builder("GET", "agent-api/sessions/$sessionId/stream").build())
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
        val call = streamClient.newCall(
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

    /**
     * 关掉调度线程池与连接池。
     *
     * **必须是 `suspend`，不能在主线程直接调**：`connectionPool.evictAll()` 会去关
     * 连接池里的连接，而 HTTPS 连接在被关时 Conscrypt 要写出 `close_notify` ——
     * 那是一次**真实的网络写**，会被 Android 的 StrictMode 拦下来抛
     * `NetworkOnMainThreadException`。
     *
     * 模拟器 + 真公网 HTTPS 端点上抓到的堆栈：
     * ```
     * RealConnectionPool.evictAll → ConscryptEngineSocket.close
     *   → SSLOutputStream.writeInternal → StrictMode.onNetwork
     * ```
     * 用明文 HTTP 打本机时**不会**触发，所以只连本地开发环境是看不出来的，
     * 一换成公网 HTTPS 立刻炸。这里用 `withContext(Dispatchers.IO)` 把它挪到后台，
     * 调用方就不必各自记得"close 要放后台线程"。
     */
    suspend fun close() = withContext(Dispatchers.IO) {
        streamClient.connectionPool.evictAll()
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

        /**
         * 流式连接的读超时。**必须大于桥接的 `: ping` 间隔（15 秒）**，
         * 否则每条订阅都会在空闲时被自己掐断。
         */
        const val STREAM_READ_TIMEOUT_MS = 60_000L
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
