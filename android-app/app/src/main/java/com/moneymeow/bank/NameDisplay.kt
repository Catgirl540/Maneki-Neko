package com.moneymeow.bank

/**
 * 姓名展示规则（安卓侧镜像 `shared/name-display.mjs`）。
 *
 * 服务端正常情况下会下发 `displayName` / `maskedName`，这里只用于兜底：
 * 老接口没有这些字段、或本地缓存里只有全名时，按同一套规则当场算出来。
 */
object NameDisplay {

    /** 判定不了性别时的默认称呼（与服务端 `DEFAULT_HONORIFIC` 一致）。 */
    private const val DEFAULT_HONORIFIC = "ms"

    /** 列表展示：「林小满」→「林女士」。 */
    fun of(name: String?, honorific: String? = null): String {
        val value = name?.trim().orEmpty()
        if (value.isEmpty()) return ""
        val surname = value.first()
        return surname + if (honorific == "mr") "先生" else "女士"
    }

    /** 详情展示：「林小满」→「林*满」；两字名「林一」→「林*」。 */
    fun masked(name: String?): String {
        val value = name?.trim().orEmpty()
        return when {
            value.length <= 1 -> value
            value.length == 2 -> value.take(1) + "*"
            else -> value.take(1) + "*".repeat(value.length - 2) + value.last()
        }
    }

    /** 昵称上限（与 `shared/nickname.mjs` 的 NICKNAME_MAX 一致）。 */
    const val NICKNAME_MAX = 16

    /** 去掉首尾空白与控制字符；空串表示未设置。 */
    fun normalizeNickname(value: String?): String =
        (value ?: "").replace(Regex("[\\u0000-\\u001f\\u007f]"), "").trim()

    /** 校验昵称；合法返回 null，非法返回错误文案。空串合法（表示恢复默认）。 */
    fun validateNickname(value: String?): String? {
        val text = normalizeNickname(value)
        if (text.isEmpty()) return null
        if (text.codePointCount(0, text.length) > NICKNAME_MAX) return "昵称最多 $NICKNAME_MAX 个字"
        return null
    }

    /** 展示用昵称：自定义优先，否则回退到称呼。 */
    fun nicknameOf(custom: String?, fallback: String?): String =
        normalizeNickname(custom).ifEmpty { fallback.orEmpty() }

    /** 身份证号第 17 位定称呼：奇数先生、偶数女士；格式不对返回默认值。 */
    fun honorificFromIdNumber(idNumber: String?): String {
        val value = idNumber?.trim().orEmpty()
        if (!Regex("^\\d{17}[\\dXx]$").matches(value)) return DEFAULT_HONORIFIC
        return if (value[16].digitToInt() % 2 == 1) "mr" else "ms"
    }
}
