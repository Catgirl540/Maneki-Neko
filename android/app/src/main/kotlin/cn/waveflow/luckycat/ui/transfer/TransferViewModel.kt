package cn.waveflow.luckycat.ui.transfer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.Account
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.Cents
import cn.waveflow.luckycat.contract.bank.Payee
import cn.waveflow.luckycat.contract.bank.TransferQuote
import cn.waveflow.luckycat.contract.bank.TransferResult
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.domain.transfer.TransferDraft
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TransferUiState(
    val accounts: List<Account> = emptyList(),
    val payees: List<Payee> = emptyList(),
    val fromAccountId: String? = null,
    val payeeId: String? = null,
    val amountText: String = "",
    val memo: String = "",
    val quote: TransferQuote? = null,
    val result: TransferResult? = null,
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
) {
    val amountCents: Cents? get() = Money.parseToCents(amountText)

    val payee: Payee? get() = payees.firstOrNull { it.id == payeeId }

    /** 报价要三个都齐：转出账户、收款人、合法金额。 */
    val canQuote: Boolean get() = fromAccountId != null && payee != null && amountCents != null && !busy

    /**
     * 能提交的前提是**已经报过价**。
     *
     * 用户要先看到手续费与到账时间再决定——这也是网页版的做法。
     */
    val canSubmit: Boolean get() = quote != null && amountCents != null && !busy
}

/**
 * 转账。
 *
 * ## 一条安全规则：任何输入变动都让报价失效
 *
 * 报价里带着手续费、到账时间、**单笔上限**。用户报完价再改金额，如果还留着
 * 旧报价，界面会显示"手续费 0 元、上限 5 万"而金额已经变成 8 万——
 * 用户按着那个数字点确认，看到的和实际要发生的就不是一回事了。
 * 所以 [invalidateQuote] 在换账户、换收款人、改金额时都调一次。
 *
 * 提交本身也**不走报价那条路**：`submitTransfer` 拿的是当前输入重新拼的请求，
 * 后端会再校验一次。
 */
class TransferViewModel(private val bank: BankApi) : ViewModel() {

    private val _state = MutableStateFlow(TransferUiState())
    val state: StateFlow<TransferUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val accounts = bank.listAccounts()
                val payees = bank.listPayees()
                _state.value = _state.value.copy(
                    accounts = accounts,
                    payees = payees,
                    // 默认选第一个可转出的账户；收款人不预选——转给谁是用户自己决定的
                    fromAccountId = _state.value.fromAccountId ?: accounts.firstOrNull()?.id,
                    loading = false,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = readable(e))
            }
        }
    }

    fun selectAccount(id: String) = invalidateQuote { it.copy(fromAccountId = id) }

    fun selectPayee(id: String) = invalidateQuote { it.copy(payeeId = id, result = null) }

    fun updateAmount(text: String) {
        // 只接受数字与小数点，用户不用先被键盘纠正一轮
        val cleaned = text.filter { it.isDigit() || it == '.' || it == '，' || it == ',' }.take(15)
        invalidateQuote { it.copy(amountText = cleaned, result = null) }
    }

    fun updateMemo(text: String) = invalidateQuote { it.copy(memo = text.take(60)) }

    /** 报价。 */
    fun requestQuote() {
        val current = _state.value
        val amount = current.amountCents ?: return
        val payee = current.payee ?: return
        val accountId = current.fromAccountId ?: return
        _state.value = current.copy(busy = true, error = null, result = null)
        viewModelScope.launch {
            try {
                val quote = bank.quoteTransfer(TransferDraft.build(accountId, payee, amount, current.memo))
                _state.value = _state.value.copy(busy = false, quote = quote)
            } catch (e: Exception) {
                _state.value = _state.value.copy(busy = false, error = readable(e))
            }
        }
    }

    /** 提交。成功后把结果放进 [TransferUiState.result]，界面显示回执。 */
    fun submit() {
        val current = _state.value
        val amount = current.amountCents ?: return
        val payee = current.payee ?: return
        val accountId = current.fromAccountId ?: return
        if (!current.canSubmit) return
        _state.value = current.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val result = bank.submitTransfer(TransferDraft.build(accountId, payee, amount, current.memo))
                _state.value = _state.value.copy(busy = false, result = result, quote = null)
            } catch (e: Exception) {
                _state.value = _state.value.copy(busy = false, error = readable(e))
            }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    private fun invalidateQuote(block: (TransferUiState) -> TransferUiState) {
        _state.value = block(_state.value).copy(quote = null)
    }

    private fun readable(e: Exception): String = when (e) {
        is BankApiException -> e.message
        else -> "网络不给力，请稍后再试"
    }
}
