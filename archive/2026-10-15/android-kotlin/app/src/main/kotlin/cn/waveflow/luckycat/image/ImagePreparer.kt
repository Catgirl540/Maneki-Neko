package cn.waveflow.luckycat.image

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import cn.waveflow.luckycat.domain.image.ImageRules
import java.io.ByteArrayOutputStream
import kotlin.math.max

/** 准备好的图片：发给 agent 的那份 + 存进本地存档的缩略图。 */
data class PreparedImage(
    /** 压缩后的字节，用来发。 */
    val bytes: ByteArray,
    /** 压缩后的 MIME。**压缩之后统一成 jpeg**（除非原来是 png 且没超限）。 */
    val mimeType: String,
    /** 缩略图的 base64（不含前缀），存进对话存档。 */
    val thumbBase64: String,
    /** 原文件名，界面上显示用。 */
    val name: String,
) {
    /** 发给 agent 用的裸 base64（**不带 `data:` 前缀**）。 */
    val sendBase64: String get() = Base64.encodeToString(bytes, Base64.NO_WRAP)
}

/**
 * 把相册里挑出来的图处理成"能发的那一份 + 能存的那一份"。
 *
 * ## 为什么要两份
 *
 * 发给 agent 的要够清楚（长边 1600），而**存进本地存档的必须很小**——
 * 存档总预算只有 2MB，原图一张就能吃掉一大半。网页版 `lib/image.ts`
 * 也是这么分的，这里沿用。
 *
 * ## 为什么必须有读取上限
 *
 * `BitmapFactory` 直接解一张几十 MB 的原图会 OOM。所以先只读尺寸
 * （`inJustDecodeBounds`）、算出采样率、再解——而不是解完发现太大。
 */
object ImagePreparer {

    /**
     * @param uri - 相册选中的图片。
     * @returns 处理好的图片；类型不认识、太大、或解不出来时返回 `null`。
     */
    fun prepare(context: Context, uri: Uri): PreparedImage? {
        val name = queryName(context, uri)
        val declared = (context.contentResolver.getType(uri) ?: "").ifEmpty {
            ImageRules.guessMimeFromName(name)
        }
        val sourceBytes = querySize(context, uri)
        // **先按来源规则拦一次**：太大或类型不认识就别去解码了（解码本身就可能 OOM）
        if (ImageRules.checkSource(declared, sourceBytes) != ImageRules.Verdict.Ok) return null

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching {
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        }.getOrNull()
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        // 只解到"目标长边的两倍"，再交给 createScaledBitmap 收到目标尺寸。
        // 一次到位用 inSampleSize 只能是 2 的幂，边缘尺寸会差很多。
        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, ImageRules.SEND_MAX_EDGE * 2)
        }
        val bitmap = runCatching {
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        }.getOrNull() ?: return null

        return try {
            val send = bitmap.scaled(ImageRules.SEND_MAX_EDGE)
            // 统一编码成 jpeg：png 截图压不下去，一张就撑破 6MB
            val sendBytes = send.toJpeg(QUALITY_SEND)
            if (ImageRules.checkPayload("image/jpeg", sendBytes.size.toLong()) != ImageRules.Verdict.Ok) return null

            val thumb = bitmap.scaled(ImageRules.THUMB_MAX_EDGE)
            PreparedImage(
                bytes = sendBytes,
                mimeType = "image/jpeg",
                thumbBase64 = Base64.encodeToString(thumb.toJpeg(QUALITY_THUMB), Base64.NO_WRAP),
                name = name,
            )
        } finally {
            bitmap.recycle()
        }
    }

    /** 只解到目标尺寸所需的采样率（2 的幂）。 */
    private fun sampleSize(width: Int, height: Int, target: Int): Int {
        var sample = 1
        while (max(width, height) / sample > target) sample *= 2
        return sample
    }

    private fun Bitmap.scaled(maxEdge: Int): Bitmap {
        val longest = max(width, height)
        if (longest <= maxEdge) return this
        val ratio = maxEdge.toFloat() / longest
        return Bitmap.createScaledBitmap(this, (width * ratio).toInt(), (height * ratio).toInt(), true)
    }

    private fun Bitmap.toJpeg(quality: Int): ByteArray =
        ByteArrayOutputStream().use { out ->
            compress(Bitmap.CompressFormat.JPEG, quality, out)
            out.toByteArray()
        }

    private fun queryName(context: Context, uri: Uri): String {
        val cursor = runCatching {
            context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
        }.getOrNull()
        return cursor?.use {
            if (it.moveToFirst()) it.getString(0) ?: "图片" else "图片"
        } ?: "图片"
    }

    private fun querySize(context: Context, uri: Uri): Long {
        val cursor = runCatching {
            context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.SIZE), null, null, null)
        }.getOrNull()
        return cursor?.use {
            if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else 0L
        } ?: 0L
    }

    /** 发送那一份的质量。网页版是 0.82，保持一致。 */
    private const val QUALITY_SEND = 82

    /** 缩略图的质量。网页版是 0.6。 */
    private const val QUALITY_THUMB = 60
}
