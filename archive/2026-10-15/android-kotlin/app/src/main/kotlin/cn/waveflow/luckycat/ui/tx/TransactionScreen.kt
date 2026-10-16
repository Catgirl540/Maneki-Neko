package cn.waveflow.luckycat.ui.tx

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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.domain.tx.DetailField
import cn.waveflow.luckycat.domain.tx.TransactionFields
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 交易详情（电子回单）。
 *
 * 字段与顺序全部来自 [TransactionFields]（可离线测），这里只负责画。
 * 对账那一段是**真的会提示异常**的：交易前余额 + 交易金额 ≠ 交易后余额时
 * 显示一行提醒，而不是默默把两个数并排列出来。
 */
@Composable
fun TransactionScreen(
    state: TransactionUiState,
    onRetry: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val record = state.record
        when {
            state.loading && record == null ->
                CircularProgressIndicator(modifier = Modifier.testTag("tx-loading"))

            record == null -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    state.error ?: "找不到这笔交易",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("tx-error"),
                )
                TextButton(onClick = onRetry, modifier = Modifier.testTag("tx-retry")) { Text("重试") }
            }

            else -> Column(
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                AmountHeader(record.counterparty, record.signedAmount, record.isIncome)
                BalanceSection(record)
                FieldsSection(TransactionFields.build(record))
            }
        }
    }
}

@Composable
private fun AmountHeader(counterparty: String, signedAmount: Long, isIncome: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(counterparty.ifEmpty { "交易" }, style = MaterialTheme.typography.titleMedium)
        Text(
            Money.moneySigned(signedAmount),
            style = MaterialTheme.typography.headlineSmall,
            color = if (isIncome) Palette.income else Palette.expense,
            modifier = Modifier.testTag("tx-amount"),
        )
    }
}

@Composable
private fun BalanceSection(state: cn.waveflow.luckycat.contract.bank.TransactionRecord) {
    val detail = state.detail
    val reconciles = TransactionFields.reconciles(state)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.sunk)
            .padding(16.dp)
            .testTag("tx-balance"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("交易前余额", style = MaterialTheme.typography.bodyMedium, color = Palette.inkSoft)
            Text(Money.money(detail.balanceBefore), style = MaterialTheme.typography.bodyMedium)
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("交易后余额", style = MaterialTheme.typography.bodyMedium, color = Palette.inkSoft)
            Text(
                Money.money(detail.balanceAfter),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
        }
        Text(
            // 原来这里开头是一个 emoji（U+26A0 U+FE0F）。它由系统 emoji 字体渲染成彩色图形，
            // 和全站的金色/奶油线条语言不是一回事。警示靠**颜色**表达就够，
            // 这一行的 `color` 本来就分了两种情况。
            if (reconciles) "余额已按此笔交易更新。交易前余额 + 交易金额 = 交易后余额。"
            else "余额对不上：交易前余额 + 交易金额 ≠ 交易后余额，请以银行为准。",
            style = MaterialTheme.typography.bodySmall,
            color = if (reconciles) Palette.inkMute else MaterialTheme.colorScheme.error,
            modifier = Modifier.testTag("tx-reconcile"),
        )
    }
}

@Composable
private fun FieldsSection(fields: List<DetailField>) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.surface)
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .testTag("tx-fields"),
    ) {
        fields.forEachIndexed { index, field ->
            if (index > 0) HorizontalDivider(color = Palette.line)
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    field.label,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Palette.inkSoft,
                )
                Text(
                    field.value,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (field.emphasis) FontWeight.SemiBold else FontWeight.Normal,
                    modifier = Modifier.padding(start = 16.dp).weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                )
            }
        }
    }
}
