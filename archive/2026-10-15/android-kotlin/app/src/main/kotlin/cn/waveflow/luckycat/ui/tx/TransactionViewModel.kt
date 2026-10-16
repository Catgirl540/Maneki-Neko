package cn.waveflow.luckycat.ui.tx

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.TransactionRecord
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TransactionUiState(
    val record: TransactionRecord? = null,
    val loading: Boolean = true,
    val error: String? = null,
)

class TransactionViewModel(
    private val bank: BankApi,
    private val transactionId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(TransactionUiState())
    val state: StateFlow<TransactionUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                _state.value = TransactionUiState(record = bank.getTransaction(transactionId), loading = false)
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
