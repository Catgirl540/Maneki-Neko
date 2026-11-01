package com.moneymeow.bank

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.util.Locale

/** 02 转入弹层：收款账户 + 转数快（FPS）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransferInSheet(onDismiss: () -> Unit) {
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { BankApi.accounts().singleOrNull() ?: throw IllegalStateException("未找到资金账户") }
            .onSuccess { account = it }
            .onFailure { error = it.message ?: "收款信息加载失败" }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(), containerColor = Tokens.Surface) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            Text("我的收款账户", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(12.dp))
            when {
                error != null -> Text(error!!, color = Tokens.Muted)
                account == null -> Text("正在加载收款信息…", color = Tokens.Muted)
                else -> HairlineCard {
                    Column(Modifier.padding(horizontal = 14.dp)) {
                        ReceiptRow("账户号码", account!!.accountNo)
                        Hairline()
                        ReceiptRow("开户银行", "招财猫银行")
                        Text("请核对账户号码后提供给付款方。", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 12.dp))
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ReceiptRow(label: String, value: String, copy: Boolean = false) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 12.5.sp, color = Tokens.Muted)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(value, fontSize = 12.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
            if (copy) {
                Spacer(Modifier.size(8.dp))
                Icon(Icons.Copy, contentDescription = "复制", tint = Tokens.Muted, modifier = Modifier.size(15.dp))
            }
        }
    }
}

/* ───────────── 36a–36e 更多服务 · 二级页 ───────────── */

@Composable
fun AutoDebitScreen(onBack: () -> Unit) {
    var rows by remember { mutableStateOf<List<AutoDebitDto>>(emptyList()) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var reloadKey by remember { mutableIntStateOf(0) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var stopTarget by remember { mutableStateOf<AutoDebitDto?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(reloadKey) {
        if (!BankApi.hasToken()) {
            loading = false
            loadError = "登录状态已失效，请重新登录"
            return@LaunchedEffect
        }
        loading = true
        loadError = null
        try {
            rows = BankApi.autoDebits()
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            loadError = failure.message ?: "自动扣款加载失败"
        } finally {
            loading = false
        }
    }

    fun changeDebit(row: AutoDebitDto, enabled: Boolean) {
        if (busyId != null) return
        busyId = row.id
        actionError = null
        scope.launch {
            try {
                val updated = MoreScreensApi.setAutoDebitEnabled(row.id, enabled)
                rows = rows.map { if (it.id == updated.id) updated else it }
                stopTarget = null
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                actionError = failure.message ?: "操作失败，请稍后重试"
            } finally {
                busyId = null
            }
        }
    }

    PushScreen(title = "自动扣款", onBack = onBack) {
        if (loading) {
            Text("正在加载自动扣款…", fontSize = 12.sp, color = Tokens.Muted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp))
        } else if (loadError != null) {
            LoadFailure(loadError!!) { reloadKey++ }
        } else {
            if (actionError != null) {
                Text(
                    "操作失败：$actionError",
                    fontSize = 12.sp,
                    color = Tokens.Coral,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
            SectionHeader("已签约服务", "${rows.size} 项")
            if (rows.isEmpty()) {
                EmptyNote("没有签约的自动扣款")
            } else {
                Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    rows.forEach { row ->
                        DebitCard(
                            row = row,
                            busy = busyId == row.id,
                            onChange = { enabled ->
                                if (enabled) changeDebit(row, true) else stopTarget = row
                            },
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        EmptyNote(
            "本行暂不支持在 App 内新建自动扣款，如需新增请前往网点或联系客服。\n" +
                "停用只关闭本行代扣，不等于取消商户订阅；已产生的账单和退款仍需向商户另行办理。",
        )
    }

    val target = stopTarget
    if (target != null) {
        AlertDialog(
            onDismissRequest = { if (busyId == null) stopTarget = null },
            containerColor = Tokens.Surface,
            title = { Text("停用本行代扣", fontSize = 18.sp, color = Tokens.Ink) },
            text = {
                Text(
                    "确认停用「${target.merchant}」的本行自动扣款？商户订阅、已产生账单和退款仍需向商户另行办理。",
                    fontSize = 13.sp,
                    color = Tokens.Ink2,
                    lineHeight = 20.sp,
                )
            },
            confirmButton = {
                TextButton(enabled = busyId == null, onClick = { changeDebit(target, false) }) {
                    Text(if (busyId == target.id) "处理中…" else "确认停用", color = Tokens.Coral)
                }
            },
            dismissButton = {
                TextButton(enabled = busyId == null, onClick = { stopTarget = null }) {
                    Text("取消", color = Tokens.Ink2)
                }
            },
        )
    }
}

@Composable
private fun DebitCard(row: AutoDebitDto, busy: Boolean, onChange: (Boolean) -> Unit) {
    HairlineCard {
        Column {
            Column(Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(row.merchant, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                    RiskBadge(if (row.enabled) "已开启" else "已停用")
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                    Metric("金额", formatCents(row.amount))
                    Metric("扣款周期", row.cycle)
                    Metric("下次", formatDate(row.nextRunAt))
                }
            }
            Hairline()
            SwitchRow(
                label = "自动扣款",
                checked = row.enabled,
                subtitle = if (row.enabled) "到期按合约扣款" else "已停用，不再自动扣款",
                onChange = { if (!busy) onChange(it) },
            )
        }
    }
}

@Composable
fun PayrollScreen(onBack: () -> Unit) {
    var plan by remember { mutableStateOf<MoreScreensApi.SalaryPlanDto?>(null) }
    var overdraft by remember { mutableStateOf<MoreScreensApi.OverdraftDto?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf(false) }
    var overdraftBusy by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(reloadKey) {
        if (!BankApi.hasToken()) {
            loadError = "登录状态已失效，请重新登录"
            return@LaunchedEffect
        }
        loadError = null
        try {
            plan = MoreScreensApi.salaryPlan()
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            loadError = failure.message ?: "工资计划加载失败"
        }
        try {
            overdraft = MoreScreensApi.overdraft()
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            if (loadError == null) loadError = failure.message ?: "备用金信息加载失败"
        }
    }

    fun toggleOverdraft(next: Boolean) {
        if (overdraftBusy) return
        overdraftBusy = true
        actionError = null
        scope.launch {
            try {
                overdraft = MoreScreensApi.setOverdraftActive(next)
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                actionError = failure.message ?: "操作失败，请稍后重试"
            } finally {
                overdraftBusy = false
            }
        }
    }

    PushScreen(title = "工资与备用金", onBack = onBack) {
        if (plan == null && overdraft == null && loadError != null) {
            LoadFailure(loadError!!) { reloadKey++ }
        } else {
            if (actionError != null) {
                Text(
                    "操作失败：$actionError",
                    fontSize = 12.sp,
                    color = Tokens.Coral,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }

            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column(Modifier.padding(16.dp)) {
                    val current = plan
                    if (current == null) {
                        Text("工资计划暂不可用", fontSize = 13.sp, color = Tokens.Muted)
                    } else if (current.configured) {
                        Text("预计发薪", fontSize = 11.sp, color = Tokens.Muted)
                        Spacer(Modifier.height(5.dp))
                        Text(formatCents(current.amount), fontSize = 27.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "每月 ${current.salaryDay} 日 · 下次 ${formatDate(current.nextPayday)}",
                            fontSize = 12.sp,
                            color = Tokens.Ink2,
                        )
                        if (current.employer.isNotBlank()) {
                            Spacer(Modifier.height(12.dp))
                            Hairline()
                            Spacer(Modifier.height(4.dp))
                            KvInline("发薪单位", current.employer)
                        }
                        Spacer(Modifier.height(10.dp))
                        GhostButton("修改计划", { editing = true })
                    } else {
                        Text("未设置工资计划", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "设置发薪日与预计月薪后，这里展示下次发薪预测；计划只作记录，不触发工资入账。",
                            fontSize = 12.sp,
                            color = Tokens.Muted,
                            lineHeight = 19.sp,
                        )
                        Spacer(Modifier.height(12.dp))
                        GhostButton("设置计划", { editing = true })
                    }
                }
            }

            SectionHeader("备用金")
            val facility = overdraft
            if (facility == null) {
                EmptyNote("备用金信息暂不可用")
            } else {
                HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                    Column {
                        Column(Modifier.padding(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("小额透支额度", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                                RiskBadge(if (facility.active) "已开通" else "未开通")
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                                Metric("额度", formatCents(facility.creditLimit))
                                Metric("已用", formatCents(facility.used))
                                Metric("可用", formatCents(facility.available))
                            }
                            Spacer(Modifier.height(10.dp))
                            Text(
                                "年化 ${formatPercent(facility.apr)} · ${facility.interestNote}",
                                fontSize = 11.sp,
                                color = Tokens.Muted,
                                lineHeight = 17.sp,
                            )
                        }
                        Hairline()
                        SwitchRow(
                            label = "备用金开关",
                            checked = facility.active,
                            subtitle = if (facility.active) "已开通；支用与还款暂未开放" else "未开通；开通结果以服务端返回为准",
                            onChange = { if (!overdraftBusy) toggleOverdraft(it) },
                        )
                    }
                }
            }

            SectionHeader("发薪记录", plan?.history?.size?.let { "$it 笔" })
            val history = plan?.history.orEmpty()
            if (history.isEmpty()) {
                EmptyNote("暂无发薪记录")
            } else {
                HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                    Column(Modifier.padding(horizontal = 14.dp)) {
                        history.forEachIndexed { index, record ->
                            if (index > 0) Hairline()
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text("${record.month} 工资", fontSize = 13.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                                    Spacer(Modifier.height(2.dp))
                                    Text("${formatDate(record.paidAt)} 到账", fontSize = 10.5.sp, color = Tokens.Muted)
                                }
                                Text(
                                    "+${formatCents(record.amount)}",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Tokens.Ink,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            EmptyNote("工资计划只记录预计发薪信息，不会触发工资入账；备用金的支用与还款暂未开放。")
        }
    }

    val current = plan
    if (editing && current != null) {
        SalaryEditSheet(
            plan = current,
            onDismiss = { editing = false },
            onSaved = {
                plan = it
                editing = false
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SalaryEditSheet(
    plan: MoreScreensApi.SalaryPlanDto,
    onDismiss: () -> Unit,
    onSaved: (MoreScreensApi.SalaryPlanDto) -> Unit,
) {
    var day by remember(plan.salaryDay) { mutableStateOf(plan.salaryDay.toString()) }
    var amount by remember(plan.amount) { mutableStateOf(centsToInput(plan.amount)) }
    var employer by remember(plan.employer) { mutableStateOf(plan.employer) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (saving) return
        val salaryDay = day.trim().toIntOrNull()
        if (salaryDay == null || salaryDay !in 1..28) {
            error = "发薪日需在 1–28 之间"
            return
        }
        val cents = parseAmountInput(amount)
        if (cents == null || cents <= 0L) {
            error = "请输入有效月薪，最多两位小数"
            return
        }
        saving = true
        error = null
        scope.launch {
            try {
                val next = MoreScreensApi.updateSalary(salaryDay, cents, employer.trim())
                onSaved(next)
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                error = failure.message ?: "保存失败，请稍后重试"
            } finally {
                saving = false
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!saving) onDismiss() },
        sheetState = rememberModalBottomSheetState(),
        containerColor = Tokens.Surface,
    ) {
        Column(
            Modifier
                .padding(horizontal = 18.dp)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            Text("修改工资计划", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(4.dp))
            Text(
                "计划只记录发薪日、预计月薪和发薪单位，不会触发工资入账。",
                fontSize = 11.5.sp,
                color = Tokens.Ink2,
                lineHeight = 18.sp,
            )
            Spacer(Modifier.height(14.dp))
            TextFieldRow("每月发薪日", day, { day = it.filter(Char::isDigit).take(2) }, placeholder = "1–28", keyboardType = KeyboardType.Number)
            Spacer(Modifier.height(12.dp))
            TextFieldRow("预计月薪", amount, { amount = it }, placeholder = "0.00", keyboardType = KeyboardType.Decimal)
            Spacer(Modifier.height(12.dp))
            TextFieldRow("发薪单位（选填）", employer, { if (it.length <= 40) employer = it }, placeholder = "公司名称")
            if (error != null) {
                Spacer(Modifier.height(10.dp))
                Text(error!!, fontSize = 12.sp, color = Tokens.Coral, lineHeight = 18.sp)
            }
            Spacer(Modifier.height(18.dp))
            PrimaryButton(if (saving) "保存中…" else "保存", ::submit)
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
fun CreditScreen(onBack: () -> Unit) {
    var overview by remember { mutableStateOf<MoreScreensApi.CreditOverviewDto?>(null) }
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var accountError by remember { mutableStateOf<String?>(null) }
    var applyFor by remember { mutableStateOf<MoreScreensApi.LoanProductDto?>(null) }
    var result by remember { mutableStateOf<MoreScreensApi.LoanDto?>(null) }
    var reloadKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(reloadKey) {
        if (!BankApi.hasToken()) {
            loadError = "登录状态已失效，请重新登录"
            return@LaunchedEffect
        }
        loadError = null
        accountError = null
        try {
            overview = MoreScreensApi.creditOverview()
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            loadError = failure.message ?: "借款信息加载失败"
        }
        try {
            account = BankApi.accounts().firstOrNull()
            if (account == null) accountError = "未获取到储蓄账户"
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            accountError = failure.message ?: "储蓄账户加载失败"
        }
    }

    val fundingAccount = account
    val cnyBalance = fundingAccount?.currencyBalances?.firstOrNull { it.currency == "CNY" }
    val payoutAccountId = cnyBalance?.id
        ?: fundingAccount?.id?.takeIf { fundingAccount.currency == "CNY" }
    val payoutLabel = cnyBalance?.label?.ifBlank { null }
        ?: fundingAccount?.label?.ifBlank { null }
        ?: "人民币储蓄账户"

    PushScreen(title = "借款与分期", onBack = onBack) {
        val credit = overview
        if (credit == null) {
            if (loadError != null) {
                LoadFailure(loadError!!) { reloadKey++ }
            } else {
                Text("正在加载借款信息…", fontSize = 12.sp, color = Tokens.Muted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp))
            }
        } else {
            if (accountError != null || payoutAccountId == null) {
                Text(
                    "未获取到可用于放款的人民币储蓄账户，暂时无法发起借款。",
                    fontSize = 12.sp,
                    color = Tokens.Coral,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }

            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("可用额度", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(5.dp))
                    Text(formatCents(credit.availableCredit), fontSize = 27.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(10.dp))
                    ThinProgress(
                        if (credit.creditLimit > 0L) credit.availableCredit.toFloat() / credit.creditLimit else 0f,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "总额度 ${formatCents(credit.creditLimit)} · 已用 ${formatCents(credit.creditLimit - credit.availableCredit)}",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                    )
                }
            }

            SectionHeader("可借产品", "${credit.products.size} 款")
            if (credit.products.isEmpty()) {
                EmptyNote("暂无可借产品")
            } else {
                Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    credit.products.forEach { product ->
                        LoanProductCard(
                            product = product,
                            canApply = payoutAccountId != null,
                            onApply = { applyFor = product },
                        )
                    }
                }
            }

            SectionHeader("我的借款", "${credit.loans.size} 笔")
            if (credit.loans.isEmpty()) {
                EmptyNote("当前没有进行中的借款")
            } else {
                Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    credit.loans.forEach { LoanCard(it) }
                }
            }

            SectionHeader("分期计划", "${credit.installments.size} 笔")
            if (credit.installments.isEmpty()) {
                EmptyNote("暂无分期计划")
            } else {
                Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    credit.installments.forEach { InstallmentCard(it) }
                }
            }

            SectionHeader("信用培养")
            CreditBuilderCard(credit.builder)

            Spacer(Modifier.height(12.dp))
            EmptyNote("借款会真实放款到人民币储蓄账户并生成借款记录；页面额度与进度均以服务端返回为准。")
        }
    }

    val product = applyFor
    val payoutId = payoutAccountId
    if (product != null && payoutId != null) {
        LoanApplySheet(
            product = product,
            availableCredit = overview?.availableCredit ?: 0L,
            payoutAccountId = payoutId,
            payoutLabel = payoutLabel,
            onDismiss = { applyFor = null },
            onApplied = { loan ->
                applyFor = null
                result = loan
                reloadKey++
            },
        )
    }

    val applied = result
    if (applied != null) {
        AlertDialog(
            onDismissRequest = { result = null },
            containerColor = Tokens.Surface,
            title = { Text("借款已放款", fontSize = 18.sp, color = Tokens.Ink) },
            text = {
                Column {
                    Text(formatCents(applied.principal), fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(4.dp))
                    Text("已放款至人民币储蓄账户", fontSize = 12.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(12.dp))
                    Hairline()
                    KvRow("分 ${applied.totalPeriods} 期", "月供 ${formatCents(applied.monthlyPayment)}")
                    Hairline()
                    KvRow("年化利率", formatPercent(applied.apr))
                    Hairline()
                    KvRow("下期还款", formatDate(applied.nextDueDate))
                }
            },
            confirmButton = {
                TextButton(onClick = { result = null }) { Text("完成", color = Tokens.Ink) }
            },
        )
    }
}

@Composable
private fun LoanProductCard(
    product: MoreScreensApi.LoanProductDto,
    canApply: Boolean,
    onApply: () -> Unit,
) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(product.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                RiskBadge("年化 ${formatPercent(product.apr)} 起")
            }
            Spacer(Modifier.height(6.dp))
            Text(product.description, fontSize = 11.5.sp, color = Tokens.Ink2, lineHeight = 18.sp)
            if (product.tags.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(product.tags.joinToString(" · "), fontSize = 11.sp, color = Tokens.Muted)
            }
            Spacer(Modifier.height(10.dp))
            Hairline()
            KvInline("额度范围", "${formatCents(product.minAmount)} – ${formatCents(product.maxAmount)}")
            KvInline("借款期限", "${product.minTermMonths}–${product.maxTermMonths} 期")
            KvInline("放款说明", product.disbursement)
            Spacer(Modifier.height(10.dp))
            if (canApply) {
                GhostButton("立即借款", onApply, Modifier.fillMaxWidth())
            } else {
                Text("未获取到人民币储蓄账户，暂不可借款", fontSize = 11.5.sp, color = Tokens.Coral)
            }
        }
    }
}

@Composable
private fun LoanCard(loan: MoreScreensApi.LoanDto) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(loan.productName, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                Text(formatCents(loan.outstanding), fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "本金 ${formatCents(loan.principal)} · 月供 ${formatCents(loan.monthlyPayment)} · 下期 ${formatDate(loan.nextDueDate)}",
                fontSize = 11.sp,
                color = Tokens.Muted,
                lineHeight = 17.sp,
            )
            Spacer(Modifier.height(8.dp))
            ThinProgress(
                if (loan.totalPeriods > 0) loan.paidPeriods.toFloat() / loan.totalPeriods else 0f,
            )
            Spacer(Modifier.height(5.dp))
            Text(
                "已还 ${loan.paidPeriods}/${loan.totalPeriods} 期 · 年化 ${formatPercent(loan.apr)}",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
            )
        }
    }
}

@Composable
private fun InstallmentCard(plan: MoreScreensApi.InstallmentDto) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(plan.title, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                Text("${formatCents(plan.monthlyPayment)}/期", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "${plan.merchant} · 剩余 ${formatCents(plan.remainingAmount)} · 下期 ${formatDate(plan.nextDueDate)}",
                fontSize = 11.sp,
                color = Tokens.Muted,
                lineHeight = 17.sp,
            )
            Spacer(Modifier.height(8.dp))
            ThinProgress(if (plan.periods > 0) plan.paidPeriods.toFloat() / plan.periods else 0f)
            Spacer(Modifier.height(5.dp))
            Text(
                "已还 ${plan.paidPeriods}/${plan.periods} 期 · 手续费率 ${formatPercent(plan.feeRate)}",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
            )
        }
    }
}

@Composable
private fun CreditBuilderCard(builder: MoreScreensApi.CreditBuilderDto) {
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("信用评分", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.weight(1f))
                RiskBadge("${builder.level} · ${builder.score} 分")
            }
            Spacer(Modifier.height(8.dp))
            Text("连续按时还款 ${builder.streakMonths} 个月", fontSize = 13.sp, color = Tokens.Ink)
            if (builder.nextMilestone.isNotBlank()) {
                Spacer(Modifier.height(5.dp))
                Text(builder.nextMilestone, fontSize = 11.5.sp, color = Tokens.Ink2, lineHeight = 18.sp)
            }
            if (builder.tips.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                builder.tips.forEach { tip ->
                    Text("· $tip", fontSize = 11.sp, color = Tokens.Muted, lineHeight = 17.sp)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LoanApplySheet(
    product: MoreScreensApi.LoanProductDto,
    availableCredit: Long,
    payoutAccountId: String,
    payoutLabel: String,
    onDismiss: () -> Unit,
    onApplied: (MoreScreensApi.LoanDto) -> Unit,
) {
    var amountText by remember(product.id) { mutableStateOf(centsToInput(product.minAmount)) }
    var term by remember(product.id) { mutableStateOf(product.minTermMonths) }
    var purpose by remember { mutableStateOf("日常消费") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val termOptions = remember(product.minTermMonths, product.maxTermMonths) {
        (product.minTermMonths..product.maxTermMonths step 3).toList()
            .ifEmpty { listOf(product.minTermMonths) }
    }

    fun submit() {
        if (submitting) return
        val amount = parseAmountInput(amountText)
        if (amount == null) {
            error = "请输入有效金额，最多两位小数"
            return
        }
        if (amount < product.minAmount || amount > product.maxAmount) {
            error = "金额需在 ${formatCents(product.minAmount)}–${formatCents(product.maxAmount)} 之间"
            return
        }
        if (amount > availableCredit) {
            error = "超过当前可用授信额度 ${formatCents(availableCredit)}"
            return
        }
        if (purpose.isBlank()) {
            error = "请填写借款用途"
            return
        }
        if (!Regex("^\\d{6}$").matches(password)) {
            error = "请输入 6 位数字支付密码"
            return
        }
        submitting = true
        error = null
        scope.launch {
            try {
                val loan = MoreScreensApi.applyLoan(
                    productId = product.id,
                    amount = amount,
                    termMonths = term,
                    purpose = purpose.trim(),
                    accountId = payoutAccountId,
                    paymentPassword = password,
                )
                onApplied(loan)
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                error = failure.message ?: "申请失败，请稍后重试"
                if ((failure as? BankApiException)?.code?.contains("PAY_PASSWORD") == true) password = ""
            } finally {
                submitting = false
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!submitting) onDismiss() },
        sheetState = rememberModalBottomSheetState(),
        containerColor = Tokens.Surface,
    ) {
        Column(
            Modifier
                .padding(horizontal = 18.dp)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            Text("借款 · ${product.name}", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(4.dp))
            Text("核对金额、期限和收款账户后提交；放款结果以服务端返回为准。", fontSize = 11.5.sp, color = Tokens.Ink2, lineHeight = 18.sp)
            Spacer(Modifier.height(14.dp))
            TextFieldRow("借款金额", amountText, { amountText = it }, placeholder = "0.00", keyboardType = KeyboardType.Decimal)
            Spacer(Modifier.height(12.dp))
            Text("借款期限", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 6.dp, start = 2.dp))
            ChipRow(
                items = termOptions.map { "$it 期" },
                selected = termOptions.indexOf(term).coerceAtLeast(0),
                onSelect = { term = termOptions[it] },
            )
            Spacer(Modifier.height(4.dp))
            TextFieldRow("借款用途", purpose, { if (it.length <= 20) purpose = it }, placeholder = "日常消费")
            Spacer(Modifier.height(12.dp))
            TextFieldRow(
                "支付密码",
                password,
                { password = it.filter(Char::isDigit).take(6) },
                placeholder = "6 位数字",
                keyboardType = KeyboardType.NumberPassword,
                password = true,
            )
            Spacer(Modifier.height(12.dp))
            HairlineCard {
                Column(Modifier.padding(horizontal = 14.dp)) {
                    KvRow("放款账户", payoutLabel)
                    Hairline()
                    KvRow("年化利率", "${formatPercent(product.apr)} 起")
                    Hairline()
                    KvRow("可用额度", formatCents(availableCredit))
                }
            }
            if (error != null) {
                Spacer(Modifier.height(10.dp))
                Text(error!!, fontSize = 12.sp, color = Tokens.Coral, lineHeight = 18.sp)
            }
            Spacer(Modifier.height(18.dp))
            PrimaryButton(if (submitting) "提交中…" else "确认借款", ::submit)
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
fun InsuranceScreen(onBack: () -> Unit) {
    var overview by remember { mutableStateOf<MoreScreensApi.InsuranceOverviewDto?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var target by remember { mutableStateOf<MoreScreensApi.InsuranceProductDto?>(null) }
    var result by remember { mutableStateOf<MoreScreensApi.InsurancePolicyDto?>(null) }
    var reloadKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(reloadKey) {
        if (!BankApi.hasToken()) {
            loadError = "登录状态已失效，请重新登录"
            return@LaunchedEffect
        }
        loadError = null
        try {
            overview = MoreScreensApi.insuranceOverview()
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            loadError = failure.message ?: "保险信息加载失败"
        }
    }

    PushScreen(title = "保险保障", onBack = onBack) {
        val data = overview
        if (data == null) {
            if (loadError != null) {
                LoadFailure(loadError!!) { reloadKey++ }
            } else {
                Text("正在加载保险信息…", fontSize = 12.sp, color = Tokens.Muted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp))
            }
        } else {
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("总保额", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(5.dp))
                    Text(formatCents(data.totalCoverage), fontSize = 27.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(5.dp))
                    Text("共 ${data.policies.size} 份保单", fontSize = 11.sp, color = Tokens.Muted)
                }
            }

            SectionHeader("我的保单", "${data.policies.size} 份")
            if (data.policies.isEmpty()) {
                EmptyNote("还没有保单，可从下方产品中选择投保。")
            } else {
                Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    data.policies.forEach { PolicyCard(it) }
                }
            }

            SectionHeader("可投保产品", "${data.products.size} 款")
            if (data.products.isEmpty()) {
                EmptyNote("暂无可投保产品")
            } else {
                Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    data.products.forEach { product ->
                        InsuranceProductCard(product) { target = product }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            EmptyNote("投保会从人民币储蓄账户扣除年缴保费并生成保单；条款、等待期与免责范围以保单及产品条款为准。")
        }
    }

    val product = target
    if (product != null) {
        InsuranceEnrollSheet(
            product = product,
            onDismiss = { target = null },
            onEnrolled = { policy ->
                target = null
                result = policy
                reloadKey++
            },
        )
    }

    val policy = result
    if (policy != null) {
        AlertDialog(
            onDismissRequest = { result = null },
            containerColor = Tokens.Surface,
            title = { Text("投保成功", fontSize = 18.sp, color = Tokens.Ink) },
            text = {
                Column {
                    Text(policy.productName, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(6.dp))
                    Text("保额 ${formatCents(policy.coverage)}", fontSize = 13.sp, color = Tokens.Ink2)
                    Spacer(Modifier.height(4.dp))
                    Text("被保人 ${policy.insuredName.ifBlank { "—" }}", fontSize = 12.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(4.dp))
                    Text("保障期至 ${formatDate(policy.expireAt)}", fontSize = 12.sp, color = Tokens.Muted)
                }
            },
            confirmButton = {
                TextButton(onClick = { result = null }) { Text("完成", color = Tokens.Ink) }
            },
        )
    }
}

@Composable
private fun PolicyCard(policy: MoreScreensApi.InsurancePolicyDto) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(policy.productName, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                RiskBadge(policyStatusLabel(policy.status))
            }
            Spacer(Modifier.height(4.dp))
            Text("${policy.insurer} · 被保人 ${policy.insuredName.ifBlank { "—" }}", fontSize = 11.sp, color = Tokens.Muted)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                Metric("保额", formatCents(policy.coverage))
                Metric("年缴保费", formatCents(policy.premium))
            }
            Spacer(Modifier.height(10.dp))
            Hairline()
            Spacer(Modifier.height(8.dp))
            Text(
                "保障期 ${formatDate(policy.effectiveAt)} 至 ${formatDate(policy.expireAt)}",
                fontSize = 11.sp,
                color = Tokens.Muted,
            )
        }
    }
}

@Composable
private fun InsuranceProductCard(
    product: MoreScreensApi.InsuranceProductDto,
    onEnroll: () -> Unit,
) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(product.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                RiskBadge(product.category)
            }
            Spacer(Modifier.height(6.dp))
            Text(product.highlight, fontSize = 11.5.sp, color = Tokens.Ink2, lineHeight = 18.sp)
            if (product.tags.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(product.tags.joinToString(" · "), fontSize = 11.sp, color = Tokens.Muted)
            }
            Spacer(Modifier.height(10.dp))
            Hairline()
            KvInline("保额", formatCents(product.coverage))
            KvInline("年缴保费", formatCents(product.premiumPerYear))
            KvInline("承保方", product.insurer)
            Spacer(Modifier.height(10.dp))
            GhostButton("立即投保", onEnroll, Modifier.fillMaxWidth())
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InsuranceEnrollSheet(
    product: MoreScreensApi.InsuranceProductDto,
    onDismiss: () -> Unit,
    onEnrolled: (MoreScreensApi.InsurancePolicyDto) -> Unit,
) {
    var insuredName by remember(product.id) { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (submitting) return
        if (insuredName.isBlank()) {
            error = "请填写被保人姓名"
            return
        }
        if (!Regex("^\\d{6}$").matches(password)) {
            error = "请输入 6 位数字支付密码"
            return
        }
        submitting = true
        error = null
        scope.launch {
            try {
                val policy = MoreScreensApi.enrollInsurance(
                    productId = product.id,
                    insuredName = insuredName.trim(),
                    paymentPassword = password,
                )
                onEnrolled(policy)
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                error = failure.message ?: "投保失败，请稍后重试"
                if ((failure as? BankApiException)?.code?.contains("PAY_PASSWORD") == true) password = ""
            } finally {
                submitting = false
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!submitting) onDismiss() },
        sheetState = rememberModalBottomSheetState(),
        containerColor = Tokens.Surface,
    ) {
        Column(
            Modifier
                .padding(horizontal = 18.dp)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            Text("投保 · ${product.name}", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(4.dp))
            Text("保费将从人民币储蓄账户扣除，投保结果以服务端返回的保单为准。", fontSize = 11.5.sp, color = Tokens.Ink2, lineHeight = 18.sp)
            Spacer(Modifier.height(14.dp))
            TextFieldRow(
                "被保人姓名",
                insuredName,
                { if (it.length <= 20) insuredName = it },
                placeholder = "请输入姓名",
            )
            Spacer(Modifier.height(12.dp))
            HairlineCard {
                Column(Modifier.padding(horizontal = 14.dp)) {
                    KvRow("保额", formatCents(product.coverage))
                    Hairline()
                    KvRow("年缴保费", formatCents(product.premiumPerYear))
                    Hairline()
                    KvRow("承保方", product.insurer)
                }
            }
            Spacer(Modifier.height(12.dp))
            TextFieldRow(
                "支付密码",
                password,
                { password = it.filter(Char::isDigit).take(6) },
                placeholder = "6 位数字",
                keyboardType = KeyboardType.NumberPassword,
                password = true,
            )
            if (error != null) {
                Spacer(Modifier.height(10.dp))
                Text(error!!, fontSize = 12.sp, color = Tokens.Coral, lineHeight = 18.sp)
            }
            Spacer(Modifier.height(18.dp))
            PrimaryButton(if (submitting) "提交中…" else "确认投保", ::submit)
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
fun InviteScreen(onBack: () -> Unit) {
    var overview by remember { mutableStateOf<MoreScreensApi.InvitationOverviewDto?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableIntStateOf(0) }
    val context = LocalContext.current

    LaunchedEffect(reloadKey) {
        if (!BankApi.hasToken()) {
            loadError = "登录状态已失效，请重新登录"
            return@LaunchedEffect
        }
        loadError = null
        try {
            overview = MoreScreensApi.invitationOverview()
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            loadError = failure.message ?: "邀请信息加载失败"
        }
    }

    fun copy(label: String, value: String) {
        if (value.isBlank()) return
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
        Toast.makeText(context, "已复制$label", Toast.LENGTH_SHORT).show()
    }

    fun shareInvite(invite: MoreScreensApi.InviteCodeDto) {
        val text = buildString {
            append("我在使用招财猫银行")
            if (invite.code.isNotBlank()) append("，邀请码 ${invite.code}")
            if (invite.link.isNotBlank()) append("；注册链接：${invite.link}")
        }
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        runCatching { context.startActivity(Intent.createChooser(send, "分享邀请")) }
            .onFailure { Toast.makeText(context, "无法打开分享，请稍后重试", Toast.LENGTH_SHORT).show() }
    }

    PushScreen(title = "邀请与奖励", onBack = onBack) {
        val data = overview
        if (data == null) {
            if (loadError != null) {
                LoadFailure(loadError!!) { reloadKey++ }
            } else {
                Text("正在加载邀请信息…", fontSize = 12.sp, color = Tokens.Muted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp))
            }
        } else {
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("我的邀请码", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.weight(1f))
                        RiskBadge("累计已得 ${formatCents(data.totalEarned)}")
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        data.invite.code.ifBlank { "—" },
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Ink,
                        letterSpacing = 2.sp,
                    )
                    Spacer(Modifier.height(10.dp))
                    if (data.invite.code.isNotBlank()) {
                        GhostButton("复制邀请码", { copy("邀请码", data.invite.code) })
                    }
                    if (data.invite.link.isNotBlank()) {
                        Spacer(Modifier.height(10.dp))
                        Text(data.invite.link, fontSize = 11.5.sp, color = Tokens.Ink2, lineHeight = 18.sp)
                        Spacer(Modifier.height(8.dp))
                        GhostButton("复制邀请链接", { copy("邀请链接", data.invite.link) })
                    }
                    Spacer(Modifier.height(10.dp))
                    PrimaryButton("分享邀请链接", { shareInvite(data.invite) })
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "好友通过你的链接或邀请码注册并开户后，双方奖励以服务端记录为准。",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        lineHeight = 17.sp,
                    )
                }
            }

            SectionHeader("推荐进度", "共 ${data.friends.size} 位好友")
            if (data.friends.isEmpty()) {
                EmptyNote("还没有好友通过你的邀请加入")
            } else {
                HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                    Column(Modifier.padding(horizontal = 14.dp)) {
                        data.friends.forEachIndexed { index, friend ->
                            if (index > 0) Hairline()
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        "${friend.name} · ${friend.maskedPhone}",
                                        fontSize = 13.sp,
                                        color = Tokens.Ink,
                                        fontWeight = FontWeight.Medium,
                                    )
                                    Spacer(Modifier.height(2.dp))
                                    Text("${formatDate(friend.joinedAt)} 加入", fontSize = 10.5.sp, color = Tokens.Muted)
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(friendStageLabel(friend.stage), fontSize = 11.sp, color = Tokens.Ink2)
                                    if (friend.reward > 0L) {
                                        Spacer(Modifier.height(2.dp))
                                        Text(
                                            "+${formatCents(friend.reward)}",
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            color = Tokens.Ink,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            SectionHeader("奖励记录", "${data.rewards.size} 笔")
            if (data.rewards.isEmpty()) {
                EmptyNote("暂无奖励记录")
            } else {
                HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                    Column(Modifier.padding(horizontal = 14.dp)) {
                        data.rewards.forEachIndexed { index, reward ->
                            if (index > 0) Hairline()
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                                verticalAlignment = Alignment.Top,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(reward.title, fontSize = 13.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                                    if (reward.description.isNotBlank()) {
                                        Spacer(Modifier.height(2.dp))
                                        Text(reward.description, fontSize = 11.sp, color = Tokens.Muted, lineHeight = 17.sp)
                                    }
                                    Spacer(Modifier.height(2.dp))
                                    Text(rewardStatusLabel(reward.status), fontSize = 10.5.sp, color = Tokens.Muted)
                                }
                                Text(
                                    formatCents(reward.amount),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Tokens.Ink,
                                    modifier = Modifier.padding(start = 10.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ───────────────────────────── 共用小组件 ───────────────────────────── */

@Composable
private fun LoadFailure(message: String, onRetry: () -> Unit) {
    Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
        Text("加载失败：$message", fontSize = 12.sp, color = Tokens.Coral, lineHeight = 18.sp)
        Spacer(Modifier.height(8.dp))
        GhostButton("重试", onRetry)
    }
}

@Composable
private fun ThinProgress(ratio: Float) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(CircleShape)
            .background(Tokens.SurfaceWarm),
    ) {
        Box(
            Modifier
                .fillMaxWidth(ratio.coerceIn(0f, 1f))
                .height(6.dp)
                .background(Tokens.Accent),
        )
    }
}

private fun formatPercent(rate: Double): String =
    if (rate.isFinite()) String.format(Locale.US, "%.2f%%", rate * 100) else "—"

private fun centsToInput(cents: Long): String {
    val negative = cents < 0
    val absolute = if (negative) -cents else cents
    val text = "${absolute / 100}.${(absolute % 100).toString().padStart(2, '0')}"
    return if (negative) "-$text" else text
}

/** 与网页 `parseAmountInput` 一致：最多两位小数，返回整数分。 */
private fun parseAmountInput(value: String): Long? {
    val text = value.trim()
    if (text.length > 15) return null
    if (!Regex("^(?:\\d+(?:\\.\\d{0,2})?|\\.\\d{1,2})$").matches(text)) return null
    val cents = Math.round(text.toDouble() * 100)
    return if (cents >= 0L) cents else null
}

private fun policyStatusLabel(status: String): String = when (status) {
    "active" -> "生效中"
    "pending" -> "待生效"
    "expired" -> "已过期"
    else -> status
}

private fun friendStageLabel(stage: String): String = when (stage) {
    "registered" -> "已注册"
    "account_opened" -> "已开户"
    "reward_earned" -> "奖励达标"
    else -> stage
}

private fun rewardStatusLabel(status: String): String = when (status) {
    "credited" -> "已发放"
    "pending" -> "待发放"
    else -> status
}
