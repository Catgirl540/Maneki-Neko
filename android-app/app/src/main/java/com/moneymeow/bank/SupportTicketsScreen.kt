package com.moneymeow.bank

import androidx.compose.foundation.layout.*
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

@Composable
fun SupportTicketsScreen(onBack: () -> Unit) {
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var selected by remember { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var reason by remember { mutableStateOf("") }
    var reply by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(selected, refresh) {
        error = null
        runCatching { BankApi.supportRequest("GET", selected?.let { "/api/support/tickets/$it" } ?: "/api/support/tickets") }
            .onSuccess { if (selected == null) data = it else detail = it }
            .onFailure { error = it.message ?: "客服工单加载失败" }
        refreshing = false
    }
    PushScreen(
        "人工客服工单",
        onBack = { if (!busy) { if (selected == null) onBack() else { selected = null; detail = null } } },
        refreshing = refreshing,
        onRefresh = { if (!refreshing) { refreshing = true; BankApi.invalidateReads(); refresh++ } },
    ) {
        PageColumn {
            Text("提交工单后等待工作人员受理，不代表已接通人工。请勿填写支付密码、验证码或卡片安全码。", color = Tokens.Muted, fontSize = 11.sp)
            error?.let { ErrorNote(it) }
            if (selected == null) {
                TextFieldRow("需要协助的问题", reason, { if (!busy) reason = it.take(500) })
                PrimaryButton("核对并申请人工协助", onClick = { if (reason.isBlank()) error = "请先描述问题" else confirmation = JSONObject().put("requestId", UUID.randomUUID().toString()).put("reason", reason.trim()) })
                val items = data?.optJSONArray("items") ?: JSONArray()
                items.objects().forEach { row ->
                    HairlineCard { Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(row.optString("reason"))
                        Text("${row.optString("ticketId")} · ${row.optString("status")}", style = Tokens.Text.hint)
                        TextButton(enabled = !busy, onClick = { selected = row.getString("ticketId"); detail = null }) { Text("查看与留言") }
                    } }
                }
            } else {
                detail?.let { ticket ->
                    Text(ticket.optString("reason"))
                    val messages = ticket.optJSONArray("messages") ?: JSONArray()
                    messages.objects().forEach { message ->
                        Text("${if (message.optString("sender") == "staff") "人工客服" else if (message.optString("sender") == "customer") "我" else "系统"}：${message.optString("text")}", fontSize = 13.sp)
                    }
                    TextFieldRow("留言", reply, { if (!busy) reply = it.take(2000) })
                    PrimaryButton("核对留言", onClick = { if (reply.isBlank()) error = "请输入留言" else confirmation = JSONObject().put("requestId", UUID.randomUUID().toString()).put("text", reply.trim()) })
                }
            }
        }
    }
    confirmation?.let { snapshot -> AlertDialog(onDismissRequest = { if (!busy) confirmation = null }, title = { Text(if (snapshot.has("reason")) "确认提交人工工单" else "确认发送留言") }, text = { Column { Text(snapshot.optString("reason", snapshot.optString("text"))); error?.let { ErrorNote(it) } } }, confirmButton = {
        TextButton(enabled = !busy, onClick = {
            busy = true; error = null
            val path = if (snapshot.has("reason")) "/api/support/tickets" else "/api/support/tickets/$selected/messages"
            scope.launch {
                runCatching { BankApi.supportRequest("POST", path, snapshot) }
                    .onSuccess { if (snapshot.has("reason")) { selected = it.getString("ticketId"); reason = "" } else reply = ""; confirmation = null; refresh++ }
                    .onFailure { error = it.message ?: "发送失败，可重试原请求" }
                busy = false
            }
        }) { Text("确认提交") }
    }, dismissButton = { TextButton(enabled = !busy, onClick = { confirmation = null }) { Text("返回修改") } }) }
}
