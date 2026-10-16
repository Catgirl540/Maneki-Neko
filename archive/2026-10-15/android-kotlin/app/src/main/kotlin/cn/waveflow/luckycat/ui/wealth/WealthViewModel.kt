package cn.waveflow.luckycat.ui.wealth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.WealthOverview
import cn.waveflow.luckycat.contract.bank.WealthProduct
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class WealthUiState(
    val overview: WealthOverview? = null,
    val products: List<WealthProduct> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
) {
    /** 理财账户没开立时申购是走不通的，界面要能据此提示（而不是等用户点了才报错）。 */
    val accountOpened: Boolean get() = overview?.account?.opened == true

    /** 持仓里还开着的那几笔。已赎回的不列出来。 */
    val openHoldings: List<cn.waveflow.luckycat.contract.bank.WealthHolding>
        get() = overview?.holdings.orEmpty().filter { !it.closed }
}

/**
 * 理财。
 *
 * 这一页只做**看**：总览、持仓、产品列表。
 * **申购/赎回没做**——那条链路要过适当性匹配（投资者等级 vs 产品风险）、
 * 抄录风险确认语句、再输支付密码，是个独立的合规流程，
 * 不适合塞进"看完就能点"的页面里凑数。
 */
class WealthViewModel(private val bank: BankApi) : ViewModel() {

    private val _state = MutableStateFlow(WealthUiState())
    val state: StateFlow<WealthUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val overview = bank.getWealthOverview()
                val products = bank.listWealthProducts()
                _state.value = WealthUiState(overview = overview, products = products, loading = false)
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
