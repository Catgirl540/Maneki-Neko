package cn.waveflow.luckycat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.domain.consent.ConsentPresentation
import cn.waveflow.luckycat.domain.consent.ConsentView
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 确认卡片：**展示交易信息 → 用户确认 → 输入支付密码 → 才执行**。
 *
 * ## 这张卡片上有几条硬规矩，改代码时别动
 *
 * 1. **展示信息必须逐条列出来**（`fields`）。只写一句"确认执行吗"不算展示——
 *    用户是按这些行核对收款人和金额的。
 * 2. **支付密码只发桥接**，绝不进对话、不进模型上下文。
 * 3. **过期就不能再点确认**（`view.expired`）。桥接那边过期也会拒，
 *    但让用户点一个注定失败的按钮是更糟的体验。
 * 4. **密码错（401）时卡片留着**、密码框清空让重输。桥接在密码错时
 *    **不结算**挑战，收起卡片等于把用户唯一的机会关掉。
 * 5. **没有任何"用语音确认"的入口**。语音只念提醒，确认必须手点 + 手输密码。
 */
@Composable
fun ConsentCardView(
    view: ConsentView,
    onSubmit: (approve: Boolean, password: String, onResult: (Boolean, String?) -> Unit) -> Unit,
) {
    var password by remember(view.challengeId) { mutableStateOf("") }
    var message by remember(view.challengeId) { mutableStateOf<String?>(null) }
    var submitting by remember(view.challengeId) { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.accentTint)
            .padding(16.dp)
            .testTag("consent-card"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            "需要你确认：${view.kind}",
            style = MaterialTheme.typography.titleMedium,
            color = Palette.accentDeep,
        )

        // ① 展示交易信息——这一步是硬要求，不能省
        Column(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Palette.surface).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            view.fields.forEach { field ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(
                        field.label,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Palette.inkSoft,
                    )
                    Text(
                        field.value,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (field.emphasis) FontWeight.SemiBold else FontWeight.Normal,
                        modifier = Modifier.padding(start = 12.dp).testTag("consent-field-${field.label}"),
                    )
                }
            }
            if (view.fields.isEmpty()) {
                // 后端没给展示字段时不能装作没事：让用户知道"没有可核对的信息"
                Text(
                    "（这次操作没有附带可核对的信息）",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkMute,
                    modifier = Modifier.testTag("consent-no-fields"),
                )
            }
        }

        view.consequence?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }

        // ② 有效期
        Text(
            view.countdown ?: "已超时，请让助手重新发起",
            style = MaterialTheme.typography.bodySmall,
            color = if (view.expired) MaterialTheme.colorScheme.error else Palette.inkMute,
            modifier = Modifier.testTag("consent-countdown"),
        )

        // ③ 需要验证方式时才出现密码框；只读查询不该被拦
        if (view.needsPassword) {
            OutlinedTextField(
                value = password,
                onValueChange = { password = it; message = null },
                label = { Text("支付密码") },
                singleLine = true,
                enabled = !view.expired && !submitting,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth().testTag("consent-password"),
            )
        }

        message?.let {
            Text(
                it,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("consent-message"),
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = {
                    submitting = true
                    onSubmit(false, "", { _, _ -> submitting = false })
                },
                enabled = !view.expired && !submitting,
                modifier = Modifier.testTag("consent-reject"),
            ) {
                Text("取消")
            }
            Button(
                onClick = {
                    submitting = true
                    val typed = password
                    onSubmit(true, typed) { passwordWrong, text ->
                        submitting = false
                        if (passwordWrong) {
                            // 密码错**不清掉挑战**，只清密码框让重输
                            password = ""
                            message = text
                        }
                    }
                },
                enabled = ConsentPresentation.canSubmit(view, password) && !submitting,
                modifier = Modifier.testTag("consent-approve"),
            ) {
                Text(if (view.needsPassword) "确认并验证" else "确认")
            }
        }
    }
}
