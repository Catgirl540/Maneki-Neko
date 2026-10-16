package cn.waveflow.luckycat.ui.cards

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.SecureFlagPolicy
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import cn.waveflow.luckycat.R
import cn.waveflow.luckycat.contract.bank.*
import cn.waveflow.luckycat.domain.cards.CardRules
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.ui.theme.NavGlyph
import cn.waveflow.luckycat.ui.theme.NavIcon
import cn.waveflow.luckycat.ui.theme.Palette

@Composable
fun CardsScreen(
    state: CardsUiState,
    onToggleLock: (String, Boolean) -> Unit,
    onToggleOnline: (String, Boolean) -> Unit,
    onToggleOverseas: (String, Boolean) -> Unit,
    onRevealSecrets: (String, String, (Boolean, String?) -> Unit) -> Unit,
    onDismissSecrets: () -> Unit,
    onDismissError: () -> Unit,
    onRetry: () -> Unit = {},
    onLoadProducts: () -> Unit = {},
    onApply: (String?, String, MailingAddress, String, (Boolean, String?) -> Unit) -> Unit = { _, _, _, _, _ -> },
    onSetLimit: (String, Long) -> Unit = { _, _ -> },
) {
    var secretsFor by remember { mutableStateOf<String?>(null) }
    var revealedOnce by remember { mutableStateOf(false) }
    var application by remember { mutableStateOf(false) }
    var replaceId by remember { mutableStateOf<String?>(null) }
    var limitFor by remember { mutableStateOf<String?>(null) }
    val dismissSecrets by rememberUpdatedState(onDismissSecrets)
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) {
                secretsFor = null; application = false; limitFor = null; dismissSecrets()
            }
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer); dismissSecrets() }
    }
    LaunchedEffect(state.revealed) {
        if (state.revealed != null) revealedOnce = true
        else if (revealedOnce) { secretsFor = null; revealedOnce = false }
    }
    fun openApplication(id: String?) { replaceId = id; application = true; onLoadProducts() }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("银行卡", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            FilledTonalButton(onClick = { openApplication(null) }, enabled = !state.busy,
                colors = ButtonDefaults.filledTonalButtonColors(containerColor = Palette.accentSoft, contentColor = Palette.accentDeep),
                modifier = Modifier.testTag("cards-apply")) {
                NavGlyph(NavIcon.Add, Palette.accentDeep, 18.dp)
                Spacer(Modifier.width(6.dp)); Text("申请新卡")
            }
        }
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth().testTag("cards-loading"))
        state.error?.let { error ->
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("cards-error"))
                Row {
                    TextButton(onClick = onRetry, enabled = !state.busy, modifier = Modifier.testTag("cards-retry")) { Text("重试") }
                    TextButton(onClick = onDismissError, modifier = Modifier.testTag("cards-error-dismiss")) { Text("关闭提示") }
                }
            }
        }
        if (!state.loading && state.cards.isEmpty() && state.error == null) {
            Column(Modifier.fillMaxWidth().padding(vertical = 48.dp).testTag("cards-empty"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                NavGlyph(NavIcon.Card, Palette.accentDeep, 48.dp)
                Text("还没有银行卡", style = MaterialTheme.typography.titleMedium)
            }
        }
        state.cards.forEach { card ->
            key(card.id) {
                CardBlock(card, state.busy,
                    onToggleLock = { onToggleLock(card.id, it) },
                    onToggleOnline = { onToggleOnline(card.id, it) },
                    onToggleOverseas = { onToggleOverseas(card.id, it) },
                    onReveal = { revealedOnce = false; secretsFor = card.id },
                    onReplace = { openApplication(card.id) },
                    onLimit = { limitFor = card.id },
                )
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    if (application) CardApplicationDialog(
        state, replaceId?.let(state::card), onLoadProducts,
        onDismiss = { application = false },
        onSubmit = { code, address, password, done ->
            onApply(replaceId, code, address, password) { success, message ->
                if (success) application = false
                done(success, message)
            }
        },
    )
    limitFor?.let { id -> state.card(id)?.let { card ->
        AlertDialog(onDismissRequest = { limitFor = null }, title = { Text("单日限额") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CardRules.dailyLimits.forEach { cents ->
                    OutlinedButton(onClick = { onSetLimit(id, cents); limitFor = null }, modifier = Modifier.fillMaxWidth().testTag("card-limit-$cents"), enabled = !state.busy) {
                        Text("${Money.money(cents)}${if (cents == card.dailyLimit) " · 当前" else ""}")
                    }
                }
            }
        }, confirmButton = { TextButton(onClick = { limitFor = null }) { Text("取消") } })
    } }
    secretsFor?.let { id ->
        val revealed = state.revealed?.takeIf { it.cardId == id }
        val close = { secretsFor = null; onDismissSecrets() }
        if (revealed != null) SecretsDialog(revealed.secrets, close)
        else PasswordDialog(onDismiss = close, onSubmit = { password, result -> onRevealSecrets(id, password, result) })
    }
}

@Composable
private fun CardBlock(
    card: BankCard, busy: Boolean,
    onToggleLock: (Boolean) -> Unit, onToggleOnline: (Boolean) -> Unit, onToggleOverseas: (Boolean) -> Unit,
    onReveal: () -> Unit, onReplace: () -> Unit, onLimit: () -> Unit,
) {
    val locked = card.status == "locked"
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Palette.surface).testTag("card-${card.id}")) {
        val colors = if (card.theme == "champagne") listOf(Color(0xFF8D692F), Color(0xFFC8973C)) else listOf(Color(0xFF0E1B26), Color(0xFF334957))
        Column(Modifier.fillMaxWidth().background(Brush.linearGradient(colors)).padding(22.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("luckycat BANK", color = Color.White, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                Image(painterResource(R.drawable.brand_cat), null, colorFilter = ColorFilter.tint(Color.White), modifier = Modifier.size(34.dp))
            }
            Text(card.productName.ifEmpty { "银行卡" }, color = Color.White, style = MaterialTheme.typography.bodyMedium)
            Text("••••  ••••  ••••  ${card.last4}", color = Color.White, style = MaterialTheme.typography.titleLarge)
            Text("${card.network.uppercase()} · 尾号 ${card.last4} · ${card.expiry}", color = Color.White.copy(alpha = .8f), style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(card.cardholder, color = Color.White, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                Text(statusLabel(card.status), color = Color.White, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("card-status-${card.id}"))
            }
        }
        Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
            ToggleRow("锁定此卡", NavIcon.Lock, locked, !busy && CardRules.canLock(card.status), "card-lock-${card.id}", onToggleLock)
            HorizontalDivider(color = Palette.line)
            ToggleRow("网上支付", NavIcon.Card, card.onlinePayment, !busy && CardRules.canPay(card.status), "card-online-${card.id}", onToggleOnline)
            ToggleRow("境外支付", NavIcon.Globe, card.overseasPayment, !busy && CardRules.canPay(card.status), "card-overseas-${card.id}", onToggleOverseas)
            HorizontalDivider(color = Palette.line)
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("单日限额", style = MaterialTheme.typography.bodyMedium)
                    Text(Money.money(card.dailyLimit), color = Palette.inkSoft, style = MaterialTheme.typography.bodyMedium)
                }
                TextButton(onClick = onLimit, enabled = !busy && CardRules.canPay(card.status), modifier = Modifier.testTag("card-limit-${card.id}")) { Text("调整") }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = onReveal, enabled = !busy && CardRules.canReveal(card.status), modifier = Modifier.testTag("card-reveal-${card.id}")) { Text("查看卡信息") }
                TextButton(onClick = onReplace, enabled = !busy && CardRules.canReplace(card.status), modifier = Modifier.testTag("card-replace-${card.id}")) { Text("换卡") }
            }
            card.shippingAddress?.takeIf { card.status == "pending" }?.let {
                Text("寄送至 ${it.region} ${it.city} ${it.detail}", style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft, modifier = Modifier.padding(bottom = 10.dp))
            }
        }
    }
}

@Composable
private fun ToggleRow(title: String, icon: NavIcon, checked: Boolean, enabled: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        NavGlyph(icon, Palette.inkSoft, 20.dp)
        Text(title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled,
            colors = SwitchDefaults.colors(checkedTrackColor = Palette.accent, checkedThumbColor = Palette.surface,
                uncheckedTrackColor = Palette.sunk, uncheckedBorderColor = Palette.lineStrong, uncheckedThumbColor = Palette.inkMute),
            modifier = Modifier.testTag(tag))
    }
}

@Composable
private fun PasswordDialog(onDismiss: () -> Unit, onSubmit: (String, (Boolean, String?) -> Unit) -> Unit) {
    var password by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(securePolicy = SecureFlagPolicy.SecureOn),
        title = { Text("输入支付密码") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(password, { password = it.filter(Char::isDigit).take(6); message = null }, label = { Text("支付密码") }, singleLine = true, enabled = !busy,
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth().testTag("card-password"))
            message?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("card-password-message")) }
        } },
        confirmButton = { TextButton(onClick = {
            busy = true
            onSubmit(password) { wrong, text -> busy = false; message = text; if (wrong) password = "" }
        }, enabled = CardRules.validPassword(password) && !busy, modifier = Modifier.testTag("card-password-submit")) { Text(if (busy) "验证中…" else "确认") } },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.testTag("card-password-cancel")) { Text("取消") } },
    )
}

@Composable
private fun SecretsDialog(secrets: CardSecrets, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, properties = DialogProperties(securePolicy = SecureFlagPolicy.SecureOn),
        title = { Text(if (secrets.demo) "卡密（演示数据）" else "卡片信息") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("卡号", color = Palette.inkSoft, style = MaterialTheme.typography.bodySmall)
            Text(secrets.number, style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("card-secret-pan"))
            Text("有效期 ${secrets.expiry}    安全码 ${secrets.cvv}")
            Text("稍后自动隐藏", color = Palette.inkSoft, style = MaterialTheme.typography.bodySmall)
        } }, confirmButton = { TextButton(onClick = onDismiss, modifier = Modifier.testTag("card-secrets-close")) { Text("关闭") } })
}

internal fun statusLabel(status: String) = when (status) {
    "active" -> "正常"
    "locked" -> "已锁定"
    "pending" -> "待激活"
    "replaced" -> "已换卡"
    else -> "暂不可用"
}
