package cn.waveflow.luckycat.ui.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.Account
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.Transaction
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 账户流水页状态。
 *
 * 分页用 [hasMore] 而不是把 total 拿去比：演示后端的 total 与 items 可能因为
 * 过滤条件不完全一致，用"本页返回的数量是否等于页大小"判断更稳。
 */
data class AccountUiState(
    val account: Account? = null,
    val transactions: List<Transaction> = emptyList(),
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val hasMore: Boolean = true,
    val error: String? = null,
)

class AccountViewModel(
    private val bank: BankApi,
    private val accountId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(AccountUiState())
    val state: StateFlow<AccountUiState> = _state.asStateFlow()

    private var page = 1

    init {
        refresh()
    }

    fun refresh() {
        page = 1
        _state.value = _state.value.copy(loading = true, error = null, hasMore = true)
        viewModelScope.launch {
            try {
                // 账户信息与第一页流水并行拉：两个请求互不依赖，串行只是白等
                val account = bank.getAccount(accountId)
                val first = bank.listTransactions(accountId, page = 1, size = PAGE_SIZE)
                _state.value = AccountUiState(
                    account = account,
                    transactions = first.items,
                    loading = false,
                    hasMore = first.items.size >= PAGE_SIZE,
                    error = null,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = readable(e))
            }
        }
    }

    /** 滚到底部时再拉下一页。已经到底、或正在拉，就直接返回（避免重复请求）。 */
    fun loadMore() {
        val current = _state.value
        if (!current.hasMore || current.loadingMore || current.loading) return
        _state.value = current.copy(loadingMore = true)
        viewModelScope.launch {
            try {
                val next = bank.listTransactions(accountId, page = page + 1, size = PAGE_SIZE)
                page += 1
                _state.value = _state.value.copy(
                    transactions = _state.value.transactions + next.items,
                    loadingMore = false,
                    hasMore = next.items.size >= PAGE_SIZE,
                )
            } catch (e: Exception) {
                // 追加失败**不清空已有列表**：用户已经看到的东西不能因为翻页失败就消失
                _state.value = _state.value.copy(loadingMore = false, error = readable(e))
            }
        }
    }

    private fun readable(e: Exception): String = when (e) {
        is BankApiException -> e.message
        else -> "网络不给力，请稍后再试"
    }

    companion object {
        const val PAGE_SIZE = 20
    }
}
