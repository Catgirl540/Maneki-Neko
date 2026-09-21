package cn.waveflow.luckycat.ui.cards

import androidx.compose.foundation.background
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import cn.waveflow.luckycat.contract.bank.BankCard
import cn.waveflow.luckycat.contract.bank.CardSecrets
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 银行卡。
 *
 * 锁卡与"网上支付/境外支付"两个开关是**即时生效**的（点了就打后端），
 * 不做"保存"按钮——银行 App 里这类开关用户期望点完就生效。
 *
 * 「查看卡密」是这一页唯一能看到完整卡号的地方，所以它**必须输支付密码**，
 * 而且查出来的卡密是弹窗里的临时内容：关掉就没了，不落盘。
 */
@Composable
fun CardsScreen(
    state: CardsUiState,
    onToggleLock: (String, Boolean) -> Unit,
    onToggleOnline: (String, Boolean) -> Unit,
    onToggleOverseas: (String, Boolean) -> Unit,
    onRevealSecrets: (String, String, (Boolean, String?) -> Unit) -> Unit,
    onDismissSecrets: () -> Unit,
    onDismissError: () -> Unit,
) {
    var secretsFor by remember { mutableStateOf<String?>(null) }

    if (state.loading && state.cards.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.testTag("cards-loading"))
        }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("银行卡", style = MaterialTheme.typography.headlineSmall)

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
                    modifier = Modifier.weight(1f).testTag("cards-error"),
                )
                TextButton(onClick = onDismissError, modifier = Modifier.testTag("cards-error-dismiss")) {
                    Text("知道了")
                }
            }
        }

        state.cards.forEach { card ->
            CardBlock(
                card = card,
                busy = state.busyId == card.id,
                onToggleLock = { onToggleLock(card.id, it) },
                onToggleOnline = { onToggleOnline(card.id, it) },
                onToggleOverseas = { onToggleOverseas(card.id, it) },
                onReveal = { secretsFor = card.id },
            )
        }
    }

    // 卡密弹窗：先输密码
    secretsFor?.let { cardId ->
        val revealed = state.revealed?.takeIf { it.cardId == cardId }
        if (revealed != null) {
            SecretsDialog(
                title = "卡密（演示数据）",
                secrets = revealed.secrets,
                onDismiss = {
                    secretsFor = null
                    // 关掉时顺手让 ViewModel 也丢掉——卡密只该在用户要看的那一刻存在
                    onDismissSecrets()
                },
            )
        } else {
            PasswordDialog(
                onDismiss = { secretsFor = null },
                onSubmit = { password, onResult -> onRevealSecrets(cardId, password, onResult) },
            )
        }
    }
}

@Composable
private fun CardBlock(
    card: BankCard,
    busy: Boolean,
    onToggleLock: (Boolean) -> Unit,
    onToggleOnline: (Boolean) -> Unit,
    onToggleOverseas: (Boolean) -> Unit,
    onReveal: () -> Unit,
) {
    val locked = card.status == "locked"
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.surface)
            .padding(16.dp)
            .testTag("card-${card.id}"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(card.productName.ifEmpty { "银行卡" }, style = MaterialTheme.typography.titleMedium)
                Text(
                    // **只显示后四位**：完整卡号走"查看卡密"，而且那里要支付密码
                    "${card.network.uppercase()} · 尾号 ${card.last4} · ${card.expiry}",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkMute,
                )
            }
            Text(
                statusLabel(card.status),
                style = MaterialTheme.typography.bodySmall,
                color = if (locked) MaterialTheme.colorScheme.error else Palette.accentDeep,
                modifier = Modifier.testTag("card-status-${card.id}"),
            )
        }

        Text(card.cardholder, style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft)
        Text("单日限额 ${Money.money(card.dailyLimit)}", style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft)

        ToggleRow("锁定此卡", "锁了之后所有交易都会被拒", locked, busy, "card-lock-${card.id}", onToggleLock)
        ToggleRow("网上支付", null, card.onlinePayment, busy, "card-online-${card.id}", onToggleOnline)
        ToggleRow("境外支付", null, card.overseasPayment, busy, "card-overseas-${card.id}", onToggleOverseas)

        TextButton(
            onClick = onReveal,
            enabled = !busy && !locked,
            modifier = Modifier.testTag("card-reveal-${card.id}"),
        ) {
            Text("查看卡密（需支付密码）")
        }
    }
}

@Composable
private fun ToggleRow(
    title: String,
    subtitle: String?,
    checked: Boolean,
    busy: Boolean,
    tag: String,
    onChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.inkMute) }
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            enabled = !busy,
            modifier = Modifier.testTag(tag),
        )
    }
}

/**
 * 支付密码输入。
 *
 * **密码错时不关弹窗**——只清空并提示重输。关掉的话用户得重新点一次"查看卡密"，
 * 而且会以为功能坏了。（与确认卡片同一条规矩。）
 */
@Composable
private fun PasswordDialog(
    onDismiss: () -> Unit,
    onSubmit: (String, (Boolean, String?) -> Unit) -> Unit,
) {
    var password by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("输入支付密码") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "查看卡密属于敏感操作，需要验证身份。密码只发给银行，不会进入对话。",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkSoft,
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it; message = null },
                    label = { Text("支付密码") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.fillMaxWidth().testTag("card-password"),
                )
                message?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.testTag("card-password-message"),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    busy = true
                    onSubmit(password) { wrong, text ->
                        busy = false
                        if (wrong) {
                            password = ""
                            message = text ?: "支付密码不正确"
                        }
                    }
                },
                enabled = password.isNotEmpty() && !busy,
                modifier = Modifier.testTag("card-password-submit"),
            ) {
                Text("确认")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("card-password-cancel")) { Text("取消") }
        },
    )
}

@Composable
private fun SecretsDialog(title: String, secrets: CardSecrets, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SecretRow("卡号", secrets.cardNo)
                SecretRow("有效期", secrets.expiry)
                SecretRow("安全码", secrets.cvv)
                if (secrets.demo) {
                    Text(
                        "演示环境返回的是占位值，不是真实卡信息。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("card-secrets-close")) { Text("关闭") }
        },
    )
}

@Composable
private fun SecretRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = Palette.inkSoft)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}

internal fun statusLabel(status: String): String = when (status) {
    "locked" -> "已锁定"
    "pending" -> "待激活"
    "replaced" -> "已换卡"
    else -> "正常"
}
