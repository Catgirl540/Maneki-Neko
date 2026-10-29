package com.moneymeow.bank

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

private data class Method(
    val label: String,
    val desc: String,
    val icon: ImageVector,
    val route: String,
    val enabled: Boolean = true,
)

private val methods = listOf(
    Method("手机号转账", "暂未安全接入，请使用银行卡号转账", Icons.Phone, "手机号转账", enabled = false),
    Method("银行卡号转账", "支持本行与他行储蓄卡", Icons.Card, "银行卡号转账"),
    Method("跨境支付通", "转数快（FPS）暂未安全接入", Icons.Globe, "跨境支付通", enabled = false),
)

private data class Payee(val initial: String, val name: String, val meta: String, val time: String)

/** 历史收款人来自真实转出流水，不预置名单。 */
@Composable
private fun rememberPayees(): List<Payee> {
    var rows by remember { mutableStateOf<List<TransactionDto>>(emptyList()) }
    LaunchedEffect(Unit) {
        runCatching {
            val account = BankApi.accounts().firstOrNull() ?: return@runCatching emptyList()
            BankApi.transactions(account.id, 30)
        }.onSuccess { rows = it }
    }
    return remember(rows) {
        rows.filter { it.direction == "out" && it.category == "transfer" && it.counterparty.isNotBlank() }
            .distinctBy { it.counterparty }
            .take(3)
            .map { dto ->
                val date = runCatching { java.time.LocalDate.parse(dto.createdAt.take(10)) }.getOrNull()
                val display = dto.counterparty.removePrefix("转账 · ").ifEmpty { dto.counterparty }
                Payee(
                    initial = display.take(1),
                    name = display,
                    meta = BankApi.categoryLabel(dto.category),
                    time = date?.let { "${it.monthValue}月${it.dayOfMonth}日" } ?: "",
                )
            }
    }
}

@Composable
fun TransferSelectScreen(onBack: () -> Unit, onPick: (String) -> Unit, onPickPayee: (TransferDraft) -> Unit) {
    val payees = rememberPayees()
    PushScreen(title = "转出", onBack = onBack) {
        // 搜索框
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp)
                .height(42.dp)
                .clip(CircleShape)
                .background(Tokens.Surface)
                .border(1.dp, Tokens.Border, CircleShape)
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Search, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(16.dp))
                Spacer(Modifier.size(8.dp))
                Text("手机号 / 银行卡号 / 收款人", fontSize = 12.5.sp, color = Tokens.Muted)
            }
        }

        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            methods.forEach { method ->
                HairlineCard {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable(enabled = method.enabled) { onPick(method.route) }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Tokens.SurfaceWarm),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(method.icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(20.dp))
                        }
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                method.label,
                                fontSize = 13.5.sp,
                                color = if (method.enabled) Tokens.Ink else Tokens.Muted,
                                fontWeight = FontWeight.Medium,
                            )
                            Spacer(Modifier.height(3.dp))
                            Text(method.desc, fontSize = 11.sp, color = Tokens.Muted)
                        }
                        if (method.enabled) {
                            Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(14.dp))
                        } else {
                            Text("暂未开放", fontSize = 10.5.sp, color = Tokens.Muted)
                        }
                    }
                }
            }
        }
        Text(
            "手机号转账与跨境支付通（FPS）暂未开放：支付密码和完整收款信息确认尚未接入。请使用银行卡号转账。",
            fontSize = 11.sp,
            color = Tokens.Muted,
            lineHeight = 17.sp,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
        )

        SectionHeader("历史收款人")
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (payees.isEmpty()) {
                Text(
                    "暂无历史收款人",
                    fontSize = 12.sp,
                    color = Tokens.Muted,
                    modifier = Modifier.padding(vertical = 12.dp),
                )
            }
            payees.forEach { payee ->
                HairlineCard {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                onPickPayee(
                                    // 历史收款人只带回姓名，账号仍需本人填写，避免用编造的账号下单。
                                    TransferDraft(
                                        channel = "bank",
                                        payeeName = payee.name,
                                        payeeAccountNo = "",
                                        bankCode = "",
                                        bankRegion = "CN",
                                    )
                                )
                            }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(38.dp)
                                .clip(CircleShape)
                                .background(Tokens.SurfaceWarm),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(payee.initial, fontSize = 14.sp, color = Tokens.Ink2, fontWeight = FontWeight.SemiBold)
                        }
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(payee.name, fontSize = 13.5.sp, color = Tokens.Ink)
                            Spacer(Modifier.height(3.dp))
                            Text(payee.meta, fontSize = 11.sp, color = Tokens.Muted)
                        }
                        Text(payee.time, fontSize = 11.sp, color = Tokens.Muted)
                    }
                }
            }
        }
    }
}

/** 三个渠道表单：字段不同，样式一致。 */
@Composable
fun TransferFormScreen(
    title: String,
    onBack: () -> Unit,
    draft: TransferDraft,
    onDraftChange: (TransferDraft) -> Unit,
    onNext: () -> Unit,
) {
    var payeeName by remember { mutableStateOf(draft.payeeName) }
    var accountNo by remember { mutableStateOf(draft.payeeAccountNo) }
    var phone by remember { mutableStateOf("") }
    var bankCode by remember { mutableStateOf(draft.bankCode) }
    var formError by remember { mutableStateOf<String?>(null) }

    FormScaffold(title = title, onBack = onBack, actionLabel = "下一步", onAction = {
        if (title != "银行卡号转账") {
            formError = "该转账方式暂未安全接入，请返回选择银行卡号转账"
            return@FormScaffold
        }
        val name = payeeName.trim()
        val no = accountNo.trim()
        if (name.isEmpty() || no.isBlank() || bankCode.isBlank()) {
            formError = "请填写收款人姓名、完整银行卡号和收款银行代码"
            return@FormScaffold
        }
        if (!no.matches(Regex("\\d{12,19}"))) {
            formError = "请输入 12–19 位完整银行卡号"
            return@FormScaffold
        }
        onDraftChange(
            draft.copy(
                channel = "bank",
                payeeName = name,
                payeeAccountNo = no,
                bankCode = bankCode,
                bankRegion = "CN",
                method = "bankCard",
            )
        )
        onNext()
    }) {
        formError?.let { Text(it, color = Tokens.Coral, modifier = Modifier.padding(vertical = 8.dp)) }
        when (title) {
            "手机号转账" -> {
                TextFieldRow(
                    label = "收款人手机号",
                    value = phone,
                    onValueChange = { phone = it.filter(Char::isDigit).take(11) },
                    placeholder = "请输入已登记的手机号",
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Phone,
                )
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "收款人姓名",
                    value = payeeName,
                    onValueChange = { payeeName = it },
                    placeholder = "请输入收款人姓名",
                )
            }
            "银行卡号转账" -> {
                TextFieldRow(
                    label = "银行卡号",
                    value = accountNo,
                    onValueChange = { accountNo = it.filter(Char::isDigit).take(19) },
                    placeholder = "请输入卡号",
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                )
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "收款人姓名",
                    value = payeeName,
                    onValueChange = { payeeName = it },
                    placeholder = "请输入收款人姓名",
                )
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "收款银行代码",
                    value = bankCode,
                    onValueChange = { bankCode = it.uppercase().take(8) },
                    placeholder = "例如 CMB（招商银行）",
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "目前仅支持中国内地银行卡号转账；手机号转账与跨境支付通暂未开放。",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                    lineHeight = 17.sp,
                )
            }
            else -> {
                Text("收款标识类型", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(6.dp))
                var seg by remember { mutableStateOf(0) }
                SegTabs(listOf("手机号", "电邮", "FPS ID", "账户"), seg) { seg = it }
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "收款标识",
                    value = accountNo,
                    onValueChange = { accountNo = it },
                    placeholder = "+852 · · · · · · · ·",
                )
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "收款人姓名",
                    value = payeeName,
                    onValueChange = { payeeName = it },
                    placeholder = "LAM HO**",
                )
            }
        }
    }
}

@Composable
internal fun Field(label: String, value: String, hint: String? = null, placeholder: Boolean = false) {
    Column {
        Text(label, fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 6.dp, start = 2.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(46.dp)
                .clip(CircleShape)
                .background(Tokens.Surface)
                .border(1.dp, Tokens.Border, CircleShape)
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(value, fontSize = 14.sp, color = if (placeholder) Tokens.Muted else Tokens.Ink)
        }
        if (hint != null) {
            Text(hint, fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(top = 6.dp, start = 2.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AmountScreen(
    onBack: () -> Unit,
    draft: TransferDraft,
    onSubmitted: (TransferResultDto) -> Unit,
) {
    var amountText by remember { mutableStateOf("") }
    var memo by remember { mutableStateOf("") }
    var quote by remember { mutableStateOf<TransferQuoteDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var payCurrency by remember { mutableStateOf("CNY") }
    var receiveCurrency by remember { mutableStateOf("CNY") }
    var quoteNonce by remember { mutableStateOf(0) }
    var loadingQuote by remember { mutableStateOf(false) }
    var opening by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var ambiguousOutcome by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var confirmError by remember { mutableStateOf<String?>(null) }
    var recipient by remember { mutableStateOf<TransferRecipientDto?>(null) }
    var confirmation by remember { mutableStateOf<TransferConfirmation?>(null) }
    var idempotencyKey by remember { mutableStateOf<String?>(null) }

    val currencies = listOf("CNY", "USD", "HKD")
    val selectedBalance = account?.currencyBalances?.firstOrNull { it.currency == payCurrency && it.id.isNotBlank() }
    val accountId = selectedBalance?.id
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val submitGuard = remember { AtomicBoolean(false) }
    val openGuard = remember { AtomicBoolean(false) }

    val amountCents = remember(amountText) {
        if (amountText.matches(Regex("[0-9]+(\\.[0-9]{0,2})?")))
            runCatching { java.math.BigDecimal(amountText).movePointRight(2).longValueExact() }.getOrDefault(0L)
        else 0L
    }
    val sameCurrency = payCurrency == receiveCurrency
    val accountNoValid = draft.payeeAccountNo.matches(Regex("\\d{12,19}"))
    val bankFlowReady = draft.method == "bankCard" &&
        draft.channel == "bank" &&
        draft.bankRegion == "CN" &&
        draft.bankCode.isNotBlank() &&
        accountNoValid &&
        draft.payeeName.isNotBlank()

    LaunchedEffect(Unit) {
        runCatching { BankApi.accounts().firstOrNull() }
            .onSuccess { account = it }
            .onFailure { error = it.message ?: "账户加载失败" }
    }
    LaunchedEffect(accountId, amountCents, payCurrency, receiveCurrency, quoteNonce) {
        quote = null
        confirmation = null
        idempotencyKey = null
        if (!bankFlowReady || !sameCurrency || amountCents <= 0) return@LaunchedEffect
        val id = accountId ?: return@LaunchedEffect
        val balance = selectedBalance ?: return@LaunchedEffect
        loadingQuote = true
        error = null
        try {
            val fresh = BankApi.transferQuote(
                fromAccountId = id,
                channel = "bank",
                scope = "domestic",
                amount = amountCents,
                bankCode = draft.bankCode,
                bankRegion = "CN",
                payeeCurrency = payCurrency,
            )
            val problem = quoteProblem(fresh, amountCents, balance.available)
            if (problem != null) error = problem else quote = fresh
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = failure.message ?: "报价失败"
        } finally {
            loadingQuote = false
        }
    }

    /**
     * 打开确认页前重新核对能力声明、收款人和报价。
     * 任何一项无法确认都不进入确认页，避免用旧报价或未核对的收款人提交。
     */
    fun openConfirmation() {
        if (opening || submitting) return
        if (ambiguousOutcome) {
            // 上次提交结果未知时只允许复用原确认与幂等键重试；绝不开新确认，避免重复扣款。
            if (confirmation != null && idempotencyKey != null) {
                confirm = true
                confirmError = "上次提交结果未知：再次提交会复用同一幂等键，不会重复扣款；也可先核对交易记录。"
            } else {
                error = "上一次提交结果未知，请先返回交易记录核对，勿重新发起转账。"
            }
            return
        }
        if (!openGuard.compareAndSet(false, true)) return
        opening = true
        error = null
        confirmError = null
        scope.launch {
            try {
                if (draft.method != "bankCard" || draft.channel != "bank") {
                    error = "该转账方式暂未安全接入，请返回选择银行卡号转账。"
                    return@launch
                }
                if (draft.bankRegion != "CN") {
                    error = "目前仅支持中国内地银行卡号转账。"
                    return@launch
                }
                if (!accountNoValid) {
                    error = "请返回填写 12–19 位完整收款账号。"
                    return@launch
                }
                if (!sameCurrency) {
                    error = "跨币种转账暂未开放，请选择相同付款与到账币种。"
                    return@launch
                }
                if (amountCents <= 0) {
                    error = "请输入有效转账金额。"
                    return@launch
                }
                val balance = selectedBalance ?: run {
                    error = "该币种暂无可用于转账的余额分区。"
                    return@launch
                }
                val support = try {
                    BankApi.transferRequirements()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    error = failure.message ?: "无法确认转账安全设置，请稍后再试。"
                    return@launch
                }
                if (!support.transferPaymentPassword || support.confirmedQuoteVersion != 1) {
                    error = "银行服务暂不支持安全转账，请稍后再试。"
                    return@launch
                }
                val resolved = try {
                    BankApi.resolveTransferRecipient(
                        bankCode = draft.bankCode,
                        bankRegion = "CN",
                        accountOrCardNo = draft.payeeAccountNo,
                        payeeName = draft.payeeName,
                    )
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    error = failure.message ?: "收款信息核对失败，请检查后重试。"
                    return@launch
                }
                val fresh = try {
                    BankApi.transferQuote(
                        fromAccountId = balance.id,
                        channel = "bank",
                        scope = "domestic",
                        amount = amountCents,
                        bankCode = draft.bankCode,
                        bankRegion = "CN",
                        payeeCurrency = payCurrency,
                    )
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    error = failure.message ?: "报价失败，请稍后重试。"
                    return@launch
                }
                val problem = quoteProblem(fresh, amountCents, balance.available)
                if (problem != null) {
                    error = problem
                    return@launch
                }
                quote = fresh
                recipient = resolved
                confirmation = TransferConfirmation(
                    fromCurrency = payCurrency,
                    fee = fresh.fee,
                    submitBefore = System.currentTimeMillis() + 180_000,
                )
                idempotencyKey = UUID.randomUUID().toString()
                password = ""
                confirmError = null
                confirm = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                error = failure.message ?: "转账准备失败，请稍后再试。"
            } finally {
                opening = false
                openGuard.set(false)
            }
        }
    }

    fun submitConfirmed() {
        if (submitting || !submitGuard.compareAndSet(false, true)) return
        val snapshot = confirmation
        val balance = selectedBalance
        if (snapshot == null || balance == null) {
            submitGuard.set(false)
            confirmError = "确认信息已失效，请关闭后重新确认。"
            return
        }
        if (password.length != 6 || !password.all(Char::isDigit)) {
            submitGuard.set(false)
            confirmError = "请输入 6 位数字支付密码"
            return
        }
        // 上次结果未知时允许超时后重试：服务端先查幂等键，成功过就回放原结果，不会重复扣款。
        if (!ambiguousOutcome && System.currentTimeMillis() >= snapshot.submitBefore) {
            submitGuard.set(false)
            confirmError = "报价已过期，请关闭后重新确认。"
            return
        }
        submitting = true
        confirmError = null
        scope.launch {
            try {
                val result = BankApi.submitTransfer(
                    fromAccountId = balance.id,
                    channel = "bank",
                    scope = "domestic",
                    payeeName = draft.payeeName,
                    amount = amountCents,
                    memo = memo,
                    bankCode = draft.bankCode,
                    bankRegion = "CN",
                    payeeAccountNo = draft.payeeAccountNo,
                    payeeCurrency = receiveCurrency,
                    paymentPassword = password,
                    confirmedQuote = snapshot,
                    idempotencyKey = idempotencyKey,
                )
                password = ""
                confirm = false
                onSubmitted(result)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: BankApiException) {
                when (failure.code) {
                    "BAD_PAY_PASSWORD" -> {
                        confirmError = failure.message
                        password = ""
                    }
                    "ACCOUNT_FROZEN" -> confirmError = failure.message
                    "QUOTE_EXPIRED", "QUOTE_CHANGED" -> {
                        // 服务端先查幂等键再校验报价；回放成功会直接返回，走到这里说明上次未执行成功。
                        ambiguousOutcome = false
                        confirm = false
                        confirmation = null
                        idempotencyKey = null
                        quote = null
                        error = (failure.message ?: "报价已变化") + "，请重新确认报价。"
                        quoteNonce += 1
                    }
                    "IDEMPOTENCY_CONFLICT" -> {
                        confirmation = null
                        idempotencyKey = null
                        confirmError = "本次确认已失效，请关闭后重新确认。"
                    }
                    "TRANSFER_SECURITY_UNAVAILABLE" -> confirmError = failure.message
                    else -> {
                        if (failure.status >= 500 || failure.status == 408) {
                            ambiguousOutcome = true
                            confirmError = "网络或银行服务异常，转账结果未知。可先核对交易记录；再次提交会复用同一幂等键，不会重复扣款。"
                        } else {
                            confirmError = failure.message
                        }
                    }
                }
            } catch (failure: Exception) {
                ambiguousOutcome = true
                confirmError = "网络异常，转账结果未知。可先核对交易记录；再次提交会复用同一幂等键，不会重复扣款。"
            } finally {
                submitting = false
                submitGuard.set(false)
            }
        }
    }

    BackHandler(enabled = opening || submitting) { }
    PushScreen(title = "填写金额", onBack = { if (!opening && !submitting) onBack() }) {
        HairlineCard(Modifier.fillMaxWidth().padding(horizontal = 14.dp)) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(Tokens.SurfaceWarm),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        draft.payeeName.take(1).ifEmpty { "收" },
                        fontSize = 14.sp,
                        color = Tokens.Ink2,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                Spacer(Modifier.size(12.dp))
                Column {
                    Text(draft.payeeName.ifEmpty { "未填写收款人" }, fontSize = 14.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                    Text(
                        draft.payeeAccountNo.ifEmpty { "请返回上一步填写收款信息" },
                        fontSize = 11.5.sp,
                        color = Tokens.Muted,
                    )
                }
            }
        }
        if (!bankFlowReady) {
            Text(
                "请返回并选择「银行卡号转账」，填写完整收款银行与 12–19 位收款账号后再转账。",
                fontSize = 11.5.sp,
                color = Tokens.Coral,
                lineHeight = 17.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            )
        }
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Text("付款币种", fontSize = 12.sp, color = Tokens.Muted)
            SegTabs(currencies, currencies.indexOf(payCurrency)) { if (!opening && !submitting && !confirm && !ambiguousOutcome) payCurrency = currencies[it] }
            Text(
                selectedBalance?.let { "可用余额 ${formatCents(it.available, payCurrency)}" }
                    ?: "该币种暂无余额分区，无法从该币种转账",
                fontSize = 11.sp,
                color = Tokens.Muted,
            )
            Spacer(Modifier.height(12.dp))
            Text("到账币种", fontSize = 12.sp, color = Tokens.Muted)
            SegTabs(currencies, currencies.indexOf(receiveCurrency)) { if (!opening && !submitting && !confirm && !ambiguousOutcome) receiveCurrency = currencies[it] }
            if (!sameCurrency) {
                Text(
                    "跨币种转账暂未开放：无法完整确认换汇报价，请选择与付款币种相同的到账币种。",
                    fontSize = 11.sp,
                    color = Tokens.Coral,
                    lineHeight = 17.sp,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 18.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(payCurrency, fontSize = 18.sp, color = Tokens.Ink, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.size(6.dp))
            androidx.compose.foundation.text.BasicTextField(
                value = amountText,
                onValueChange = { input ->
                    if (!opening && !submitting && !confirm && !ambiguousOutcome) {
                        val filtered = input.filter { it in '0'..'9' || it == '.' }.take(12)
                        if (filtered.isEmpty() || filtered.matches(Regex("[0-9]*(\\.[0-9]{0,2})?"))) amountText = filtered
                    }
                },
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(
                    fontSize = 34.sp,
                    color = Tokens.Ink,
                    fontWeight = FontWeight.SemiBold,
                ),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal,
                ),
                modifier = Modifier.weight(1f),
            )
        }
        KvCard(
            listOf(
                "预计到账" to (quote?.let { formatCents(it.receiveAmount ?: amountCents, receiveCurrency) } ?: "—"),
                "汇率" to (quote?.rate?.toString() ?: if (quote != null) "同币种" else "—"),
                "手续费" to (quote?.let { formatCents(it.fee, payCurrency) } ?: "—"),
                "到账时间" to (quote?.etaText ?: "—"),
                "单笔限额" to (quote?.let { formatCents(it.singleLimit, payCurrency) } ?: "—"),
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        if (loadingQuote) {
            Text(
                "正在获取报价…",
                fontSize = 11.5.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        if (error != null) {
            Text(
                error!!,
                fontSize = 11.5.sp,
                color = Tokens.Coral,
                lineHeight = 17.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        Spacer(Modifier.height(12.dp))
        Column(Modifier.padding(horizontal = 14.dp)) {
            TextFieldRow(
                label = "附言",
                value = memo,
                onValueChange = { if (!opening && !submitting && !confirm && !ambiguousOutcome) memo = it.take(30) },
                placeholder = "选填",
            )
        }
        Spacer(Modifier.height(18.dp))
        PrimaryButton(
            text = when {
                submitting -> "提交中…"
                opening -> "正在核对…"
                else -> "确认转出"
            },
            onClick = { openConfirmation() },
            modifier = Modifier
                .padding(horizontal = 14.dp)
                .alpha(if (opening || submitting || !sameCurrency) 0.55f else 1f),
        )
    }

    if (confirm) {
        ModalBottomSheet(
            onDismissRequest = {
                if (!submitting) {
                    confirm = false
                    password = ""
                    confirmError = null
                }
            },
            sheetState = sheetState,
            containerColor = Tokens.Surface,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text("确认转账", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                KvRow("收款人", draft.payeeName.ifEmpty { "—" })
                recipient?.holderNameMasked?.takeIf { it.isNotBlank() }?.let {
                    KvRow("户名核对", it)
                }
                recipient?.accountNoMasked?.takeIf { it.isNotBlank() }?.let {
                    KvRow("收款账号", it)
                }
                KvRow("收款银行", "${draft.bankCode} · 中国内地")
                KvRow("转账金额", formatCents(amountCents, payCurrency))
                KvRow("手续费", confirmation?.let { formatCents(it.fee, payCurrency) } ?: "—")
                KvRow("付款合计", confirmation?.let { formatCents(amountCents + it.fee, payCurrency) } ?: "—")
                KvRow("到账币种", receiveCurrency)
                KvRow("预计到账", quote?.etaText ?: "—")
                confirmation?.let { KvRow("报价有效至", formatClock(it.submitBefore)) }
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "支付密码",
                    value = password,
                    onValueChange = {
                        if (!submitting) {
                            password = it.filter(Char::isDigit).take(6)
                            confirmError = null
                        }
                    },
                    placeholder = "6 位数字支付密码",
                    password = true,
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                )
                confirmError?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, fontSize = 11.5.sp, color = Tokens.Coral, lineHeight = 17.sp)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "支付密码只随本次提交发送，不会保存。连续输错 5 次会冻结账号。",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                    lineHeight = 17.sp,
                )
                Spacer(Modifier.height(14.dp))
                PrimaryButton(
                    text = if (submitting) "提交中…" else "确认提交",
                    onClick = { submitConfirmed() },
                    modifier = Modifier.alpha(if (submitting) 0.55f else 1f),
                )
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

/** 同币种转账报价的完整性校验；不满足时不进入确认页。 */
private fun quoteProblem(
    quote: TransferQuoteDto,
    amountCents: Long,
    available: Long,
): String? {
    if (quote.fee < 0) return "报价手续费无效，请稍后重试"
    if (quote.singleLimit <= 0 || quote.maxAmount <= 0) return "报价限额无效，请稍后重试"
    if (amountCents > quote.singleLimit) return "转账金额超过单笔上限"
    if (amountCents > quote.maxAmount) return "转账金额超过可用余额"
    if (quote.fee > available || amountCents > available - quote.fee) return "可用余额不足以支付金额与手续费"
    if (quote.rate != null || quote.receiveAmount != null) return "同币种报价不应包含换汇信息，请稍后重试"
    return null
}

private val transferClock = DateTimeFormatter.ofPattern("HH:mm:ss")

private fun formatClock(epochMillis: Long): String =
    Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()).format(transferClock)

@Composable
fun TransferResultScreen(
    result: TransferResultDto?,
    onBack: () -> Unit,
    onHome: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Page),
    ) {
        TopBar("转账结果", onBack)
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(96.dp))
            Box(
                Modifier
                    .size(78.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFE7F5EC)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Check, contentDescription = null, tint = Color(0xFF1F9D6B), modifier = Modifier.size(32.dp))
            }
            Spacer(Modifier.height(22.dp))
            Text(
                when (result?.settlementStatus) {
                    "pending" -> "转账已受理"
                    "success" -> "转账成功"
                    else -> "转账状态待核实"
                },
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Ink,
            )
            Spacer(Modifier.height(26.dp))
            Text(
                result?.let { formatCents(it.amount, it.currency) } ?: "—",
                fontSize = 32.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Ink,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                result?.let { "交易号 ${it.referenceNo}" } ?: "—",
                fontSize = 12.sp,
                color = Tokens.Muted,
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 16.dp),
        ) {
            PrimaryButton("完成", onHome)
        }
    }
}
