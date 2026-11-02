package com.moneymeow.bank

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.activity.compose.BackHandler
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray
import java.math.BigDecimal
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

private fun planAmount(value: String): Long = runCatching {
    require(value.matches(Regex("[0-9]+(\\.[0-9]{1,2})?")))
    BigDecimal(value).movePointRight(2).longValueExact().also { require(it > 0) }
}.getOrElse { throw IllegalArgumentException("请输入有效金额，最多两位小数") }

private data class ExpenseDraft(val title: String = "", val amount: String = "", val names: String = "")
private fun splitNames(value: String) = value.split(',', '，', '\n').map { it.trim() }
internal fun scheduledIso(value: String): String = LocalDateTime.parse(value, DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm").withResolverStyle(java.time.format.ResolverStyle.STRICT)).atZone(ZoneId.of("Asia/Shanghai")).toInstant().toString()
private fun planStatus(status: String) = mapOf("scheduled" to "待执行", "executed" to "已执行", "failed" to "执行失败", "cancelled" to "已取消", "open" to "待收款", "complete" to "已收齐", "unpaid" to "待付款", "processing" to "付款处理中", "paid" to "已付款")[status] ?: "状态待核查"

@Composable
fun PaymentPlansScreen(onBack: () -> Unit, initialTab: Int = 0) {
    var tab by rememberSaveable { mutableIntStateOf(initialTab) }
    var formOpen by rememberSaveable { mutableStateOf(false) }
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var banks by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    val submitter = rememberSubmitter()
    var loading by remember { mutableStateOf(true) }
    var name by rememberSaveable { mutableStateOf("") }
    var number by rememberSaveable { mutableStateOf("") }
    var bank by rememberSaveable { mutableStateOf("") }
    var amount by rememberSaveable { mutableStateOf("") }
    var date by rememberSaveable { mutableStateOf("") }
    var memo by rememberSaveable { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var scheduleKey by remember { mutableStateOf("") }
    var reviewSchedule by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<JSONObject?>(null) }
    var aaMode by rememberSaveable { mutableIntStateOf(0) }
    var aaTitle by rememberSaveable { mutableStateOf("") }
    var aaAmount by rememberSaveable { mutableStateOf("") }
    var aaNames by rememberSaveable { mutableStateOf("") }
    var collector by rememberSaveable { mutableStateOf("") }
    val expenses = remember { mutableStateListOf(ExpenseDraft()) }
    val phones = remember { mutableStateMapOf<String, String>() }
    val memos = remember { mutableStateMapOf<String, String>() }
    var matching by remember { mutableStateOf<Pair<JSONObject, JSONObject>?>(null) }
    var transactionNo by remember { mutableStateOf("") }
    var aaReview by remember { mutableStateOf<JSONObject?>(null) }
    val aaAllocation = runCatching {
        if (aaMode == 0) allocateSplit(planAmount(aaAmount), splitNames(aaNames))
        else allocateExpenses(collector, expenses.map { SplitExpenseInput(it.title, planAmount(it.amount), splitNames(it.names)) })
    }.getOrNull()
    fun loadRows(array: org.json.JSONArray): List<JSONObject> = (0 until array.length()).map { array.getJSONObject(it) }
    LaunchedEffect(tab, reload) {
        loading = true
        error = null
        runCatching {
            val path = when (tab) { 0 -> "/api/transfers/scheduled"; 1 -> "/api/transfers/splits"; else -> "/api/transfers/aa-payments" }
            val result = loadRows(BankApi.paymentPlanList(path))
            if (tab == 0) {
                account = BankApi.accounts().singleOrNull()
                banks = loadRows(BankApi.paymentPlanList("/api/banks")).filter { it.optString("region") == "CN" }
                if (bank.isBlank()) bank = banks.firstOrNull { it.optString("code") == "LCB" }?.optString("code") ?: banks.firstOrNull()?.optString("code").orEmpty()
            }
            result
        }.onSuccess { rows = it }.onFailure { rows = emptyList(); error = it.message ?: "加载失败" }
        loading = false
        refreshing = false
    }
    fun runWrite(work: suspend () -> Unit) {
        submitter.submit(
            fallback = "操作失败，请核查结果",
            onStart = { error = null; message = null },
            onError = {
                error = it
                if (FinancialRecovery.pending != null) { reviewSchedule = false; aaReview = null; selected = null; matching = null }
            },
            onSuccess = { reload++ },
            onFinally = { pin = "" },
        ) { work() }
    }
    BackHandler(enabled = formOpen || submitter.busy) { if (!submitter.busy) formOpen = false }
    PushScreen(
        title = if (formOpen) { if (tab == 0) "新建定时转账" else "发起 AA 收款" } else "定时转账与 AA",
        onBack = { if (!submitter.busy) { if (formOpen) { formOpen = false; error = null } else onBack() } },
        refreshing = refreshing,
        onRefresh = if (formOpen) null else { { if (!refreshing && !submitter.busy) { refreshing = true; BankApi.invalidateReads(); reload++ } } },
        actionContent = { if (!formOpen) ActionIcon(Icons.Refresh, "刷新指令", enabled = !submitter.busy, busy = loading) { if (!loading) { BankApi.invalidateReads(); reload++ } } },
    ) {
        PageColumn {
            if (!formOpen) {
                SegTabs(listOf("定时转账", "AA 收款", "AA 付款"), tab) { if (!submitter.busy) { tab = it; rows = emptyList() } }
                if (tab < 2) {
                    EntryRow(
                        icon = if (tab == 0) Icons.Clock else Icons.Person,
                        title = if (tab == 0) "新建定时转账" else "发起 AA 收款",
                        onClick = { if (!submitter.busy) { formOpen = true; error = null } },
                    )
                }
            }
            if (tab == 0 && formOpen) {
                FormCard("收款与执行信息", subtitle = "按北京时间执行；保存后不冻结资金，到期余额不足会失败。") {
                TextFieldRow("收款人姓名", name, { name = it.take(80) })
                SecureNumberField("收款账号", number, { number = it.filter(Char::isDigit).take(19) }, placeholder = "完整收款账号", maxLength = 19)
                if (banks.isNotEmpty()) {
                    BankSelector(banks, "CN", bank, enabled = !submitter.busy) { bank = it }
                }
                SecureNumberField("金额（元）", amount, { amount = it }, allowDecimal = true)
                TextFieldRow("执行时间（北京时间）", date, { date = it.take(16) }, placeholder = "YYYY-MM-DD HH:MM")
                TextFieldRow("转账备注", memo, { memo = it.take(140) })
                }
                PrimaryButton(if (submitter.busy) "处理中…" else "核对定时转账", onClick = {
                    runCatching {
                        require(name.isNotBlank() && number.matches(Regex("[0-9]{12,19}")) && bank.isNotBlank()) { "请填写完整收款信息" }
                        require(account != null) { "未找到资金账户" }
                        planAmount(amount)
                        val whenAt = java.time.Instant.parse(scheduledIso(date))
                        require(whenAt.isAfter(java.time.Instant.now())) { "执行时间必须晚于现在" }
                    }.onSuccess { scheduleKey = UUID.randomUUID().toString(); reviewSchedule = true }.onFailure { error = it.message ?: "请检查时间格式" }
                })
            }
            if (tab == 1 && formOpen) {
                FormCard("收款信息") {
                SegTabs(listOf("均分待收金额", "分项 AA"), aaMode) { if (!submitter.busy) aaMode = it }
                TextFieldRow("收款事由", aaTitle, { aaTitle = it.take(80) })
                if (aaMode == 0) {
                    SecureNumberField("待收总额（元）", aaAmount, { aaAmount = it }, allowDecimal = true)
                    TextFieldRow("参与者姓名（逗号分隔）", aaNames, { aaNames = it.take(500) })
                } else {
                    TextFieldRow("本人完整姓名", collector, { collector = it.take(40) })
                    expenses.forEachIndexed { index, expense ->
                        Text("消费 ${index + 1}", fontWeight = FontWeight.Medium)
                        TextFieldRow("消费事由", expense.title, { expenses[index] = expense.copy(title = it.take(80)) })
                        SecureNumberField("消费全额（元）", expense.amount, { expenses[index] = expense.copy(amount = it) }, allowDecimal = true)
                        TextFieldRow("本项参加者（逗号分隔）", expense.names, { expenses[index] = expense.copy(names = it.take(500)) })
                        if (expenses.size > 1) TextButton(onClick = { expenses.removeAt(index) }) { Text("删除本项") }
                    }
                    if (expenses.size < 30) TextButton(onClick = { expenses.add(ExpenseDraft()) }) { Text("添加消费") }
                }
                aaAllocation?.let { allocation ->
                    Text("待收总额 ${formatCents(allocation.amount, "CNY")}" + if (aaMode == 1) " · 本人份额 ${formatCents(allocation.selfAmount, "CNY")}" else "", fontSize = 12.sp)
                    allocation.participants.forEach { (participant, share) ->
                        Text("$participant 应付 ${formatCents(share, "CNY")}", fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        SecureNumberField("注册手机号", phones[participant].orEmpty(), { phones[participant] = it.filter(Char::isDigit).take(11) }, placeholder = "11 位手机号", maxLength = 11)
                        TextFieldRow("付款备注", memos[participant] ?: aaTitle, { memos[participant] = it.take(140) })
                    }
                }
                }
                PrimaryButton("核对 AA 收款", onClick = {
                    runCatching {
                        val allocation = requireNotNull(aaAllocation) { "请检查金额和参与人" }
                        require(aaTitle.isNotBlank()) { "请填写收款事由" }
                        val members = JSONArray()
                        val used = mutableSetOf<String>()
                        allocation.participants.forEach { (participant, share) ->
                            val phone = phones[participant].orEmpty()
                            val note = (memos[participant] ?: aaTitle).trim()
                            require(phone.matches(Regex("1[3-9][0-9]{9}")) && used.add(phone)) { "请为每位参与者填写不同的有效手机号" }
                            require(note.isNotEmpty() && note.length <= 140) { "请填写有效的付款备注" }
                            members.put(JSONObject().put("phone", phone).put("amount", share).put("memo", note))
                        }
                        val input = if (aaMode == 0) JSONObject().put("amount", planAmount(aaAmount)).put("participants", JSONArray(splitNames(aaNames)))
                        else JSONObject().put("collectorName", collector.trim()).put("expenses", JSONArray().apply { expenses.forEach { put(JSONObject().put("title", it.title.trim()).put("amount", planAmount(it.amount)).put("participants", JSONArray(splitNames(it.names)))) } })
                        JSONObject().put("title", aaTitle.trim()).put("currency", "CNY").put("allocation", input).put("members", members).put("confirmed", true).put("clientRequestId", UUID.randomUUID().toString())
                    }.onSuccess { aaReview = it }.onFailure { error = it.message ?: "请检查收款信息" }
                })
            }
            error?.let { ErrorNote(it) }
            message?.let { Text(it, color = Tokens.Ink, fontSize = 12.sp) }
            if (!formOpen) {
            Text(if (tab == 0) "定时指令" else if (tab == 1) "收款记录" else "待付款与历史", fontWeight = FontWeight.SemiBold)
            if (loading) SkeletonCardList()
            else if (rows.isEmpty() && error == null) BankEmptyState(if (tab == 0) "还没有定时指令" else if (tab == 1) "还没有收款记录" else "暂无待付款", if (tab == 0) "保存的指令会在这里显示状态。" else "收付款状态以服务端确认为准。", if (tab == 0) Icons.Clock else Icons.Receipt)
            rows.forEach { row ->
                HairlineCard {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(row.optString("title").ifBlank { row.optString("payeeName") }, fontWeight = FontWeight.Medium)
                        Text("${formatCents(row.optLong("amount"), row.optString("currency", "CNY"))} · ${planStatus(row.optString("status"))}", fontSize = 12.sp)
                        if (tab == 0) Text("执行时间：${parseBankTime(row.optString("executeAt"))?.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")) ?: "待核查"}（北京时间） · ${row.optString("payeeBankCode")}", style = Tokens.Text.hint)
                        if (tab == 2) Text("收款人：${row.optString("collectorName")} · 备注：${row.optString("memo")}", fontSize = 11.sp)
                        if (tab == 1) {
                            val participants = row.optJSONArray("participants") ?: JSONArray()
                            participants.objects().forEach { participant ->
                                Text("${participant.optString("splitName").ifBlank { participant.optString("name") }} · ${formatCents(participant.optLong("amount"), row.optString("currency", "CNY"))} · ${planStatus(participant.optString("status"))}", fontSize = 11.sp)
                                if (row.optString("delivery") != "account-inbox" && row.optString("status") == "open" && participant.optString("status") == "unpaid") TextButton(enabled = !submitter.busy, onClick = { matching = row to participant; transactionNo = ""; error = null }) { Text("核对已有回款") }
                                if (row.optString("status") == "open" && participant.optString("status") == "unpaid") TextButton(enabled = !submitter.busy, onClick = {
                                    runWrite {
                                        val body = JSONObject().put("version", row.getInt("version")).put("participantId", participant.getString("id"))
                                        val response = BankApi.paymentPlanWrite("POST", "/api/transfers/splits/${row.getString("id")}/reminders", body)
                                        message = response.optString("text") + "\n" + response.optString("notice").ifBlank { "仅生成提醒文字，未向他人发送。" }
                                    }
                                }) { Text("提醒") }
                            }
                            if (row.optString("status") == "open") TextButton(enabled = !submitter.busy, onClick = { selected = row }) { Text("取消 AA 收款") }
                        }
                        if (tab == 0 && row.optString("status") == "scheduled") TextButton(enabled = !submitter.busy, onClick = { selected = row }) { Text("取消指令") }
                        if (tab == 2 && row.optString("status") == "unpaid") TextButton(enabled = !submitter.busy, onClick = { selected = row }) { Text("查看并付款") }
                    }
                }
            }
            }
        }
    }
    matching?.let { (collection, participant) -> AlertDialog(onDismissRequest = { if (!submitter.busy) matching = null }, title = { Text("核对已有成功回款") }, text = {
        Column { Text("${participant.optString("name")} · ${formatCents(participant.getLong("amount"), collection.getString("currency"))}\n仅认领本人同币种、同金额的成功转入流水，不产生新扣款。"); TextFieldRow("成功转入流水编号", transactionNo, { if (!submitter.busy) transactionNo = it.take(100) }); error?.let { ErrorNote(it) } }
    }, confirmButton = { TextButton(enabled = !submitter.busy, onClick = {
        if (!transactionNo.matches(Regex("[A-Za-z0-9_-]+"))) error = "请填写有效流水编号" else runWrite {
            BankApi.paymentPlanWrite("POST", "/api/transfers/splits/${collection.getString("id")}/payments", JSONObject().put("version", collection.getInt("version")).put("participantId", participant.getString("id")).put("transactionId", transactionNo))
            matching = null; message = "服务端已核对原回款，请查看最新状态。"
        }
    }) { Text("确认核对") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { matching = null }) { Text("取消") } }) }
    aaReview?.let { review -> AlertDialog(onDismissRequest = { if (!submitter.busy) aaReview = null }, title = { Text("确认 AA 收款通知") }, text = {
        val members = review.getJSONArray("members")
        Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
            Text(review.getString("title"))
            error?.let { ErrorNote(it) }
            for (index in 0 until members.length()) {
                val member = members.getJSONObject(index)
                Text("${aaAllocation?.participants?.getOrNull(index)?.first.orEmpty()} · ${member.getString("phone")} · ${formatCents(member.getLong("amount"), "CNY")}\n备注：${member.getString("memo")}", fontSize = 12.sp)
            }
        }
    }, confirmButton = { TextButton(enabled = !submitter.busy, onClick = { runWrite {
        BankApi.paymentPlanWrite("POST", "/api/transfers/splits", review)
        aaReview = null; formOpen = false; aaTitle = ""; aaAmount = ""; aaNames = ""; collector = ""; expenses.clear(); expenses.add(ExpenseDraft()); phones.clear(); memos.clear()
        message = "AA 收款已发起，请核对成员付款状态。"
    } }) { Text("确认发送") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { aaReview = null }) { Text("返回修改") } }) }
    if (reviewSchedule) AlertDialog(onDismissRequest = { if (!submitter.busy) { reviewSchedule = false; pin = "" } }, title = { Text("确认定时转账") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("$name · $number\n银行：$bank\n金额：$amount 元\n执行：$date（北京时间）\n备注：$memo")
            SecurePinField("支付密码", pin, { if (!submitter.busy) pin = it.filter(Char::isDigit).take(6) }, enabled = !submitter.busy)
            error?.let { ErrorNote(it) }
        }
    }, confirmButton = { TextButton(enabled = !submitter.busy && pin.length == 6, onClick = {
        val snapshotPin = pin
        runWrite {
            val instant = scheduledIso(date)
            val body = JSONObject().put("fromAccountId", account!!.id).put("channel", "bank").put("scope", "domestic").put("payeeName", name.trim()).put("payeeAccountNo", number).put("payeeBankCode", bank).put("payeeBankRegion", "CN").put("amount", planAmount(amount)).put("memo", memo).put("executeAt", instant).put("confirmed", true).put("paymentPassword", snapshotPin).put("clientRequestId", scheduleKey)
            BankApi.paymentPlanWrite("POST", "/api/transfers/scheduled", body)
            reviewSchedule = false; formOpen = false; message = "定时转账已保存，请核对指令状态。"
        }
    }) { Text("确认保存") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { reviewSchedule = false; pin = "" }) { Text("返回") } })
    selected?.let { row -> AlertDialog(onDismissRequest = { if (!submitter.busy) { selected = null; pin = "" } }, title = { Text(when (tab) { 0 -> "取消定时转账"; 1 -> "取消 AA 收款"; else -> "确认 AA 付款" }) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(when (tab) { 0 -> "确认取消 ${row.optString("payeeName")} 的定时转账？"; 1 -> "确认取消 ${row.optString("title")} 的 AA 收款？"; else -> "收款人：${row.optString("collectorName")}\n账号：${row.optString("collectorAccountNo")}\n金额：${formatCents(row.optLong("amount"), row.optString("currency", "CNY"))}\n备注：${row.optString("memo")}" })
            if (tab == 2) SecurePinField("支付密码", pin, { if (!submitter.busy) pin = it.filter(Char::isDigit).take(6) }, enabled = !submitter.busy)
            error?.let { ErrorNote(it) }
        }
    }, confirmButton = { TextButton(enabled = !submitter.busy && (tab != 2 || pin.length == 6), onClick = {
        val snapshotPin = pin
        runWrite {
            val id = row.getString("id")
            val body = JSONObject().put("version", row.getInt("version"))
            when (tab) {
                0 -> BankApi.paymentPlanWrite("DELETE", "/api/transfers/scheduled/$id", body)
                1 -> BankApi.paymentPlanWrite("DELETE", "/api/transfers/splits/$id", body)
                else -> BankApi.paymentPlanWrite("POST", "/api/transfers/aa-payments/$id/pay", body.put("confirmed", true).put("paymentPassword", snapshotPin))
            }
            selected = null; message = "请求已处理，请核对最新状态。"
        }
    }) { Text(if (tab != 2) "确认取消" else "确认付款") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { selected = null; pin = "" }) { Text("返回") } }) }
}
