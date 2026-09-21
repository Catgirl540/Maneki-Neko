package cn.waveflow.luckycat.ui.analysis

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.CashFlow
import cn.waveflow.luckycat.contract.bank.SpendingAnalysis
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AnalysisUiState(
    val spending: SpendingAnalysis? = null,
    val cashFlow: CashFlow? = null,
    val loading: Boolean = true,
    val error: String? = null,
) {
    /** 净现金流 = 收入 - 支出。正数才是攒下钱。 */
    val net: Long get() = (cashFlow?.totalIncome ?: 0) - (cashFlow?.totalExpense ?: 0)
}

class AnalysisViewModel(private val bank: BankApi) : ViewModel() {

    private val _state = MutableStateFlow(AnalysisUiState())
    val state: StateFlow<AnalysisUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val spending = bank.getSpending()
                val cashFlow = bank.getCashFlow(days = 30)
                _state.value = AnalysisUiState(spending = spending, cashFlow = cashFlow, loading = false)
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
