package cn.waveflow.luckycat.contract

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SSE 解析器的断言。这一层是流式语音与事件流共用的地基，
 * 所以按"能坏的方式"逐条钉，而不是只测一条顺利路径。
 */
class SseParserTest {

    private fun feed(vararg lines: String): List<SseMessage> {
        val parser = SseParser()
        val out = mutableListOf<SseMessage>()
        for (line in lines) parser.feedLine(line)?.let { out += it }
        return out
    }

    @Test
    fun `单行 data 在空行处派发`() {
        val messages = feed("data: {\"type\":\"hello\"}", "")
        assertEquals(1, messages.size)
        assertEquals("{\"type\":\"hello\"}", messages[0].data)
    }

    @Test
    fun `没有 event 字段时 event 为 null`() {
        // 桥接的 agent 流就是这样：类型写在 JSON 里，没有 event: 行
        val messages = feed("data: {\"type\":\"assistant\"}", "")
        assertNull(messages[0].event)
    }

    @Test
    fun `event 字段被保留`() {
        // 桥接的语音流用的是这种写法
        val messages = feed("event: audio", "data: AAAA", "")
        assertEquals("audio", messages[0].event)
        assertEquals("AAAA", messages[0].data)
    }

    @Test
    fun `多行 data 用换行拼接`() {
        val messages = feed("data: 第一行", "data: 第二行", "")
        assertEquals("第一行\n第二行", messages[0].data)
    }

    @Test
    fun `注释行被吃掉`() {
        // 桥接会定期发 `: ping` 保活。它要是被当成数据，界面就会莫名多出一条空事件
        val messages = feed(": ping", "", "data: 真数据", "")
        assertEquals(1, messages.size)
        assertEquals("真数据", messages[0].data)
    }

    @Test
    fun `没有 data 的空行不派发`() {
        val messages = feed("event: audio", "")
        assertEquals(0, messages.size)
    }

    @Test
    fun `data 为空串时仍然派发`() {
        // SSE 规范：data 缓冲区非空就派发，`data:` 会让缓冲区里有一个换行
        val messages = feed("data:", "")
        assertEquals(1, messages.size)
        assertEquals("", messages[0].data)
    }

    @Test
    fun `冒号后只去掉一个空格`() {
        val messages = feed("data:  两个空格", "")
        assertEquals(" 两个空格", messages[0].data)
    }

    @Test
    fun `没有冒号的行按空值处理`() {
        // 规范：没有冒号时整行是字段名、值为空串。所以 `data` 与 `data:` 等价，
        // 都会往缓冲区里放一个换行，于是照样派发。
        // （一开始我断言它"不该派发"，跑出来是红的——错的是断言，不是实现。）
        val messages = feed("data", "")
        assertEquals(1, messages.size)
        assertEquals("", messages[0].data)
    }

    @Test
    fun `id 与 retry 字段被忽略`() {
        val messages = feed("id: 7", "retry: 3000", "data: 内容", "")
        assertEquals(1, messages.size)
        assertEquals("内容", messages[0].data)
        assertNull(messages[0].event)
    }

    @Test
    fun `连续两条消息各自独立`() {
        val messages = feed("data: 一", "", "data: 二", "")
        assertEquals(2, messages.size)
        assertEquals("一", messages[0].data)
        assertEquals("二", messages[1].data)
    }

    @Test
    fun `上一条的 event 不会漏给下一条`() {
        // 状态没清干净的话，第二条会带着第一条的 event 名出去
        val messages = feed("event: start", "data: 一", "", "data: 二", "")
        assertEquals("start", messages[0].event)
        assertNull(messages[1].event)
    }

    @Test
    fun `派发之后缓冲区被清空`() {
        val parser = SseParser()
        parser.feedLine("data: 一")
        assertEquals("一", parser.feedLine("")?.data)
        // 再补一个空行不该重复派发
        assertNull(parser.feedLine(""))
    }

    @Test
    fun `喂真实的分帧内容能解出来`() {
        // 照抄桥接实际的写法：agent 流只有 data，TTS 流带 event
        val parser = SseParser()
        val out = mutableListOf<SseMessage>()
        val raw = listOf(
            ": ping",
            "data: {\"type\":\"hello\",\"sessionId\":\"web-1\"}",
            "",
            "event: start",
            "data: {\"format\":\"pcm\",\"sampleRate\":24000}",
            "",
        )
        for (line in raw) parser.feedLine(line)?.let { out += it }
        assertEquals(2, out.size)
        assertTrue(out[0].data.contains("hello"))
        assertEquals("start", out[1].event)
    }
}
