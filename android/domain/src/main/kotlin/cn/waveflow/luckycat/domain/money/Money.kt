package cn.waveflow.luckycat.domain.money

import cn.waveflow.luckycat.contract.bank.Cents
import java.math.BigDecimal
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/**
 * 金额格式化。**逐条照抄网页版 `app/src/lib/format.ts`** —— 同一个数在两端
 * 长得不一样（一边 `¥1,234.56`、一边 `1234.56`）是最容易被当成 bug 报上来的东西。
 *
 * 一律用 [BigDecimal] 而不是 `cents / 100.0`：浮点在做除法的那一刻就开始有误差，
 * 金额上这是不能接受的习惯（哪怕这个演示里金额都不大）。
 */
object Money {

    /** 币种符号。与网页版的 `CURRENCY_SYMBOL` 一致；认不出就退回币种代码本身。 */
    private val SYMBOLS = mapOf("CNY" to "¥", "USD" to "US\$", "HKD" to "HK\$")

    fun symbolOf(currency: String): String = SYMBOLS[currency] ?: currency

    /**
     * 分 → `"1,234.56"`（**不带**符号与币种）。
     *
     * 固定用逗号分位、点作小数点，不跟随系统区域：银行界面上的数字格式
     * 不该因为用户把系统语言换成德语（`1.234,56`）就变样。
     */
    fun amount(cents: Cents): String = decimalFormat().format(BigDecimal(cents).movePointLeft(2).abs())

    /** 分 → `"¥1,234.56"`。 */
    fun money(cents: Cents, symbol: String = "¥"): String = "$symbol${amount(cents)}"

    /**
     * 分 → `"+¥1,234.56"` / `"-¥1,234.56"`。
     *
     * 符号在**最前面**、币种紧跟其后。与网页版 `formatAmount` 的 `{ sign }` 区别是：
     * 那个给的是 `"+1,234.56"`（没币种）。交易详情页一直写的是 `"+¥45.00"`，
     * 而交易列表用的是没币种的那种——同一个数两处不一样，所以分开两个函数。
     */
    fun moneySigned(cents: Cents, symbol: String = "¥"): String =
        "${if (cents < 0) "-" else "+"}$symbol${amount(cents)}"

    /** 分 → `"HK$1,088.52"`，符号按币种取。 */
    fun currency(cents: Cents, currency: String): String = "${symbolOf(currency)}${amount(cents)}"

    /**
     * 年化利率 → `"1.55%"`。
     *
     * 后端给的是小数（`0.0155`），网页版也是这么换算的。
     */
    fun rate(value: Double): String =
        "${DecimalFormat("0.##", DecimalFormatSymbols(Locale.US)).format(BigDecimal(value).movePointRight(2))}%"

    /**
     * 用户输入的**元** → **分**。解析不出来返回 `null`。
     *
     * 解析金额是最容易出错的一环：用户会输 `800`、`800.5`、`800.50`、
     * `1,234.56`、`８００`（全角）、`800元`、`-5`、`0`。这里一律**不做四舍五入**，
     * 超过两位小数直接判为无效——静默把 `800.555` 变成 `800.56` 是在替用户改金额。
     *
     * 用 [BigDecimal] 而不是 `toDouble() * 100`：后者在 `8.7` 这种值上会给出
     * 869.9999…，取整之后少一分钱。
     *
     * @returns 分；空串、非法、负数、超过两位小数时返回 `null`。
     */
    fun parseToCents(text: String): Cents? {
        // 全角数字与千分位逗号先归一，用户从别处粘贴过来的常常带这些
        val normalized = text.trim()
            .replace(",", "")
            .replace("，", "")
            .map { if (it in '０'..'９') it - '０' + '0'.code else it.code }
            .map { it.toChar() }
            .joinToString("")
            .removeSuffix("元")
            .trim()
        if (normalized.isEmpty()) return null
        if (!Regex("^\\d+(\\.\\d{1,2})?$").matches(normalized)) return null
        val value = runCatching { BigDecimal(normalized) }.getOrNull() ?: return null
        val cents = value.movePointRight(2).toLong()
        return if (cents <= 0) null else cents
    }

    /**
     * 每次都新建一个。
     *
     * `DecimalFormat` **不是线程安全的**（它带着可变状态），做成共享的静态实例
     * 迟早会在并发格式化时给出错乱的数字——金额上是不能接受的。
     * 这里每次新建，代价可以忽略。
     */
    private fun decimalFormat() = DecimalFormat("#,##0.00", DecimalFormatSymbols(Locale.US))
}
