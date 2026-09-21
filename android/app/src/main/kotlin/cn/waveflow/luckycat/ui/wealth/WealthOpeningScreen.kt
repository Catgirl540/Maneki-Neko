package cn.waveflow.luckycat.ui.wealth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.domain.account.AccountOpening
import cn.waveflow.luckycat.domain.account.WealthOpening
import cn.waveflow.luckycat.domain.labels.Labels
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 开立理财账户。
 *
 * **顺序是有约束的，不是随便排的**：风险测评是监管要求的前置，
 * 而且**满一年失效**。没有有效的测评，后端直接回 403，
 * 所以界面在测评做完之前就不再往下走——而不是让用户把姓名身份证都填完再被拒。
 */
@Composable
fun WealthOpeningScreen(
    state: WealthOpeningUiState,
    onChoose: (Int, Int) -> Unit,
    onSubmitAssessment: () -> Unit,
    onNameChange: (String) -> Unit,
    onIdChange: (String) -> Unit,
    onPhoneChange: (String) -> Unit,
    onSmsChange: (String) -> Unit,
    onSelectSettlement: (String) -> Unit,
    onPledgedChange: (Boolean) -> Unit,
    onRequestSms: () -> Unit,
    onVerifyFace: () -> Unit,
    onSubmit: () -> Unit,
    onDismissError: () -> Unit,
    onDone: () -> Unit,
) {
    if (state.loading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.testTag("wopen-loading"))
        }
        return
    }

    if (state.done) {
        Column(
            modifier = Modifier.fillMaxSize().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("理财账户已开立", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.testTag("wopen-done"))
            Text(
                "开立后可以浏览并申购理财产品。",
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.inkSoft,
            )
            Button(onClick = onDone, modifier = Modifier.fillMaxWidth().testTag("wopen-finish")) {
                Text("开始看理财")
            }
        }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("开立理财账户", style = MaterialTheme.typography.headlineSmall)
        Text(
            "银行账户是装钱的地方，理财账户才是买理财的资格。理财账户不装钱，" +
                "申购扣款与赎回到账都走你指定的资金账户。",
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkSoft,
        )

        // ── 1. 风险测评 ─────────────────────────────────────────────────
        SectionTitle("1. 风险承受能力评估")
        if (state.assessable) {
            Text(
                "已完成：${Labels.tolerance(state.risk!!.level)} · 有效期至 ${state.risk.expiresAt.take(10)}",
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.income,
                modifier = Modifier.testTag("wopen-risk-done"),
            )
        } else {
            state.questions.forEachIndexed { qIndex, question ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Palette.surface)
                        .padding(12.dp)
                        .testTag("wopen-q-$qIndex"),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(question.question, style = MaterialTheme.typography.bodyMedium)
                    question.options.forEachIndexed { oIndex, option ->
                        val selected = state.answers.getOrNull(qIndex) == oIndex
                        Text(
                            (if (selected) "✓ " else "· ") + option.label,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (selected) Palette.accentDeep else Palette.inkSoft,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onChoose(qIndex, oIndex) }
                                .padding(vertical = 4.dp)
                                .testTag("wopen-q-$qIndex-o$oIndex"),
                        )
                    }
                }
            }
            Button(
                onClick = onSubmitAssessment,
                enabled = state.answered && !state.assessing,
                modifier = Modifier.fillMaxWidth().testTag("wopen-submit-assessment"),
            ) {
                Text(if (state.assessing) "评估中…" else "提交评估")
            }
            if (!state.answered) {
                Text(
                    "监管要求先完成评估才能开立理财账户。",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkMute,
                    modifier = Modifier.testTag("wopen-risk-gate"),
                )
            }
        }

        // ── 2. 实名核验（测评过了才展开）─────────────────────────────────
        if (state.assessable) {
            SectionTitle("2. 实名身份核验")
            OutlinedTextField(
                value = state.holderName,
                onValueChange = onNameChange,
                label = { Text("姓名") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("wopen-name"),
            )
            OutlinedTextField(
                value = state.idNumber,
                onValueChange = onIdChange,
                label = { Text("身份证号") },
                singleLine = true,
                isError = state.idNumber.isNotEmpty() && !AccountOpening.isValidIdNumber(state.idNumber),
                modifier = Modifier.fillMaxWidth().testTag("wopen-id"),
            )
            OutlinedTextField(
                value = state.phone,
                onValueChange = onPhoneChange,
                label = { Text("手机号") },
                singleLine = true,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth().testTag("wopen-phone"),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.smsCode,
                    onValueChange = onSmsChange,
                    label = { Text("短信验证码") },
                    singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f).testTag("wopen-sms"),
                )
                TextButton(
                    onClick = onRequestSms,
                    enabled = state.canRequestSms,
                    modifier = Modifier.testTag("wopen-request-sms"),
                ) {
                    Text(if (state.sending) "发送中…" else "获取验证码")
                }
            }
            state.demoCode?.let {
                Text(
                    "演示环境验证码：$it",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Palette.accentDeep,
                    modifier = Modifier.testTag("wopen-demo-code"),
                )
            }
            Text(
                if (state.faceTicket.isNotEmpty()) "已完成人脸核身" else "还需要人脸核身（演示环境直接给一张票据）",
                style = MaterialTheme.typography.bodySmall,
                color = if (state.faceTicket.isNotEmpty()) Palette.income else Palette.inkSoft,
                modifier = Modifier.testTag("wopen-face-status"),
            )
            Button(
                onClick = onVerifyFace,
                enabled = !state.verifying && state.faceTicket.isEmpty(),
                modifier = Modifier.fillMaxWidth().testTag("wopen-verify-face"),
            ) {
                Text(if (state.verifying) "核身中…" else "开始人脸核身")
            }

            // ── 3. 签协议 + 指定资金账户 ────────────────────────────────
            SectionTitle("3. 签署协议并指定资金账户")
            Text(
                "申赎款项都走这个账户。",
                style = MaterialTheme.typography.bodySmall,
                color = Palette.inkMute,
            )
            state.accounts.forEach { account ->
                val selected = account.id == state.settlementAccountId
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (selected) Palette.accentSoft else Palette.surface)
                        .clickable { onSelectSettlement(account.id) }
                        .padding(14.dp)
                        .testTag("wopen-settle-${account.id}"),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(account.label, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            Money.money(account.balance),
                            style = MaterialTheme.typography.bodySmall,
                            color = Palette.inkMute,
                        )
                    }
                    if (selected) Text("✓", color = Palette.accentDeep)
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Checkbox(
                    checked = state.pledged,
                    onCheckedChange = onPledgedChange,
                    modifier = Modifier.testTag("wopen-agreement"),
                )
                Text(
                    // 逐字与后端比对的那一句
                    WealthOpening.AGREEMENT,
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkSoft,
                    modifier = Modifier.weight(1f).padding(top = 14.dp).testTag("wopen-agreement-text"),
                )
            }
        }

        state.error?.let {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f).testTag("wopen-error"),
                )
                TextButton(onClick = onDismissError, modifier = Modifier.testTag("wopen-error-dismiss")) {
                    Text("知道了")
                }
            }
        }

        if (state.assessable) {
            Button(
                onClick = onSubmit,
                enabled = state.canSubmit,
                modifier = Modifier.fillMaxWidth().testTag("wopen-submit"),
            ) {
                Text(if (state.submitting) "开立中…" else "开立理财账户")
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
}
