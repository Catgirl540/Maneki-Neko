package cn.waveflow.luckycat.ui.openaccount

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.domain.account.AccountOpening
import cn.waveflow.luckycat.ui.theme.Palette

@Composable
fun OpenAccountScreen(
    state: OpenAccountUiState,
    onPhoneChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onConfirmPasswordChange: (String) -> Unit,
    onNameChange: (String) -> Unit,
    onIdNumberChange: (String) -> Unit,
    onSmsChange: (String) -> Unit,
    onPledgedChange: (Boolean) -> Unit,
    onConfirmedChange: (Boolean) -> Unit,
    onRequestSms: () -> Unit,
    onVerifyFace: () -> Unit,
    onSubmit: () -> Unit,
    onDismissError: () -> Unit,
) {
    val draft = state.draft
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text("注册并开通储蓄账户", style = MaterialTheme.typography.headlineMedium)
        Text("使用身份证、短信和人脸核身完成开户，无需已有银行卡或选择账户类别。", style = MaterialTheme.typography.bodyMedium, color = Palette.inkSoft)

        FormCard("01", "基本资料与登录密码") {
            OutlinedTextField(draft.holderName, onNameChange, label = { Text("姓名") }, singleLine = true, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().testTag("open-name"))
            OutlinedTextField(draft.idNumber, onIdNumberChange, label = { Text("身份证号") }, singleLine = true, shape = RoundedCornerShape(18.dp), isError = draft.idNumber.isNotEmpty() && !AccountOpening.isValidIdNumber(draft.idNumber), modifier = Modifier.fillMaxWidth().testTag("open-id"))
            OutlinedTextField(draft.password, onPasswordChange, label = { Text("登录密码（6-20 位）") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().testTag("open-password"))
            OutlinedTextField(draft.confirmPassword, onConfirmPasswordChange, label = { Text("确认登录密码") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), isError = draft.confirmPassword.isNotEmpty() && draft.confirmPassword != draft.password, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().testTag("open-password-confirm"))
        }

        FormCard("02", "手机号与身份核验") {
            OutlinedTextField(draft.phone, onPhoneChange, label = { Text("手机号") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().testTag("open-phone"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(draft.smsCode, onSmsChange, label = { Text("短信验证码") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), shape = RoundedCornerShape(18.dp), modifier = Modifier.weight(1f).testTag("open-sms"))
                TextButton(onClick = onRequestSms, enabled = state.canRequestSms, modifier = Modifier.testTag("open-request-sms")) { Text(if (state.sending) "发送中…" else "获取验证码") }
            }
            state.demoCode?.let { Text("演示环境验证码：$it", color = Palette.accentDeep, modifier = Modifier.testTag("open-demo-code")) }
            Text(if (draft.faceTicket.isNotEmpty()) "人脸核身已通过" else "开户前需要确认是本人操作", color = if (draft.faceTicket.isNotEmpty()) Palette.income else Palette.inkSoft, modifier = Modifier.testTag("open-face-status"))
            Button(onClick = onVerifyFace, enabled = !state.verifying && draft.faceTicket.isEmpty(), modifier = Modifier.fillMaxWidth().testTag("open-verify-face")) { Text(if (state.verifying) "核身中…" else if (draft.faceTicket.isNotEmpty()) "已完成核身" else "开始人脸核身") }
        }

        FormCard("03", "开户确认", tint = true) {
            ConfirmRow("账户产品", "储蓄账户")
            ConfirmRow("开户人", draft.holderName.ifBlank { "待填写" })
            ConfirmRow("手机号", AccountOpening.maskPhone(draft.phone))
            ConfirmRow("身份证", AccountOpening.maskId(draft.idNumber))
            CheckRow(draft.pledged, onPledgedChange, AccountOpening.PLEDGE_TEXT, "open-pledge")
            CheckRow(draft.confirmed, onConfirmedChange, "我已核对上述开户信息，确认提交", "open-confirm")
        }

        state.error?.let { Row(verticalAlignment = Alignment.CenterVertically) { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f).testTag("open-error")); TextButton(onClick = onDismissError, modifier = Modifier.testTag("open-error-dismiss")) { Text("知道了") } } }
        Button(onClick = onSubmit, enabled = state.canSubmit, modifier = Modifier.fillMaxWidth().testTag("open-submit")) { Text(if (state.submitting) "开通中…" else "确认注册并开户") }
        Text("开户成功后将自动登录。演示环境不会产生真实资金变动。", style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
    }
}

@Composable private fun FormCard(number: String, title: String, tint: Boolean = false, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(if (tint) Palette.accentTint else Palette.surface).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) { Text(number, color = Palette.accentDeep, fontWeight = FontWeight.Bold); Text(title, style = MaterialTheme.typography.titleMedium) }
        content()
    }
}

@Composable private fun ConfirmRow(label: String, value: String) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(label, color = Palette.inkSoft); Text(value, fontWeight = FontWeight.Medium) } }
@Composable private fun CheckRow(checked: Boolean, onChange: (Boolean) -> Unit, text: String, tag: String) { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) { Checkbox(checked, onChange, modifier = Modifier.testTag(tag)); Text(text, style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft, modifier = Modifier.weight(1f).padding(top = 12.dp)) } }
