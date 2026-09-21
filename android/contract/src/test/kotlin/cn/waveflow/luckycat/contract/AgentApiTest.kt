package cn.waveflow.luckycat.contract

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.util.Base64

/**
 * 打的是**假的桥接**（MockWebServer），验的是"客户端把桥接的字节解对了没有"。
 * 真实桥接的形状由 [LiveContractTest] 负责，两者分工不同，都要有。
 */
class AgentApiTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun api(token: String? = null) = AgentApi(server.url("/").toString(), token = token)

    private fun json(body: String) = MockResponse()
        .setResponseCode(200)
        .setHeader("content-type", "application/json")
        .setBody(body)

    private fun sse(body: String) = MockResponse()
        .setResponseCode(200)
        .setHeader("content-type", "text/event-stream; charset=utf-8")
        .setBody(body)

    @Test
    fun `health 解析出语音能力`() = runBlocking {
        server.enqueue(
            json("""{"ok":true,"sessions":3,"voice":{"asr":true,"tts":true,"maxSeconds":60}}""")
        )
        val health = api().health()
        assertTrue(health.ok)
        assertEquals(3, health.sessions)
        assertTrue(health.voice.asr)
        assertTrue(health.voice.tts)
        assertEquals(60, health.voice.maxSeconds)
    }

    @Test
    fun `health 里没有语音能力时 asr tts 都是 false`() = runBlocking {
        // 服务端没配语音密钥时就是这样回的；前端据此决定显不显示语音入口
        server.enqueue(json("""{"ok":true,"sessions":0,"voice":{"asr":false,"tts":false}}"""))
        val health = api().health()
        assertFalse(health.voice.asr)
        assertFalse(health.voice.tts)
    }

    @Test
    fun `建会话取出 sessionId`() = runBlocking {
        server.enqueue(json("""{"sessionId":"web-abc"}"""))
        assertEquals("web-abc", api().createSession())
        assertEquals("/agent-api/sessions", server.takeRequest().path)
    }

    @Test
    fun `只读问会话 不存在的会话 known 与 started 都是 false`() = runBlocking {
        // "顺手把它建出来"是这条接口明确要避免的行为，前端只认 started
        server.enqueue(json("""{"sessionId":"web-x","known":false,"started":false,"busy":false}"""))
        val info = api().sessionInfo("web-x")
        assertFalse(info.known)
        assertFalse(info.started)
        assertFalse(info.busy)
        assertEquals("/agent-api/sessions/web-x", server.takeRequest().path)
    }

    @Test
    fun `发消息用 POST 且路径正确`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(202).setBody("""{"accepted":true}"""))
        api().sendMessage("web-1", "查余额")
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/agent-api/sessions/web-1/messages", request.path)
        assertTrue(request.body.readUtf8().contains("查余额"))
    }

    @Test
    fun `事件流按序解出 hello 与 assistant`() = runBlocking {
        // 刻意用 CRLF 行尾 + 一条注释保活：这两个都是真实会出现的
        server.enqueue(
            sse(
                ": ping\r\n" +
                    "\r\n" +
                    "data: {\"type\":\"hello\",\"sessionId\":\"web-1\"}\r\n" +
                    "\r\n" +
                    "data: {\"type\":\"assistant\",\"text\":\"您好\"}\r\n" +
                    "\r\n"
            )
        )
        val events = api().streamEvents("web-1").toList()
        assertEquals(2, events.size)
        assertEquals("web-1", (events[0] as AgentEvent.Hello).sessionId)
        assertEquals("您好", (events[1] as AgentEvent.Assistant).text)
    }

    @Test
    fun `事件流遇到没见过的类型不中断`() = runBlocking {
        // 中断了的话，后面那条 assistant 就永远到不了界面
        server.enqueue(
            sse(
                "data: {\"type\":\"future-thing\"}\n\n" +
                    "data: {\"type\":\"assistant\",\"text\":\"还在\"}\n\n"
            )
        )
        val events = api().streamEvents("web-1").toList()
        assertEquals(2, events.size)
        assertTrue(events[0] is AgentEvent.Unknown)
        assertEquals("还在", (events[1] as AgentEvent.Assistant).text)
    }

    @Test
    fun `事件流遇到坏帧留下 Malformed 并继续`() = runBlocking {
        server.enqueue(
            sse(
                "data: 这不是 JSON\n\n" +
                    "data: {\"type\":\"assistant\",\"text\":\"继续\"}\n\n"
            )
        )
        val events = api().streamEvents("web-1").toList()
        assertEquals(2, events.size)
        assertTrue(events[0] is AgentEvent.Malformed)
        assertEquals("继续", (events[1] as AgentEvent.Assistant).text)
    }

    @Test
    fun `确认通道的 401 是密码不对 不是终态`() = runBlocking {
        // 服务端在密码错时**不结算挑战**，所以客户端必须能区分 401 与其它失败
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"支付密码不正确"}"""))
        try {
            api().answerConsent("c1", approve = true, paymentPassword = "0000")
            fail("应该抛 ApiException")
        } catch (e: ApiException) {
            assertEquals(401, e.code)
            assertTrue(e.body.contains("支付密码不正确"))
        }
    }

    @Test
    fun `确认通过时带上 verified`() = runBlocking {
        server.enqueue(json("""{"ok":true,"decision":"approve","verified":true}"""))
        val answer = api().answerConsent("c1", approve = true, paymentPassword = "123456")
        assertTrue(answer.ok)
        assertEquals("approve", answer.decision)
        assertEquals(true, answer.verified)

        val request = server.takeRequest()
        assertEquals("/agent-api/consent/c1", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"decision\":\"approve\""))
        assertTrue(body.contains("\"paymentPassword\":\"123456\""))
    }

    @Test
    fun `拒绝时不带支付密码字段`() = runBlocking {
        // 拒绝不需要密码；带上会白白把密码送到网络上
        server.enqueue(json("""{"ok":true,"decision":"reject"}"""))
        api().answerConsent("c1", approve = false)
        val body = server.takeRequest().body.readUtf8()
        assertFalse(body.contains("paymentPassword"))
    }

    @Test
    fun `语音流解出 start audio end`() = runBlocking {
        val pcm = byteArrayOf(0x01, 0x00, 0xFF.toByte(), 0x7F)
        val b64 = Base64.getEncoder().encodeToString(pcm)
        server.enqueue(
            sse(
                "event: start\ndata: {\"format\":\"pcm\",\"sampleRate\":24000}\n\n" +
                    "event: audio\ndata: $b64\n\n" +
                    "event: audio\ndata: $b64\n\n" +
                    "event: end\ndata: {\"frames\":2,\"bytes\":8,\"truncated\":false}\n\n"
            )
        )
        val frames = api().streamSpeech("您好").toList()
        assertEquals(4, frames.size)

        val start = frames[0] as TtsFrame.Start
        assertEquals("pcm", start.format)
        assertEquals(24000, start.sampleRate)

        // 音频帧是**裸 PCM16 LE**，不是 JSON——拿 JSON 解会得到乱码错误
        assertEquals(pcm.toList(), (frames[1] as TtsFrame.Audio).pcm16.toList())
        assertEquals(pcm.toList(), (frames[2] as TtsFrame.Audio).pcm16.toList())

        val end = frames[3] as TtsFrame.End
        assertEquals(2, end.frames)
        assertEquals(8, end.bytes)
        assertFalse(end.truncated)
    }

    @Test
    fun `语音流的 error 事件变成 Failure 而不是抛异常`() = runBlocking {
        server.enqueue(sse("event: error\ndata: {\"message\":\"上游合成失败\"}\n\n"))
        val frames = api().streamSpeech("您好").toList()
        assertEquals(1, frames.size)
        assertEquals("上游合成失败", (frames[0] as TtsFrame.Failure).message)
    }

    @Test
    fun `语音流里坏掉的 base64 变成 Failure`() = runBlocking {
        // 静默当成空音频的话，用户只会听到"没声音"，查不出原因
        server.enqueue(sse("event: audio\ndata: !!!不是base64!!!\n\n"))
        val frames = api().streamSpeech("您好").toList()
        assertTrue(frames[0] is TtsFrame.Failure)
    }

    @Test
    fun `语音流发出的是 POST 且带 text`() = runBlocking {
        server.enqueue(sse("event: end\ndata: {\"frames\":0,\"bytes\":0,\"truncated\":false}\n\n"))
        api().streamSpeech("念这段").toList()
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/agent-api/tts/stream", request.path)
        assertTrue(request.body.readUtf8().contains("念这段"))
    }

    @Test
    fun `只取第一帧就取消 不抛异常（浅层冒烟）`() = runBlocking {
        // ⚠️ **这条不覆盖那个真 bug**，别把它当守卫。
        //
        // 真 bug 是：桥接的 hello 订阅后立刻发，界面常常只要前几帧就取消；
        // 取消会让阻塞中的读取抛 "SocketException: Socket closed"，
        // 当时被当成失败往上报。**只有真桥接那条测试能稳定抓到它**
        // （变异验证：把修复改回去，LiveContractTest 连跑 3 次全红）。
        //
        // 为什么离线抓不到：`first()` 拿到值就取消了收集，reader 随后抛的异常
        // 被送进一个已经没人读的 channel，**静默丢掉**——观测不到。
        // 试过 `SocketPolicy.KEEP_OPEN` 想让读取真的阻塞住，也不行，同样是这个原因。
        // 所以这条只值"取消不会在浅层崩"这一点，留着是因为它便宜。
        server.enqueue(
            sse(
                "data: {\"type\":\"hello\",\"sessionId\":\"web-1\"}\n\n" +
                    "data: {\"type\":\"assistant\",\"text\":\"后面还有很多\"}\n\n"
            )
        )
        val first = api().streamEvents("web-1").first()
        assertTrue(first is AgentEvent.Hello)
    }

    @Test
    fun `流到一半被掐断要抛出来 不能吞`() = runBlocking {
        // 这条是确定性的，方向也重要：修"取消被当失败"时最容易做过头，
        // 变成"IOException 一律吞"。真失败被吞掉，界面上就是一直转圈，比报错更难查。
        server.enqueue(
            sse("data: {\"type\":\"hello\"}\n\n")
                .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
        )
        try {
            api().streamEvents("web-1").toList()
            fail("中途断开应该抛出来")
        } catch (e: IOException) {
            // 预期：连接层失败要能到收集方手里
        }
    }

    @Test
    fun `订阅时服务端报错要抛出来 不能吞`() = runBlocking {
        // 反向断言：修上面那条时最容易做过头，变成"IOException 一律吞"。
        // 真失败被吞掉，界面上就是"一直转圈"，比报错更难查。
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":"炸了"}"""))
        try {
            api().streamEvents("web-1").toList()
            fail("应该抛 ApiException")
        } catch (e: ApiException) {
            assertEquals(500, e.code)
        }
    }

    @Test
    fun `语音流取第一帧就取消 也不该抛异常（浅层冒烟）`() = runBlocking {
        // 同事件流：**这条也不覆盖那个取消竞态**，理由见上一条的注释。
        // 留着是因为它便宜，且能证明语音流和事件流共用同一套取消处理。
        server.enqueue(
            sse(
                "event: start\ndata: {\"format\":\"pcm\",\"sampleRate\":24000}\n\n" +
                    "event: audio\ndata: AAAA\n\n"
            )
        )
        val first = api().streamSpeech("您好").first()
        assertTrue(first is TtsFrame.Start)
    }

    @Test
    fun `语音流里服务端报错要抛出来`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":"炸了"}"""))
        try {
            api().streamSpeech("您好").toList()
            fail("应该抛 ApiException")
        } catch (e: ApiException) {
            assertEquals(500, e.code)
        }
    }

    @Test
    fun `配置了口令就带上 x-luckycat-token 头`() = runBlocking {
        server.enqueue(json("""{"ok":true,"sessions":0,"voice":{"asr":false,"tts":false}}"""))
        api(token = "s3cret").health()
        assertEquals("s3cret", server.takeRequest().headers["x-luckycat-token"])
    }

    @Test
    fun `没配口令就不带这个头`() = runBlocking {
        server.enqueue(json("""{"ok":true,"sessions":0,"voice":{"asr":false,"tts":false}}"""))
        api().health()
        assertEquals(null, server.takeRequest().headers["x-luckycat-token"])
    }

    @Test
    fun `转录把音频编成裸 base64 并带上容器类型`() = runBlocking {
        server.enqueue(json("""{"text":"查一下余额","seconds":1.5}"""))
        val result = api().transcribe(byteArrayOf(1, 2, 3), mimeType = "audio/mp4")
        assertEquals("查一下余额", result.text)

        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("\"mimeType\":\"audio/mp4\""))
        // 裸 base64，**不带** data: 前缀（文档写的是裸 base64）
        assertTrue(body.contains(Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3))))
        assertFalse(body.contains("data:audio"))
    }

    @Test
    fun `服务端 500 会抛出带状态码的异常`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":"炸了"}"""))
        try {
            api().health()
            fail("应该抛 ApiException")
        } catch (e: ApiException) {
            assertEquals(500, e.code)
        }
    }

    @Test
    fun `路径里的会话 id 被正确拼接`() = runBlocking {
        // sessionId 里带连字符与十六进制，别被当成需要转义的字符
        server.enqueue(sse("data: {\"type\":\"hello\"}\n\n"))
        api().streamEvents("web-0f3a-4b2c").toList()
        assertEquals("/agent-api/sessions/web-0f3a-4b2c/stream", server.takeRequest().path)
    }

    @Test
    fun `没有 sessionId 的建会话响应会报错而不是回空串`() = runBlocking {
        // 回空串的话，后面所有请求都会打到 /agent-api/sessions//messages 上，
        // 报出来的是 404，排查方向全错
        server.enqueue(json("""{"oops":true}"""))
        try {
            api().createSession()
            fail("应该失败")
        } catch (e: Exception) {
            assertNotNull(e)
        }
    }
}
