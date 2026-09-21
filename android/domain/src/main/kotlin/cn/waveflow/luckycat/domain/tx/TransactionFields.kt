package cn.waveflow.luckycat.domain.tx

import cn.waveflow.luckycat.contract.bank.TransactionRecord
import cn.waveflow.luckycat.domain.labels.Labels
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.domain.time.Dates

/** 详情页上的一行。 */
data class DetailField(
    val label: String,
    val value: String,
    /** 金额、汇率这类要强调的字段。 */
    val emphasis: Boolean = false,
)

/**
 * 交易详情的字段拼装。
 *
 * 放在 `:domain` 而不是 Composable 里，是因为**"哪些字段该出现、按什么顺序、
 * 什么格式"是业务规则**（网页版 `TransactionDetailPage` 里那一大段
 * `buildFields` 就是干这个的），而它完全可以脱离界面测——
 * 一个字段忘了拼，在界面上只会表现为"少了一行"，很难有人发现。
 *
 * 顺序与网页版一致。带条件的字段（对方户名、商户信息…）只在**有值**时出现：
 * 一排"——"对核对凭证没有任何帮助。
 */
object TransactionFields {

    fun build(record: TransactionRecord): List<DetailField> {
        val d = record.detail
        val fields = mutableListOf(
            DetailField("交易状态", Labels.status(record.status)),
            DetailField("交易类型", Labels.category(record.category)),
            DetailField("交易渠道", Labels.channel(d.channel)),
            DetailField("交易时间", Dates.dateTimeFull(record.createdAt)),
        )

        d.counterpartyName?.let { fields += DetailField("对方户名", it) }
        d.merchantId?.let { fields += DetailField("商户编号", it) }

        val place = listOfNotNull(d.merchantCountry?.takeIf { it.isNotEmpty() }, d.merchantCity?.takeIf { it.isNotEmpty() })
        if (place.isNotEmpty()) fields += DetailField("商户注册地", place.joinToString(" · "))

        d.location?.let { fields += DetailField("交易地点", it) }
        d.counterpartyAccountNo?.let { fields += DetailField("对方账号", it) }
        d.counterpartyBank?.let { fields += DetailField("对方机构", it) }

        fields += DetailField("交易编号", d.referenceNo)
        if (d.paymentMethod.isNotEmpty()) fields += DetailField("支付方式", d.paymentMethod)

        d.authCode?.let { fields += DetailField("授权码", it) }

        d.originAmount?.let { amount ->
            // 外币交易：按 ISO 4217 惯例把币种代码放数字**前面**（USD 5.00）
            val currency = d.originCurrency ?: ""
            fields += DetailField("原交易金额", "$currency ${Money.amount(amount)}".trim(), emphasis = true)
        }
        d.exchangeRate?.let { rate ->
            // 记账汇率：`1 USD = 7.1234 CNY`，与网页版同一种写法
            val currency = d.originCurrency ?: ""
            fields += DetailField("记账汇率", "1 $currency = ${RateFormat.format(rate)} ${d.settleCurrency}", emphasis = true)
        }
        d.exchangeRateNote?.let { fields += DetailField("汇率说明", it) }

        d.remark?.let { fields += DetailField("附言", it) }

        return fields
    }

    /**
     * 对账：交易前余额 + 交易金额 = 交易后余额。
     *
     * 网页版专门有一句提示说这件事。这里也返回，界面照着显示。
     */
    fun reconciles(record: TransactionRecord): Boolean {
        val d = record.detail
        return d.balanceBefore + record.signedAmount == d.balanceAfter
    }
}

private object RateFormat {
    fun format(value: Double): String =
        java.math.BigDecimal(value).setScale(4, java.math.RoundingMode.HALF_UP).toPlainString()
}
