package cn.waveflow.luckycat.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.Account
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 首页状态。
 *
 * [error] 与 [accounts] **可以同时存在**：刷新失败时旧数据要留着，
 * 页面变成"有数据的错误提示"而不是空白——网页版那批 check-stale-data
 * 就是冲这个来的。
 */
data class HomeUiState(
    val accounts: List<Account> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
) {
    /** 总资产折算成人民币分。演示数据只有人民币账户，所以直接相加。 */
    val totalBalance: Long get() = accounts.sumOf { it.balance }
}

class HomeViewModel(private val bank: BankApi) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val accounts = bank.listAccounts()
                _state.value = HomeUiState(accounts = accounts, loading = false, error = null)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = readable(e))
            }
        }
    }

    private fun readable(e: Exception): String = when (e) {
        is BankApiException -> e.message
        else -> "网络不给力，请稍后再试"
    }
}
