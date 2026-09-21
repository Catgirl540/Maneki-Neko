package cn.waveflow.luckycat.ui.transfer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.domain.transfer.TransferDraft
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 转账页。
 *
 * 顺序是**刻意的**：选账户 → 选收款人 → 填金额 → **报价** → 提交。
 * 报价那一步不能省：手续费、到账时间、单笔上限都要用户先看到，
 * 点了确认之后才发现扣了手续费是最典型的投诉来源。
 *
 * 报价之后**任何输入变动都会让报价消失**（见 `TransferViewModel.invalidateQuote`），
 * 所以"确认转账"按钮只在刚报过价、且没改过东西时才亮。
 */
@Composable
fun TransferScreen(
    state: TransferUiState,
    onSelectAccount: (String) -> Unit,
    onSelectPayee: (String) -> Unit,
    onAmountChange: (String) -> Unit,
    onMemoChange: (String) -> Unit,
    onQuote: () -> Unit,
    onSubmit: () -> Unit,
    onDismissError: () -> Unit,
) {
    if (state.loading && state.accounts.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.testTag("transfer-loading"))
        }
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("转账", style = MaterialTheme.typography.headlineMedium)
            Text(
                "核对账户、收款人和报价后再确认",
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.inkSoft,
            )
        }

        SectionTitle("01", "付款账户")
        Column(
            modifier = Modifier.fillMaxWidth().testTag("transfer-accounts"),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            state.accounts.forEach { account ->
                PickRow(
                    title = account.label,
                    subtitle = "${Money.money(account.balance)} · 可用 ${Money.money(account.available)}",
                    selected = account.id == state.fromAccountId,
                    selectable = state.accounts.size > 1,
                    tag = "from-${account.id}",
                    onClick = { onSelectAccount(account.id) },
                )
            }
        }

        SectionTitle("02", "收款人")
        Column(
            modifier = Modifier.fillMaxWidth().testTag("transfer-payees"),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            state.payees.forEach { payee ->
                PickRow(
                    title = payee.name,
                    subtitle = TransferDraft.identifier(payee),
                    selected = payee.id == state.payeeId,
                    selectable = true,
                    tag = "payee-${payee.id}",
                    onClick = { onSelectPayee(payee.id) },
                )
            }
        }

        SectionTitle("03", "转账金额")
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Palette.surface)
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = state.amountText,
                onValueChange = onAmountChange,
                label = { Text("金额") },
                prefix = { Text("¥ ", style = MaterialTheme.typography.titleLarge) },
                suffix = { Text("元") },
                textStyle = MaterialTheme.typography.titleLarge,
                singleLine = true,
                shape = RoundedCornerShape(18.dp),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                isError = state.amountText.isNotEmpty() && state.amountCents == null,
                supportingText = {
                    if (state.amountText.isNotEmpty() && state.amountCents == null) {
                        Text("请输入有效金额（最多两位小数）")
                    }
                },
                modifier = Modifier.fillMaxWidth().testTag("transfer-amount"),
            )

            OutlinedTextField(
                value = state.memo,
                onValueChange = onMemoChange,
                label = { Text("附言（选填）") },
                singleLine = true,
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.fillMaxWidth().testTag("transfer-memo"),
            )
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
                    modifier = Modifier.weight(1f).testTag("transfer-error"),
                )
                TextButton(onClick = onDismissError, modifier = Modifier.testTag("transfer-error-dismiss")) {
                    Text("知道了")
                }
            }
        }

        OutlinedButton(
            onClick = onQuote,
            enabled = state.canQuote,
            modifier = Modifier.fillMaxWidth().testTag("transfer-quote"),
        ) {
            Text(if (state.busy) "处理中…" else "查看费用与到账时间")
        }

        state.quote?.let { quote ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(Palette.accentTint)
                    .border(1.dp, Palette.accentSoft, RoundedCornerShape(24.dp))
                    .padding(18.dp)
                    .testTag("transfer-quote-card"),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("转账确认", style = MaterialTheme.typography.titleMedium)
                Text(
                    "提交前请再次核对以下信息",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkSoft,
                )
                QuoteRow("手续费", Money.money(quote.fee))
                QuoteRow("预计到账", quote.etaText)
                QuoteRow("单笔上限", Money.money(quote.singleLimit))
                if (quote.requiresConfirm) {
                    Text(
                        quote.confirmReason ?: "这笔转账需要二次确认",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.testTag("transfer-quote-confirm"),
                    )
                }
                if (quote.channelNote.isNotEmpty()) {
                    Text(quote.channelNote, style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft)
                }
            }
        }

        Button(
            onClick = onSubmit,
            enabled = state.canSubmit,
            colors = ButtonDefaults.buttonColors(containerColor = Palette.accent),
            modifier = Modifier.fillMaxWidth().testTag("transfer-submit"),
        ) {
            Text("确认信息并转账")
        }

        state.result?.let { result ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(Palette.accentTint)
                    .padding(18.dp)
                    .testTag("transfer-result"),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("转账已受理", style = MaterialTheme.typography.titleMedium, color = Palette.accentDeep)
                QuoteRow("金额", Money.money(result.amount))
                QuoteRow("手续费", Money.money(result.fee))
                QuoteRow("收款", result.identifier)
                QuoteRow("回执号", result.referenceNo)
                Text(
                    "演示环境：这里没有真实资金变动。",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkMute,
                )
            }
        }
    }
}

@Composable
private fun SectionTitle(number: String, text: String) {
    Row(
        modifier = Modifier.padding(top = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(50))
                .background(Palette.accentSoft),
            contentAlignment = Alignment.Center,
        ) {
            Text(number, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = Palette.accentDeep)
        }
        Text(text, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun PickRow(title: String, subtitle: String, selected: Boolean, selectable: Boolean, tag: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.surface)
            .border(
                width = if (selected) 2.dp else 1.dp,
                color = if (selected) Palette.accent else Palette.line,
                shape = RoundedCornerShape(20.dp),
            )
            .clickable(enabled = selectable, onClick = onClick)
            .padding(16.dp)
            .testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(50))
                .background(if (selected) Palette.accent else Palette.accentTint),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                title.take(1),
                fontWeight = FontWeight.Bold,
                color = if (selected) Palette.onAccent else Palette.accentDeep,
            )
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
        }
        if (selected) Text("✓", color = Palette.accentDeep, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun QuoteRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = Palette.inkSoft)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}
