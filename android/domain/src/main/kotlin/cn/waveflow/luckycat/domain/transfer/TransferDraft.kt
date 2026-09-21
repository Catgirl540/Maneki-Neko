package cn.waveflow.luckycat.domain.transfer

import cn.waveflow.luckycat.contract.bank.Cents
import cn.waveflow.luckycat.contract.bank.Payee
import cn.waveflow.luckycat.contract.bank.TransferRequest

/**
 * 从"选了谁 + 转多少"拼出转账请求。
 *
 * 放 `:domain` 是因为这里有两条**会转错钱的约束**，而它们在界面上看不出来：
 *
 * 1. **`bankCode` 与 `bankRegion` 必须成对下发**。3 位清算代码两地会撞号
 *    （004 在香港是汇丰、在内地是另一家），只带一个就可能路由到错误的银行。
 *    所以这里要么两个都给，要么两个都不给——不允许只落一个。
 * 2. **`fps` 通道要有 `fpsId`**。只填了标识方式没填标识，等于没有收款人。
 */
object TransferDraft {

    /**
     * @param accountId - 从哪个账户转出。
     * @param payee - 选中的收款人。
     * @param amountCents - 金额（**分**）。
     * @param memo - 附言。
     * @returns 可以直接交给 `quoteTransfer` / `submitTransfer` 的请求体。
     */
    fun build(
        accountId: String,
        payee: Payee,
        amountCents: Cents,
        memo: String,
    ): TransferRequest {
        // 成对：两个都有才下发，只有一个就都不给（宁可让后端按账号校验，
        // 也不要让它按一个残缺的清算代码去猜银行）
        val bankCode = payee.bankCode?.takeIf { it.isNotEmpty() }
        val bankRegion = payee.bankRegion?.takeIf { it.isNotEmpty() }
        val paired = bankCode != null && bankRegion != null

        return TransferRequest(
            fromAccountId = accountId,
            channel = payee.channel,
            scope = payee.scope.ifEmpty { "domestic" },
            payeeName = payee.name,
            amount = amountCents,
            memo = memo.trim(),
            payeeBankCode = bankCode.takeIf { paired },
            payeeBankRegion = bankRegion.takeIf { paired },
            payeeAccountNo = payee.accountNo?.takeIf { it.isNotEmpty() },
            // 转数快通道才带标识；银行通道带上会让后端多一层判断
            fpsId = payee.fpsId?.takeIf { it.isNotEmpty() && payee.channel == "fps" },
            fpsMethod = payee.fpsMethod?.takeIf { it.isNotEmpty() && payee.channel == "fps" },
        )
    }

    /** 界面上展示的收款标识：转数快显示标识，银行显示账号尾号。 */
    fun identifier(payee: Payee): String {
        // 先取到局部变量：跨模块的 public 属性不能直接智能转换
        val fpsId = payee.fpsId
        val accountNo = payee.accountNo
        val bankName = payee.bankName
        return when {
            payee.channel == "fps" && !fpsId.isNullOrEmpty() -> "转数快 $fpsId"
            !accountNo.isNullOrEmpty() -> "${bankName ?: "银行"} 尾号 ${accountNo.takeLast(4)}"
            else -> bankName ?: "—"
        }
    }
}
