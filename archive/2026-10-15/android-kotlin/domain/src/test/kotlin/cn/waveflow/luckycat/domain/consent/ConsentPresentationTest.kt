package cn.waveflow.luckycat.domain.consent

import cn.waveflow.luckycat.contract.Challenge
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConsentPresentationTest {

    private val now = 1_788_999_800_000L

    private fun challenge(json: String): Challenge {
        val obj = Json.parseToJsonElement(json).jsonObject
        return Challenge(obj)
    }

    private fun transfer(expiresInMs: Long = 60_000, verification: String? = "payment-password") = challenge(
        buildString {
            append("""{"challengeId":"c1","kind":"转账","fields":[""")
            append("""{"label":"收款人","value":"梁乐怡"},""")
            append("""{"label":"金额","value":"¥800.00","emphasis":true}]""")
            append(""","consequence":"确认后立即扣款，不可撤销"""")
            append(""","expiresAt":${now + expiresInMs}""")
            if (verification != null) append(""","verification":"$verification"""")
            append("}")
        }
    )

    @Test
    fun `展示字段一个不少地带出来`() {
        val view = ConsentPresentation.from(transfer(), now)
        assertEquals("转账", view.kind)
        assertEquals(2, view.fields.size)
        assertEquals("梁乐怡", view.fields[0].value)
        assertTrue(view.fields[1].emphasis)
        assertEquals("确认后立即扣款，不可撤销", view.consequence)
    }

    @Test
    fun `要密码的挑战 needsPassword 为真`() {
        assertTrue(ConsentPresentation.from(transfer(), now).needsPassword)
    }

    @Test
    fun `只读查询不要密码`() {
        // 查余额这类操作有确认、但不要求验证方式
        assertFalse(ConsentPresentation.from(transfer(verification = null), now).needsPassword)
    }

    @Test
    fun `没过期时倒计时按秒`() {
        val view = ConsentPresentation.from(transfer(expiresInMs = 45_000), now)
        assertFalse(view.expired)
        assertEquals(45L, view.secondsLeft)
        assertEquals("45 秒内有效", view.countdown)
    }

    @Test
    fun `过期后倒计时为 null`() {
        // 界面据此从"倒计时"切到"已超时"；返回 "0 秒内有效" 会让人以为还能点
        val view = ConsentPresentation.from(transfer(expiresInMs = -1_000), now)
        assertTrue(view.expired)
        assertNull(view.countdown)
    }

    @Test
    fun `刚好到期的那一刻仍算有效`() {
        // 与后端一致的边界：now == expiresAt 不算过期
        val view = ConsentPresentation.from(transfer(expiresInMs = 0), now)
        assertFalse(view.expired)
    }

    @Test
    fun `没有 expiresAt 时不判过期`() {
        val view = ConsentPresentation.from(challenge("""{"challengeId":"c1","kind":"转账"}"""), now)
        assertFalse("拿不到超时时刻就不该自己判过期", view.expired)
    }

    // ── 能不能提交 ──────────────────────────────────────────────────────

    @Test
    fun `过期后不能提交`() {
        val view = ConsentPresentation.from(transfer(expiresInMs = -1_000), now)
        assertFalse(ConsentPresentation.canSubmit(view, "123456"))
    }

    @Test
    fun `要密码时密码不能为空`() {
        val view = ConsentPresentation.from(transfer(), now)
        assertFalse(ConsentPresentation.canSubmit(view, ""))
        assertTrue(ConsentPresentation.canSubmit(view, "123456"))
    }

    @Test
    fun `不要密码时直接放行`() {
        val view = ConsentPresentation.from(transfer(verification = null), now)
        assertTrue(ConsentPresentation.canSubmit(view, ""))
    }

    @Test
    fun `401 表示密码错 要清空重输`() {
        // 桥接在密码错时**不结算**挑战，用户还有机会；不清空的话
        // 用户得自己删掉六个星号才能重输
        assertTrue(ConsentPresentation.shouldClearPasswordAfterFailure(401))
    }

    @Test
    fun `其它错误码不清空密码`() {
        // 404（挑战已过期/已经被处理）与网络错误都不该把用户输的密码抹掉
        assertFalse(ConsentPresentation.shouldClearPasswordAfterFailure(404))
        assertFalse(ConsentPresentation.shouldClearPasswordAfterFailure(500))
    }
}
