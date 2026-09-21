package cn.waveflow.luckycat

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import cn.waveflow.luckycat.contract.ConsentField
import cn.waveflow.luckycat.contract.QuestionItem
import cn.waveflow.luckycat.contract.QuestionSet
import cn.waveflow.luckycat.domain.ask.QuestionDraft
import cn.waveflow.luckycat.domain.consent.ConsentView
import cn.waveflow.luckycat.ui.chat.ConsentCardView
import cn.waveflow.luckycat.ui.chat.QuestionCardView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * 确认卡片与提问卡片的界面规矩。
 *
 * 这些是**安全不变量**，不是样式：少了密码框、过期还能点、单选能多选，
 * 都是真实的问题。用纯 Compose 测试（不联网、不起后端）钉住，
 * 所以它们既快又不会因为上游抖动变红。
 */
class CardsTest {

    @get:Rule
    val rule = createComposeRule()

    private fun view(
        needsPassword: Boolean = true,
        expired: Boolean = false,
        fields: List<ConsentField> = listOf(
            ConsentField("收款人", "梁乐怡", false),
            ConsentField("金额", "¥800.00", true),
        ),
    ) = ConsentView(
        challengeId = "c1",
        kind = "转账",
        fields = fields,
        consequence = "确认后立即扣款，不可撤销",
        needsPassword = needsPassword,
        secondsLeft = if (expired) 0 else 45,
        expired = expired,
    )

    // ── 确认卡片：展示信息 ──────────────────────────────────────────────

    @Test
    fun 确认卡片逐条展示交易信息() {
        rule.setContent { ConsentCardView(view()) { _, _, _ -> } }
        // 「展示交易信息」是硬要求：每一行都要在界面上找得到
        rule.onNodeWithTag("consent-field-收款人").assertExists()
        rule.onNodeWithTag("consent-field-金额").assertExists()
    }

    @Test
    fun 没有展示字段时明确说明而不是装作没事() {
        rule.setContent { ConsentCardView(view(fields = emptyList())) { _, _, _ -> } }
        rule.onNodeWithTag("consent-no-fields").assertExists()
    }

    // ── 确认卡片：密码 ──────────────────────────────────────────────────

    @Test
    fun 需要验证时才出现密码框() {
        rule.setContent { ConsentCardView(view(needsPassword = true)) { _, _, _ -> } }
        rule.onNodeWithTag("consent-password").assertExists()
    }

    @Test
    fun 只读查询不出现密码框() {
        // 查余额这类操作有确认、不要求身份验证，弹密码框是多余的阻碍
        rule.setContent { ConsentCardView(view(needsPassword = false)) { _, _, _ -> } }
        rule.onNodeWithTag("consent-password").assertDoesNotExist()
    }

    @Test
    fun 需要密码时密码为空则不能确认() {
        rule.setContent { ConsentCardView(view()) { _, _, _ -> } }
        rule.onNodeWithTag("consent-approve").assertIsNotEnabled()
        rule.onNodeWithTag("consent-password").performTextInput("123456")
        rule.onNodeWithTag("consent-approve").assertIsEnabled()
    }

    @Test
    fun 不需要密码时直接可以确认() {
        rule.setContent { ConsentCardView(view(needsPassword = false)) { _, _, _ -> } }
        rule.onNodeWithTag("consent-approve").assertIsEnabled()
    }

    // ── 确认卡片：过期 ──────────────────────────────────────────────────

    @Test
    fun 过期后两个按钮都点不动() {
        rule.setContent { ConsentCardView(view(expired = true)) { _, _, _ -> } }
        rule.onNodeWithTag("consent-approve").assertIsNotEnabled()
        rule.onNodeWithTag("consent-reject").assertIsNotEnabled()
    }

    @Test
    fun 过期后显示已超时而不是倒计时() {
        rule.setContent { ConsentCardView(view(expired = true)) { _, _, _ -> } }
        rule.onNodeWithTag("consent-countdown").assertExists()
        // 文案断言放在这里是有意的：过期时显示"0 秒内有效"会让人以为还能点。
        // **必须给 substring = true**：这个 API 的 substring 默认是 false，
        // 也就是要求整串相等——不给的话 "已超时，请让助手重新发起" 不匹配 "已超时"。
        rule.onNodeWithTag("consent-countdown").assertTextContains("已超时", substring = true)
    }

    // ── 确认卡片：密码错 ────────────────────────────────────────────────

    @Test
    fun 密码错时清空密码并保留卡片等待重输() {
        var calls = 0
        rule.setContent {
            ConsentCardView(view()) { approve, password, onResult ->
                calls += 1
                assertEquals(true, approve)
                assertEquals("123456", password)
                // 桥接在密码错时**不结算**挑战
                onResult(true, "支付密码不正确")
            }
        }
        rule.onNodeWithTag("consent-password").performTextInput("123456")
        rule.onNodeWithTag("consent-approve").performClick()
        rule.waitForIdle()

        assertEquals(1, calls)
        // 卡片还在（没被收起来），提示在，而且密码框已清空、确认按钮重新变灰
        rule.onNodeWithTag("consent-card").assertExists()
        rule.onNodeWithTag("consent-message").assertExists()
        rule.onNodeWithTag("consent-approve").assertIsNotEnabled()
    }

    @Test
    fun 取消时不带密码() {
        var password: String? = "还没调用"
        var approve: Boolean? = null
        rule.setContent {
            ConsentCardView(view()) { ok, pwd, onResult ->
                approve = ok
                password = pwd
                onResult(false, null)
            }
        }
        rule.onNodeWithTag("consent-reject").performClick()
        rule.waitForIdle()
        assertEquals(false, approve)
        assertEquals("取消不该把密码一起送出去", "", password)
    }

    // ── 提问卡片 ────────────────────────────────────────────────────────

    private val single = QuestionItem("q1", "要转给谁？", "收款人", listOf("梁乐怡", "陈嘉禾"), false)
    private val multi = QuestionItem("q2", "用途", null, listOf("房租", "生活费"), true)

    @Test
    fun 每题都答了才能提交() {
        var submitted: Map<String, QuestionDraft>? = null
        rule.setContent { QuestionCardView(QuestionSet("ask_1", listOf(single, multi), null)) { submitted = it } }

        rule.onNodeWithTag("question-submit").assertIsNotEnabled()
        rule.onNodeWithTag("option-q1-梁乐怡").performClick()
        rule.onNodeWithTag("question-submit").assertIsNotEnabled()   // 第二题还没答
        rule.onNodeWithTag("option-q2-房租").performClick()
        rule.onNodeWithTag("question-submit").assertIsEnabled()
        rule.onNodeWithTag("question-submit").performClick()
        rule.waitForIdle()

        assertEquals(listOf("梁乐怡"), submitted!!["q1"]!!.selected)
        assertEquals(listOf("房租"), submitted!!["q2"]!!.selected)
    }

    @Test
    fun 单选点第二个会替换而不是追加() {
        var submitted: Map<String, QuestionDraft>? = null
        rule.setContent { QuestionCardView(QuestionSet("ask_1", listOf(single), null)) { submitted = it } }
        rule.onNodeWithTag("option-q1-梁乐怡").performClick()
        rule.onNodeWithTag("option-q1-陈嘉禾").performClick()
        rule.onNodeWithTag("question-submit").performClick()
        rule.waitForIdle()
        // 单选收到两个选项，桥接会直接 400
        assertEquals(listOf("陈嘉禾"), submitted!!["q1"]!!.selected)
    }

    @Test
    fun 多选可以选好几个() {
        var submitted: Map<String, QuestionDraft>? = null
        rule.setContent { QuestionCardView(QuestionSet("ask_1", listOf(multi), null)) { submitted = it } }
        rule.onNodeWithTag("option-q2-房租").performClick()
        rule.onNodeWithTag("option-q2-生活费").performClick()
        rule.onNodeWithTag("question-submit").performClick()
        rule.waitForIdle()
        assertEquals(listOf("房租", "生活费"), submitted!!["q2"]!!.selected)
    }

    @Test
    fun 自己写也算答了() {
        var submitted: Map<String, QuestionDraft>? = null
        rule.setContent { QuestionCardView(QuestionSet("ask_1", listOf(single), null)) { submitted = it } }
        rule.onNodeWithTag("custom-q1").performTextInput("转给王小明")
        rule.onNodeWithTag("question-submit").assertIsEnabled()
        rule.onNodeWithTag("question-submit").performClick()
        rule.waitForIdle()
        assertTrue(submitted!!["q1"]!!.custom.isNotEmpty())
    }
}
