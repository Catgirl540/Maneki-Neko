package com.moneymeow.bank

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * 身份码的约定：手机 A 编码出来的内容，手机 B 必须能原样解回同一个人。
 *
 * 这里覆盖两段容易悄悄坏掉的地方：JSON 里的中文与转义，以及 zxing 编出来的位图能不能再被自己的解码器读回来。
 * 解码器同时用于相机帧和相册截图，所以位图往返能过，就等于两条入口走的是同一套规则。
 */
class MemberQrTest {
    @Test fun payloadRoundTripsThroughJson() {
        val original = SplitIdentity("张三", phone = "13800138000")
        assertEquals(original, MemberQr.parse(MemberQr.encode(original)))
    }

    @Test fun payloadKeepsBothPhoneAndAccount() {
        val original = SplitIdentity("李四", phone = "13900139000", accountNo = "6222020200112233445")
        val decoded = MemberQr.parse(MemberQr.encode(original))
        assertEquals("李四", decoded.name)
        assertEquals("13900139000", decoded.phone)
        assertEquals("6222020200112233445", decoded.accountNo)
    }

    @Test fun accountOnlyMemberIsAccepted() {
        val original = SplitIdentity("王五", accountNo = "6222020200112233")
        assertEquals(original, MemberQr.parse(MemberQr.encode(original)))
    }

    @Test fun foreignOrBrokenCodesAreRejected() {
        // 别的应用的二维码、版本不对的码、缺身份的码，都不能被当成收款人。
        assertThrows(IllegalArgumentException::class.java) { MemberQr.parse("https://example.com/pay") }
        assertThrows(IllegalArgumentException::class.java) { MemberQr.parse("""{"t":"other.app","n":"张三","p":"13800138000"}""") }
        assertThrows(IllegalArgumentException::class.java) { MemberQr.parse("""{"t":"luckycat.aa.v1","n":"张三"}""") }
        assertThrows(IllegalArgumentException::class.java) { MemberQr.parse("""{"t":"luckycat.aa.v1","n":"张三","p":"12345"}""") }
        assertThrows(IllegalArgumentException::class.java) { MemberQr.parse("""{"t":"luckycat.aa.v1","p":"13800138000"}""") }
        // 超长内容直接挡掉，不给解码器喂一兆的字符串。
        assertThrows(IllegalArgumentException::class.java) { MemberQr.parse("x".repeat(401)) }
    }

    @Test fun encodedBitmapDecodesBackToTheSamePerson() {
        val original = SplitIdentity("赵六", phone = "13700137000")
        val bitmap = MemberQr.bitmap(original, size = 640)
        assertEquals(640, bitmap.width)
        val text = MemberQr.decodeBitmap(bitmap)
        assertEquals(MemberQr.encode(original), text)
        assertEquals(original, MemberQr.parse(requireNotNull(text)))
    }

    @Test fun blankImageHasNoCode() {
        val blank = android.graphics.Bitmap.createBitmap(200, 200, android.graphics.Bitmap.Config.ARGB_8888)
        assertNull(MemberQr.decodeBitmap(blank))
    }
}
