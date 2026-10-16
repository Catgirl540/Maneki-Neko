package cn.waveflow.luckycat.ui.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.contract.bank.Transaction
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.domain.time.Dates
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 账户流水页：账户头部 + 分页流水。
 *
 * 金额显示用**带币种符号的带符号写法**（网页版此处也是 `moneySigned`）：
 * 流水行里光看数字分不清收还是支，符号比颜色更可靠——色盲用户看不到颜色。
 */
@Composable
fun AccountScreen(
    state: AccountUiState,
    onOpenTransaction: (String) -> Unit,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        AccountHeader(state)
        state.error?.let {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f).testTag("account-error"),
                )
                TextButton(onClick = onRetry, modifier = Modifier.testTag("account-retry")) { Text("重试") }
            }
        }

        Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            when {
                state.loading && state.transactions.isEmpty() ->
                    CircularProgressIndicator(modifier = Modifier.testTag("account-loading"))

                state.transactions.isEmpty() ->
                    Text(
                        "这个账户还没有交易",
                        color = Palette.inkSoft,
                        modifier = Modifier.testTag("account-empty"),
                    )

                else -> TransactionList(state, onOpenTransaction, onLoadMore)
            }
        }
    }
}

@Composable
private fun AccountHeader(state: AccountUiState) {
    val account = state.account
    Column(
        modifier = Modifier.fillMaxWidth().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            account?.label ?: "账户",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.testTag("account-title"),
        )
        if (account != null) {
            Text(
                "${account.accountNo.take(4)} **** ${account.accountNo.takeLast(4)} · 储蓄账户",
                style = MaterialTheme.typography.bodySmall,
                color = Palette.inkMute,
            )
            Text(
                Money.money(account.balance),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(top = 4.dp).testTag("account-balance"),
            )
            Text(
                "可用 ${Money.money(account.available)} · 年利率 ${Money.rate(account.interestRate)}",
                style = MaterialTheme.typography.bodySmall,
                color = Palette.inkSoft,
            )
        }
    }
}

@Composable
private fun TransactionList(
    state: AccountUiState,
    onOpenTransaction: (String) -> Unit,
    onLoadMore: () -> Unit,
) {
    val listState = rememberLazyListState()
    // 快到底了就预取下一页。用 derivedStateOf 是为了**只在跨过阈值那一刻**触发重组，
    // 否则每滚一像素都会重算一次。
    val nearEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= state.transactions.size - 3
        }
    }
    LaunchedEffect(nearEnd, state.transactions.size, state.hasMore) {
        if (nearEnd && state.hasMore) onLoadMore()
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().testTag("account-tx-list"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(state.transactions, key = { it.id }) { tx ->
            TransactionRow(tx, onClick = { onOpenTransaction(tx.id) })
        }
        if (state.loadingMore) {
            item {
                Box(modifier = Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                    Text("正在加载…", style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
                }
            }
        }
    }
}

@Composable
private fun TransactionRow(tx: Transaction, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.surface)
            .clickable(onClick = onClick)
            .padding(14.dp)
            .testTag("tx-${tx.id}"),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(tx.counterparty.ifEmpty { tx.memo.ifEmpty { "—" } }, style = MaterialTheme.typography.bodyLarge)
            Text(
                Dates.dateTime(tx.createdAt) + if (tx.status != "success") statusLabel(tx.status) else "",
                style = MaterialTheme.typography.bodySmall,
                color = Palette.inkMute,
            )
        }
        Text(
            Money.moneySigned(tx.signedAmount),
            style = MaterialTheme.typography.bodyLarge,
            color = if (tx.isIncome) Palette.income else Palette.expense,
        )
    }
}

/** 交易状态的中文说法。与网页版 `STATUS_LABEL` 对齐。 */
internal fun statusLabel(status: String): String = when (status) {
    "pending" -> " · 处理中"
    "failed" -> " · 失败"
    else -> ""
}
