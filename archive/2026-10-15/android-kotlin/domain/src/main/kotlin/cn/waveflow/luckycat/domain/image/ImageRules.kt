package cn.waveflow.luckycat.domain.image

/**
 * 发图的规则。
 *
 * 分两层上限，**别混**（桥接侧也是这么分的）：
 *
 * - **策略上限**（[MAX_SEND_BYTES]，与服务端一致）：超了要回一条清清楚楚的错，
 *   告诉用户"太大了"，而不是让它悄悄失败。
 * - **来源上限**（[MAX_SOURCE_BYTES]）：用户相册里一张原图可能几十 MB，
 *   那是正常的，不该拦——**先压缩再发**。
 *
 * 纯函数，因为"哪张图能发"是个安全与体验的边界，不该只在界面上靠眼睛看。
 */
object ImageRules {

    /** 服务端认的类型，与 `bridge/demo-server.mjs` 的 `IMAGE_MIME_TYPES` 对齐。 */
    val ACCEPTED_MIME_TYPES = listOf("image/png", "image/jpeg", "image/webp", "image/gif")

    /** 服务端的**策略**上限：超了服务端回 413。发之前就该拦住。 */
    const val MAX_SEND_BYTES = 6 * 1024 * 1024

    /** 相册里原图的上限。比策略上限大得多——压缩之后才发。 */
    const val MAX_SOURCE_BYTES = 20 * 1024 * 1024

    /** 发送前的长边上限。与服务端 6MB 上限配着用。 */
    const val SEND_MAX_EDGE = 1600

    /** 存档里那张缩略图的长边。存档总预算是 2MB，原图一张就能吃光。 */
    const val THUMB_MAX_EDGE = 160

    sealed interface Verdict {
        data object Ok : Verdict
        data class TooLarge(val bytes: Long) : Verdict
        data class UnsupportedType(val mimeType: String) : Verdict
    }

    /**
     * 相册里挑出来的原图能不能处理。
     *
     * [mimeType] 允许为空：有些来源（旧相册、拖拽）不带类型，
     * 那时由调用方按扩展名猜（[guessMimeFromName]）之后再来问。
     */
    fun checkSource(mimeType: String, bytes: Long): Verdict = when {
        mimeType.isNotEmpty() && mimeType.lowercase() !in ACCEPTED_MIME_TYPES ->
            Verdict.UnsupportedType(mimeType)
        bytes > MAX_SOURCE_BYTES -> Verdict.TooLarge(bytes)
        else -> Verdict.Ok
    }

    /**
     * **压缩之后**的图能不能发。这一步不能省：
     * 压缩有它的极限（一张 20MB 的 PNG 压到 1600px 仍可能超过 6MB），
     * 不在这儿再拦一次，就会变成"上传到一半被服务端 413"。
     */
    fun checkPayload(mimeType: String, bytes: Long): Verdict = when {
        mimeType.lowercase() !in ACCEPTED_MIME_TYPES -> Verdict.UnsupportedType(mimeType)
        bytes > MAX_SEND_BYTES -> Verdict.TooLarge(bytes)
        else -> Verdict.Ok
    }

    /** 出错时说一句人能看懂的话。`null` 表示没问题。 */
    fun message(verdict: Verdict): String? = when (verdict) {
        ImageRules.Verdict.Ok -> null
        is ImageRules.Verdict.TooLarge ->
            "这张图太大了（${verdict.bytes / 1024 / 1024}MB，上限 ${MAX_SOURCE_BYTES / 1024 / 1024}MB）"
        is ImageRules.Verdict.UnsupportedType ->
            "不支持的图片格式：${verdict.mimeType}"
    }

    /**
     * 从文件名猜 MIME。有些系统（和拖拽进来的文件）不带 `type`，
     * 不猜的话一张正常的图会被当成"格式不支持"。
     */
    fun guessMimeFromName(name: String): String {
        val lower = name.lowercase()
        return when {
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            lower.endsWith(".gif") -> "image/gif"
            else -> ""
        }
    }
}
