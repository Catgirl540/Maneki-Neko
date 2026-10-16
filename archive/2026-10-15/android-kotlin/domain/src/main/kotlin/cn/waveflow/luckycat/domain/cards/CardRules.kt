package cn.waveflow.luckycat.domain.cards

import cn.waveflow.luckycat.contract.bank.MailingAddress

object CardRules {
    // Same options as the web client and bank validation; values are cents.
    val dailyLimits = listOf(200_000L, 500_000L, 1_000_000L, 5_000_000L)
    fun canLock(status: String) = status == "active" || status == "locked"
    fun canPay(status: String) = status == "active"
    fun canReplace(status: String) = status in listOf("active", "locked", "pending")
    fun canReveal(status: String) = status == "active" || status == "locked"
    fun validPassword(value: String) = Regex("[0-9]{6}").matches(value)
    fun normalize(a: MailingAddress) = a.copy(
        recipient = a.recipient.trim(), phone = a.phone.filter { it in '0'..'9' },
        region = a.region.trim(), city = a.city.trim(), detail = a.detail.trim(), postalCode = a.postalCode.trim(),
    )
    fun addressError(raw: MailingAddress): String? {
        val a = normalize(raw)
        return when {
            a.recipient.isBlank() -> "请填写收件人姓名"
            !Regex("1[3-9][0-9]{9}").matches(a.phone) -> "请输入 11 位手机号"
            a.region.isBlank() -> "请填写省 / 直辖市"
            a.city.isBlank() -> "请填写城市"
            a.detail.length < 5 -> "详细地址至少 5 个字"
            a.postalCode.isNotEmpty() && !Regex("[0-9]{6}").matches(a.postalCode) -> "邮政编码为 6 位数字"
            else -> null
        }
    }
}
