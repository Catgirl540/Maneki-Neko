package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.RadioButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.time.LocalDate
import java.util.UUID

internal fun planCents(text: String, zero: Boolean = false): Long {
    require(text.matches(Regex("[0-9]{1,10}(\\.[0-9]{1,2})?"))) { "请输入有效金额，最多两位小数" }
    val value = BigDecimal(text).movePointRight(2).longValueExact()
    require(value >= if (zero) 0L else 1L) { "金额必须大于零" }
    return value
}
internal fun bankTime(value: String): String = runCatching {
    java.time.Instant.parse(value).atZone(bankZone).format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
}.getOrDefault(value)

private data class PlanReview(val title: String, val detail: String, val method: String, val path: String, val body: JSONObject, val pinRequired: Boolean = false)

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun PlansScreen(onBack: () -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var createGoal by rememberSaveable { mutableStateOf(false) }
    var roundupOpen by rememberSaveable { mutableStateOf(false) }
    var createInvestment by rememberSaveable { mutableStateOf(false) }
    var editCash by rememberSaveable { mutableStateOf(false) }
    var createBirthday by rememberSaveable { mutableStateOf(false) }
    // 记录当前 data 属于哪个 tab：切 tab 时先渲染、后加载，不能拿上一个 tab 的数据去取值。
    var loadedTab by remember { mutableIntStateOf(-1) }
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var birthdays by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    val submitter = rememberSubmitter()
    var reload by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    // 各分段独立保留草稿；关闭表单、切换分段和旋转屏幕都不清空输入。
    var names by rememberSaveable { mutableStateOf(List(4) { "" }) }
    var amounts by rememberSaveable { mutableStateOf(List(4) { "" }) }
    var dates by rememberSaveable { mutableStateOf(List(4) { "" }) }
    val name = names[tab]
    val amount = amounts[tab]
    val date = dates[tab]
    fun setName(value: String) { names = names.toMutableList().also { it[tab] = value } }
    fun setAmount(value: String) { amounts = amounts.toMutableList().also { it[tab] = value } }
    fun setDate(value: String) { dates = dates.toMutableList().also { it[tab] = value } }
    var relationship by rememberSaveable { mutableStateOf("") }
    var currency by rememberSaveable { mutableStateOf("CNY") }
    var cycle by rememberSaveable { mutableStateOf("每月") }
    var product by rememberSaveable { mutableStateOf("") }
    var goal by rememberSaveable { mutableStateOf("") }
    var roundup by rememberSaveable { mutableStateOf("") }
    var cap by rememberSaveable { mutableStateOf("") }
    var roundupDraftLoaded by rememberSaveable { mutableStateOf(false) }
    var cashDraftLoaded by rememberSaveable { mutableStateOf(false) }
    var review by remember { mutableStateOf<PlanReview?>(null) }
    var pin by remember { mutableStateOf("") }
    LaunchedEffect(tab, reload) {
        loading = true; data = null; birthdays = emptyList(); error = null
        try {
            account = BankApi.accounts().singleOrNull()
            val path = when (tab) { 0 -> "/api/savings/overview"; 1 -> "/api/wealth/investments"; 2 -> "/api/wealth/cash-management"; else -> "/api/linked/birthdays" }
            val result = BankApi.savingsRequest("GET", path)
            if (tab == 3) birthdays = (result as JSONArray).objects() else data = result as JSONObject
            if (tab == 0 && !roundupDraftLoaded) data?.getJSONObject("roundup")?.let { rule ->
                goal = rule.optString("goalId").takeUnless { it == "null" }.orEmpty()
                roundup = BigDecimal(rule.getLong("roundupTo")).movePointLeft(2).toPlainString()
                cap = BigDecimal(rule.getLong("dailyCap")).movePointLeft(2).toPlainString()
                roundupDraftLoaded = true
            }
            if (tab == 2 && !cashDraftLoaded) {
                setAmount(BigDecimal(data!!.getLong("sweepThreshold")).movePointLeft(2).toPlainString())
                cashDraftLoaded = true
            }
            loadedTab = tab
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "计划加载失败" }
        finally { loading = false; refreshing = false }
    }
    fun prepare(block: () -> PlanReview) {
        if (submitter.busy || loading) return
        error = null; message = null; pin = ""
        runCatching(block).onSuccess { review = it }.onFailure { error = it.message ?: "请检查输入" }
    }
    fun reviewChange(title: String, detail: String, method: String, path: String, body: JSONObject, password: Boolean = false) = prepare { PlanReview(title, detail, method, path, body, password) }
    PushScreen(
        "储蓄与计划",
        onBack = { if (!submitter.busy) onBack() },
        refreshing = refreshing,
        onRefresh = { if (!refreshing) { refreshing = true; BankApi.invalidateReads(); reload++ } },
        actionContent = {
            ActionIcon(Icons.Refresh, "刷新计划", enabled = !submitter.busy, busy = loading) {
                if (!loading) { refreshing = true; BankApi.invalidateReads(); reload++ }
            }
        },
    ) {
        PageColumn {
            SegTabs(listOf("存钱目标", "定投", "现金管理", "生日"), tab) { if (!submitter.busy) { tab = it; message = null } }
            if (loading) SkeletonCardList()
            error?.let { ErrorNote(it) }
            message?.let { Text(it, color = Tokens.Ink2, fontSize = 12.sp) }
            if (tab == 0 && data != null && loadedTab == 0) {
                val goals = data!!.getJSONArray("goals").objects()
                val totalSaved = data!!.getLong("totalSaved")

                val totalTarget = goals.sumOf { it.optLong("targetAmount") }.coerceAtLeast(1L)
                val totalRatio = (totalSaved.toFloat() / totalTarget).coerceIn(0f, 1f)
                HairlineCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 18.dp, vertical = 16.dp)) {
                        Text("目标进度合计", style = Tokens.Text.hint)
                        Spacer(Modifier.height(6.dp))
                        Text(formatCents(totalSaved), fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                        Spacer(Modifier.height(12.dp))
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(Tokens.SurfaceWarm),
                        ) {
                            Box(
                                Modifier
                                    .fillMaxWidth(totalRatio)
                                    .fillMaxHeight()
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(Tokens.Primary),
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("已完成 ${(totalRatio * 100).toInt()}%", fontSize = 11.sp, color = Tokens.Ink2, modifier = Modifier.weight(1f))
                            Text("目标 ${formatCents(totalTarget)}", style = Tokens.Text.hint)
                        }
                    }
                }

                SectionHeader("我的目标", "${goals.size} 个")
                if (goals.isEmpty()) BankEmptyState("还没有存钱目标", "为下一次旅行或心愿，定一个小目标。", Icons.Pig)
                goals.forEach { row ->
                    val saved = row.getLong("savedAmount")
                    val target = row.getLong("targetAmount").coerceAtLeast(1)
                    val ratio = (saved.toFloat() / target).coerceIn(0f, 1f)
                    HairlineCard {
                        Column(Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    row.getString("name"),
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = Tokens.Ink,
                                    modifier = Modifier.weight(1f),
                                )
                                Box(
                                    Modifier
                                        .size(28.dp)
                                        .clip(CircleShape)
                                        .clickable(enabled = !submitter.busy) {
                                            reviewChange("删除存钱目标", "删除「${row.getString("name")}」只移除目标记录，不扣款或退款。", "DELETE", "/api/savings/goals/${row.getString("id")}", JSONObject())
                                        },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(Icons.Trash, contentDescription = "删除目标", tint = Tokens.Muted, modifier = Modifier.size(15.dp))
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .height(5.dp)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(Tokens.SurfaceWarm),
                            ) {
                                Box(
                                    Modifier
                                        .fillMaxWidth(ratio)
                                        .fillMaxHeight()
                                        .clip(RoundedCornerShape(999.dp))
                                        .background(Tokens.Primary),
                                )
                            }
                            Spacer(Modifier.height(8.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    "${formatCents(saved)} / ${formatCents(target)}",
                                    fontSize = 12.sp,
                                    color = Tokens.Ink2,
                                    modifier = Modifier.weight(1f),
                                )
                                row.optString("deadline").takeUnless { it == "null" || it.isBlank() }?.let {
                                    Text("目标日 $it", style = Tokens.Text.hint)
                                }
                            }
                        }
                    }
                }

                HairlineCard(Modifier.fillMaxWidth().clickable(enabled = !submitter.busy) { createGoal = true }) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 16.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Plus, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("新建存钱目标", style = Tokens.Text.bodyMuted)
                    }
                }

                val chosenGoal = goals.firstOrNull { it.optString("id") == goal }
                HairlineCard(Modifier.fillMaxWidth().clickable(enabled = !submitter.busy) { roundupOpen = true }) {
                    Row(
                        Modifier.padding(horizontal = 16.dp, vertical = 15.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("消费凑整规则", fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = Tokens.Ink)
                            Spacer(Modifier.height(3.dp))
                            Text(
                                (chosenGoal?.optString("name")?.takeIf { it.isNotBlank() } ?: "未选择归集目标") +
                                    " · 凑整到 $roundup 元 · 每日上限 $cap 元",
                                fontSize = 11.sp,
                                color = Tokens.Muted,
                            )
                        }
                        Icon(Icons.Chevron, contentDescription = "编辑凑整规则", tint = Tokens.Muted, modifier = Modifier.size(14.dp))
                    }
                }
            }
            if (tab == 1 && data != null && loadedTab == 1) {
                EntryRow(Icons.Plus, "新建定投计划", onClick = { if (!submitter.busy) createInvestment = true })
                val plans = data!!.optJSONArray("plans")?.objects().orEmpty()
                SectionHeader("我的定投", "${plans.size} 个")
                if (plans.isEmpty()) BankEmptyState("还没有定投计划", "从小额开始，按自己的节奏规划投资。", Icons.Wealth)
                plans.forEach { row -> HairlineCard { Column(Modifier.fillMaxWidth().padding(14.dp)) {
                    Text(row.getString("productName"), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    val status = row.getString("status")
                    Spacer(Modifier.height(8.dp))
                    Text("${row.getString("cycle")} · ${formatCents(row.getLong("amount"))}", fontSize = 18.sp, fontWeight = FontWeight.Medium, color = Tokens.Ink)
                    Spacer(Modifier.height(6.dp))
                    Text("${when(status) { "active" -> "已保存"; "paused" -> "已暂停"; else -> "已取消" }} · 计划日期 ${bankTime(row.getString("nextRunAt"))}", fontSize = 12.sp, color = Tokens.Ink2)
                    Text("已投 ${row.optInt("executedRuns")} 次", style = Tokens.Text.note)
                    Spacer(Modifier.height(10.dp))
                    Hairline()
                    if (status != "cancelled") Row {
                        listOf((if (status == "active") "paused" else "active") to (if (status == "active") "暂停" else "恢复"), "cancelled" to "取消").forEach { (next, label) -> TextButton(enabled = !submitter.busy, onClick = { reviewChange("$label 定投计划", "${row.getString("productName")} · ${row.getString("cycle")} ${formatCents(row.getLong("amount"))}\n只管理计划，不赎回或退款。", "PATCH", "/api/wealth/investments/plan/${row.getString("id")}", JSONObject().put("status", next).put("expectedRevision", row.optInt("revision")), next == "active") }) { Text(label) } }
                    }
                } } }
                Text("自动扣款尚未开放，当前仅管理计划。", style = Tokens.Text.note)
            }
            if (tab == 2 && data != null && loadedTab == 2) {
                val row = data!!
                FormCard("活钱余额") {
                    Text(formatCents(row.getLong("balance")), fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    KvRow("累计收益", formatCents(row.getLong("totalYield")))
                    Hairline()
                    KvRow("活期保留金额", formatCents(row.getLong("sweepThreshold")))
                    KvRow("自动转入规则", if (row.getBoolean("sweepEnabled")) "已启用" else "已停用")
                }
                EntryRow(Icons.Edit, "管理自动转入", onClick = { if (!submitter.busy) editCash = true })
                Text("当前只保存规则，自动执行尚未开放。", style = Tokens.Text.note)
            }
            if (tab == 3 && !loading) {
                EntryRow(Icons.Plus, "新建生日计划", onClick = { if (!submitter.busy) createBirthday = true })
                SectionHeader("生日计划", "${birthdays.size} 个")
                if (birthdays.isEmpty() && error == null) BankEmptyState("记住每个重要日子", "为亲友提前准备一份心意。", Icons.Person)
                birthdays.forEach { row -> HairlineCard { Column(Modifier.fillMaxWidth().padding(14.dp)) {
                    Text("${row.getString("contactName")} · ${row.getString("eventDate")}")
                    Text("${formatCents(row.getLong("amountCents"), row.getString("currency"))} · ${birthdayStatus(row.getString("status"))}", fontSize = 12.sp)
                    Text("预留时间 ${bankTime(row.getString("reserveAt"))}", fontSize = 11.sp)
                    row.optString("lastError").takeUnless { it.isBlank() || it == "null" }?.let { Text(it, color = Tokens.Coral, fontSize = 11.sp) }
                    if (row.getString("status") !in setOf("cancelled", "expired", "released")) TextButton(enabled = !submitter.busy, onClick = { reviewChange("取消生日计划", "确认取消并释放本计划的原预留？不会改变其他冻结资金。", "POST", "/api/linked/birthdays/${row.getString("id")}/cancel", JSONObject().put("confirmed", true)) }) { Text("取消计划") }
                    if (row.optJSONObject("order")?.optString("status") == "awaiting_confirmation") TextButton(enabled = !submitter.busy, onClick = { reviewChange("确认订购待办", "当前商户尚未接入，确认后只标为等待接入，不消费或产生真实订单。", "POST", "/api/linked/birthdays/${row.getString("id")}/order", JSONObject().put("confirmed", true)) }) { Text("核对鲜花蛋糕待办") }
                } } }
            }
        }
    }
    if (createInvestment) {
        PlanFormSheet("新建定投计划", submitter.busy, onDismiss = { createInvestment = false }) {
            val products = if (loadedTab == 1) data?.optJSONArray("products")?.objects().orEmpty() else emptyList()
            FormCard("选择投资产品") {
                products.forEachIndexed { index, row ->
                    if (index > 0) Hairline()
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !submitter.busy) { product = row.getString("code"); setName(row.getString("name")) }.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = product == row.getString("code"), onClick = null)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(row.getString("name"), fontSize = 14.sp, color = Tokens.Ink)
                            Text("起投 ${formatCents(row.getLong("minAmount"))}", style = Tokens.Text.note)
                        }
                    }
                }
                if (products.isEmpty()) Text("暂无可选产品，请返回后刷新。", color = Tokens.Muted, fontSize = 12.sp)
            }
            FormCard("定投设置", subtitle = "创建或恢复需有效风险测评、理财资格及支付密码。") {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SecureNumberField("每期金额（元）", amount, { if (!submitter.busy) setAmount(it) }, placeholder = "请输入每期投入金额", allowDecimal = true)
                    Text("投资频次", style = Tokens.Text.note)
                    SegTabs(listOf("每周", "每两周", "每月"), listOf("每周", "每两周", "每月").indexOf(cycle)) { if (!submitter.busy) cycle = listOf("每周", "每两周", "每月")[it] }
                    Text("当前仅保存计划，不自动扣款。", style = Tokens.Text.note)
                }
            }
            error?.let { ErrorNote(it) }
            PrimaryButton(if (submitter.busy) "处理中…" else "核对新建定投", onClick = { prepare {
                val selected = products.firstOrNull { it.getString("code") == product } ?: error("请选择产品")
                val cents = planCents(amount); require(cents >= selected.getLong("minAmount")) { "金额低于产品起投要求" }
                PlanReview("确认保存定投", "${selected.getString("name")} · $cycle ${formatCents(cents)}\n只保存计划，不自动扣款。", "POST", "/api/wealth/investments/plan", JSONObject().put("productCode", product).put("cycle", cycle).put("amount", cents).put("accountId", account?.id ?: error("资金账户不可用")), true)
            } })
        }
    }
    if (editCash) {
        PlanFormSheet("自动转入规则", submitter.busy, onDismiss = { editCash = false }) {
            val row = if (loadedTab == 2) data else null
            FormCard("活期保留金额", subtitle = "当前只保存设置，自动转入尚未开放。") {
                SecureNumberField("保留金额（元）", amount, { if (!submitter.busy) setAmount(it) }, placeholder = "请输入需保留的金额", allowDecimal = true)
            }
            error?.let { ErrorNote(it) }
            PrimaryButton("核对保存金额", onClick = { prepare { PlanReview("修改保留金额", "保留 $amount 元；只保存规则。", "PATCH", "/api/wealth/cash-management/sweep", JSONObject().put("threshold", planCents(amount, true))) } })
            if (row != null) SecondaryButton(if (row.getBoolean("sweepEnabled")) "停用自动转入规则" else "启用自动转入规则", onClick = {
                reviewChange("确认切换规则", "仅保存自动转入开关，当前不会执行转入。", "PATCH", "/api/wealth/cash-management/sweep", JSONObject().put("enabled", !row.getBoolean("sweepEnabled")))
            }, modifier = Modifier.fillMaxWidth())
        }
    }
    if (createBirthday) {
        PlanFormSheet("新建生日计划", submitter.busy, onDismiss = { createBirthday = false }) {
            FormCard("联系人") {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    TextFieldRow("联系人姓名", name, { if (!submitter.busy) setName(it.take(40)) }, placeholder = "例如：妈妈")
                    TextFieldRow("与本人关系", relationship, { if (!submitter.busy) relationship = it.take(20) }, placeholder = "例如：家人、朋友")
                    TextFieldRow("生日日期", date, { if (!submitter.busy) setDate(it.take(10)) }, placeholder = "YYYY-MM-DD")
                }
            }
            FormCard("预留设置") {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("预留币种", style = Tokens.Text.note)
                    SegTabs(listOf("CNY", "USD", "HKD"), listOf("CNY", "USD", "HKD").indexOf(currency)) { if (!submitter.busy) currency = listOf("CNY", "USD", "HKD")[it] }
                    SecureNumberField("预留金额", amount, { if (!submitter.busy) setAmount(it) }, placeholder = "请输入预留金额", allowDecimal = true)
                    Text("预留只减少该币种可用余额，不扣账面余额。鲜花蛋糕另行确认，商户未接入前不创建真实订单。", color = Tokens.Muted, fontSize = 12.sp)
                }
            }
            error?.let { ErrorNote(it) }
            PrimaryButton(if (submitter.busy) "获取预览中…" else "获取生日预留预览", onClick = {
                if (!submitter.busy && !loading) {
                    error = null
                    val body = runCatching {
                        require(name.isNotBlank() && relationship.isNotBlank()) { "请填写联系人姓名与关系" }
                        JSONObject().put("contactName", name.trim()).put("relationship", relationship.trim()).put("eventDate", LocalDate.parse(date).toString()).put("amountCents", planCents(amount)).put("currency", currency)
                    }.getOrElse { error = it.message ?: "请检查输入"; null }
                    if (body != null) {
                        submitter.submit(
                            fallback = "预览失败",
                            onError = { error = it },
                        ) {
                            val terms = BankApi.savingsRequest("POST", "/api/linked/birthdays/preview", body) as JSONObject
                            review = PlanReview("确认生日资金预留", "${terms.getString("contactName")}（${terms.getString("relationship")}）\n生日 ${terms.getString("eventDate")}\n预留 ${formatCents(terms.getLong("amountCents"), terms.getString("currency"))}\n预留时间 ${bankTime(terms.getString("reserveAt"))}\n待办时间 ${bankTime(terms.getString("orderAt"))}\n${terms.getString("notice")}", "POST", "/api/linked/birthdays", body.put("accountId", terms.getString("accountId")).put("requestId", UUID.randomUUID().toString()).put("confirmed", true), true)
                            pin = ""
                        }
                    }
                }
            })
        }
    }
    if (roundupOpen) {
        PlanFormSheet("消费凑整规则", submitter.busy, onDismiss = { roundupOpen = false }) {
            val goals = data?.optJSONArray("goals")?.objects().orEmpty()
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("当前只保存规则，不自动扣款。", style = Tokens.Text.hint)
                Text("选择归集目标", style = Tokens.Text.hint)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    goals.forEach { row ->
                        val chosen = goal == row.getString("id")
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .background(if (chosen) Tokens.Primary else Tokens.SurfaceWarm)
                                .clickable(enabled = !submitter.busy) { goal = row.getString("id") }
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                        ) {
                            Text(row.getString("name"), fontSize = 12.sp, color = if (chosen) Color.White else Tokens.Ink2)
                        }
                    }
                }
                SecureNumberField("凑整到（元）", roundup, { if (!submitter.busy) roundup = it }, allowDecimal = true)
                SecureNumberField("单日上限（元）", cap, { if (!submitter.busy) cap = it }, allowDecimal = true)
                error?.let { ErrorNote(it) }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryButton("保存并启用", onClick = { prepare {
                        require(goals.any { it.optString("id") == goal }) { "请选择本人目标" }
                        val body = JSONObject().put("enabled", true).put("roundupTo", planCents(roundup)).put("dailyCap", planCents(cap, true)).put("goalId", if (goal.isBlank()) JSONObject.NULL else goal).put("accountId", account?.id ?: error("资金账户不可用"))
                        PlanReview("确认凑整规则", "保存并启用，凑整到 $roundup 元，每日上限 $cap 元。当前只保存规则。", "PATCH", "/api/savings/roundup", body)
                    } }, Modifier.weight(1f))
                    SecondaryButton("保存并停用", onClick = { prepare {
                        val body = JSONObject().put("enabled", false).put("roundupTo", planCents(roundup)).put("dailyCap", planCents(cap, true)).put("goalId", if (goal.isBlank()) JSONObject.NULL else goal).put("accountId", account?.id ?: error("资金账户不可用"))
                        PlanReview("确认凑整规则", "保存并停用，当前只保存规则。", "PATCH", "/api/savings/roundup", body)
                    } }, Modifier.weight(1f))
                }
                Spacer(Modifier.height(12.dp))
            }
        }
    }

    if (createGoal) {
        PlanFormSheet("新建存钱目标", submitter.busy, onDismiss = { createGoal = false }) {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TextFieldRow("目标名称", name, { if (!submitter.busy) setName(it.take(40)) }, placeholder = "例如：旅行基金")
                SecureNumberField("目标金额（元）", amount, { if (!submitter.busy) setAmount(it) }, placeholder = "请输入目标金额", allowDecimal = true)
                TextFieldRow("目标日期（选填）", date, { if (!submitter.busy) setDate(it.take(10)) }, placeholder = "YYYY-MM-DD")
                error?.let { ErrorNote(it) }
                PrimaryButton("核对新建目标", onClick = {
                    prepare {
                        require(name.isNotBlank()) { "请填写目标名称" }; val cents = planCents(amount)
                        if (date.isNotBlank()) LocalDate.parse(date)
                        PlanReview("新建存钱目标", "$name · ${formatCents(cents)}\n目标日：${date.ifBlank { "无固定期限" }}", "POST", "/api/savings/goals", JSONObject().put("name", name.trim()).put("targetAmount", cents).put("deadline", if (date.isBlank()) JSONObject.NULL else date))
                    }
                })
                Spacer(Modifier.height(12.dp))
            }
        }
    }

    review?.let { snapshot -> AlertDialog(onDismissRequest = { if (!submitter.busy) { review = null; pin = "" } }, title = { Text(snapshot.title) }, text = {
        Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(snapshot.detail)
            if (snapshot.pinRequired) SecurePinField("支付密码", pin, { if (!submitter.busy) pin = it.filter(Char::isDigit).take(6) }, enabled = !submitter.busy)
            error?.let { ErrorNote(it) }
        }
    }, confirmButton = { TextButton(enabled = !submitter.busy, onClick = {
        if (snapshot.pinRequired && pin.length != 6) error = "请输入 6 位支付密码" else {
            // Copy only for the final authorization. Neither PIN nor body enters recovery storage.
            val payload = JSONObject(snapshot.body.toString()); if (snapshot.pinRequired) payload.put("paymentPassword", pin)
            submitter.submit(
                fallback = "结果未知，请核查后再办理",
                onStart = { error = null },
                onError = { error = it; if (FinancialRecovery.pending != null) review = null },
                onSuccess = {
                    review = null; createGoal = false; roundupOpen = false; createInvestment = false; editCash = false; createBirthday = false
                    if (snapshot.path == "/api/wealth/cash-management/sweep") cashDraftLoaded = false
                    if (snapshot.path == "/api/savings/roundup") roundupDraftLoaded = false
                    message = "服务端已确认，请核对最新记录。"; reload++
                },
                onFinally = { payload.remove("paymentPassword"); pin = "" },
            ) {
                BankApi.savingsRequest(snapshot.method, snapshot.path, payload)
            }
        }
    }) { Text(if (submitter.busy) "处理中…" else "确认") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { review = null; pin = "" }) { Text("返回修改") } }) }
}
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun PlanFormSheet(title: String, busy: Boolean, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy }),
        containerColor = Tokens.Page,
    ) {
        TopBar(title, onBack = { if (!busy) onDismiss() })
        Column(
            Modifier.fillMaxWidth().heightIn(max = 680.dp).imePadding().verticalScroll(rememberScrollState()).padding(16.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            content = content,
        )
    }
}
private fun birthdayStatus(status: String): String = when(status) { "scheduled" -> "待预留"; "reserved" -> "已预留"; "needs_funds" -> "可用余额不足"; "awaiting_order" -> "待确认订购"; "awaiting_merchant" -> "待商户接入"; "cancelled" -> "已取消"; "expired" -> "已到期"; "released" -> "已释放"; else -> status }
