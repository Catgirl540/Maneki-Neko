package cn.waveflow.luckycat.domain.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountOpeningTest {
    @Test fun 密码必须为六到二十位() {
        assertFalse(AccountOpening.isValidPassword("12345"))
        assertTrue(AccountOpening.isValidPassword("123456"))
        assertTrue(AccountOpening.isValidPassword("a".repeat(20)))
        assertFalse(AccountOpening.isValidPassword("a".repeat(21)))
    }

    @Test fun 证件校验() {
        assertTrue(AccountOpening.isValidIdNumber("310101199001011234"))
        assertFalse(AccountOpening.isValidIdNumber("310101"))
    }

    @Test fun 确认密码不同时不能提交() {
        val draft = complete().copy(confirmPassword = "654321")
        assertEquals("两次输入的密码不一致", draft.firstProblem())
        assertFalse(draft.canSubmit)
    }

    @Test fun 所有核身与确认完成才能提交() {
        val draft = complete()
        assertNull(draft.firstProblem())
        assertTrue(draft.canSubmit)
        assertEquals("请先完成人脸核身", draft.copy(faceTicket = "").firstProblem())
        assertEquals("请阅读并勾选开户承诺", draft.copy(pledged = false).firstProblem())
        assertEquals("请核对并确认开户信息", draft.copy(confirmed = false).firstProblem())
    }

    @Test fun 脱敏文案不泄露完整信息() {
        assertEquals("138****8000", AccountOpening.maskPhone("13800138000"))
        assertEquals("310***********1234", AccountOpening.maskId("310101199001011234"))
    }

    private fun complete() = AccountOpeningDraft(
        phone = "13800138000",
        password = "123456",
        confirmPassword = "123456",
        holderName = "林小满",
        idNumber = "310101199001011234",
        smsCode = "285276",
        faceTicket = "face.ticket",
        pledged = true,
        confirmed = true,
    )
}
