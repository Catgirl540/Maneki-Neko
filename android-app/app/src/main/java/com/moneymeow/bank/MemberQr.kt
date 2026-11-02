package com.moneymeow.bank

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.MultiFormatWriter
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.json.JSONObject

/**
 * 「扫码加成员」用的身份码。
 *
 * 二维码里只放**这位付款人的身份**（姓名 + 手机号或本行账号），不放金额、不放收款指令：
 * 扫码只是把对方填进参与者表，真正发起 AA 时金额与成员仍由发起人在本机核对、服务端再校验一次
 * （`server/aa-payments.mjs`）。所以扫到伪造的码最多是填错一行表单，不会凭空生成扣款。
 *
 * 格式：`{"t":"luckycat.aa.v1","n":"张三","p":"13800138000","a":"6222..."}`。
 * 用 JSON 而不是自定义分隔符，是为了让姓名里的任何字符都不需要转义规则，`JSONObject` 兜住。
 */
internal object MemberQr {
    private const val TYPE = "luckycat.aa.v1"
    /** 整段二维码内容的长度上限：正常内容不到 100 字节，超过说明不是我们发的码。 */
    private const val PAYLOAD_MAX = 400
    private val PHONE = Regex("1[3-9]\\d{9}")
    private val ACCOUNT = Regex("\\d{12,19}")

    /** 校验并拼出二维码内容；这里和 [parse] 用同一套规则，扫进来的码不会被本机放过一个坏身份。 */
    fun encode(member: SplitIdentity): String {
        val name = member.name.trim()
        val phone = member.phone.filter(Char::isDigit)
        val account = member.accountNo.filter(Char::isDigit)
        require(name.isNotEmpty()) { "请先填写姓名" }
        require(name.length <= 40) { "姓名最多 40 个字" }
        require(phone.isEmpty() || phone.matches(PHONE)) { "手机号须为 11 位" }
        require(account.isEmpty() || account.matches(ACCOUNT)) { "账号须为 12 至 19 位数字" }
        require(phone.isNotEmpty() || account.isNotEmpty()) { "请先填写手机号或本行账号" }
        return JSONObject().put("t", TYPE).put("n", name).apply {
            if (phone.isNotEmpty()) put("p", phone)
            if (account.isNotEmpty()) put("a", account)
        }.toString()
    }

    /** 解析扫到的内容；不是本应用的码时抛异常，由调用方提示「不是招财猫的身份码」。 */
    fun parse(text: String): SplitIdentity {
        require(text.length <= PAYLOAD_MAX) { "二维码内容过长" }
        val json = runCatching { JSONObject(text) }.getOrElse { throw IllegalArgumentException("这个二维码不是招财猫的身份码") }
        require(json.optString("t") == TYPE) { "这个二维码不是招财猫的身份码" }
        val name = json.optString("n").trim()
        val phone = json.optString("p").filter(Char::isDigit)
        val account = json.optString("a").filter(Char::isDigit)
        require(name.isNotEmpty()) { "身份码里没有姓名" }
        require(name.length <= 40) { "身份码里的姓名过长" }
        require(phone.isEmpty() || phone.matches(PHONE)) { "身份码里的手机号无效" }
        require(account.isEmpty() || account.matches(ACCOUNT)) { "身份码里的账号无效" }
        require(phone.isNotEmpty() || account.isNotEmpty()) { "身份码里没有手机号或账号" }
        return SplitIdentity(name, phone = phone, accountNo = account)
    }

    /** 生成二维码位图；`size` 是边长像素，界面按 dp 缩放显示。 */
    fun bitmap(member: SplitIdentity, size: Int = 640): Bitmap {
        val matrix = MultiFormatWriter().encode(
            encode(member),
            BarcodeFormat.QR_CODE,
            size,
            size,
            mapOf(
                EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
                EncodeHintType.MARGIN to 1,
                EncodeHintType.CHARACTER_SET to "UTF-8",
            ),
        )
        val width = matrix.width
        val height = matrix.height
        val pixels = IntArray(width * height)
        for (y in 0 until height) {
            val row = y * width
            for (x in 0 until width) pixels[row + x] = if (matrix.get(x, y)) Color.BLACK else Color.WHITE
        }
        return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply {
            setPixels(pixels, 0, width, 0, 0, width, height)
        }
    }

    /**
     * 解一张已经取到内存里的二维码图片（相册、截图或相机帧都走这里）。
     * 返回 `null` 表示这一张里没有可识别的码，调用方继续下一帧或提示重试。
     */
    fun decodeBitmap(bitmap: Bitmap): String? {
        val width = bitmap.width
        val height = bitmap.height
        if (width <= 1 || height <= 1) return null
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        return decode(RGBLuminanceSource(width, height, pixels))
    }

    private fun decode(source: com.google.zxing.LuminanceSource): String? {
        val reader = MultiFormatReader().apply {
            setHints(
                mapOf(
                    DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                    // 反色码（深底浅码）在截图上很常见，多试一次不贵。
                    DecodeHintType.ALSO_INVERTED to true,
                ),
            )
        }
        val image = BinaryBitmap(HybridBinarizer(source))
        val text = runCatching { reader.decode(image).text }.getOrNull()
        reader.reset()
        return text
    }
}
