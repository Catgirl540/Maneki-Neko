package cn.waveflow.luckycat.domain.phone

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneRulesTest {

    @Test
    fun `发码要求 1 开头且第二位 3 到 9`() {
        assertTrue(PhoneRules.canRequestSms("13800138000"))
        assertTrue(PhoneRules.canRequestSms("19912345678"))
        // 第二位是 2 —— 后端会拒
        assertFalse(PhoneRules.canRequestSms("12800138000"))
        // 10 位
        assertFalse(PhoneRules.canRequestSms("1380013800"))
    }

    @Test
    fun `发码忽略分隔符`() {
        assertTrue(PhoneRules.canRequestSms("138 0013 8000"))
        assertTrue(PhoneRules.canRequestSms("138-0013-8000"))
    }

    @Test
    fun `登录比发码宽`() {
        // 第二位是 2：发码按钮点不动，但登录按钮可以点（后端 login 就是这么宽的）
        assertFalse(PhoneRules.canRequestSms("12800138000"))
        assertTrue(PhoneRules.canSubmitLogin("12800138000", "123456", "285276"))
    }

    @Test
    fun `登录要求密码非空 验证码六位`() {
        assertFalse(PhoneRules.canSubmitLogin("13800138000", "", "285276"))
        assertFalse(PhoneRules.canSubmitLogin("13800138000", "123456", "2852"))
        assertTrue(PhoneRules.canSubmitLogin("13800138000", "123456", "285276"))
    }

    @Test
    fun `登录不做 digitsOnly 因为与后端一致`() {
        // 后端 login 直接拿整串去匹配 \d{11}，带空格的会被拒。
        // 客户端跟着它，免得"按钮能点但请求必失败"。
        assertFalse(PhoneRules.canSubmitLogin("138 0013 8000", "123456", "285276"))
    }

    @Test
    fun `验证码里的非数字会被忽略后再数长度`() {
        assertTrue(PhoneRules.canSubmitLogin("13800138000", "123456", "285 276"))
    }
}
