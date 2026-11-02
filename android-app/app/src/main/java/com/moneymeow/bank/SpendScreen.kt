package com.moneymeow.bank

import androidx.compose.foundation.layout.*
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Sandbox merchant posting uses the same financial recovery gate as transfers. */
@Composable
fun SpendScreen(onBack: () -> Unit, onTransactions: () -> Unit) {
    var cards by remember { mutableStateOf<List<BankCard>>(emptyList()) }
    var cardId by rememberSaveable { mutableStateOf("") }
    var platformId by rememberSaveable { mutableStateOf("meituan") }
    var merchant by rememberSaveable { mutableStateOf("") }
    var amount by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var formOpen by rememberSaveable { mutableStateOf(false) }
    var subscription by remember(platformId) { mutableStateOf(false) }
    var review by remember { mutableStateOf<JSONObject?>(null) }
    var receipt by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val submitter = rememberSubmitter()
    var reload by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(reload) {
        loading = true; error = null
        try { cards = CardApi.cards().filter { it.status == "active" }; if (cards.none { it.id == cardId }) cardId = cards.firstOrNull()?.id.orEmpty() }
        catch (failure: Exception) { error = failure.message ?: "卡片加载失败" }
        refreshing = false; loading = false
    }
    val platform = spendPlatforms.first { it.id == platformId }
    BackHandler(enabled = formOpen || submitter.busy) { if (!submitter.busy) formOpen = false }
    PushScreen(
        if (formOpen) "新建模拟消费" else "模拟消费",
        onBack = { if (!submitter.busy) { if (formOpen) formOpen = false else onBack() } },
        refreshing = refreshing,
        onRefresh = if (formOpen) null else { { if (!refreshing && !submitter.busy) { refreshing = true; BankApi.invalidateReads(); reload++ } } },
        actionContent = { if (!formOpen) ActionIcon(Icons.Refresh, "刷新银行卡", enabled = !submitter.busy, busy = loading) { if (!loading) { BankApi.invalidateReads(); reload++ } } },
    ) {
        PageColumn {
            if (!formOpen) {
                EntryRow(Icons.Shop, "新建模拟消费", onClick = { if (!submitter.busy) formOpen = true })
                FormCard("演示沙箱") {
                    Text("从银行卡关联的资金账户扣款，银行卡和预算限制仍有效；不会向真实商户付款。", style = Tokens.Text.bodyMuted, lineHeight = 20.sp)
                    KvRow("可使用的银行卡", if (loading) "正在读取" else "${cards.size} 张")
                }
            }
            error?.let { ErrorNote(it) }
            if (formOpen) {
            FormCard("付款银行卡") {
                if (cards.isEmpty()) Text("没有可使用的银行卡，请先在银行卡页核对状态。", color = Tokens.Muted)
                cards.forEach { card -> Row(Modifier.fillMaxWidth().clickable(enabled = !submitter.busy) { cardId = card.id }.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = cardId == card.id, onClick = null)
                    Spacer(Modifier.width(10.dp))
                    Text("${card.productName} ··${card.last4}", color = Tokens.Ink, fontSize = 14.sp)
                } }
            }
            FormCard("消费信息") {
            Text("演示商户", color = Tokens.Ink2, fontSize = 12.sp)
            // A bounded dropdown keeps the form usable as the shared catalog grows.
            var expanded by remember { mutableStateOf(false) }
            Box {
                TextButton(enabled = !submitter.busy, onClick = { expanded = true }) { Text(platform.name) }
                androidx.compose.material3.DropdownMenu(expanded, { expanded = false }, Modifier.heightIn(max = 320.dp)) {
                    spendPlatforms.forEach { row -> androidx.compose.material3.DropdownMenuItem(text = { Text(row.name) }, onClick = { platformId = row.id; expanded = false }) }
                }
            }
            if (platform.custom) TextFieldRow("商户名称", merchant, { if (!submitter.busy) merchant = it.take(80) })
            SecureNumberField("消费金额（元）", amount, { if (!submitter.busy) amount = it }, placeholder = "请输入本次消费金额", allowDecimal = true)
            TextFieldRow("账单详情（选填）", note, { if (!submitter.busy) note = it.take(160) }, placeholder = "添加便于核对的备注")
            if (platform.subscriptionAmount > 0) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(subscription, { if (!submitter.busy) subscription = it })
                    Text("同意创建该商户月付合约", fontSize = 12.sp)
                }
                Text("月付金额以本次消费为准；当前只管理合约，未开放自动扣款。", style = Tokens.Text.hint)
            }
            }
            PrimaryButton(if (submitter.busy) "提交中…" else "核对模拟消费", onClick = {
                if (!submitter.busy) runCatching {
                    require(cards.any { it.id == cardId }) { "请选择使用中的银行卡" }
                    val cents = planCents(amount); require(cents <= 5000000L) { "单笔模拟消费不超过 50,000 元" }
                    require(!platform.custom || merchant.trim().length in 2..80) { "请填写 2–80 字的商户名称" }
                    JSONObject().put("cardId", cardId).put("platform", platform.id).put("amount", cents).put("note", note.trim()).put("subscription", subscription && platform.subscriptionAmount > 0).also { if (platform.custom) it.put("merchant", merchant.trim()) }
                }.onSuccess { error = null; review = it }.onFailure { error = it.message ?: "请检查输入" }
            })
            }
            receipt?.let { row ->
                FormCard("消费回执") {
                val transaction = row.getJSONObject("transaction")
                Text("已记账 ${formatCents(transaction.getLong("amount"), row.getString("currency"))}")
                Text("交易编号 ${transaction.getString("id")}\n分类：${BankApi.categoryLabel(row.optString("category"))}${if (row.optString("classificationState") == "pending") "（后台处理中）" else ""}\n剩余可用 ${formatCents(row.getLong("available"), row.getString("currency"))}", fontSize = 12.sp)
                if (row.optJSONObject("autoDebit") != null) Text("服务端已建立月付合约，可前往自动扣款页核对。", fontSize = 11.sp)
                GhostButton("查看交易记录", onClick = onTransactions)
                }
            }
        }
    }
    review?.let { snapshot -> AlertDialog(onDismissRequest = { if (!submitter.busy) review = null }, title = { Text("确认模拟扣款") }, text = { Text("商户：${snapshot.optString("merchant", spendPlatforms.first { it.id == snapshot.getString("platform") }.name)}\n金额：${formatCents(snapshot.getLong("amount"))}\n卡片：··${cards.firstOrNull { it.id == snapshot.getString("cardId") }?.last4.orEmpty()}\n${if (snapshot.optBoolean("subscription")) "同时创建月付自动扣款合约（当前不自动执行）。" else "仅本次模拟消费。"}") }, confirmButton = { TextButton(enabled = !submitter.busy, onClick = {
        submitter.submit(
            fallback = "请先核查扣款结果",
            onStart = { error = null },
            onError = { error = it; review = null },
            onSuccess = { review = null; formOpen = false; reload++ },
        ) {
            val body = JSONObject(snapshot.toString())
            val selected = body.getString("cardId")
            body.remove("cardId")
            receipt = CardApi.spend(selected, body)
        }
    }) { Text("确认扣款") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { review = null }) { Text("返回修改") } }) }
}
