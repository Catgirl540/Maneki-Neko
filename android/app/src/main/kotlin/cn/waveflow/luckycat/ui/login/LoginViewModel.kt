package cn.waveflow.luckycat.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.BankUser
import cn.waveflow.luckycat.domain.phone.PhoneRules
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 登录页状态。
 *
 * [demoCode] 是**演示环境**才有的：后端把验证码回传，页面直接显示出来。
 * 真后端不会回传，到时候这里是 null，界面那行提示自然就不显示——
 * 所以不用为"接了真后端"改一行界面代码。
 */
data class LoginUiState(
    val phone: String = "",
    val password: String = "",
    val smsCode: String = "",
    val demoCode: String? = null,
    val sending: Boolean = false,
    val submitting: Boolean = false,
    val error: String? = null,
) {
    val canRequestSms: Boolean get() = PhoneRules.canRequestSms(phone) && !sending && !submitting

    val canSubmit: Boolean
        get() = PhoneRules.canSubmitLogin(phone, password, smsCode) && !submitting
}

/**
 * 登录流程。
 *
 * **登录判定一律在后端**（`/api/auth/…`）。这里只做两件事：
 * 收集输入、把后端的错误原样显示出来。故意不在本地"先判一遍"——
 * 两份规则必然漂开（见 [PhoneRules] 的说明）。
 */
class LoginViewModel(private val bank: BankApi) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun updatePhone(value: String) {
        // 手机号只留数字：粘贴进来的串常常带空格或连字符
        _state.value = _state.value.copy(phone = PhoneRules.digitsOnly(value).take(11), error = null)
    }

    fun updatePassword(value: String) {
        _state.value = _state.value.copy(password = value, error = null)
    }

    fun updateSmsCode(value: String) {
        _state.value = _state.value.copy(smsCode = PhoneRules.digitsOnly(value).take(6), error = null)
    }

    /** 请求验证码。演示环境会把码回传，直接填进输入框省一次手输。 */
    fun requestSms() {
        val current = _state.value
        if (!current.canRequestSms) return
        _state.value = current.copy(sending = true, error = null)
        viewModelScope.launch {
            try {
                val result = bank.sendSmsCode(current.phone)
                _state.value = _state.value.copy(
                    sending = false,
                    demoCode = result.demoCode.ifEmpty { null },
                    smsCode = result.demoCode.ifEmpty { _state.value.smsCode },
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(sending = false, error = readable(e))
            }
        }
    }

    /** 登录。成功时回调，交给上层写登录态并跳转。 */
    fun submit(onSuccess: (token: String, user: BankUser) -> Unit) {
        val current = _state.value
        if (!current.canSubmit) return
        _state.value = current.copy(submitting = true, error = null)
        viewModelScope.launch {
            try {
                val result = bank.login(current.phone, current.password, current.smsCode)
                _state.value = _state.value.copy(submitting = false)
                onSuccess(result.token, result.user)
            } catch (e: Exception) {
                _state.value = _state.value.copy(submitting = false, error = readable(e))
            }
        }
    }

    /**
     * 把异常变成一句能显示的话。
     *
     * [BankApiException.message] 已经是后端给的中文文案（`API-CONTRACT.md` 要求
     * "直接展示给用户、前端不做任何二次包装"），所以**不要**再包一层
     * "登录失败：…"。网络层异常才需要兜底。
     */
    private fun readable(e: Exception): String = when (e) {
        is BankApiException -> e.message
        else -> "网络不给力，请稍后再试"
    }
}
