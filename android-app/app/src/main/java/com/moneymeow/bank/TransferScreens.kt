package com.moneymeow.bank

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
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class Method(val label: String, val desc: String, val icon: ImageVector, val route: String)

private val methods = listOf(
    Method("手机号转账", "本行与他行账户，凭手机号直达", Icons.Phone, "手机号转账"),
    Method("银行卡号转账", "支持本行与他行储蓄卡", Icons.Card, "银行卡号转账"),
    Method("跨境支付通", "转数快（FPS）· 港币 / 离岸人民币", Icons.Globe, "跨境支付通"),
)

private data class Payee(val initial: String, val name: String, val meta: String, val time: String)

private val payees = listOf(
    Payee("陈", "陈嘉禾", "招财猫银行 ··8821", "10月12日"),
    Payee("王", "王思远", "招商银行 ··6633", "10月8日"),
    Payee("L", "LAM HO**", "转数快 FPS", "9月30日"),
)

@Composable
fun TransferSelectScreen(onBack: () -> Unit, onPick: (String) -> Unit, onPickPayee: (TransferDraft) -> Unit) {
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
                            .clickable { onPick(method.route) }
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
                            Text(method.label, fontSize = 13.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                            Spacer(Modifier.height(3.dp))
                            Text(method.desc, fontSize = 11.sp, color = Tokens.Muted)
                        }
                        Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(14.dp))
                    }
                }
            }
        }

        SectionHeader("历史收款人")
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            payees.forEach { payee ->
                HairlineCard {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                onPickPayee(
                                    TransferDraft(
                                        channel = if (payee.meta.contains("FPS")) "fps" else "bank",
                                        payeeName = payee.name,
                                        payeeAccountNo = if (payee.meta.contains("FPS")) "+85291234321" else "6225880137706633",
                                        bankCode = if (payee.meta.contains("FPS")) "HSB" else "CMB",
                                        bankRegion = if (payee.meta.contains("FPS")) "HK" else "CN",
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

    FormScaffold(title = title, onBack = onBack, actionLabel = "下一步", onAction = {
        val name = payeeName.ifEmpty { "陈嘉禾" }
        val no = when (title) {
            "手机号转账" -> accountNo.ifEmpty { phone }
            else -> accountNo
        }
        onDraftChange(
            draft.copy(
                channel = if (title == "跨境支付通") "fps" else "bank",
                payeeName = name,
                payeeAccountNo = no,
                bankCode = bankCode,
            )
        )
        onNext()
    }) {
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
    var amountText by remember { mutableStateOf("500.00") }
    var memo by remember { mutableStateOf("房租分摊") }
    var quote by remember { mutableStateOf<TransferQuoteDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var accountId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState()

    val amountCents = remember(amountText) {
        amountText.toDoubleOrNull()?.let { Math.round(it * 100) } ?: 0L
    }

    LaunchedEffect(Unit) {
        runCatching { BankApi.accounts().firstOrNull()?.id }
            .onSuccess { accountId = it }
    }
    LaunchedEffect(accountId, amountCents) {
        val id = accountId ?: return@LaunchedEffect
        if (amountCents <= 0) return@LaunchedEffect
        runCatching { BankApi.transferQuote(id, draft.channel, "domestic", amountCents, draft.bankCode, draft.bankRegion) }
            .onSuccess { quote = it; error = null }
            .onFailure { error = it.message }
    }

    PushScreen(title = "填写金额", onBack = onBack) {
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
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 18.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text("¥", fontSize = 24.sp, color = Tokens.Ink, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.size(6.dp))
            androidx.compose.foundation.text.BasicTextField(
                value = amountText,
                onValueChange = { input ->
                    amountText = input.filter { it.isDigit() || it == '.' }.take(12)
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
                "手续费" to (quote?.let { formatCents(it.fee) } ?: "—"),
                "到账时间" to (quote?.etaText ?: "—"),
                "单笔限额" to (quote?.let { formatCents(it.singleLimit) } ?: "—"),
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        if (error != null) {
            Text(
                error!!,
                fontSize = 11.5.sp,
                color = Tokens.Coral,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        Spacer(Modifier.height(12.dp))
        Column(Modifier.padding(horizontal = 14.dp)) {
            TextFieldRow(
                label = "附言",
                value = memo,
                onValueChange = { memo = it.take(30) },
                placeholder = "选填",
            )
        }
        Spacer(Modifier.height(18.dp))
        PrimaryButton("确认转出", { confirm = true }, Modifier.padding(horizontal = 14.dp))
    }

    if (confirm) {
        ModalBottomSheet(
            onDismissRequest = { confirm = false },
            sheetState = sheetState,
            containerColor = Tokens.Surface,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text("确认转账", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                KvRow("收款人", draft.payeeName.ifEmpty { "—" })
                KvRow("转账金额", formatCents(amountCents))
                KvRow("手续费", quote?.let { formatCents(it.fee) } ?: "—")
                KvRow("付款账户", "人民币活期")
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "支付密码",
                    value = password,
                    onValueChange = { password = it.filter(Char::isDigit).take(6) },
                    placeholder = "6 位支付密码",
                    password = true,
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                )
                Spacer(Modifier.height(16.dp))
                PrimaryButton(
                    if (submitting) "提交中…" else "确认支付",
                    onClick = {
                        val id = accountId ?: return@PrimaryButton
                        if (submitting) return@PrimaryButton
                        submitting = true
                        error = null
                        scope.launch {
                            runCatching {
                                BankApi.submitTransfer(
                                    fromAccountId = id,
                                    channel = draft.channel,
                                    scope = "domestic",
                                    payeeName = draft.payeeName,
                                    amount = amountCents,
                                    memo = memo,
                                    bankCode = draft.bankCode,
                                    bankRegion = draft.bankRegion,
                                    payeeAccountNo = draft.payeeAccountNo,
                                )
                            }
                                .onSuccess {
                                    confirm = false
                                    submitting = false
                                    onSubmitted(it)
                                }
                                .onFailure {
                                    error = it.message
                                    submitting = false
                                }
                        }
                    },
                )
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

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
                    null -> "转账已提交"
                    else -> "转账成功"
                },
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Ink,
            )
            Spacer(Modifier.height(26.dp))
            Text(
                result?.let { formatCents(it.amount) } ?: "—",
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
