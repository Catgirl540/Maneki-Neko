package cn.waveflow.luckycat.ui.wealth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.bank.Account
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankApiException
import cn.waveflow.luckycat.contract.bank.RiskAssessment
import cn.waveflow.luckycat.contract.bank.RiskQuestion
import cn.waveflow.luckycat.contract.bank.WealthAccountOpeningRequest
import cn.waveflow.luckycat.domain.account.AccountOpening
import cn.waveflow.luckycat.domain.account.WealthOpening
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class WealthOpeningUiState(
    val questions: List<RiskQuestion> = emptyList(),
    /** 每题选了第几个选项；`-1` 表示没选。 */
    val answers: List<Int> = emptyList(),
    val risk: RiskAssessment? = null,
    val accounts: List<Account> = emptyList(),
    val settlementAccountId: String = "",
    val holderName: String = "",
    val idNumber: String = "",
    val phone: String = "",
    val smsCode: String = "",
    val faceTicket: String = "",
    val pledged: Boolean = false,
    val demoCode: String? = null,
    val loading: Boolean = true,
    val assessing: Boolean = false,
    val sending: Boolean = false,
    val verifying: Boolean = false,
    val submitting: Boolean = false,
    val done: Boolean = false,
    val error: String? = null,
) {
    val answered: Boolean get() = questions.isNotEmpty() && answers.size == questions.size && answers.all { it >= 0 }

    /** 测评做完（且没过期）才有资格开。见 [WealthOpening] 的类文档。 */
    val assessable: Boolean get() = risk?.usable == true

    val canRequestSms: Boolean get() = Regex("^1\\d{10}$").matches(phone.trim()) && !sending

    /** 提交前逐项检查，**顺序照用户填写的顺序**。 */
    fun firstProblem(): String? = when {
        questions.isEmpty() -> "题目还没加载出来"
        !assessable -> "请先完成风险承受能力评估"
        !AccountOpening.isValidName(holderName) -> "请填写姓名"
        !AccountOpening.isValidIdNumber(idNumber) -> "请输入 18 位身份证号"
        faceTicket.isEmpty() -> "请先完成人脸核身"
        smsCode.length != 6 -> "请输入 6 位短信验证码"
        settlementAccountId.isEmpty() -> "请选择资金账户"
        !pledged -> "请阅读并签署投资协议"
        else -> null
    }

    val canSubmit: Boolean get() = firstProblem() == null && !submitting
}

/**
 * 开理财账户。
 *
 * **顺序不能换**：风险测评是前置条件（监管要求，且满一年失效），
 * 没有它后端会直接回 403。界面在测评做完之前就说明白，
 * 而不是让用户把姓名身份证都填完再被拒。
 */
class WealthOpeningViewModel(private val bank: BankApi) : ViewModel() {

    private val _state = MutableStateFlow(WealthOpeningUiState())
    val state: StateFlow<WealthOpeningUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val questions = bank.listRiskQuestions()
                val overview = bank.getWealthOverview()
                val accounts = bank.listAccounts()
                _state.value = _state.value.copy(
                    questions = questions,
                    answers = List(questions.size) { -1 },
                    risk = overview.risk,
                    accounts = accounts,
                    // 默认选第一个账户：多数人只有一个，让它默认选中少一次点击
                    settlementAccountId = accounts.firstOrNull()?.id ?: "",
                    loading = false,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = readable(e))
            }
        }
    }

    fun choose(questionIndex: Int, optionIndex: Int) {
        val answers = _state.value.answers.toMutableList()
        if (questionIndex !in answers.indices) return
        answers[questionIndex] = optionIndex
        _state.value = _state.value.copy(answers = answers, error = null)
    }

    /** 提交测评。**必须六题全答**，少一题后端回 `INCOMPLETE_ANSWERS`。 */
    fun submitAssessment() {
        val current = _state.value
        if (!current.answered || current.assessing) return
        _state.value = current.copy(assessing = true, error = null)
        viewModelScope.launch {
            try {
                val risk = bank.submitRiskAssessment(current.answers)
                _state.value = _state.value.copy(assessing = false, risk = risk)
            } catch (e: Exception) {
                _state.value = _state.value.copy(assessing = false, error = readable(e))
            }
        }
    }

    fun updateName(value: String) { _state.value = _state.value.copy(holderName = value, error = null) }

    fun updateIdNumber(value: String) { _state.value = _state.value.copy(idNumber = value.trim().take(18), error = null) }

    fun updatePhone(value: String) {
        _state.value = _state.value.copy(phone = value.filter { it.isDigit() }.take(11), error = null)
    }

    fun updateSmsCode(value: String) {
        _state.value = _state.value.copy(smsCode = value.filter { it.isDigit() }.take(6), error = null)
    }

    fun selectSettlement(id: String) { _state.value = _state.value.copy(settlementAccountId = id, error = null) }

    fun setPledged(value: Boolean) { _state.value = _state.value.copy(pledged = value, error = null) }

    fun requestSms() {
        val current = _state.value
        if (!current.canRequestSms) return
        _state.value = current.copy(sending = true, error = null)
        viewModelScope.launch {
            try {
                val result = bank.sendSmsCode(current.phone.trim())
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

    /** 人脸核身。与开储蓄账户同一套——**不开理财户也躲不掉它**。 */
    fun verifyFace() {
        if (_state.value.verifying) return
        _state.value = _state.value.copy(verifying = true, error = null)
        viewModelScope.launch {
            try {
                val ticket = bank.verifyIdentity("face")
                _state.value = _state.value.copy(verifying = false, faceTicket = ticket.ticket)
            } catch (e: Exception) {
                _state.value = _state.value.copy(verifying = false, error = readable(e))
            }
        }
    }

    fun submit() {
        val current = _state.value
        val problem = current.firstProblem()
        if (problem != null) {
            _state.value = current.copy(error = problem)
            return
        }
        if (current.submitting) return
        _state.value = current.copy(submitting = true, error = null)
        viewModelScope.launch {
            try {
                bank.openWealthAccount(
                    WealthAccountOpeningRequest(
                        holderName = current.holderName.trim(),
                        idNumber = current.idNumber.trim(),
                        smsCode = current.smsCode,
                        faceTicket = current.faceTicket,
                        settlementAccountId = current.settlementAccountId,
                        // **逐字**：后端比对的就是这个常量
                        agreement = WealthOpening.AGREEMENT,
                    ),
                )
                _state.value = _state.value.copy(submitting = false, done = true)
            } catch (e: Exception) {
                _state.value = _state.value.copy(submitting = false, error = readable(e))
            }
        }
    }

    fun dismissError() { _state.value = _state.value.copy(error = null) }

    private fun readable(e: Exception): String = when (e) {
        is BankApiException -> e.message
        else -> "网络不给力，请稍后再试"
    }
}
