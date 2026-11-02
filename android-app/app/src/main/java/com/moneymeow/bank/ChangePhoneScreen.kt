package com.moneymeow.bank

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable
fun ChangePhoneScreen(onBack: () -> Unit) {
    var phone by remember { mutableStateOf("") }
    var sms by remember { mutableStateOf("") }
    var ticket by remember { mutableStateOf("") }
    var hint by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun perform(work: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        scope.launch { try { work() } catch (failure: Exception) { error = failure.message ?: "操作失败" } finally { busy = false } }
    }
    FormScaffold("修改手机号", onBack = { if (!busy) onBack() }, actionLabel = if (busy) "提交中…" else "确认修改", onAction = {
        if (!phone.matches(Regex("1[3-9][0-9]{9}")) || sms.length != 6 || ticket.isBlank()) error = "请先完成身份核验并填写新手机号和验证码"
        else perform { BankApi.changePhone(phone, sms, ticket); sms = ""; ticket = ""; onBack() }
    }) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("演示环境由银行核身接口签发人脸票据，不调用摄像头。", style = Tokens.Text.hint)
            GhostButton(if (ticket.isBlank()) "验证本人身份" else "身份已验证", onClick = { perform { ticket = BankApi.verifyIdentity("face") } })
            SecureNumberField("新手机号", phone, { if (!busy) { phone = it.filter(Char::isDigit).take(11); sms = ""; hint = null } }, placeholder = "11 位手机号", maxLength = 11)
            GhostButton("获取新手机号验证码", onClick = {
                if (ticket.isBlank() || !phone.matches(Regex("1[3-9][0-9]{9}"))) error = "请先验证本人身份并填写有效手机号"
                else perform { val code = BankApi.sendSmsCode(phone); hint = code?.let { "演示验证码：$it" } ?: "验证码已发送" }
            })
            SecureNumberField("短信验证码", sms, { if (!busy) sms = it.filter(Char::isDigit).take(6) }, placeholder = "6 位验证码", maxLength = 6)
            hint?.let { Text(it, fontSize = 11.sp, color = Tokens.Ink2) }
            error?.let { Text(it, style = Tokens.Text.error) }
        }
    }
}
