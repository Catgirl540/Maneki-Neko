package cn.waveflow.luckycat.ui.security

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.SecurityOverview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SecurityUiState(
    val overview: SecurityOverview? = null,
    val loading: Boolean = true,
    /** 正在切哪条规则（转圈用）。 */
    val busyRuleId: String? = null,
    val error: String? = null,
)

/**
 * 安全中心。
 *
 * 这一页上有一个**值得写下来的取舍**：关掉一条风控规则是"降低自己的安全性"，
 * 所以界面**不把它做成一个顺手就能点的开关**——每条规则下面都完整显示
 * 它在拦什么。用户关掉"境外交易拦截"之前有权知道自己在关什么。
 *
 * 真正要动安全设置（改密码、换手机号）时**必须走身份验证**，
 * 那是另一条独立链路，不在这一页凑数。
 */
class SecurityViewModel(private val bank: BankApi) : ViewModel() {

    private val _state = MutableStateFlow(SecurityUiState())
    val state: StateFlow<SecurityUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                _state.value = SecurityUiState(overview = bank.getSecurityOverview(), loading = false)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = readable(e))
            }
        }
    }

    /**
     * 开关一条规则。
     *
     * 后端返回的是**整个总览**，直接换掉——不重拉、也不做乐观更新：
     * 安全设置上"界面显示已关掉、其实后端没关"是最坏的一种不同步。
     */
    fun setRule(id: String, enabled: Boolean) {
        _state.value = _state.value.copy(busyRuleId = id, error = null)
        viewModelScope.launch {
            try {
                val updated = bank.setSecurityRule(id, enabled)
                _state.value = _state.value.copy(overview = updated, busyRuleId = null)
            } catch (e: Exception) {
                _state.value = _state.value.copy(busyRuleId = null, error = readable(e))
            }
        }
    }

    private fun readable(e: Exception): String = when (e) {
        is BankApiException -> e.message
        else -> "网络不给力，请稍后再试"
    }
}
