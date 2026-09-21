package cn.waveflow.luckycat.domain.image

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageRulesTest {

    @Test
    fun `四种类型都认`() {
        listOf("image/png", "image/jpeg", "image/webp", "image/gif").forEach {
            assertEquals(ImageRules.Verdict.Ok, ImageRules.checkSource(it, 1000))
        }
    }

    @Test
    fun `不认识的类型被拒`() {
        // SVG 尤其危险：它里面可以带脚本。服务端也不认它
        assertTrue(ImageRules.checkSource("image/svg+xml", 1000) is ImageRules.Verdict.UnsupportedType)
        assertTrue(ImageRules.checkSource("application/pdf", 1000) is ImageRules.Verdict.UnsupportedType)
    }

    @Test
    fun `类型大小写不敏感`() {
        assertEquals(ImageRules.Verdict.Ok, ImageRules.checkSource("IMAGE/PNG", 1000))
    }

    @Test
    fun `没有类型时不在这一层拒`() {
        // 有些来源不带 type，调用方按扩展名猜完再来问
        assertEquals(ImageRules.Verdict.Ok, ImageRules.checkSource("", 1000))
    }

    @Test
    fun `来源上限比发送上限大得多`() {
        // 相册里一张 20MB 的原图是正常的，不该拦——先压缩再发
        assertTrue(ImageRules.MAX_SOURCE_BYTES > ImageRules.MAX_SEND_BYTES * 2)
        assertEquals(ImageRules.Verdict.Ok, ImageRules.checkSource("image/jpeg", 15L * 1024 * 1024))
    }

    @Test
    fun `超过来源上限被拒`() {
        val verdict = ImageRules.checkSource("image/jpeg", 21L * 1024 * 1024)
        assertTrue(verdict is ImageRules.Verdict.TooLarge)
    }

    @Test
    fun `压缩之后的图还要再拦一次`() {
        // 压缩有极限：20MB 的 PNG 压到 1600px 仍可能超过 6MB。
        // 不在这儿再拦，就变成"上传到一半被服务端 413"。
        assertTrue(ImageRules.checkPayload("image/png", 7L * 1024 * 1024) is ImageRules.Verdict.TooLarge)
        assertEquals(ImageRules.Verdict.Ok, ImageRules.checkPayload("image/png", 5L * 1024 * 1024))
    }

    @Test
    fun `恰好等于上限算通过`() {
        assertEquals(ImageRules.Verdict.Ok, ImageRules.checkPayload("image/jpeg", ImageRules.MAX_SEND_BYTES.toLong()))
        assertEquals(ImageRules.Verdict.Ok, ImageRules.checkSource("image/jpeg", ImageRules.MAX_SOURCE_BYTES.toLong()))
    }

    @Test
    fun `错误提示要说清是多大`() {
        val message = ImageRules.message(ImageRules.Verdict.TooLarge(21L * 1024 * 1024))
        assertTrue("要说清实际大小：$message", message!!.contains("21MB"))
    }

    @Test
    fun `没问题时不产生提示`() {
        assertNull(ImageRules.message(ImageRules.Verdict.Ok))
    }

    @Test
    fun `按扩展名猜类型`() {
        assertEquals("image/png", ImageRules.guessMimeFromName("账单.PNG"))
        assertEquals("image/jpeg", ImageRules.guessMimeFromName("a.jpeg"))
        assertEquals("image/webp", ImageRules.guessMimeFromName("a.webp"))
        assertEquals("", ImageRules.guessMimeFromName("a.txt"))
    }
}
