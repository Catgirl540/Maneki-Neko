package com.moneymeow.bank

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.LocalDate
import java.time.YearMonth

@Composable
fun BillingReportScreen(onBack: () -> Unit, onBudgets: () -> Unit) {
    var period by remember { mutableIntStateOf(0) }
    var currency by remember { mutableIntStateOf(0) }
    var month by remember { mutableStateOf(YearMonth.now(bankZone).toString()) }
    var year by remember { mutableStateOf(LocalDate.now(bankZone).year.toString()) }
    var report by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var exportData by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val kind = if (period == 0) "month" else "year"
    val value = if (period == 0) month else year
    val code = listOf("CNY", "USD", "HKD")[currency]
    val saveFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        val data = exportData
        exportData = null
        if (uri != null && data != null) scope.launch {
            runCatching { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(data.toByteArray(Charsets.UTF_8)) } ?: error("无法打开文件") } }
                .onSuccess { info = "报告已保存" }.onFailure { error = it.message ?: "保存报告失败" }
        }
    }
    LaunchedEffect(kind, value, code, reload) {
        report = null; error = null
        val valid = if (period == 0) runCatching { YearMonth.parse(value) }.isSuccess else value.matches(Regex("[0-9]{4}"))
        if (!valid) { loading = false; error = if (period == 0) "请输入 YYYY-MM 格式的有效月份" else "请输入四位年份"; return@LaunchedEffect }
        loading = true
        runCatching { LedgerApi.report(kind, value, code) }.onSuccess {
            if (it.optString("period") == kind && it.optString("value") == value && it.optString("currency") == code) report = it
            else error = "银行返回的报告与所选条件不一致"
        }.onFailure { error = it.message ?: "报告加载失败" }
        loading = false
        refreshing = false
    }
    PushScreen(
        title = "账单报告",
        onBack = onBack,
        action = "支出预算",
        onAction = onBudgets,
        refreshing = refreshing,
        onRefresh = { if (!refreshing) { refreshing = true; BankApi.invalidateReads(); reload++ } },
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            FormCard("报告范围") {
            SegTabs(listOf("月度报告", "年度报告"), period) { period = it }
            TextFieldRow(
                if (period == 0) "月份" else "年份",
                value,
                { if (period == 0) month = it.take(7) else year = it.filter(Char::isDigit).take(4) },
                placeholder = if (period == 0) "YYYY-MM" else "YYYY",
            )
            SegTabs(listOf("CNY", "USD", "HKD"), currency) { currency = it }
            }
            if (loading) {
                SkeletonBox(Modifier.fillMaxWidth().height(150.dp), RoundedCornerShape(14.dp))
                SkeletonCardLines(2)
            }
            error?.let {
                Text(it, color = Tokens.Coral, fontSize = 12.sp)
                ActionIcon(Icons.Refresh, "重新加载报告", onClick = { reload++ })
            }
            info?.let { BankToast(it) { info = null } }
            report?.let { data ->
                val income = data.optLong("totalIncome")
                val expense = data.optLong("totalExpense")
                val net = data.optLong("net")

                // 汇总：净额最大，收入/支出并列，笔数与截止时间收在底部。
                HairlineCard {
                    Column(Modifier.padding(horizontal = 18.dp, vertical = 16.dp)) {
                        Text("净额", style = Tokens.Text.hint)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            formatCents(net, code),
                            fontSize = 30.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (net >= 0) Tokens.Ink else Tokens.Coral,
                        )
                        Spacer(Modifier.height(14.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                            ReportFigure("收入", formatCents(income, code))
                            ReportFigure("支出", formatCents(expense, code))
                        }
                        Spacer(Modifier.height(12.dp))
                        Hairline()
                        Spacer(Modifier.height(10.dp))
                        Row {
                            Text("交易笔数", fontSize = 11.5.sp, color = Tokens.Muted, modifier = Modifier.weight(1f))
                            Text(data.optInt("transactionCount").toString(), fontSize = 12.5.sp, color = Tokens.Ink)
                        }
                        Spacer(Modifier.height(6.dp))
                        Row {
                            Text("截至（北京时间）", fontSize = 11.5.sp, color = Tokens.Muted, modifier = Modifier.weight(1f))
                            Text(bankTime(data.optString("asOf")), fontSize = 12.5.sp, color = Tokens.Ink)
                        }
                    }
                }

                val months = data.optJSONArray("months")
                if (months != null && months.length() > 0) {
                    SectionHeader("月度明细", "${months.length()} 个月")
                    HairlineCard {
                        Column {
                            for (index in 0 until months.length()) {
                                if (index > 0) Hairline()
                                val item = months.getJSONObject(index)
                                Column(
                                    Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
                                ) {
                                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                        Text(item.optString("month"), fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Tokens.Ink, modifier = Modifier.weight(1f))
                                        Text("${item.optInt("count")} 笔", style = Tokens.Text.note)
                                    }
                                    Spacer(Modifier.height(10.dp))
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Column(Modifier.weight(1f)) { ReportFigure("收入", formatCents(item.optLong("income"), code)) }
                                        Column(Modifier.weight(1f)) { ReportFigure("支出", formatCents(item.optLong("expense"), code)) }
                                    }
                                }
                            }
                        }
                    }
                }

                val categories = data.optJSONArray("categories")
                if (categories != null && categories.length() > 0) {
                    SectionHeader("支出分类", "${categories.length()} 项")
                    HairlineCard {
                        Column {
                            for (index in 0 until categories.length()) {
                                if (index > 0) Hairline()
                                val item = categories.getJSONObject(index)
                                val amount = item.optLong("amount")
                                val ratio = if (expense > 0) (amount.toDouble() / expense).coerceIn(0.0, 1.0) else 0.0
                                Column(Modifier.padding(horizontal = 14.dp, vertical = 11.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(item.optString("label"), style = Tokens.Text.body, modifier = Modifier.weight(1f))
                                        Text(formatCents(amount, code), fontSize = 12.5.sp, color = Tokens.Ink2)
                                    }
                                    Spacer(Modifier.height(7.dp))
                                    Box(
                                        Modifier
                                            .fillMaxWidth()
                                            .height(8.dp)
                                            .clip(RoundedCornerShape(999.dp))
                                            .background(Tokens.SurfaceWarm),
                                    ) {
                                        Box(
                                            Modifier
                                                .fillMaxWidth(ratio.toFloat())
                                                .fillMaxHeight()
                                                .clip(RoundedCornerShape(999.dp))
                                                .background(Tokens.Primary),
                                        )
                                    }
                                    Spacer(Modifier.height(5.dp))
                                    Text("占总支出 ${String.format(java.util.Locale.CHINA, "%.1f%%", ratio * 100)}", style = Tokens.Text.hint)
                                }
                            }
                        }
                    }
                }

                PrimaryButton("导出 CSV", onClick = {
                    val capturedKind = kind; val capturedValue = value; val capturedCode = code
                    scope.launch {
                        runCatching { LedgerApi.reportCsv(capturedKind, capturedValue, capturedCode) }
                            .onSuccess { exportData = it; saveFile.launch("账单报告-$capturedValue-$capturedCode.csv") }
                            .onFailure { error = it.message ?: "导出报告失败" }
                    }
                })
            }
        }
    }
}

/** 汇总里的并列数字块：小标签 + 金额。 */
@Composable
private fun ReportFigure(label: String, value: String) {
    Column {
        Text(label, style = Tokens.Text.hint)
        Spacer(Modifier.height(3.dp))
        Text(value, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
    }
}
