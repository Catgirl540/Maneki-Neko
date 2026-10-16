package cn.waveflow.luckycat.domain.tx

import cn.waveflow.luckycat.contract.bank.TransactionDetail
import cn.waveflow.luckycat.contract.bank.TransactionRecord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class TransactionFieldsTest {

    private fun record(
        detail: TransactionDetail = TransactionDetail(),
        signedAmount: Long = -4_500,
        status: String = "success",
        category: String = "dining",
    ) = TransactionRecord(
        id = "txn_1",
        accountId = "acc_1",
        direction = if (signedAmount < 0) "out" else "in",
        amount = kotlin.math.abs(signedAmount),
        signedAmount = signedAmount,
        counterparty = "Manner Coffee",
        category = category,
        createdAt = "2026-09-20T08:12:00Z",
        status = status,
        detail = detail,
    )

    private fun labels(fields: List<DetailField>) = fields.map { it.label }

    private fun valueOf(fields: List<DetailField>, label: String) =
        fields.first { it.label == label }.value

    @Test
    fun `基础四项永远都在且顺序固定`() {
        val fields = TransactionFields.build(record())
        assertEquals(listOf("交易状态", "交易类型", "交易渠道", "交易时间"), labels(fields).take(4))
        assertEquals("交易成功", valueOf(fields, "交易状态"))
        assertEquals("餐饮", valueOf(fields, "交易类型"))
    }

    @Test
    fun `没有值的可选字段不出现`() {
        // 一排"——"对核对凭证毫无帮助
        val fields = TransactionFields.build(record())
        assertFalse(labels(fields).contains("对方户名"))
        assertFalse(labels(fields).contains("商户编号"))
        assertFalse(labels(fields).contains("授权码"))
        assertFalse(labels(fields).contains("附言"))
        assertFalse(labels(fields).contains("记账汇率"))
    }

    @Test
    fun `有值的可选字段按网页版的顺序出现`() {
        val fields = TransactionFields.build(
            record(
                detail = TransactionDetail(
                    referenceNo = "REF-1",
                    channel = "card",
                    paymentMethod = "星享卡 尾号 8888",
                    counterpartyName = "梁乐怡",
                    merchantId = "M-001",
                    merchantCountry = "中国",
                    merchantCity = "深圳",
                    location = "深圳 · 南山",
                    counterpartyAccountNo = "6222 **** 9123",
                    counterpartyBank = "建设银行",
                    authCode = "A1B2C3",
                    remark = "房租",
                )
            )
        )
        val order = labels(fields)
        assertEquals(
            listOf(
                "交易状态", "交易类型", "交易渠道", "交易时间",
                "对方户名", "商户编号", "商户注册地", "交易地点", "对方账号", "对方机构",
                "交易编号", "支付方式", "授权码", "附言",
            ),
            order,
        )
        assertEquals("中国 · 深圳", valueOf(fields, "商户注册地"))
    }

    @Test
    fun `外币交易显示原币金额与汇率`() {
        val fields = TransactionFields.build(
            record(
                detail = TransactionDetail(
                    referenceNo = "REF-2",
                    channel = "quickpay",
                    originAmount = 500,
                    originCurrency = "USD",
                    exchangeRate = 7.1234,
                    settleCurrency = "CNY",
                )
            )
        )
        // 币种代码在数字**前面**（ISO 4217 惯例，与 Alipay+ 一致）
        assertEquals("USD 5.00", valueOf(fields, "原交易金额"))
        assertEquals("1 USD = 7.1234 CNY", valueOf(fields, "记账汇率"))
        assertTrue(fields.first { it.label == "原交易金额" }.emphasis)
    }

    @Test
    fun `商户注册地缺一边也能拼`() {
        val onlyCountry = TransactionFields.build(record(detail = TransactionDetail(merchantCountry = "中国")))
        assertEquals("中国", valueOf(onlyCountry, "商户注册地"))
        val onlyCity = TransactionFields.build(record(detail = TransactionDetail(merchantCity = "深圳")))
        assertEquals("深圳", valueOf(onlyCity, "商户注册地"))
    }

    @Test
    fun `时间是本地时区且到秒`() {
        val original = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
            assertEquals("2026-09-20 16:12:00", valueOf(TransactionFields.build(record()), "交易时间"))
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test
    fun `对账 前余额加金额等于后余额`() {
        val ok = record(
            signedAmount = -4_500,
            detail = TransactionDetail(balanceBefore = 12_868_555, balanceAfter = 12_864_055),
        )
        assertTrue(TransactionFields.reconciles(ok))

        val broken = record(
            signedAmount = -4_500,
            detail = TransactionDetail(balanceBefore = 12_868_555, balanceAfter = 12_000_000),
        )
        assertFalse("对不上时必须返回 false——这正是界面要提示的东西", TransactionFields.reconciles(broken))
    }

    @Test
    fun `收入方向的对账也要成立`() {
        val income = record(
            signedAmount = 1_145_786,
            detail = TransactionDetail(balanceBefore = 11_718_269, balanceAfter = 12_864_055),
        )
        assertTrue(TransactionFields.reconciles(income))
    }
}
