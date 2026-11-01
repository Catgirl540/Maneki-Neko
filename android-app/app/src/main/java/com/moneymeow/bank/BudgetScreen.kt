package com.moneymeow.bank

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal

private fun budgetCents(text: String): Long {
    require(text.matches(Regex("[0-9]+(\\.[0-9]{1,2})?"))) { "请输入有效金额，最多两位小数" }
    return BigDecimal(text).movePointRight(2).longValueExact()
}

@Composable
fun BudgetScreen(onBack: () -> Unit) {
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val submitter = rememberSubmitter()
    var reload by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var formOpen by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    var name by rememberSaveable { mutableStateOf("") }
    var limit by rememberSaveable { mutableStateOf("") }
    var threshold by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var platformsExpanded by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(reload) {
        loading = true
        runCatching { BankApi.budgetRequest("GET", "/api/budgets") }.onSuccess { data = it; error = null }.onFailure { data = null; error = it.message ?: "预算加载失败" }
        refreshing = false; loading = false
    }
    fun write(work: suspend () -> Unit) {
        submitter.submit(
            fallback = "操作失败，请刷新核对",
            onStart = { error = null },
            onError = { error = it },
            onSuccess = { reload++ },
        ) { work() }
    }
    fun newBudget() {
        if (submitter.busy) return
        if (editing != null) { name = ""; limit = ""; threshold = ""; selected = emptyList() }
        editing = null; error = null; formOpen = true
    }
    BackHandler(enabled = formOpen || submitter.busy) { if (!submitter.busy) { formOpen = false; error = null } }
    PushScreen(
        if (formOpen) { if (editing == null) "创建预算" else "编辑预算" } else "支出预算",
        onBack = { if (!submitter.busy) { if (formOpen) { formOpen = false; error = null } else onBack() } },
        refreshing = refreshing,
        onRefresh = if (formOpen) null else { { if (!refreshing && !submitter.busy) { refreshing = true; BankApi.invalidateReads(); reload++ } } },
        actionContent = {
            if (!formOpen) ActionIcon(Icons.Refresh, "刷新预算", enabled = !submitter.busy, busy = loading) { if (!loading) { BankApi.invalidateReads(); reload++ } }
        },
    ) {
        PageColumn {
            Spacer(Modifier.height(2.dp))
            error?.let { ErrorNote(it) }
            if (!formOpen) {
            val budgets = data?.optJSONArray("budgets") ?: JSONArray()
            EntryRow(Icons.Plus, "创建支出预算", onClick = ::newBudget)
            SectionHeader("我的预算", if (data == null) "" else "${budgets.length()} 个")
            if (loading) SkeletonCardList()
            if (!loading && data != null && budgets.length() == 0) BankEmptyState("让每笔支出有计划", "创建第一份预算，按平台管理每日开销。", Icons.Pig)
            budgets.objects().forEach { row ->
                val today = row.getJSONObject("today"); val points = row.getJSONObject("points")
                HairlineCard { Column(Modifier.fillMaxWidth().padding(14.dp)) {
                    Text(row.optString("name"), fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(10.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("今日已用", style = Tokens.Text.note)
                        Text("${formatCents(today.optLong("used"))} / ${formatCents(today.optLong("limit"))}", fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Tokens.Ink)
                    }
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(6.dp)).background(Tokens.SurfaceWarm)) {
                        val ratio = (today.optLong("used").toFloat() / today.optLong("limit").coerceAtLeast(1)).coerceIn(0f, 1f)
                        Box(Modifier.fillMaxWidth(ratio).fillMaxHeight().background(if (ratio >= 1f) Tokens.Coral else Tokens.Accent))
                    }
                    KvRow("今日剩余", formatCents(today.optLong("remaining")))
                    Text("可用积分 ${points.optInt("available")} · ${if (row.optBoolean("enabled")) "已启用" else "已停用"}", style = Tokens.Text.hint)
                    Row {
                        TextButton(enabled = !submitter.busy, onClick = { editing = row.getString("id"); name = row.optString("name"); limit = BigDecimal(row.optLong("dailyLimit")).movePointLeft(2).toPlainString(); threshold = BigDecimal(row.optLong("pointThreshold")).movePointLeft(2).toPlainString(); val p = row.optJSONArray("platforms") ?: JSONArray(); selected = (0 until p.length()).map { p.getString(it) }; error = null; formOpen = true }) { Text("编辑") }
                        TextButton(enabled = !submitter.busy, onClick = { write { BankApi.budgetRequest("PATCH", "/api/budgets/${row.getString("id")}", JSONObject().put("enabled", !row.optBoolean("enabled"))) } }) { Text(if (row.optBoolean("enabled")) "停用" else "启用") }
                        TextButton(enabled = !submitter.busy, onClick = { deleting = row }) { Text("删除", color = Tokens.Coral) }
                    }
                    TextButton(enabled = !submitter.busy && points.optInt("available") >= (data?.optInt("pointsPerPass") ?: Int.MAX_VALUE), onClick = { write { BankApi.budgetRequest("POST", "/api/budgets/${row.getString("id")}/passes", JSONObject().put("day", today.getString("day"))) } }) { Text("兑换今日额度券") }
                } }
            }
            Text("预算限制模拟消费，不冻结资金。", style = Tokens.Text.note)
            } else {
            FormCard("预算设置") {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    TextFieldRow("预算名称", name, { if (!submitter.busy) name = it.take(40) }, placeholder = "例如：日常餐饮")
                    TextFieldRow("每日限额（元）", limit, { if (!submitter.busy) limit = it.take(16) }, placeholder = "至少 1.00 元", keyboardType = KeyboardType.Decimal)
                    TextFieldRow("积分门槛（元）", threshold, { if (!submitter.busy) threshold = it.take(16) }, placeholder = "不超过每日限额", keyboardType = KeyboardType.Decimal)
                }
            }
            FormCard("适用平台") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(if (selected.isEmpty()) "尚未选择" else "已选择 ${selected.size} 个平台", style = Tokens.Text.bodyMuted)
                    TextButton(enabled = !submitter.busy, onClick = { platformsExpanded = !platformsExpanded }) { Text(if (platformsExpanded) "收起" else "选择平台", color = Tokens.AccentDeep) }
                }
                if (platformsExpanded) {
                spendPlatforms.filter { !it.custom }.chunked(2).forEach { platforms ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        platforms.forEach { platform ->
                            FilterChip(selected = platform.id in selected, enabled = !submitter.busy, onClick = {
                                selected = if (platform.id in selected) selected - platform.id else selected + platform.id
                            }, label = { Text(platform.name, fontSize = 13.sp) }, modifier = Modifier.weight(1f))
                        }
                        if (platforms.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
                } else if (selected.isNotEmpty()) {
                    Text(spendPlatforms.filter { it.id in selected }.joinToString("、") { it.name }, fontSize = 12.sp, lineHeight = 18.sp, color = Tokens.Muted)
                }
            }
            PrimaryButton(if (submitter.busy) "保存中…" else "保存预算", onClick = {
                if (!submitter.busy) {
                runCatching { require(name.isNotBlank() && selected.isNotEmpty()) { "请填写名称并选择平台" }; val cents = budgetCents(limit); val thresholdCents = budgetCents(threshold); require(cents >= 100 && thresholdCents <= cents) { "限额至少 1 元，积分门槛不能超过限额" }; JSONObject().put("name", name.trim()).put("platforms", JSONArray(selected.toList())).put("dailyLimit", cents).put("pointThreshold", thresholdCents) }
                    .onSuccess { body -> write { val id = editing; BankApi.budgetRequest(if (id == null) "POST" else "PATCH", if (id == null) "/api/budgets" else "/api/budgets/$id", body); formOpen = false; editing = null; name = ""; limit = ""; threshold = ""; selected = emptyList() } }
                    .onFailure { error = it.message ?: "请检查输入" }
                }
            })
            }
        }
    }
    deleting?.let { row -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text("删除预算") }, text = { Text("确认删除「${row.optString("name")}」？") }, confirmButton = { TextButton(enabled = !submitter.busy, onClick = { write { BankApi.budgetRequest("DELETE", "/api/budgets/${row.getString("id")}"); deleting = null } }) { Text("确认删除") } }, dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } }) }
}
