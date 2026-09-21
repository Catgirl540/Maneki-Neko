package cn.waveflow.luckycat.ui.cards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.BankCard
import cn.waveflow.luckycat.contract.bank.CardSecrets
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 已经查出来的卡密，挂在哪张卡上。 */
data class RevealedSecrets(val cardId: String, val secrets: CardSecrets)

data class CardsUiState(
    val cards: List<BankCard> = emptyList(),
    val loading: Boolean = true,
    /** 正在改哪张卡（按钮转圈用）。 */
    val busyId: String? = null,
    val error: String? = null,
    val revealed: RevealedSecrets? = null,
) {
    fun card(id: String): BankCard? = cards.firstOrNull { it.id == id }
}

/**
 * 银行卡。
 *
 * ## 卡密是这一页唯一"能看到钱"的地方，所以规矩最多
 *
 * - **必须输支付密码**，密码只发后端，不进日志、不进对话。
 * - 密码错（401 / `BAD_PAY_PASSWORD`）时**不关掉输入框**，清空让重输——
 *   和确认卡片同一个道理。
 * - 查出来的卡密**只放在内存里**，切走或刷新就没了；演示环境后端返回的是
 *   占位值，但真后端会返回真卡号，所以不落盘这条从现在就守住。
 */
class CardsViewModel(private val bank: BankApi) : ViewModel() {

    private val _state = MutableStateFlow(CardsUiState())
    val state: StateFlow<CardsUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                _state.value = CardsUiState(cards = bank.listCards(), loading = false)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = readable(e))
            }
        }
    }

    /** 锁卡 / 解锁。锁了之后所有交易都会被拒。 */
    fun setLock(cardId: String, locked: Boolean) = patch(cardId) { bank.setCardLock(cardId, locked) }

    fun setOnlinePayment(cardId: String, enabled: Boolean) =
        patch(cardId) { bank.updateCardSettings(cardId, patchOf("onlinePayment" to enabled)) }

    fun setOverseasPayment(cardId: String, enabled: Boolean) =
        patch(cardId) { bank.updateCardSettings(cardId, patchOf("overseasPayment" to enabled)) }

    /**
     * 查卡密。
     *
     * @param onResult - 回调告诉界面"是不是密码错"，界面据此决定清不清空输入框。
     */
    fun revealSecrets(
        cardId: String,
        paymentPassword: String,
        onResult: (passwordWrong: Boolean, message: String?) -> Unit,
    ) {
        if (paymentPassword.isEmpty()) return
        _state.value = _state.value.copy(busyId = cardId, error = null)
        viewModelScope.launch {
            try {
                val secrets = bank.revealCardSecrets(cardId, paymentPassword)
                _state.value = _state.value.copy(busyId = null, revealed = RevealedSecrets(cardId, secrets))
                onResult(false, null)
            } catch (e: BankApiException) {
                _state.value = _state.value.copy(busyId = null)
                // 码里带 PAY_PASSWORD 的都算"密码不对"（后端可能用 401 或 423）
                val wrong = e.code?.contains("PAY_PASSWORD") == true || e.status == 401
                if (wrong) onResult(true, e.message)
                else {
                    _state.value = _state.value.copy(error = e.message)
                    onResult(false, null)
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(busyId = null, error = readable(e))
                onResult(false, null)
            }
        }
    }

    /** 收起卡密。**离开页面时也要调**——卡密只该在用户主动要看的那一刻存在。 */
    fun dismissSecrets() {
        _state.value = _state.value.copy(revealed = null)
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    override fun onCleared() {
        // 直接把状态丢掉（内存里那份卡密随之消失）
        _state.value = _state.value.copy(revealed = null)
        super.onCleared()
    }

    /** 改完一张卡之后把返回的那张替换回去，**不重新拉整个列表**。 */
    private fun patch(cardId: String, action: suspend () -> BankCard) {
        _state.value = _state.value.copy(busyId = cardId, error = null)
        viewModelScope.launch {
            try {
                val updated = action()
                _state.value = _state.value.copy(
                    busyId = null,
                    cards = _state.value.cards.map { if (it.id == updated.id) updated else it },
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(busyId = null, error = readable(e))
            }
        }
    }

    private fun patchOf(vararg pairs: Pair<String, Boolean>): JsonObject =
        buildJsonObject { pairs.forEach { (key, value) -> put(key, JsonPrimitive(value)) } }

    private fun readable(e: Exception): String = when (e) {
        is BankApiException -> e.message
        else -> "网络不给力，请稍后再试"
    }
}
