package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

/** 通讯录里的一位收款人。 */
private data class PayeeRow(val id: String, val name: String, val phone: String, val accountNo: String, val remark: String) {
    val identity: String get() = phone.ifBlank { accountNo }
}

/**
 * 收款人通讯录。
 *
 * 转账与 AA 收款共用这一份名单：转账成功、发起 AA 成功后都会自动记进来，
 * 这里负责集中查看、搜索、手动添加、改备注与删除。
 * 没有这一页时，名单只能在 AA 表单的姓名格下拉、或转账第二步的弹窗里看到。
 */
@Composable
fun ContactsScreen(onBack: () -> Unit) {
    var rows by remember { mutableStateOf<List<PayeeRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var keyword by remember { mutableStateOf("") }

    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var accountNo by remember { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }

    var editing by remember { mutableStateOf<PayeeRow?>(null) }
    var editingRemark by remember { mutableStateOf("") }
    var removing by remember { mutableStateOf<PayeeRow?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(refresh) {
        runCatching { BankApi.savedPayees("") }
            .onSuccess { array ->
                rows = (0 until array.length()).map { i ->
                    val row = array.getJSONObject(i)
                    PayeeRow(
                        id = row.optString("id"),
                        name = row.optString("name"),
                        phone = row.optString("phone"),
                        accountNo = row.optString("accountNo"),
                        remark = row.optString("remark"),
                    )
                }
                error = null
            }
            .onFailure { error = it.message ?: "收款人通讯录不可用" }
        loading = false
        refreshing = false
    }

    fun run(work: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null; message = null
        scope.launch {
            try { work(); refresh++ } catch (failure: Exception) { error = failure.message ?: "操作失败" } finally { busy = false }
        }
    }

    val shown = rows.filter { row ->
        val needle = keyword.trim()
        needle.isEmpty() || listOf(row.name, row.phone, row.accountNo, row.remark).any { it.contains(needle, ignoreCase = true) }
    }

    PushScreen(
        "收款人通讯录",
        onBack = { if (!busy && removing == null) onBack() },
        refreshing = refreshing,
        onRefresh = { if (!refreshing && !busy) { refreshing = true; BankApi.invalidateReads(); refresh++ } },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(
                "转账与 AA 收款共用这份名单。转账成功或发起 AA 收款后会自动记进来，也可以在这里手动添加。",
                fontSize = 12.sp, lineHeight = 18.sp, color = Tokens.Muted,
            )
            error?.let { ErrorNote(it) }
            message?.let { Text(it, fontSize = 12.sp, color = Tokens.Ink) }

            FormCard("添加收款人") {
                if (!adding) {
                    PrimaryButton("添加一位收款人", onClick = { adding = true; error = null; message = null }, enabled = !busy)
                } else {
                    TextFieldRow("姓名", name, { name = it.take(40) }, placeholder = "与账户户名一致")
                    // 手机号与账号走自绘安全键盘，与全项目数字输入的规范一致。
                    SecureNumberField("手机号（选填）", phone, { phone = it.filter(Char::isDigit).take(11) }, placeholder = "11 位手机号", maxLength = 11)
                    SecureNumberField("本行账号（选填）", accountNo, { accountNo = it.filter(Char::isDigit).take(19) }, placeholder = "12–19 位账号", maxLength = 19)
                    Text("姓名必填；手机号与账号填一个即可，都填时须属于同一位客户。", fontSize = 11.sp, lineHeight = 16.sp, color = Tokens.Muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        PrimaryButton("保存", onClick = {
                            run {
                                val created = BankApi.addPayee(SplitIdentity(name.trim(), phone, accountNo))
                                name = ""; phone = ""; accountNo = ""; adding = false
                                message = "已添加 ${created.optString("name")}"
                            }
                        }, enabled = !busy)
                        TextButton(enabled = !busy, onClick = { adding = false; name = ""; phone = ""; accountNo = "" }) { Text("取消") }
                    }
                }
            }

            FormCard("共 ${shown.size} 位") {
                TextFieldRow("搜索", keyword, { keyword = it.take(40) }, placeholder = "姓名、手机号、账号或备注")
                when {
                    loading -> SkeletonCardList(cards = 1, rows = 3)
                    shown.isEmpty() -> Text(
                        if (keyword.isBlank()) "通讯录还是空的，先用上面添加一位。" else "没有匹配的收款人。",
                        fontSize = 12.sp, color = Tokens.Muted,
                    )
                    else -> HairlineCard(Modifier.fillMaxWidth()) {
                        Column {
                            Row(
                                Modifier.fillMaxWidth().background(Tokens.SurfaceWarm).padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("姓名", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.weight(1f))
                                Text("手机号 / 账号", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.weight(1.2f))
                            }
                            HorizontalDivider(color = Tokens.Border)
                            shown.forEachIndexed { index, row ->
                                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(row.name, fontSize = 14.sp, color = Tokens.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                        Text(row.identity, fontSize = 13.sp, color = Tokens.Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1.2f))
                                    }
                                    if (row.remark.isNotBlank()) Text(row.remark, fontSize = 11.sp, color = Tokens.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                        Text(
                                            "改备注", fontSize = 11.sp, color = Tokens.Ink2,
                                            modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(enabled = !busy) { editing = row; editingRemark = row.remark }.padding(vertical = 2.dp),
                                        )
                                        Text(
                                            "删除", fontSize = 11.sp, color = Tokens.Coral,
                                            modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(enabled = !busy) { removing = row }.padding(vertical = 2.dp),
                                        )
                                    }
                                }
                                if (index != shown.lastIndex) HorizontalDivider(Modifier.padding(horizontal = 12.dp), color = Tokens.Border.copy(alpha = 0.7f))
                            }
                        }
                    }
                }
            }
        }
    }

    editing?.let { row ->
        AlertDialog(
            onDismissRequest = { if (!busy) editing = null },
            title = { Text("修改备注") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("${row.name} · ${row.identity}", fontSize = 12.sp, color = Tokens.Muted)
                    TextFieldRow("备注", editingRemark, { if (!busy) editingRemark = it.take(140) }, placeholder = "便于检索的说明，例如「房东」")
                }
            },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    run { BankApi.payeeRemark(row.id, editingRemark.trim()); editing = null; message = "已保存备注" }
                }) { Text("保存") }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = { editing = null }) { Text("取消") } },
        )
    }

    removing?.let { row ->
        AlertDialog(
            onDismissRequest = { if (!busy) removing = null },
            title = { Text("删除收款人") },
            text = { Text("从通讯录删除「${row.name}」？只删记录，不影响已有转账与流水；下次转账需重新提供完整账号。") },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    run { BankApi.deletePayee(row.id); removing = null; message = "已删除 ${row.name}" }
                }) { Text("删除") }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = { removing = null }) { Text("保留") } },
        )
    }
}
