package com.moneymeow.bank

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
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
    Method("内地转账", "本行与他行储蓄卡 · 实时到账免手续费", Icons.Card, "银行卡号转账"),
    Method("境外转账", "转数快手机号、电邮、FPS ID 或香港账户", Icons.Globe, "跨境支付通"),
)

/** Display only: the original account identifier remains in the transfer draft. */
private fun transferAccountLabel(value: String, verifiedMask: String? = null): String {
    verifiedMask?.takeIf { it.isNotBlank() }?.let { return it }
    val compact = value.filterNot(Char::isWhitespace)
    return when {
        compact.isEmpty() -> "未填写收款账号"
        compact.contains('*') || compact.contains('•') -> value
        compact.length > 8 -> "${compact.take(4)} **** **** ${compact.takeLast(4)}"
        compact.length > 4 -> "${compact.take(2)} **** ${compact.takeLast(2)}"
        else -> compact
    }
}

@Composable
private fun TransferReviewRow(label: String, value: String, emphasized: Boolean = false) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, color = Tokens.Muted, fontSize = 12.sp, modifier = Modifier.width(82.dp))
        Text(
            value,
            color = Tokens.Ink,
            fontSize = if (emphasized) 14.sp else 12.sp,
            fontWeight = if (emphasized) FontWeight.SemiBold else FontWeight.Medium,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
fun TransferSelectScreen(onBack: () -> Unit, onPick: (String) -> Unit, onPickPayee: (TransferDraft) -> Unit) {
    // 收款人列表收进二级页：转出页只留一个入口卡片，长列表不再撑开一级页面。
    var picking by remember { mutableStateOf(false) }
    BackHandler(enabled = picking) { picking = false }
    if (picking) {
        PayeePickerScreen(onBack = { picking = false }, onPickPayee = onPickPayee)
        return
    }
    PushScreen(title = "转出", onBack = onBack) {
        PageColumn {
            (listOf(Method("定时转账与 AA 收付款", "预约定时转账、均分/分项 AA 与催收", Icons.Transfer, "定时转账与 AA")) + methods).forEach { method ->
                EntryRow(Icons.bolder(method.icon), method.label, onClick = { onPick(method.route) }, chevron = false)
            }
            EntryRow(Icons.Search, "选择收款人", onClick = { picking = true }, chevron = false)
        }
    }
}

/** 二级页：已保存收款人按卡片排列，点卡片或「核对转账」进核对页，「备注」就地编辑。 */
@Composable
private fun PayeePickerScreen(onBack: () -> Unit, onPickPayee: (TransferDraft) -> Unit) {
    var query by remember { mutableStateOf("") }
    var payees by remember { mutableStateOf<List<org.json.JSONObject>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var editing by remember { mutableStateOf<org.json.JSONObject?>(null) }
    var remark by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(query, reload) {
        loading = true; error = null; payees = emptyList()
        try {
            kotlinx.coroutines.delay(200)
            val rows = BankApi.savedPayees(query)
            payees = (0 until rows.length()).map { rows.getJSONObject(it) }
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "收款人加载失败" }
        finally { loading = false }
    }

    PushScreen(title = "选择收款人", onBack = onBack) {
        PageColumn {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .clip(CircleShape)
                    .background(Tokens.SurfaceWarm)
                    .border(1.dp, Tokens.Border, CircleShape)
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Search, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                BasicTextField(
                    value = query,
                    onValueChange = { query = it.take(140) },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Ink),
                    cursorBrush = SolidColor(Tokens.Accent),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (query.isEmpty()) Text("姓名 / 账号 / 手机号 / 备注", fontSize = 13.5.sp, color = Tokens.Muted)
                        inner()
                    },
                )
            }
            when {
                loading -> repeat(3) { HairlineCard(Modifier.fillMaxWidth()) { SkeletonRow() } }
                error != null -> HairlineCard(Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(error!!, color = Tokens.Coral, fontSize = 12.sp, modifier = Modifier.weight(1f))
                        TextButton(onClick = { reload++ }) { Text("重试", style = Tokens.Text.body) }
                    }
                }
                payees.isEmpty() -> BankEmptyState(
                    title = "没有匹配的收款人",
                    description = "换个姓名、账号、手机号或备注再试。",
                    icon = Icons.Search,
                )
                else -> payees.forEach { row ->
                    PayeeCard(
                        row = row,
                        enabled = !busy,
                        onPick = { onPickPayee(payeeDraft(row)) },
                        onRemark = { editing = row; remark = row.optString("remark"); error = null },
                    )
                }
            }
        }
    }

    editing?.let { row -> AlertDialog(onDismissRequest = { if (!busy) editing = null }, title = { Text("收款人备注") }, text = { Column { Text(row.getString("name")); TextFieldRow("备注", remark, { if (!busy) remark = it.take(140) }); error?.let { ErrorNote(it) } } }, confirmButton = { TextButton(enabled = !busy, onClick = {
        busy = true; error = null
        scope.launch { try { BankApi.payeeRemark(row.getString("id"), remark); editing = null; reload++ } catch (failure: Exception) { error = failure.message ?: "备注保存失败" } finally { busy = false } }
    }) { Text("保存备注") } }, dismissButton = { TextButton(enabled = !busy, onClick = { editing = null }) { Text("取消") } }) }
}

/** 收款人卡片：首字头像 + 姓名/银行账号/备注，底部左侧备注、右侧核对转账。 */
@Composable
private fun PayeeCard(row: org.json.JSONObject, enabled: Boolean, onPick: () -> Unit, onRemark: () -> Unit) {
    val name = row.optString("name")
    val detail = listOf(row.optString("bankName"), row.optString("accountNo").ifBlank { row.optString("fpsId") })
        .filter { it.isNotBlank() }
        .joinToString(" · ")
    val remark = row.optString("remark")
    HairlineCard(Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(enabled = enabled, onClick = onPick)
                    .padding(horizontal = 14.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(name, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Text(detail, fontSize = 11.5.sp, color = Tokens.Muted)
                    if (remark.isNotBlank()) {
                        Text(remark, fontSize = 12.sp, color = Tokens.Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(16.dp))
            }
            Hairline()
            Row(
                Modifier.fillMaxWidth().padding(start = 6.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(enabled = enabled, onClick = onRemark) { Text("备注", fontSize = 12.5.sp, color = Tokens.Ink2) }
                Spacer(Modifier.weight(1f))
                // 「核对转账」用描边不用填充：页面上不再出现紫色底块。
                Box(
                    Modifier
                        .clip(CircleShape)
                        .border(1.dp, Tokens.Accent, CircleShape)
                        .clickable(enabled = enabled, onClick = onPick)
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                ) { Text("核对转账", fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = Tokens.AccentDeep) }
                Spacer(Modifier.width(2.dp))
            }
        }
    }
}

/** 收款人行 → 转账草稿；FPS 方向沿用行里带的通道信息，不改服务端解析结果。 */
private fun payeeDraft(row: org.json.JSONObject): TransferDraft {
    val fps = row.optString("channel") == "fps"
    return TransferDraft(
        channel = if (fps) "fps" else "bank",
        payeeName = row.optString("name"),
        payeeAccountNo = row.optString("accountNo"),
        bankCode = row.optString("bankCode"),
        bankRegion = row.optString("bankRegion", if (fps) "HK" else "CN"),
        method = if (fps) "fps" else "bankCard",
        fpsMethod = row.optString("fpsMethod", "mobile"),
        fpsId = row.optString("fpsId"),
    )
}

/** 银行账号与香港转数快入口共用现有报价和支付密码提交边界。 */
@Composable
fun TransferFormScreen(
    title: String,
    onBack: () -> Unit,
    draft: TransferDraft,
    onDraftChange: (TransferDraft) -> Unit,
    onNext: () -> Unit,
    /** 顶部标题：入口按内地／境外呈现，业务分支仍用 title 判断。 */
    heading: String = title,
) {
    val fps = title != "银行卡号转账"
    var payeeName by remember { mutableStateOf("") }
    var identifier by remember { mutableStateOf("") }
    var fpsType by remember { mutableIntStateOf(0) }
    // 地区由入口决定（内地／境外），也兼容直接选中的香港账户收款人。
    var region by remember { mutableStateOf(if (fps) "HK" else draft.bankRegion.ifBlank { "CN" }) }
    var bankCode by remember { mutableStateOf(if (fps) "" else "LCB") }
    var banks by remember { mutableStateOf<List<org.json.JSONObject>>(emptyList()) }
    var formError by remember { mutableStateOf<String?>(null) }
    var preparing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val method = listOf("mobile", "email", "fpsid", "account")[fpsType]
    LaunchedEffect(Unit) {
        runCatching { BankApi.paymentPlanList("/api/banks") }.onSuccess { data -> banks = (0 until data.length()).map { data.getJSONObject(it) } }.onFailure { formError = it.message ?: "银行列表加载失败" }
    }
    FormScaffold(heading, onBack = { if (!preparing) onBack() }, actionLabel = if (preparing) "核对中…" else "下一步", onAction = {
        if (!preparing) {
            formError = null
            val issue = if (fps) fpsIdentifierProblem(method, identifier) else if (!identifier.matches(Regex("[0-9]{12,19}"))) "请输入 12–19 位完整收款账号" else null
            if (issue != null) formError = issue
            else if ((!fps || method == "account") && (payeeName.isBlank() || banks.none { it.optString("code") == bankCode && it.optString("region") == region })) formError = "请填写姓名并选择收款银行"
            else {
                preparing = true
                scope.launch {
                    try {
                        val resolved = if (fps && method != "account") BankApi.resolveFps(method, identifier.trim()) else null
                        onDraftChange(draft.copy(channel = if (fps) "fps" else "bank", method = if (fps) "fps" else "bankCard", payeeName = resolved?.name ?: payeeName.trim(), payeeAccountNo = if (!fps || method == "account") identifier.trim() else "", bankCode = resolved?.bankCode ?: bankCode, bankRegion = resolved?.bankRegion ?: region, fpsMethod = method, fpsId = if (fps && method != "account") identifier.trim() else ""))
                        onNext()
                    } catch (failure: Exception) { formError = failure.message ?: "收款信息核对失败" }
                    finally { preparing = false }
                }
            }
        }
    }) {
        FormCard("收款信息") {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (fps && title != "手机号转账") SegTabs(listOf("手机号", "电邮", "FPS ID", "账户"), fpsType) { if (!preparing) { fpsType = it; identifier = ""; formError = null } }
            TextFieldRow(
                if (!fps) "完整收款账号" else listOf("香港手机号", "电邮", "FPS ID", "收款账号")[fpsType],
                identifier,
                { if (!preparing) identifier = it.filter { c -> !c.isWhitespace() }.take(if (!fps) 19 else 60) },
                placeholder = when { !fps -> "12–19 位完整收款账号"; method == "mobile" -> "8 位香港手机号"; method == "email" -> "收款人登记的电邮"; method == "fpsid" -> "7 位 FPS ID"; else -> "6–24 位完整收款账号" },
                keyboardType = when { !fps || method in listOf("mobile", "fpsid") -> KeyboardType.Number; method == "email" -> KeyboardType.Email; else -> KeyboardType.Text },
            )
            if (!fps || method == "account") {
                TextFieldRow("收款人姓名", payeeName, { if (!preparing) payeeName = it.take(80) }, placeholder = "与收款账户登记姓名一致")
                BankSelector(banks, region, bankCode, enabled = !preparing) { bankCode = it }
            } else Text("下一步由转数快登记资料返回户名和收款银行，请在确认页核对。", color = Tokens.Muted, fontSize = 11.sp)
            }
        }
        formError?.let { Text(it, color = Tokens.Coral, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp)) }
    }
}

internal fun fpsIdentifierProblem(method: String, value: String): String? = when {
    method == "mobile" && !value.matches(Regex("[4-9][0-9]{7}")) -> "请输入 8 位香港手机号（4 至 9 开头）"
    method == "fpsid" && !value.matches(Regex("[0-9]{7}")) -> "FPS ID 为 7 位数字"
    method == "email" && !value.matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}")) -> "请输入有效电邮"
    method == "account" && !value.matches(Regex("[A-Za-z0-9]{6,24}")) -> "请输入 6 至 24 位完整收款账号"
    else -> null
}

@Composable
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
internal fun BankSelector(banks: List<org.json.JSONObject>, region: String, selected: String, enabled: Boolean = true, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var query by remember(open) { mutableStateOf("") }
    val options = banks.filter { it.optString("region") == region }
    val current = options.firstOrNull { it.optString("code") == selected }
    val needle = query.trim().lowercase()
    val filtered = if (needle.isEmpty()) options else options.filter { bank ->
        listOf(bank.optString("name"), bank.optString("shortName"), bank.optString("code"))
            .any { it.lowercase().contains(needle) }
    }
    Column {
        Text("收款银行", style = Tokens.Text.hint, modifier = Modifier.padding(bottom = 6.dp, start = 2.dp))
        Box {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(46.dp)
                    .clip(CircleShape)
                    .background(Tokens.Surface)
                    .border(1.dp, Tokens.Border, CircleShape)
                    .clickable(enabled = enabled && options.isNotEmpty()) { open = true }
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    current?.optString("name") ?: if (options.isEmpty()) "银行列表加载中…" else "选择收款银行",
                    fontSize = 14.sp,
                    color = if (current == null) Tokens.Muted else Tokens.Ink,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    Icons.Chevron,
                    contentDescription = null,
                    tint = Tokens.Muted,
                    modifier = Modifier.size(14.dp).rotate(90f),
                )
            }
            if (open) {
                androidx.compose.material3.ModalBottomSheet(
                    onDismissRequest = { open = false },
                    containerColor = Tokens.Surface,
                ) {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Text("选择收款银行", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                        Spacer(Modifier.height(12.dp))
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .height(44.dp)
                                .clip(CircleShape)
                                .background(Tokens.SurfaceWarm)
                                .border(1.dp, Tokens.Border, CircleShape)
                                .padding(horizontal = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Search, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(8.dp))
                            androidx.compose.foundation.text.BasicTextField(
                                value = query,
                                onValueChange = { query = it.take(30) },
                                singleLine = true,
                                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp, color = Tokens.Ink),
                                cursorBrush = androidx.compose.ui.graphics.SolidColor(Tokens.Accent),
                                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                                    imeAction = androidx.compose.ui.text.input.ImeAction.Search,
                                ),
                                modifier = Modifier.weight(1f),
                                decorationBox = { inner ->
                                    if (query.isEmpty()) Text("搜索银行名称或代码", fontSize = 13.5.sp, color = Tokens.Muted)
                                    inner()
                                },
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        if (filtered.isEmpty()) {
                            Text("没有匹配的银行", fontSize = 12.5.sp, color = Tokens.Muted, modifier = Modifier.padding(vertical = 28.dp))
                        } else {
                            LazyColumn(Modifier.fillMaxWidth().height(360.dp)) {
                                items(filtered, key = { it.optString("code") }) { bank ->
                                    val chosen = bank.optString("code") == selected
                                    Row(
                                        Modifier
                                            .fillMaxWidth()
                                            .clickable { onSelect(bank.optString("code")); open = false }
                                            .padding(vertical = 13.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(Modifier.weight(1f)) {
                                            Text(
                                                bank.optString("name"),
                                                fontSize = 14.sp,
                                                color = Tokens.Ink,
                                                fontWeight = if (chosen) FontWeight.Medium else FontWeight.Normal,
                                            )
                                            val sub = listOf(bank.optString("shortName"), bank.optString("code")).filter { it.isNotBlank() }.distinct().joinToString(" · ")
                                            if (sub.isNotBlank()) {
                                                Spacer(Modifier.height(2.dp))
                                                Text(sub, style = Tokens.Text.hint)
                                            }
                                        }
                                        if (chosen) Icon(Icons.Check, contentDescription = "当前选择", tint = Tokens.Accent, modifier = Modifier.size(16.dp))
                                    }
                                    Hairline()
                                }
                            }
                        }
                        Spacer(Modifier.height(18.dp))
                    }
                }
            }
        }
    }
}

@Composable
internal fun Field(label: String, value: String, hint: String? = null, placeholder: Boolean = false) {
    Column {
        Text(label, style = Tokens.Text.hint, modifier = Modifier.padding(bottom = 6.dp, start = 2.dp))
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
            Text(hint, style = Tokens.Text.hint, modifier = Modifier.padding(top = 6.dp, start = 2.dp))
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
    var receiveText by remember { mutableStateOf("") }
    var amountSide by remember { mutableStateOf("pay") }
    var reverseResolved by remember { mutableStateOf<String?>(null) }
    var memo by remember { mutableStateOf("") }
    var memoEditing by remember { mutableStateOf(false) }
    var memoInput by remember { mutableStateOf("") }
    var receiveEditing by remember { mutableStateOf(false) }
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
    var fpsConfirmed by remember { mutableStateOf<FpsRecipientDto?>(null) }
    var confirmation by remember { mutableStateOf<TransferConfirmation?>(null) }
    var idempotencyKey by remember { mutableStateOf<String?>(null) }

    val currencies = listOf("CNY", "USD", "HKD")
    val isFps = draft.channel == "fps"
    val isFpsAccount = isFps && draft.fpsMethod == "account"
    val receiveCurrencies = if (isFps) listOf("CNY", "HKD") else currencies
    val transferScope = if (draft.bankRegion == "HK") "overseas" else "domestic"
    val selectedBalance = account?.currencyBalances?.firstOrNull { it.currency == payCurrency && it.id.isNotBlank() }
    val accountId = selectedBalance?.id
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val submitGuard = remember { AtomicBoolean(false) }
    val openGuard = remember { AtomicBoolean(false) }

    val amountCents = remember(amountText) {
        if (amountText.matches(Regex("[0-9]+(\\.[0-9]{0,2})?")))
            runCatching { java.math.BigDecimal(amountText).movePointRight(2).longValueExact() }.getOrDefault(0L)
        else 0L
    }
    val accountNoValid = if (isFpsAccount) fpsIdentifierProblem("account", draft.payeeAccountNo) == null else draft.payeeAccountNo.matches(Regex("\\d{12,19}"))
    val bankFlowReady = draft.channel in setOf("bank", "fps") && draft.bankRegion in setOf("CN", "HK") &&
        draft.bankCode.isNotBlank() && draft.payeeName.isNotBlank() &&
        (if (isFps && !isFpsAccount) draft.bankRegion == "HK" && fpsIdentifierProblem(draft.fpsMethod, draft.fpsId) == null else accountNoValid)


    LaunchedEffect(Unit) {
        runCatching { BankApi.accounts().firstOrNull() }
            .onSuccess { account = it }
            .onFailure { error = it.message ?: "账户加载失败" }
    }
    val reverseSignature = listOf(accountId, payCurrency, receiveCurrency, receiveText, quoteNonce.toString()).joinToString(":")
    LaunchedEffect(amountSide, reverseSignature) {
        if (amountSide != "receive") return@LaunchedEffect
        reverseResolved = null
        amountText = ""
        val desired = runCatching { java.math.BigDecimal(receiveText).movePointRight(2).longValueExact() }.getOrNull() ?: return@LaunchedEffect
        if (desired <= 0 || accountId == null || !bankFlowReady) return@LaunchedEffect
        if (payCurrency == receiveCurrency) {
            amountText = receiveText; reverseResolved = reverseSignature
            return@LaunchedEffect
        }
        try {
            kotlinx.coroutines.delay(220)
            val sample = BankApi.transferQuote(accountId, draft.channel, transferScope, 10000, draft.bankCode, draft.bankRegion, receiveCurrency)
            val rate = sample.fx?.rate
            require(rate != null && rate.isFinite() && rate > 0) { "反算报价不可用" }
            val closest = java.math.BigDecimal.valueOf(desired).divide(java.math.BigDecimal.valueOf(rate), 0, java.math.RoundingMode.HALF_UP).longValueExact()
            require(closest in 1..9_007_199_254_740_000L) { "金额超出可处理范围" }
            val calculated = listOf(closest, closest - 1, closest + 1).filter { it > 0 }.minBy { kotlin.math.abs(kotlin.math.round(it * rate) - desired) }
            amountText = java.math.BigDecimal.valueOf(calculated, 2).toPlainString()
            reverseResolved = reverseSignature
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "收款金额反算失败" }
    }
    LaunchedEffect(quote?.receivedAt, confirm) {
        val current = quote
        if (!confirm && current?.fx != null) {
            kotlinx.coroutines.delay((current.fxTtlSeconds ?: 0) * 1000)
            if (!submitting && !ambiguousOutcome) quoteNonce++
        }
    }
    LaunchedEffect(accountId, amountCents, payCurrency, receiveCurrency, quoteNonce) {
        quote = null
        confirmation = null
        idempotencyKey = null
        if (!bankFlowReady || amountCents <= 0) return@LaunchedEffect
        val id = accountId ?: return@LaunchedEffect
        val balance = selectedBalance ?: return@LaunchedEffect
        loadingQuote = true
        error = null
        try {
            val fresh = BankApi.transferQuote(
                fromAccountId = id,
                channel = draft.channel,
                scope = transferScope,
                amount = amountCents,
                bankCode = draft.bankCode,
                bankRegion = draft.bankRegion,
                payeeCurrency = receiveCurrency,
            )
            val problem = quoteProblem(fresh, amountCents, balance.available, payCurrency, receiveCurrency)
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
            error = "上次提交结果未知，请先通过结果核查窗口确认，暂不能重新办理。"
            return
        }
        if (!openGuard.compareAndSet(false, true)) return
        opening = true
        error = null
        confirmError = null
        scope.launch {
            try {
                if (!bankFlowReady) {
                    error = "收款信息不完整，请返回重新核对。"
                    return@launch
                }
                if (amountSide == "receive" && reverseResolved != reverseSignature) {
                    error = "正在核对付款金额，请等待报价完成。"
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
                if (!support.transferPaymentPassword || support.confirmedQuoteVersion != 1 || (isFps && !isFpsAccount && !support.confirmedRecipient)) {
                    error = "银行服务暂不支持安全转账，请稍后再试。"
                    return@launch
                }
                val resolved = try {
                    fpsConfirmed = null
                    if (isFps && !isFpsAccount) {
                        val current = BankApi.resolveFps(draft.fpsMethod, draft.fpsId)
                        if (current.name != draft.payeeName || current.bankCode != draft.bankCode || current.bankRegion != draft.bankRegion) {
                            error = "转数快登记资料已变化，请返回重新核对。"
                            return@launch
                        }
                        fpsConfirmed = current
                        null
                    } else if (isFpsAccount) null
                    else BankApi.resolveTransferRecipient(draft.bankCode, draft.bankRegion, draft.payeeAccountNo, draft.payeeName)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    error = failure.message ?: "收款信息核对失败，请检查后重试。"
                    return@launch
                }
                val fresh = try {
                    BankApi.transferQuote(
                        fromAccountId = balance.id,
                        channel = draft.channel,
                        scope = transferScope,
                        amount = amountCents,
                        bankCode = draft.bankCode,
                        bankRegion = draft.bankRegion,
                        payeeCurrency = receiveCurrency,
                    )
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    error = failure.message ?: "报价失败，请稍后重试。"
                    return@launch
                }
                val problem = quoteProblem(fresh, amountCents, balance.available, payCurrency, receiveCurrency)
                if (problem != null) {
                    error = problem
                    return@launch
                }
                quote = fresh
                recipient = resolved
                confirmation = TransferConfirmation(
                    fromCurrency = payCurrency,
                    fee = fresh.fee,
                    submitBefore = fresh.fxTtlSeconds?.let { fresh.receivedAt + it * 1000 } ?: (System.currentTimeMillis() + 180_000),
                    fx = fresh.fx,
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
                    channel = draft.channel,
                    scope = transferScope,
                    payeeName = draft.payeeName,
                    amount = amountCents,
                    memo = memo,
                    bankCode = draft.bankCode,
                    bankRegion = draft.bankRegion,
                    payeeAccountNo = draft.payeeAccountNo,
                    payeeCurrency = receiveCurrency,
                    paymentPassword = password,
                    confirmedQuote = snapshot,
                    idempotencyKey = idempotencyKey,
                    fpsMethod = if (isFps) draft.fpsMethod else null,
                    fpsId = if (isFps && !isFpsAccount) draft.fpsId else null,
                    confirmedRecipient = fpsConfirmed,
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
                            confirmError = "网络或银行服务异常，转账结果未知。请先在结果核查窗口确认原操作状态。"
                        } else {
                            confirmError = failure.message
                        }
                    }
                }
            } catch (failure: Exception) {
                ambiguousOutcome = true
                confirmError = "网络异常，转账结果未知。请先在结果核查窗口确认原操作状态。"
            } finally {
                password = ""
                if (ambiguousOutcome) confirm = false
                submitting = false
                submitGuard.set(false)
            }
        }
    }

    BackHandler(enabled = opening || submitting) { }
    PushScreen(title = "填写金额", onBack = { if (!opening && !submitting) onBack() }, bottomContent = {
        PrimaryButton(
            text = when { submitting -> "提交中…"; opening -> "正在核对…"; else -> "确认转出" },
            onClick = { openConfirmation() },
            modifier = Modifier.alpha(if (opening || submitting) 0.55f else 1f),
        )
    }) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        HairlineCard(Modifier.fillMaxWidth()) {
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
                Column(Modifier.weight(1f)) {
                    Text("收款方", style = Tokens.Text.hint)
                    Text(draft.payeeName.ifEmpty { "未填写收款人" }, fontSize = 14.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                    Text(
                        if (isFps && !isFpsAccount) draft.fpsId else transferAccountLabel(draft.payeeAccountNo, recipient?.accountNoMasked),
                        fontSize = 11.5.sp,
                        color = Tokens.Muted,
                    )
                }
            }
        }
        if (!bankFlowReady) {
            Text(
                "收款信息不完整，请返回上一步重新填写并核对。",
                fontSize = 11.5.sp,
                color = Tokens.Coral,
                lineHeight = 17.sp,
            )
        }
        FormCard("转账金额") {
            Text("付款币种", style = Tokens.Text.hint)
            SegTabs(currencies, currencies.indexOf(payCurrency)) {
                if (!opening && !submitting && !confirm && !ambiguousOutcome) payCurrency = currencies[it]
            }
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(when (payCurrency) { "USD" -> "US$"; "HKD" -> "HK$"; else -> "¥" }, fontSize = 24.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                BasicTextField(
                    value = amountText,
                    onValueChange = { input ->
                        if (!opening && !submitting && !confirm && !ambiguousOutcome && (input.isEmpty() || input.matches(Regex("[0-9]*(\\.[0-9]{0,2})?")))) {
                            amountSide = "pay"; amountText = input.take(12)
                        }
                    },
                    enabled = !opening && !submitting && !confirm && !ambiguousOutcome,
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 34.sp, color = Tokens.Ink, fontWeight = FontWeight.SemiBold),
                    cursorBrush = SolidColor(Tokens.Accent),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics { contentDescription = "转账金额" },
                    decorationBox = { inner -> Box(contentAlignment = Alignment.CenterStart) { if (amountText.isEmpty()) Text("0.00", fontSize = 34.sp, color = Tokens.BorderStrong, fontWeight = FontWeight.SemiBold); inner() } },
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                selectedBalance?.let { "可用余额 ${formatCents(it.available, payCurrency)}" }
                    ?: "该币种暂无余额分区，无法从该币种转账",
                fontSize = 11.sp,
                color = Tokens.Muted,
            )
            Spacer(Modifier.height(14.dp))
            Hairline()
            Spacer(Modifier.height(14.dp))
            Text("到账币种", style = Tokens.Text.hint)
            SegTabs(receiveCurrencies, receiveCurrencies.indexOf(receiveCurrency)) { if (!opening && !submitting && !confirm && !ambiguousOutcome) receiveCurrency = receiveCurrencies[it] }
            if (payCurrency != receiveCurrency) {
                Spacer(Modifier.height(8.dp))
                EntryRow(
                    icon = Icons.Transfer,
                    title = "按收款金额填写",
                    onClick = {
                        if (!opening && !submitting && !confirm && !ambiguousOutcome) {
                            receiveEditing = !receiveEditing
                            if (!receiveEditing) amountSide = "pay"
                        }
                    },
                )
                if (receiveEditing) {
                    val received = if (amountSide == "receive") receiveText else if (amountCents <= 0) "" else quote?.let { java.math.BigDecimal.valueOf(it.receiveAmount ?: amountCents, 2).toPlainString() }.orEmpty()
                    TextFieldRow("希望到账（$receiveCurrency）", received, { input ->
                        if (!opening && !submitting && !confirm && !ambiguousOutcome && (input.isEmpty() || input.matches(Regex("[0-9]*(\\.[0-9]{0,2})?")))) { amountSide = "receive"; receiveText = input.take(12) }
                    }, placeholder = "输入希望到账的金额", keyboardType = KeyboardType.Decimal)
                }
            }
        }
        FormCard("费用与到账") {
            if (loadingQuote) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Tokens.Accent)
                    Text("正在获取报价…", style = Tokens.Text.note)
                }
            } else quote?.let { current ->
                TransferReviewRow("预计到账", formatCents(current.receiveAmount ?: amountCents, receiveCurrency), emphasized = true)
                current.fx?.let { TransferReviewRow("汇率", it.rate.toString()) }
                TransferReviewRow("手续费", formatCents(current.fee, payCurrency))
                TransferReviewRow("到账时间", current.etaText)
                TransferReviewRow("单笔限额", formatCents(current.singleLimit, payCurrency))
            } ?: Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Receipt, null, Modifier.size(22.dp), tint = Tokens.Muted)
                Text(if (amountCents <= 0) "输入金额后查看费用与到账信息" else "报价暂不可用，请重试", style = Tokens.Text.note, modifier = Modifier.weight(1f))
                if (amountCents > 0) ActionIcon(Icons.Refresh, "重新获取报价", enabled = !opening && !submitting && !confirm && !ambiguousOutcome, onClick = { quoteNonce++ })
            }
        }
        if (error != null) {
            Text(
                error!!,
                fontSize = 11.5.sp,
                color = Tokens.Coral,
                lineHeight = 17.sp,
            )
        }
        HairlineCard {
            EntryRow(
                icon = Icons.Edit,
                title = "转账附言",
                onClick = {
                    if (!opening && !submitting && !confirm && !ambiguousOutcome) { memoInput = memo; memoEditing = true }
                },
            )
        }
        }
    }

    if (memoEditing) AlertDialog(
        onDismissRequest = { memoEditing = false },
        title = { Text("转账附言") },
        text = { TextFieldRow("附言", memoInput, { memoInput = it.take(30) }, placeholder = "选填，最多 30 字") },
        confirmButton = { TextButton(onClick = { if (!opening && !submitting && !confirm && !ambiguousOutcome) memo = memoInput; memoEditing = false }) { Text("保存") } },
        dismissButton = { TextButton(onClick = { memoEditing = false }) { Text("取消") } },
    )

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
            Column(Modifier.fillMaxWidth().imePadding()) {
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("确认转账", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("转账金额", style = Tokens.Text.hint)
                        Text(formatCents(amountCents, payCurrency), fontSize = 32.sp, color = Tokens.Ink, fontWeight = FontWeight.SemiBold)
                        confirmation?.fx?.let { Text("预计到账 ${formatCents(it.toAmount, it.toCurrency)}", color = Tokens.Accent, fontSize = 13.sp) }
                    }
                    FormCard("收款方") {
                        TransferReviewRow("收款人", draft.payeeName.ifEmpty { "—" })
                        recipient?.holderNameMasked?.takeIf { it.isNotBlank() }?.let { TransferReviewRow("户名核对", it) }
                        if (isFps && !isFpsAccount) TransferReviewRow("收款标识", draft.fpsId)
                        else TransferReviewRow("收款账号", transferAccountLabel(draft.payeeAccountNo, recipient?.accountNoMasked))
                        TransferReviewRow("收款银行", "${draft.bankCode} · ${if (draft.bankRegion == "HK") "香港" else "中国内地"}")
                    }
                    FormCard("付款与费用") {
                        account?.accountNo?.takeIf { it.isNotBlank() }?.let { TransferReviewRow("付款账户", transferAccountLabel(it)) }
                        TransferReviewRow("付款币种", payCurrency)
                        TransferReviewRow("手续费", confirmation?.let { formatCents(it.fee, payCurrency) } ?: "—")
                        TransferReviewRow("付款合计", confirmation?.let { formatCents(amountCents + it.fee, payCurrency) } ?: "—", emphasized = true)
                        TransferReviewRow("到账币种", receiveCurrency)
                        confirmation?.fx?.let { TransferReviewRow("汇率", it.rate.toString()) }
                        TransferReviewRow("预计到账", quote?.etaText ?: "—")
                        confirmation?.let { TransferReviewRow("报价有效至", formatClock(it.submitBefore)) }
                        if (memo.isNotBlank()) TransferReviewRow("转账附言", memo)
                    }
                    Spacer(Modifier.height(2.dp))
                }
                Column(Modifier.padding(horizontal = 18.dp, vertical = 12.dp)) {
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
                }
            }
        }
    }
}

/** 同币种转账报价的完整性校验；不满足时不进入确认页。 */
internal fun quoteProblem(
    quote: TransferQuoteDto,
    amountCents: Long,
    available: Long,
    fromCurrency: String,
    toCurrency: String,
): String? {
    if (quote.fee < 0) return "报价手续费无效，请稍后重试"
    if (quote.singleLimit <= 0 || quote.maxAmount <= 0) return "报价限额无效，请稍后重试"
    if (amountCents > quote.singleLimit) return "转账金额超过单笔上限"
    if (amountCents > quote.maxAmount) return "转账金额超过可用余额"
    if (quote.fee > available || amountCents > available - quote.fee) return "可用余额不足以支付金额与手续费"
    val fx = quote.fx
    if (fromCurrency == toCurrency && fx != null) return "同币种报价不应包含换汇信息，请稍后重试"
    if (fromCurrency != toCurrency && (fx == null || fx.fromCurrency != fromCurrency || fx.toCurrency != toCurrency || fx.fromAmount != amountCents || fx.toAmount <= 0 || !fx.rate.isFinite() || fx.rate <= 0 || !fx.spread.isFinite() || fx.spread < 0 || (quote.fxTtlSeconds ?: 0) !in 1..180)) return "换汇报价不完整或币种不一致，请重新报价"
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
            result?.fx?.let { fx ->
                Spacer(Modifier.height(12.dp))
                Text("${if (result.settlementStatus == "success") "到账" else "受理到账金额"} ${formatCents(fx.toAmount, fx.toCurrency)}", color = Tokens.Ink2, fontSize = 13.sp)
                Text("成交汇率 ${fx.rate}", color = Tokens.Muted, fontSize = 11.sp)
            }
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
