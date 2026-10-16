package cn.waveflow.luckycat.domain.time

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.util.TimeZone

/**
 * 时间格式的断言。
 *
 * 固定时区为 Asia/Shanghai：这组用例的意义正是"UTC → 本地"这一步有没有做，
 * 跟着跑测机器的时区走就测不出东西了。
 */
class DatesTest {

    private lateinit var original: TimeZone

    @Before
    fun pinZone() {
        original = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
    }

    @After
    fun restoreZone() {
        TimeZone.setDefault(original)
    }

    @Test
    fun `带 Z 的 UTC 会转成本地时间`() {
        // 08:12Z 在上海是 16:12
        assertEquals("2026-09-20 16:12", Dates.dateTime("2026-09-20T08:12:00Z"))
    }

    @Test
    fun `带偏移的直接按它算`() {
        assertEquals("2026-09-20 08:12", Dates.dateTime("2026-09-20T08:12:00+08:00"))
    }

    @Test
    fun `不带时区的当本地时间`() {
        assertEquals("2026-09-20 08:12", Dates.dateTime("2026-09-20T08:12:00"))
    }

    @Test
    fun `回单格式到秒`() {
        assertEquals("2026-09-20 16:12:33", Dates.dateTimeFull("2026-09-20T08:12:33Z"))
    }

    @Test
    fun `日期与月日`() {
        assertEquals("2026-09-20", Dates.date("2026-09-20T08:12:00Z"))
        assertEquals("9月20日", Dates.monthDay("2026-09-20T08:12:00Z"))
    }

    @Test
    fun `月日不补零`() {
        // 网页版是 `9月20日` 不是 `09月20日`
        assertEquals("9月5日", Dates.monthDay("2026-09-05T08:12:00Z"))
    }

    @Test
    fun `解析不出来时原样返回而不是显示占位符`() {
        // 显示原始串才知道后端给了什么；显示 "—" 等于把线索扔了
        assertEquals("不是时间", Dates.dateTime("不是时间"))
        assertEquals("", Dates.dateTime(""))
    }

    @Test
    fun `parse 对三种形态都能给出结果`() {
        assertNotNull(Dates.parse("2026-09-20T08:12:00Z"))
        assertNotNull(Dates.parse("2026-09-20T08:12:00+08:00"))
        assertNotNull(Dates.parse("2026-09-20T08:12:00"))
        assertNull(Dates.parse("2026-09-20"))  // 只有日期，没实现这一种
    }
}
