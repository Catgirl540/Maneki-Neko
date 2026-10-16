package cn.waveflow.luckycat.domain.conversation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

class ConversationsTest {

    private val zone: ZoneId = ZoneId.of("Asia/Shanghai")
    private val now = 1_800_000_000_000L

    private fun conv(
        id: String = "c_1",
        updatedAt: Long = now,
        agentSessionId: String? = null,
        items: List<ChatItem> = emptyList(),
    ) = StoredConversation(
        id = id,
        agentSessionId = agentSessionId,
        title = "对话",
        createdAt = updatedAt,
        updatedAt = updatedAt,
        items = items,
    )

    // ── 标题 ────────────────────────────────────────────────────────────

    @Test
    fun `标题取第一行`() {
        assertEquals("查一下余额", Conversations.titleFrom("查一下余额\n顺便看看流水"))
    }

    @Test
    fun `标题把连续空白压成一个空格`() {
        assertEquals("查 余额", Conversations.titleFrom("查    余额"))
    }

    @Test
    fun `超长标题截断并加省略号`() {
        val long = "一".repeat(30)
        val title = Conversations.titleFrom(long)
        // 18 个字 + 一个省略号
        assertEquals(19, title.length)
        assertTrue(title.endsWith("…"))
    }

    @Test
    fun `刚好 18 个字不截断`() {
        val exact = "一".repeat(18)
        assertEquals(exact, Conversations.titleFrom(exact))
    }

    @Test
    fun `空话说不出标题`() {
        assertEquals("新对话", Conversations.titleFrom("   \n  "))
        assertEquals("新对话", Conversations.titleFrom(""))
    }

    // ── 相对时间 ────────────────────────────────────────────────────────

    @Test
    fun `一分钟以内是刚刚`() {
        assertEquals("刚刚", Conversations.relativeTime(now - 30_000, now, zone))
        // 未来时间也按刚刚处理，不显示负数
        assertEquals("刚刚", Conversations.relativeTime(now + 60_000, now, zone))
    }

    @Test
    fun `一小时以内报分钟`() {
        assertEquals("5 分钟前", Conversations.relativeTime(now - 5 * 60_000, now, zone))
    }

    @Test
    fun `今天报时刻`() {
        // now 是 2026-01-15 前后；取当天更早一点的时间戳
        val today = java.time.Instant.ofEpochMilli(now).atZone(zone)
        val earlier = today.withHour(9).withMinute(3).withSecond(0).withNano(0).toInstant().toEpochMilli()
        assertEquals("09:03", Conversations.relativeTime(earlier, now, zone))
    }

    @Test
    fun `昨天可以只报昨天`() {
        val yesterday = java.time.Instant.ofEpochMilli(now).atZone(zone)
            .minusDays(1).withHour(20).withMinute(17).withSecond(0).withNano(0)
            .toInstant().toEpochMilli()
        assertEquals("昨天 20:17", Conversations.relativeTime(yesterday, now, zone))
        assertEquals("昨天", Conversations.relativeTime(yesterday, now, zone, compact = true))
    }

    @Test
    fun `更早报月日 跨年报年月日`() {
        val tz = java.time.Instant.ofEpochMilli(now).atZone(zone)
        val earlierThisYear = tz.minusDays(40).withHour(12).withMinute(0).withSecond(0).withNano(0)
        val text = Conversations.relativeTime(earlierThisYear.toInstant().toEpochMilli(), now, zone)
        assertTrue(text.contains("月"))
        val lastYear = tz.minusYears(1)
        assertTrue(Conversations.relativeTime(lastYear.toInstant().toEpochMilli(), now, zone).contains("年"))
    }

    // ── 空对话与裁剪 ────────────────────────────────────────────────────

    @Test
    fun `有 agentSessionId 就不算空`() {
        // 内容可能还没落盘，但会话已经建过了 = 一定发过话
        assertFalse(Conversations.isEmpty(conv(agentSessionId = "web-1")))
        assertTrue(Conversations.isEmpty(conv()))
    }

    @Test
    fun `有内容的对话让空对话一个都不留`() {
        val list = listOf(conv("a"), conv("b", items = listOf(ChatItem.User("m1", "你好"))), conv("c"))
        val pruned = Conversations.pruneEmpty(list)
        assertEquals(listOf("b"), pruned.map { it.id })
    }

    @Test
    fun `全是空对话时只留最新那段`() {
        val list = listOf(conv("old", updatedAt = now - 1000), conv("new", updatedAt = now))
        assertEquals(listOf("new"), Conversations.pruneEmpty(list).map { it.id })
    }

    @Test
    fun `空列表裁剪后还是空`() {
        assertEquals(emptyList<String>(), Conversations.pruneEmpty(emptyList()).map { it.id })
    }

    @Test
    fun `超过条数上限从最旧的丢`() {
        val list = (1..60).map { conv("c$it", updatedAt = now + it) }
        val kept = Conversations.prune(list, maxCount = 50)
        assertEquals(50, kept.size)
        // 留下的是最新的 50 个：c11..c60
        assertEquals("c60", kept.first().id)
        assertEquals("c11", kept.last().id)
    }

    @Test
    fun `超过体积上限继续从最旧的丢`() {
        // 旧的那段很大、新的那段很小 —— 该丢的是**旧**的
        val big = ChatItem.Assistant("m", "x".repeat(Conversations.MAX_ITEM_TEXT))
        val hugeOld = conv("huge", updatedAt = now, items = List(11) { big })
        val smallNew = conv("small", updatedAt = now + 1, items = listOf(ChatItem.User("u", "hi")))
        val kept = Conversations.prune(listOf(hugeOld, smallNew), maxBytes = 50_000)
        assertEquals(listOf("small"), kept.map { it.id })
    }

    @Test
    fun `最新那段自己就超预算时连它一起丢`() {
        // 这是有意的：宁可留一个空存档，也不要写出一个读不回来的东西。
        // （网页版同此行为；把这条写出来是为了它别被当成 bug 随手"修"掉。）
        val big = ChatItem.Assistant("m", "x".repeat(Conversations.MAX_ITEM_TEXT))
        val hugeNew = conv("huge", updatedAt = now + 1, items = List(11) { big })
        assertEquals(emptyList<String>(), Conversations.prune(listOf(hugeNew), maxBytes = 50_000).map { it.id })
    }

    @Test
    fun `体积预算够大时一个都不丢`() {
        val list = listOf(conv("a", updatedAt = now), conv("b", updatedAt = now + 1))
        assertEquals(listOf("b", "a"), Conversations.prune(list).map { it.id })
    }

    @Test
    fun `单条超长文本会被截断`() {
        val clamped = Conversations.clampText("x".repeat(Conversations.MAX_ITEM_TEXT + 500))
        assertEquals(Conversations.MAX_ITEM_TEXT, clamped.length)
    }

    // ── 编解码 ──────────────────────────────────────────────────────────

    @Test
    fun `判别字段是 kind 而不是 type`() {
        val raw = Conversations.encode(listOf(conv(items = listOf(ChatItem.User("m1", "你好")))))
        assertTrue(raw.contains("\"kind\":\"user\""))
        assertFalse("不该出现 kotlinx 默认的 type", raw.contains("\"type\""))
    }

    @Test
    fun `四种内容都能往返`() {
        val items: List<ChatItem> = listOf(
            ChatItem.User("m1", "转账", thumb = "data:image/jpeg;base64,AA", imageName = "a.jpg"),
            ChatItem.Assistant("m2", "好的"),
            ChatItem.Tool("m3", "bank_transfer", "done", "已完成"),
            ChatItem.Notice("m4", "已取消", "error"),
        )
        val restored = Conversations.decode(Conversations.encode(listOf(conv(items = items))))
        assertEquals(items, restored.first().items)
    }

    @Test
    fun `坏存档读不出来当空 而不是崩`() {
        assertEquals(emptyList<StoredConversation>(), Conversations.decode("{不是数组"))
        assertEquals(emptyList<StoredConversation>(), Conversations.decode(""))
        assertEquals(emptyList<StoredConversation>(), Conversations.decode(null))
    }

    @Test
    fun `老存档里的多余字段不影响读取`() {
        val raw = """[{"id":"c1","title":"旧","createdAt":1,"updatedAt":2,"items":[],"brandNewField":42}]"""
        assertEquals(1, Conversations.decode(raw).size)
    }

    @Test
    fun `有 agentSessionId 的对话往返后仍然是它`() {
        val raw = Conversations.encode(listOf(conv(agentSessionId = "web-abc")))
        assertEquals("web-abc", Conversations.decode(raw).first().agentSessionId)
    }
}

/** 消息上的小动作：重新生成 / 编辑重发。 */
class MessageActionsTest {

    private fun items(): List<ChatItem> = listOf(
        ChatItem.User("u1", "查余额"),
        ChatItem.Assistant("a1", "余额 ¥128,640.55"),
        ChatItem.User("u2", "那转账呢"),
        ChatItem.Tool("t1", "bank_transfer", "done", "已完成"),
        ChatItem.Assistant("a2", "已受理"),
    )

    @Test
    fun `重新生成只挂在最后一条助手回复上`() {
        // 挂到中间那条上，重新生成就得把后面的几轮全丢掉——
        // 用户点的是"重说这一句"，代价却是删掉后面十分钟的对话
        assertEquals("a2", Conversations.lastAssistantId(items()))
    }

    @Test
    fun `没有助手回复时没有可重新生成的`() {
        assertEquals(null, Conversations.lastAssistantId(listOf(ChatItem.User("u1", "你好"))))
        assertEquals(null, Conversations.lastAssistantId(emptyList()))
    }

    @Test
    fun `助手回复要换算回产生它的那句提问`() {
        // 这个换算很容易漏，漏了的后果是按钮点了什么都不发生（静默失灵）
        assertEquals("u2", Conversations.promptOf(items(), "a2"))
        assertEquals("u1", Conversations.promptOf(items(), "a1"))
    }

    @Test
    fun `用户消息的提问就是它自己`() {
        assertEquals("u1", Conversations.promptOf(items(), "u1"))
    }

    @Test
    fun `工具行与通知没有对应的提问`() {
        // 它们上面不该有这些动作；真传进来也不能瞎给一个 id
        assertEquals(null, Conversations.promptOf(items(), "t1"))
        assertEquals(null, Conversations.promptOf(items(), "不存在"))
    }

    @Test
    fun `倒回到某条提问会丢掉它后面的一切`() {
        val kept = Conversations.rewindTo(items(), "u2")!!
        assertEquals(listOf("u1", "a1", "u2"), kept.map { it.id })
    }

    @Test
    fun `倒回时换文字`() {
        val kept = Conversations.rewindTo(items(), "u2", "那理财呢")!!
        assertEquals(3, kept.size)
        assertEquals("那理财呢", (kept.last() as ChatItem.User).text)
        // 前面那些一个字都不能动
        assertEquals("查余额", (kept[0] as ChatItem.User).text)
    }

    @Test
    fun `倒回到不是用户消息的位置会被拒`() {
        // 助手回复与工具行都不能作为倒回点
        assertEquals(null, Conversations.rewindTo(items(), "a2"))
        assertEquals(null, Conversations.rewindTo(items(), "t1"))
        assertEquals(null, Conversations.rewindTo(items(), "不存在"))
    }

    @Test
    fun `倒回到第一条就只剩这一条`() {
        val kept = Conversations.rewindTo(items(), "u1")!!
        assertEquals(listOf("u1"), kept.map { it.id })
    }
}
