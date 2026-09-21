package cn.waveflow.luckycat.domain.account

/** 注册并开立唯一的储蓄账户。 */
object AccountOpening {
    const val PLEDGE_TEXT =
        "本人充分了解并清楚知晓出租、出借、出售、购买账户的相关法律责任和惩戒措施，承诺依法依规开立和使用本人账户"

    fun isValidIdNumber(value: String): Boolean =
        Regex("^\\d{17}[\\dXx]$").matches(value.trim())

    fun isValidName(value: String): Boolean = value.trim().isNotEmpty()

    fun isValidPassword(value: String): Boolean = value.length in 6..20

    fun maskPhone(value: String): String =
        if (value.length == 11) value.take(3) + "****" + value.takeLast(4) else "待填写"

    fun maskId(value: String): String =
        if (value.length == 18) value.take(3) + "***********" + value.takeLast(4) else "待填写"

}

data class AccountOpeningDraft(
    val phone: String = "",
    val password: String = "",
    val confirmPassword: String = "",
    val holderName: String = "",
    val idNumber: String = "",
    val smsCode: String = "",
    val faceTicket: String = "",
    val pledged: Boolean = false,
    val confirmed: Boolean = false,
) {
    val canRequestSms: Boolean get() = Regex("^1\\d{10}$").matches(phone.trim())

    fun firstProblem(): String? = when {
        !AccountOpening.isValidName(holderName) -> "请填写姓名"
        !AccountOpening.isValidIdNumber(idNumber) -> "请输入 18 位身份证号"
        !AccountOpening.isValidPassword(password) -> "请设置 6-20 位登录密码"
        password != confirmPassword -> "两次输入的密码不一致"
        !canRequestSms -> "请输入 11 位手机号"
        smsCode.length != 6 -> "请输入 6 位短信验证码"
        faceTicket.isEmpty() -> "请先完成人脸核身"
        !pledged -> "请阅读并勾选开户承诺"
        !confirmed -> "请核对并确认开户信息"
        else -> null
    }

    val canSubmit: Boolean get() = firstProblem() == null
}
