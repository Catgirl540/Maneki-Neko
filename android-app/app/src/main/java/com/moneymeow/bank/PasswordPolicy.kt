package com.moneymeow.bank

/** Mirrors shared/password-policy.mjs; the server enforces the same rule. */
internal object PasswordPolicy {
    const val requirements = "登录密码至少 8 位，须包含大写字母、小写字母和特殊字符（如 !@#，空格不计）"
    private val upper = Regex("[A-Z]")
    private val lower = Regex("[a-z]")
    private val special = Regex("[\\p{P}\\p{S}]")

    fun isValid(value: String): Boolean =
        value.codePointCount(0, value.length) >= 8 &&
            value.toByteArray(Charsets.UTF_8).size <= 1024 &&
            upper.containsMatchIn(value) && lower.containsMatchIn(value) && special.containsMatchIn(value)
}
