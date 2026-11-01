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
fun ImRemindersScreen(onBack: () -> Unit) {
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var title by remember { mutableStateOf("") }
    var time by remember { mutableStateOf("") }
    var binding by remember { mutableStateOf("") }
    var review by remember { mutableStateOf<JSONObject?>(null) }
    var cancellation by remember { mutableStateOf<Pair<String, String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(refresh) {
        runCatching { AgentApi.imRequest("GET", "/im/reminders") as JSONObject }
            .onSuccess { data = it; error = null; val bindings = it.optJSONArray("bindings") ?: JSONArray(); if ((0 until bindings.length()).none { i -> bindings.getJSONObject(i).optString("id") == binding }) binding = bindings.optJSONObject(0)?.optString("id").orEmpty() }
            .onFailure { data = null; error = it.message ?: "提醒服务不可用" }
        refreshing = false
    }
    fun operate(work: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        scope.launch { try { work(); refresh++ } catch (failure: Exception) { error = failure.message ?: "操作失败，可使用原请求重试" } finally { busy = false } }
    }
    PushScreen(
        "微信日程提醒",
        onBack = { if (!busy) onBack() },
        refreshing = refreshing,
        onRefresh = { if (!refreshing) { refreshing = true; BankApi.invalidateReads(); refresh++ } },
    ) {
        PageColumn {
            Text("提醒只发送本人确认的内容，不授权资金操作。时间为北京时间。", style = Tokens.Text.hint)
            error?.let { ErrorNote(it) }
            val bindings = data?.optJSONArray("bindings") ?: JSONArray()
            if (data != null && bindings.length() == 0) Text("请先连接本人微信私聊。", color = Tokens.Muted)
            bindings.objects().forEach { row ->
                TextButton(enabled = !busy, onClick = { binding = row.getString("id") }) { Text((if (binding == row.getString("id")) "✓ " else "") + row.optString("label")) }
            }
            TextFieldRow("提醒内容", title, { if (!busy) title = it.take(500) })
            TextFieldRow("提醒时间", time, { if (!busy) time = it.take(16) }, placeholder = "YYYY-MM-DD HH:MM")
            PrimaryButton("核对提醒", onClick = {
                runCatching { require(title.isNotBlank() && binding.isNotBlank()) { "请填写内容并选择本人微信" }; val due = scheduledIso(time); require(java.time.Instant.parse(due).isAfter(java.time.Instant.now())) { "提醒时间必须晚于现在" }; JSONObject().put("title", title.trim()).put("dueAt", due).put("bindingId", binding).put("requestId", UUID.randomUUID().toString()).put("confirmed", true) }
                    .onSuccess { review = it }.onFailure { error = it.message ?: "请检查时间格式" }
            })
            val rows = data?.optJSONArray("reminders") ?: JSONArray()
            if (data?.optBoolean("historyMayBeTruncated") == true || data?.optBoolean("truncated") == true) Text("仅显示最近的提醒记录", style = Tokens.Text.hint)
            rows.objects().forEach { row ->
                HairlineCard { Column(Modifier.fillMaxWidth().padding(14.dp)) {
                    Text(row.optString("title"))
                    Text("${bankTime(row.optString("dueAt"))} · ${when (row.optString("status")) { "scheduled" -> "待发送"; "sent" -> "已发送"; "cancelled" -> "已取消"; "failed" -> "发送失败"; "unknown" -> "结果未知"; else -> row.optString("status") }}", style = Tokens.Text.hint)
                    row.optString("errorCode").takeIf { it.isNotBlank() }?.let { Text(it, color = Tokens.Coral, fontSize = 11.sp) }
                    if (row.optString("status") == "scheduled") TextButton(enabled = !busy, onClick = { cancellation = row.getString("id") to UUID.randomUUID().toString() }) { Text("取消提醒") }
                } }
            }
        }
    }
    review?.let { snapshot -> AlertDialog(onDismissRequest = { if (!busy) review = null }, title = { Text("确认创建提醒") }, text = { Column { error?.let { ErrorNote(it) }; Text("${snapshot.getString("title")}\n时间：$time（北京时间）\n接收私聊：${(data?.optJSONArray("bindings") ?: JSONArray()).let { rows -> (0 until rows.length()).map { rows.getJSONObject(it) }.firstOrNull { it.optString("id") == snapshot.optString("bindingId") }?.optString("label") ?: "本人微信"}}") } }, confirmButton = { TextButton(enabled = !busy, onClick = { operate { AgentApi.imRequest("POST", "/im/reminders", snapshot); review = null; title = ""; time = "" } }) { Text("确认创建") } }, dismissButton = { TextButton(enabled = !busy, onClick = { review = null }) { Text("返回修改") } }) }
    cancellation?.let { (id, requestId) -> AlertDialog(onDismissRequest = { if (!busy) cancellation = null }, title = { Text("取消提醒") }, text = { Text("确认取消这条尚未发送的提醒？") }, confirmButton = { TextButton(enabled = !busy, onClick = { operate { AgentApi.imRequest("DELETE", "/im/reminders/$id", JSONObject().put("confirmed", true).put("requestId", requestId)); cancellation = null } }) { Text("确认取消") } }, dismissButton = { TextButton(enabled = !busy, onClick = { cancellation = null }) { Text("保留") } }) }
}
