package cn.waveflow.luckycat.domain.cards

import cn.waveflow.luckycat.contract.bank.MailingAddress
import org.junit.Assert.*
import org.junit.Test

class CardRulesTest {
    private val address = MailingAddress("林小满", "13800138000", "上海市", "上海市", "测试路 100 号", "200000")
    @Test fun addressValidation() {
        assertNull(CardRules.addressError(address))
        assertNull(CardRules.addressError(address.copy(postalCode = "")))
        assertNotNull(CardRules.addressError(address.copy(recipient = " ")))
        assertNotNull(CardRules.addressError(address.copy(phone = "123")))
        assertNotNull(CardRules.addressError(address.copy(detail = "短")))
        assertNotNull(CardRules.addressError(address.copy(postalCode = "20000x")))
        assertEquals("13800138000", CardRules.normalize(address.copy(phone = "138 0013 8000")).phone)
    }
    @Test fun statusRules() {
        assertTrue(CardRules.canLock("active")); assertTrue(CardRules.canLock("locked"))
        assertFalse(CardRules.canLock("pending")); assertFalse(CardRules.canLock("replaced"))
        assertFalse(CardRules.canPay("locked")); assertFalse(CardRules.canPay("pending"))
        assertFalse(CardRules.canReveal("pending")); assertFalse(CardRules.canReveal("replaced"))
        assertTrue(CardRules.canReveal("locked")); assertFalse(CardRules.canReplace("replaced"))
        assertFalse(CardRules.canPay("unknown")); assertFalse(CardRules.canReplace("unknown"))
    }
    @Test fun passwordAndCents() {
        assertTrue(CardRules.validPassword("123456")); assertFalse(CardRules.validPassword("12345"))
        assertFalse(CardRules.validPassword("１２３４５６")); assertFalse(CardRules.validPassword("abcdef"))
        assertEquals(listOf(200_000L, 500_000L, 1_000_000L, 5_000_000L), CardRules.dailyLimits)
    }
}
