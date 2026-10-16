package cn.waveflow.luckycat.domain.phone

/**
 * 手机号格式的**客户端**规则，只用来决定按钮能不能点、
 * 以及"还没请求验证码"这类即时提示。
 *
 * ## 为什么这里只有正则、没有登录逻辑
 *
 * 登录必须走**后端**（`/api/auth/…`）——那是唯一事实来源。
 * 之前 `:domain` 里有一个把 mock 规则抄了一遍的 `DemoAuth`，在有了占位后端
 * （`framework/bridge/demo-bank.mjs`，见 `P15-DEMO-BANK.md`）之后就把两份规则
 * 变成了两个会漂的实现，所以删掉了。
 *
 * 留下的这两个正则**与后端不一致是有意的**：它们是界面上的即时反馈，
 * 不是安全边界。真正的判定在后端，这里宽一点只会让多一次无用的请求，
 * 严格一点会让用户点不动按钮。
 */
object PhoneRules {

    /**
     * 发验证码的按钮什么时候能点。
     *
     * 后端 `sendSmsCode` 用的是 `1[3-9]\d{9}`（严格），这里跟着它——
     * 不然用户点了才被告知格式不对。
     */
    fun canRequestSms(raw: String): Boolean = STRICT.matches(digitsOnly(raw))

    /**
     * 登录按钮什么时候能点。
     *
     * 后端 `login` 用的是宽松的 `\d{11}`，所以这里也宽：
     * 两个正则不一样**不是笔误**，是照抄网页版（`app/src/api/mock/index.ts`）的
     * 实际行为。客户端比后端严会让用户遇到"明明填对了却点不动"。
     */
    fun canSubmitLogin(rawPhone: String, password: String, smsCode: String): Boolean =
        LOOSE.matches(rawPhone) && password.isNotEmpty() && digitsOnly(smsCode).length == 6

    /** 去空格、连字符之类，只留数字。 */
    fun digitsOnly(value: String): String = value.filter { it.isDigit() }

    private val STRICT = Regex("^1[3-9]\\d{9}$")
    private val LOOSE = Regex("^\\d{11}$")
}
