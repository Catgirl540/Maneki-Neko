package cn.waveflow.luckycat.contract

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentEventTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun decode(data: String) = decodeAgentEvent(json, data)

    @Test
    fun `assistant 事件取出文本`() {
        val event = decode("""{"type":"assistant","text":"您好"}""")
        assertTrue(event is AgentEvent.Assistant)
        assertEquals("您好", (event as AgentEvent.Assistant).text)
    }

    @Test
    fun `status 事件`() {
        val event = decode("""{"type":"status","status":"running"}""")
        assertEquals("running", (event as AgentEvent.Status).status)
    }

    @Test
    fun `hello 事件带 sessionId`() {
        val event = decode("""{"type":"hello","sessionId":"web-1"}""")
        assertEquals("web-1", (event as AgentEvent.Hello).sessionId)
    }

    @Test
    fun `没见过的类型走 Unknown 而不是崩掉`() {
        // 这是这份契约唯一的向前兼容硬要求：桥接以后加事件，老客户端要能安静带过
        val event = decode("""{"type":"brand-new-event","payload":1}""")
        assertTrue(event is AgentEvent.Unknown)
        assertEquals("brand-new-event", (event as AgentEvent.Unknown).type)
    }

    @Test
    fun `连 type 都没有也走 Unknown`() {
        val event = decode("""{"foo":1}""")
        assertTrue(event is AgentEvent.Unknown)
    }

    @Test
    fun `不是 JSON 的数据回 Malformed 而不是抛异常`() {
        // 静默丢弃会变成"界面莫名不动"，所以既要容错也要留下痕迹
        val event = decode("这不是 JSON")
        assertTrue(event is AgentEvent.Malformed)
    }

    @Test
    fun `error 事件带 message`() {
        val event = decode("""{"type":"error","message":"上游失败"}""")
        assertEquals("上游失败", (event as AgentEvent.Error).message)
    }

    @Test
    fun `consent 事件带 challenge 与验证方式`() {
        val event = decode(
            """{"type":"consent","challenge":{"challengeId":"c1","sessionId":"web-1",""" +
                """"toolName":"bank_transfer","kind":"转账","verification":"payment-password"}}"""
        )
        val challenge = (event as AgentEvent.Consent).challenge
        assertNotNull(challenge)
        assertEquals("c1", challenge!!.challengeId)
        assertEquals("转账", challenge.kind)
        assertTrue(challenge.requiresPaymentPassword)
    }

    @Test
    fun `没有 verification 字段表示不需要输密码`() {
        // 只读查询不该弹密码框。判据是字段缺省，不是"值等于空串"
        val event = decode("""{"type":"consent","challenge":{"challengeId":"c2","toolName":"bank_balance"}}""")
        val challenge = (event as AgentEvent.Consent).challenge!!
        assertFalse(challenge.requiresPaymentPassword)
    }

    @Test
    fun `consent 事件缺 challenge 时返回 null 而不是崩`() {
        val event = decode("""{"type":"consent"}""")
        assertEquals(null, (event as AgentEvent.Consent).challenge)
    }

    @Test
    fun `consent-resolved 的四种结局都能读出来`() {
        for (decision in listOf("approve", "reject", "timeout", "abandoned")) {
            val event = decode("""{"type":"consent-resolved","challengeId":"c1","decision":"$decision"}""")
            assertEquals(decision, (event as AgentEvent.ConsentResolved).decision)
        }
    }

    @Test
    fun `tool-result 的 isError 默认 false`() {
        val event = decode("""{"type":"tool-result","callId":"x","text":"【演示占位数据】"}""")
        assertFalse((event as AgentEvent.ToolResult).isError)
    }

    @Test
    fun `question-resolved 的 answered 为 false 表示超时或没人等了`() {
        val event = decode("""{"type":"question-resolved","questionId":"q1","answered":false}""")
        assertFalse((event as AgentEvent.QuestionResolved).answered)
    }

    @Test
    fun `审计事件走 Audit`() {
        val event = decode("""{"type":"consent-asked","challengeId":"c1"}""")
        assertTrue(event is AgentEvent.Audit)
        assertEquals("consent-asked", (event as AgentEvent.Audit).type)
    }

    @Test
    fun `原始 JSON 被原样带下去`() {
        // 确认卡片要展示交易信息，字段各工具不同，不能在这一层丢
        val event = decode("""{"type":"consent","challenge":{"challengeId":"c1","amount":1234.5}}""")
        assertTrue(event.raw.toString().contains("1234.5"))
    }
}
