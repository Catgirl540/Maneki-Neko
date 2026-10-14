package cn.waveflow.luckycat.ui.cards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.*
import cn.waveflow.luckycat.domain.cards.CardRules
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class RevealedSecrets(val cardId: String, val secrets: CardSecrets)
data class CardsUiState(
    val cards: List<BankCard> = emptyList(),
    val loading: Boolean = true,
    val busyId: String? = null,
    val error: String? = null,
    val revealed: RevealedSecrets? = null,
    val products: List<CardProduct> = emptyList(),
    val productsLoading: Boolean = false,
    val productsError: String? = null,
    val submitting: Boolean = false,
) {
    fun card(id: String): BankCard? = cards.firstOrNull { it.id == id }
    val busy: Boolean get() = busyId != null || submitting || loading
}

class CardsViewModel(private val bank: BankApi) : ViewModel() {
    private val _state = MutableStateFlow(CardsUiState())
    val state = _state.asStateFlow()
    private var revealVersion = 0
    private var hideJob: Job? = null
    private var loadJob: Job? = null
    init { load() }

    fun load() {
        if (loadJob?.isActive == true || _state.value.busyId != null || _state.value.submitting) return
        dismissSecrets()
        _state.value = _state.value.copy(loading = true, error = null)
        loadJob = viewModelScope.launch {
            try { _state.value = _state.value.copy(cards = bank.listCards(), loading = false) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { _state.value = _state.value.copy(loading = false, error = readable(e)) }
        }
    }

    fun loadProducts() {
        if (_state.value.productsLoading) return
        _state.value = _state.value.copy(productsLoading = true, productsError = null)
        viewModelScope.launch {
            try { _state.value = _state.value.copy(products = bank.listCardProducts(), productsLoading = false) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { _state.value = _state.value.copy(productsLoading = false, productsError = readable(e)) }
        }
    }

    fun setLock(cardId: String, locked: Boolean) {
        if (!CardRules.canLock(_state.value.card(cardId)?.status.orEmpty())) return
        patch(cardId) { bank.setCardLock(cardId, locked) }
    }
    fun setOnlinePayment(cardId: String, enabled: Boolean) {
        if (!CardRules.canPay(_state.value.card(cardId)?.status.orEmpty())) return
        patch(cardId) { bank.updateCardSettings(cardId, buildJsonObject { put("onlinePayment", enabled) }) }
    }
    fun setOverseasPayment(cardId: String, enabled: Boolean) {
        if (!CardRules.canPay(_state.value.card(cardId)?.status.orEmpty())) return
        patch(cardId) { bank.updateCardSettings(cardId, buildJsonObject { put("overseasPayment", enabled) }) }
    }
    fun setDailyLimit(cardId: String, cents: Long) {
        if (!CardRules.canPay(_state.value.card(cardId)?.status.orEmpty()) || cents !in CardRules.dailyLimits) return
        patch(cardId) { bank.updateCardSettings(cardId, buildJsonObject { put("dailyLimit", cents) }) }
    }

    /** Writes once per user submission. No automatic retry for fee-bearing operations. */
    fun applyCard(replaceId: String?, productCode: String, address: MailingAddress, password: String, onResult: (Boolean, String?) -> Unit) {
        if (_state.value.busy) return
        val old = replaceId?.let { _state.value.card(it) }
        val product = if (replaceId == null) _state.value.products.find { it.code == productCode }
            else _state.value.products.find { it.network == old?.network }
        val error = when {
            product == null -> "卡产品信息暂不可用，请重试"
            replaceId != null && (old == null || !CardRules.canReplace(old.status)) -> "该卡当前不可换卡"
            CardRules.addressError(address) != null -> CardRules.addressError(address)
            !CardRules.validPassword(password) -> "请输入 6 位数字支付密码"
            else -> null
        }
        if (error != null) { onResult(false, error); return }
        dismissSecrets()
        _state.value = _state.value.copy(submitting = true, error = null)
        viewModelScope.launch {
            try {
                val created = if (replaceId == null) bank.openCard(CardApplication(product!!.code, CardRules.normalize(address), password))
                    else bank.replaceCard(replaceId, CardReplaceRequest(CardRules.normalize(address), password))
                val cards = _state.value.cards.map { if (it.id == replaceId) it.copy(status = "replaced", onlinePayment = false, overseasPayment = false) else it }
                _state.value = _state.value.copy(cards = cards.filterNot { it.id == created.id } + created, submitting = false)
                onResult(true, null)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                _state.value = _state.value.copy(submitting = false)
                onResult(false, readable(e))
            }
        }
    }

    fun revealSecrets(cardId: String, paymentPassword: String, onResult: (Boolean, String?) -> Unit) {
        if (_state.value.busy || !CardRules.canReveal(_state.value.card(cardId)?.status.orEmpty())) return
        if (!CardRules.validPassword(paymentPassword)) { onResult(true, "请输入 6 位数字支付密码"); return }
        dismissSecrets()
        val version = revealVersion
        _state.value = _state.value.copy(busyId = cardId, error = null)
        viewModelScope.launch {
            try {
                val secrets = bank.revealCardSecrets(cardId, paymentPassword)
                _state.value = _state.value.copy(busyId = null)
                // A dismissed dialog or backgrounded page must never redisplay a late response.
                if (version != revealVersion) return@launch
                if (secrets.number.isBlank() || secrets.revealSeconds <= 0) { onResult(false, "卡信息暂不可用，请重试"); return@launch }
                _state.value = _state.value.copy(revealed = RevealedSecrets(cardId, secrets))
                hideJob = viewModelScope.launch {
                    delay(secrets.revealSeconds.coerceAtMost(60).toLong() * 1000)
                    dismissSecrets()
                }
                onResult(false, null)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                _state.value = _state.value.copy(busyId = null)
                if (version == revealVersion) onResult(e is BankApiException && e.code?.contains("PAY_PASSWORD") == true, readable(e))
            }
        }
    }

    fun dismissSecrets() { revealVersion++; hideJob?.cancel(); hideJob = null; _state.value = _state.value.copy(revealed = null) }
    fun dismissError() { _state.value = _state.value.copy(error = null) }
    override fun onCleared() { dismissSecrets(); super.onCleared() }

    private fun patch(cardId: String, action: suspend () -> BankCard) {
        if (_state.value.busy) return
        dismissSecrets()
        _state.value = _state.value.copy(busyId = cardId, error = null)
        viewModelScope.launch {
            try {
                val updated = action()
                _state.value = _state.value.copy(busyId = null, cards = _state.value.cards.map { if (it.id == updated.id) updated else it })
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { _state.value = _state.value.copy(busyId = null, error = readable(e)) }
        }
    }
    private fun readable(e: Exception) = if (e is BankApiException) e.message else "连接失败，请稍后重试"
}
