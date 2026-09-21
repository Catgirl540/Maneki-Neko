package cn.waveflow.luckycat.domain.money

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 金额格式的断言。这些值都是照着**网页版 `format.ts` 的实际输出**定的，
 * 不是"我觉得应该是这样"。
 */
class MoneyTest {

    @Test
    fun `整数金额补两位小数`() {
        assertEquals("1,000.00", Money.amount(100_000))
    }

    @Test
    fun `千分位用逗号`() {
        assertEquals("128,640.55", Money.amount(12_864_055))
    }

    @Test
    fun `零与一分`() {
        assertEquals("0.00", Money.amount(0))
        assertEquals("0.01", Money.amount(1))
    }

    @Test
    fun `负数取绝对值 符号由调用方给`() {
        // 列表里的支出是 -4500 分，但显示成 "45.00"（方向由颜色/前缀表达）
        assertEquals("45.00", Money.amount(-4_500))
    }

    @Test
    fun `带币种符号`() {
        assertEquals("¥128,640.55", Money.money(12_864_055))
    }

    @Test
    fun `带符号的写法 符号在最前面`() {
        assertEquals("+¥45.00", Money.moneySigned(4_500))
        assertEquals("-¥45.00", Money.moneySigned(-4_500))
    }

    @Test
    fun `零在带符号写法里是正号`() {
        // 网页版用的是 `cents < 0 ? '-' : '+'`，所以 0 走加号
        assertEquals("+¥0.00", Money.moneySigned(0))
    }

    @Test
    fun `按币种取符号`() {
        assertEquals("HK$1,088.52", Money.currency(108_852, "HKD"))
        assertEquals("US$5.00", Money.currency(500, "USD"))
        assertEquals("¥5.00", Money.currency(500, "CNY"))
    }

    @Test
    fun `不认识的币种退回代码本身`() {
        // 宁可显示 "SGD 5.00" 也不要显示成 ¥ —— 后者是**错的**金额
        assertEquals("SGD5.00", Money.currency(500, "SGD"))
    }

    @Test
    fun `利率按百分数显示`() {
        assertEquals("1.55%", Money.rate(0.0155))
        assertEquals("0.3%", Money.rate(0.003))
        assertEquals("0%", Money.rate(0.0))
    }

    @Test
    fun `大额不丢精度`() {
        // 用 BigDecimal 的意义：92233720368547758.07 分这种量级也不能出现
        // "9.223372036854776E16" 这种浮点写法
        assertEquals("92,233,720,368,547,758.07", Money.amount(9_223_372_036_854_775_807L))
    }

    @Test
    fun `格式化结果不跟随系统区域`() {
        // 这条是"固定用 Locale.US 的 DecimalFormatSymbols"的意义：
        // 用户把系统语言换成德语时，逗号与点不能对调。
        val previous = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY)
            assertEquals("1,234.56", Money.amount(123_456))
        } finally {
            java.util.Locale.setDefault(previous)
        }
    }
}

/** 元 → 分。金额解析错了就是转错钱，所以这一组写得比较细。 */
class MoneyParseTest {

    @Test
    fun `整数元`() {
        assertEquals(80_000L, Money.parseToCents("800"))
    }

    @Test
    fun `两位小数`() {
        assertEquals(80_050L, Money.parseToCents("800.50"))
    }

    @Test
    fun `一位小数按角算`() {
        assertEquals(80_050L, Money.parseToCents("800.5"))
    }

    @Test
    fun `千分位逗号会被去掉`() {
        assertEquals(123_456L, Money.parseToCents("1,234.56"))
    }

    @Test
    fun `全角数字也能认`() {
        assertEquals(80_000L, Money.parseToCents("８００"))
    }

    @Test
    fun `带元字后缀也能认`() {
        assertEquals(80_000L, Money.parseToCents("800元"))
    }

    @Test
    fun `超过两位小数判为无效 而不是四舍五入`() {
        // 静默把 800.555 变成 800.56 是在替用户改金额
        assertEquals(null, Money.parseToCents("800.555"))
    }

    @Test
    fun `零与负数无效`() {
        assertEquals(null, Money.parseToCents("0"))
        assertEquals(null, Money.parseToCents("0.00"))
        assertEquals(null, Money.parseToCents("-5"))
    }

    @Test
    fun `空与乱输无效`() {
        assertEquals(null, Money.parseToCents(""))
        assertEquals(null, Money.parseToCents("   "))
        assertEquals(null, Money.parseToCents("abc"))
        assertEquals(null, Money.parseToCents("8.0.0"))
        assertEquals(null, Money.parseToCents("."))
    }

    @Test
    fun `不会出现浮点少一分钱`() {
        // toDouble() * 100 在 8.7 上会给出 869.9999…，取整就少一分
        assertEquals(870L, Money.parseToCents("8.7"))
        assertEquals(2_030L, Money.parseToCents("20.30"))
        assertEquals(1_145_786L, Money.parseToCents("11457.86"))
    }
}
