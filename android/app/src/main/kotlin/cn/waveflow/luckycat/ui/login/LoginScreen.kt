package cn.waveflow.luckycat.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.contract.bank.BankUser
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 登录页。
 *
 * 与网页版同一套演示凭据：任意合法手机号 + 密码 `123456` + 「获取验证码」后
 * 页面上会显示出来的那个码。
 *
 * 锚点一律用 `testTag`（等价于网页版的 `data-*`）：门禁按锚点找控件，
 * 不按文案——文案会改，锚点不会。
 */
@Composable
fun LoginScreen(
    state: LoginUiState,
    onPhoneChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSmsCodeChange: (String) -> Unit,
    onRequestSms: () -> Unit,
    onSubmit: () -> Unit,
    onOpenAccount: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("招财猫银行", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.testTag("login-title"))
        Text(
            "演示环境：任意 11 位手机号，密码 123456。",
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkSoft,
        )

        OutlinedTextField(
            value = state.phone,
            onValueChange = onPhoneChange,
            label = { Text("手机号") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth().testTag("login-phone"),
        )

        OutlinedTextField(
            value = state.password,
            onValueChange = onPasswordChange,
            label = { Text("登录密码") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth().testTag("login-password"),
        )

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = state.smsCode,
                onValueChange = onSmsCodeChange,
                label = { Text("验证码") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                modifier = Modifier.weight(1f).testTag("login-sms"),
            )
            TextButton(
                onClick = onRequestSms,
                enabled = state.canRequestSms,
                modifier = Modifier.testTag("login-request-sms"),
            ) {
                Text(if (state.sending) "发送中…" else "获取验证码")
            }
        }

        // 演示环境才有的提示：真后端不回传验证码，那时 demoCode 为 null，这一行自然消失。
        state.demoCode?.let {
            Text(
                "演示环境验证码：$it",
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.accentDeep,
                modifier = Modifier.testTag("login-demo-code"),
            )
        }

        state.error?.let {
            Text(
                it,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.testTag("login-error"),
            )
        }

        Button(
            onClick = onSubmit,
            enabled = state.canSubmit,
            modifier = Modifier.fillMaxWidth().testTag("login-submit"),
        ) {
            Text(if (state.submitting) "登录中…" else "登入")
        }

        // **开户在登录之前**：还没有账户的人从这里进。
        // 放进「我的」是把开户当成登录后随时可做的操作，与网页版不一致
        // （网页版登录页底部就有这一行）。
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            Text("还没有账户？", style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
            TextButton(onClick = onOpenAccount, modifier = Modifier.testTag("login-open-account")) {
                Text("注册并开户", style = MaterialTheme.typography.bodySmall, color = Palette.accentDeep)
            }
        }
    }
}
