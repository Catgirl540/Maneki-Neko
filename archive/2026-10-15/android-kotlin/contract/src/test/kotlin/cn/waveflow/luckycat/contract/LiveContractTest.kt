package cn.waveflow.luckycat.contract

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

/**
 * 打**真的桥接**。默认跳过，要显式开：
 *
 * ```
 * LUCKYCAT_CONTRACT_LIVE=1 ./gradlew :contract:test --tests '*LiveContractTest*'
 * ```
 *
 * 为什么要单独一层：MockWebServer 只能证明"我按我以为的形状解对了"，
 * 证明不了"桥接真的是这个形状"。这一层是唯一能发现桥接改了的门禁。
 *
 * 地址可用 `LUCKYCAT_CONTRACT_BASE` 覆盖（默认 `http://127.0.0.1:8788`）。
 */
class LiveContractTest {

    private val base: String = System.getenv("LUCKYCAT_CONTRACT_BASE") ?: "http://127.0.0.1:8788"
    private val token: String? = System.getenv("LUCKYCAT_DEMO_TOKEN")

    @Before
    fun onlyWhenEnabled() {
        assumeTrue(
            "跳过：需要 LUCKYCAT_CONTRACT_LIVE=1 且桥接在 $base 上",
            System.getenv("LUCKYCAT_CONTRACT_LIVE") == "1",
        )
    }

    private fun api() = AgentApi(base, token = token)

    @Test
    fun `健康探测可达且不回模型名`() = runBlocking {
        val health = api().health()
        assertTrue("ok 应为 true", health.ok)
        // P11：这个响应是浏览器/手机直接看到的，模型与厂商名不能出现在这里
        val raw = AgentApi.DefaultJson.encodeToString(Health.serializer(), health)
        assertFalse("health 里不该有 model", raw.contains("\"model\""))
        assertFalse("health 里不该有 provider", raw.contains("\"provider\""))
    }

    @Test
    fun `建会话拿到 web- 前缀的 id`() = runBlocking {
        val id = api().createSession()
        assertTrue("sessionId 不该为空", id.isNotEmpty())
        assertTrue("桥接建的会话以 web- 开头，实际是 $id", id.startsWith("web-"))
    }

    @Test
    fun `问一个不存在的会话是只读的`() = runBlocking {
        // 这条语义是实测踩出来的：顺手建出来会让"助手已经不记得了"永远不出现
        val api = api()
        val ghost = "web-does-not-exist-${System.nanoTime()}"
        val info = api.sessionInfo(ghost)
        assertFalse("known 应为 false", info.known)
        assertFalse("started 应为 false", info.started)
    }

    @Test
    fun `事件流第一帧是 hello`() = runBlocking {
        // 只要 hello，不等模型回答——这样这条门禁不依赖上游模型，不会假红
        val api = api()
        val sessionId = api.createSession()
        val first = withTimeout(10_000) { api.streamEvents(sessionId).first() }
        assertTrue("第一帧应是 hello，实际是 $first", first is AgentEvent.Hello)
        assertEquals(sessionId, (first as AgentEvent.Hello).sessionId)
    }

    @Test
    fun `发消息被接收`() = runBlocking {
        val api = api()
        val sessionId = api.createSession()
        // 202 只是入队回执，不代表回答完成——这里只断言"被接收"
        api.sendMessage(sessionId, "你好")
    }
}
