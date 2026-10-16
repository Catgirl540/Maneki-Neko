package cn.waveflow.luckycat.ui.openaccount

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.RegistrationRequest
import cn.waveflow.luckycat.contract.bank.RegistrationResult
import cn.waveflow.luckycat.domain.account.AccountOpening
import cn.waveflow.luckycat.domain.account.AccountOpeningDraft
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class OpenAccountUiState(
    val draft: AccountOpeningDraft = AccountOpeningDraft(),
    val demoCode: String? = null,
    val sending: Boolean = false,
    val verifying: Boolean = false,
    val submitting: Boolean = false,
    val error: String? = null,
) {
    val canRequestSms: Boolean get() = draft.canRequestSms && !sending && !submitting
    val canSubmit: Boolean get() = draft.canSubmit && !submitting
}

class OpenAccountViewModel(private val bank: BankApi) : ViewModel() {
    private val _state = MutableStateFlow(OpenAccountUiState())
    val state: StateFlow<OpenAccountUiState> = _state.asStateFlow()

    private fun edit(block: (AccountOpeningDraft) -> AccountOpeningDraft) {
        _state.value = _state.value.copy(draft = block(_state.value.draft), error = null)
    }

    fun updatePhone(value: String) = edit { it.copy(phone = value.filter(Char::isDigit).take(11)) }
    fun updatePassword(value: String) = edit { it.copy(password = value.take(20)) }
    fun updateConfirmPassword(value: String) = edit { it.copy(confirmPassword = value.take(20)) }
    fun updateName(value: String) = edit { it.copy(holderName = value) }
    fun updateIdNumber(value: String) = edit { it.copy(idNumber = value.trim().take(18)) }
    fun updateSmsCode(value: String) = edit { it.copy(smsCode = value.filter(Char::isDigit).take(6)) }
    fun setPledged(value: Boolean) = edit { it.copy(pledged = value) }
    fun setConfirmed(value: Boolean) = edit { it.copy(confirmed = value) }

    fun requestSms() {
        val current = _state.value
        if (!current.canRequestSms) return
        _state.value = current.copy(sending = true, error = null)
        viewModelScope.launch {
            try {
                val result = bank.sendSmsCode(current.draft.phone.trim())
                _state.value = _state.value.copy(
                    sending = false,
                    demoCode = result.demoCode.ifEmpty { null },
                    draft = _state.value.draft.copy(smsCode = result.demoCode.ifEmpty { _state.value.draft.smsCode }),
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(sending = false, error = readable(e))
            }
        }
    }

    fun verifyFace() {
        if (_state.value.verifying) return
        _state.value = _state.value.copy(verifying = true, error = null)
        viewModelScope.launch {
            try {
                val ticket = bank.verifyIdentity("face")
                _state.value = _state.value.copy(verifying = false, draft = _state.value.draft.copy(faceTicket = ticket.ticket))
            } catch (e: Exception) {
                _state.value = _state.value.copy(verifying = false, error = readable(e))
            }
        }
    }

    fun submit(onSuccess: (RegistrationResult) -> Unit) {
        val current = _state.value
        current.draft.firstProblem()?.let { _state.value = current.copy(error = it); return }
        if (current.submitting) return
        val draft = current.draft
        _state.value = current.copy(submitting = true, error = null)
        viewModelScope.launch {
            try {
                val result = bank.register(
                    RegistrationRequest(
                        phone = draft.phone,
                        password = draft.password,
                        holderName = draft.holderName.trim(),
                        idNumber = draft.idNumber.trim(),
                        smsCode = draft.smsCode,
                        faceTicket = draft.faceTicket,
                        pledge = AccountOpening.PLEDGE_TEXT,
                    ),
                )
                _state.value = _state.value.copy(submitting = false)
                onSuccess(result)
            } catch (e: Exception) {
                _state.value = _state.value.copy(submitting = false, error = readable(e))
            }
        }
    }

    fun dismissError() { _state.value = _state.value.copy(error = null) }
    private fun readable(e: Exception): String = if (e is BankApiException) e.message else "网络不给力，请稍后再试"
}
