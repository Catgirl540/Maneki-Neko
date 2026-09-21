package cn.waveflow.luckycat.domain.transfer

import cn.waveflow.luckycat.contract.bank.Payee
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TransferDraftTest {

    private fun bankPayee() = Payee(
        id = "pay_1",
        name = "梁乐怡",
        channel = "bank",
        bankCode = "105",
        bankRegion = "CN",
        bankName = "建设银行",
        accountNo = "6222020200009123",
        scope = "domestic",
    )

    private fun fpsPayee() = Payee(
        id = "pay_2",
        name = "陈嘉禾",
        channel = "fps",
        bankCode = "004",
        bankRegion = "HK",
        bankName = "香港上海汇丰银行",
        fpsMethod = "mobile",
        fpsId = "91234567",
        scope = "overseas",
    )

    @Test
    fun `银行通道把清算代码与市场成对下发`() {
        val req = TransferDraft.build("acc_1", bankPayee(), 80_000, "房租")
        assertEquals("105", req.payeeBankCode)
        assertEquals("CN", req.payeeBankRegion)
        assertEquals("6222020200009123", req.payeeAccountNo)
        assertEquals("bank", req.channel)
        assertEquals(80_000L, req.amount)
        assertEquals("房租", req.memo)
    }

    @Test
    fun `银行通道不带转数快字段`() {
        val req = TransferDraft.build("acc_1", bankPayee(), 80_000, "")
        assertNull(req.fpsId)
        assertNull(req.fpsMethod)
    }

    @Test
    fun `转数快通道带上标识与方式`() {
        val req = TransferDraft.build("acc_1", fpsPayee(), 1_000, "")
        assertEquals("fps", req.channel)
        assertEquals("91234567", req.fpsId)
        assertEquals("mobile", req.fpsMethod)
        assertEquals("overseas", req.scope)
    }

    @Test
    fun `只有一个清算代码时两个都不下发`() {
        // **重点**：3 位清算代码两地会撞号（004 在香港是汇丰、在内地是另一家）。
        // 只落一个就可能路由到错误的银行，宁可都不给。
        val broken = bankPayee().copy(bankRegion = null)
        val req = TransferDraft.build("acc_1", broken, 80_000, "")
        assertNull(req.payeeBankCode)
        assertNull(req.payeeBankRegion)
        assertEquals("6222020200009123", req.payeeAccountNo)
    }

    @Test
    fun `空字符串等于没有`() {
        val broken = bankPayee().copy(bankCode = "", bankRegion = "")
        val req = TransferDraft.build("acc_1", broken, 80_000, "")
        assertNull(req.payeeBankCode)
        assertNull(req.payeeBankRegion)
    }

    @Test
    fun `scope 缺失时按境内处理`() {
        val req = TransferDraft.build("acc_1", bankPayee().copy(scope = ""), 80_000, "")
        assertEquals("domestic", req.scope)
    }

    @Test
    fun `附言会去掉首尾空白`() {
        val req = TransferDraft.build("acc_1", bankPayee(), 1, "  房租  ")
        assertEquals("房租", req.memo)
    }

    @Test
    fun `展示用的收款标识`() {
        assertEquals("转数快 91234567", TransferDraft.identifier(fpsPayee()))
        assertEquals("建设银行 尾号 9123", TransferDraft.identifier(bankPayee()))
        assertEquals("—", TransferDraft.identifier(Payee(name = "无名")))
    }
}
