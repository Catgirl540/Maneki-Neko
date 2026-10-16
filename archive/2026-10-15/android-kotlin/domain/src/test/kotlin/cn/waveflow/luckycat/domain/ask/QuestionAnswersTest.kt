package cn.waveflow.luckycat.domain.ask

import cn.waveflow.luckycat.contract.QuestionItem
import cn.waveflow.luckycat.contract.QuestionSet
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionAnswersTest {

    private val single = QuestionItem(
        id = "q1",
        question = "要转给谁？",
        header = "收款人",
        options = listOf("梁乐怡", "陈嘉禾"),
        multiSelect = false,
    )

    private val multi = single.copy(id = "q2", question = "选几个用途", multiSelect = true)

    private fun set(vararg items: QuestionItem, expiresAt: Long? = null) =
        QuestionSet(questionId = "ask_1", items = items.toList(), expiresAt = expiresAt)

    // ── 单选 vs 多选 ────────────────────────────────────────────────────

    @Test
    fun `单选是替换不是追加`() {
        // 追加会让 selected 有多个元素，而单选超过一个桥接直接 400
        var draft = QuestionDraft()
        draft = QuestionAnswers.toggle(single, draft, "梁乐怡")
        draft = QuestionAnswers.toggle(single, draft, "陈嘉禾")
        assertEquals(listOf("陈嘉禾"), draft.selected)
    }

    @Test
    fun `单选再点已选中的保持选中`() {
        // 取消选中会让"已答"变成"未答"，用户会莫名其妙点不动提交按钮
        var draft = QuestionDraft()
        draft = QuestionAnswers.toggle(single, draft, "梁乐怡")
        draft = QuestionAnswers.toggle(single, draft, "梁乐怡")
        assertEquals(listOf("梁乐怡"), draft.selected)
    }

    @Test
    fun `多选是切换`() {
        var draft = QuestionDraft()
        draft = QuestionAnswers.toggle(multi, draft, "A")
        draft = QuestionAnswers.toggle(multi, draft, "B")
        assertEquals(listOf("A", "B"), draft.selected)
        draft = QuestionAnswers.toggle(multi, draft, "A")
        assertEquals(listOf("B"), draft.selected)
    }

    @Test
    fun `多选题一个都不选可以清空`() {
        var draft = QuestionDraft()
        draft = QuestionAnswers.toggle(multi, draft, "A")
        draft = QuestionAnswers.toggle(multi, draft, "A")
        assertTrue(draft.selected.isEmpty())
        assertFalse(QuestionAnswers.isAnswered(draft))
    }

    // ── 答没答 ──────────────────────────────────────────────────────────

    @Test
    fun `没选也没写就是没答`() {
        assertFalse(QuestionAnswers.isAnswered(null))
        assertFalse(QuestionAnswers.isAnswered(QuestionDraft()))
    }

    @Test
    fun `选了算答 写了也算答`() {
        assertTrue(QuestionAnswers.isAnswered(QuestionDraft(selected = listOf("A"))))
        assertTrue(QuestionAnswers.isAnswered(QuestionDraft(custom = "自己写")))
    }

    @Test
    fun `只有空白的自写文字不算答`() {
        assertFalse(QuestionAnswers.isAnswered(QuestionDraft(custom = "   \n ")))
    }

    // ── 每题必答 ────────────────────────────────────────────────────────

    @Test
    fun `只要有一题没答就不能提交`() {
        val two = set(single, multi)
        val onlyFirst = mapOf("q1" to QuestionDraft(selected = listOf("梁乐怡")))
        assertFalse(QuestionAnswers.canSubmit(two, onlyFirst))
        val both = onlyFirst + mapOf("q2" to QuestionDraft(selected = listOf("A")))
        assertTrue(QuestionAnswers.canSubmit(two, both))
    }

    @Test
    fun `没有题的提问不算可提交`() {
        // items 为空时 all{} 会返回 true —— 那种卡片刻意不让提交
        assertTrue(QuestionAnswers.canSubmit(set(), emptyMap()))
    }

    // ── 答复体 ──────────────────────────────────────────────────────────

    @Test
    fun `答复体形状是 answers 数组`() {
        val json = QuestionAnswers.toJson(
            set(single),
            mapOf("q1" to QuestionDraft(selected = listOf("梁乐怡"), custom = "备注")),
        )
        val rows = json.answersOf()
        assertEquals(1, rows.size)
        assertEquals("q1", rows[0].first)
        assertEquals(listOf("梁乐怡"), rows[0].second)
        assertEquals("备注", rows[0].third)
    }

    @Test
    fun `自写空白时不带 custom 字段`() {
        // 带一个空串过去，插件侧的 parseAnswer 会当成"用户写了空答案"
        val json = QuestionAnswers.toJson(set(single), mapOf("q1" to QuestionDraft(selected = listOf("A"), custom = "   ")))
        assertEquals(null, json.answersOf()[0].third)
    }

    @Test
    fun `没答的题也会出现在答复体里`() {
        // 桥接要求每题都有答复；漏掉一题回 400
        val json = QuestionAnswers.toJson(set(single, multi), mapOf("q1" to QuestionDraft(selected = listOf("A"))))
        assertEquals(listOf("q1", "q2"), json.answersOf().map { it.first })
        assertTrue(json.answersOf()[1].second.isEmpty())
    }

    @Test
    fun `自写文字会被 trim`() {
        val json = QuestionAnswers.toJson(set(single), mapOf("q1" to QuestionDraft(custom = "  自己写  ")))
        assertEquals("自己写", json.answersOf()[0].third)
    }

    // ── 超时与标题 ──────────────────────────────────────────────────────

    @Test
    fun `过期判定与挑战同一口径`() {
        val s = set(single, expiresAt = 1_000)
        assertFalse(QuestionAnswers.isExpired(s, now = 1_000))
        assertTrue(QuestionAnswers.isExpired(s, now = 1_001))
        assertFalse("没有 expiresAt 就不该自己判过期", QuestionAnswers.isExpired(set(single), now = Long.MAX_VALUE))
    }

    @Test
    fun `标题写几件事`() {
        assertEquals("需要你确认 1 件事", QuestionAnswers.title(set(single)))
        assertEquals("需要你确认 2 件事", QuestionAnswers.title(set(single, multi)))
    }
}
