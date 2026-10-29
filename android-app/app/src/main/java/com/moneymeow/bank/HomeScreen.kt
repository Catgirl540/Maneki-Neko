package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class Entry(val label: String, val icon: ImageVector)

private val entries = listOf(
    Entry("转入", Icons.DownIn),
    Entry("转出", Icons.UpOut),
    Entry("存款", Icons.Pig),
    Entry("银行卡", Icons.Card),
    Entry("换汇", Icons.Globe),
    Entry("理财", Icons.Wealth),
    Entry("交易记录", Icons.Receipt),
    Entry("更多", Icons.Dots),
)

private data class Txn(
    val name: String,
    val meta: String,
    val amount: String,
    val income: Boolean,
    val icon: ImageVector,
)

@Composable
fun HomeScreen(onOpen: (String) -> Unit, onSwitchTab: (Int) -> Unit) {
    var balanceVisible by remember { mutableStateOf(true) }
    var transferInOpen by remember { mutableStateOf(false) }
    // 真实数据：登录后从 server/ 拉账户与最近流水；没有数据就显示空态，不用占位数字。
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var recentRows by remember { mutableStateOf<List<TransactionDto>>(emptyList()) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        loading = true
        loadError = null
        runCatching { BankApi.accounts() }
            .onSuccess { list ->
                account = list.firstOrNull()
                recentRows = emptyList()
                account?.let { acc ->
                    runCatching { BankApi.transactions(acc.id, 6) }
                        .onSuccess { recentRows = it }
                }
            }
            .onFailure { loadError = it.message }
        loading = false
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 12.dp),
    ) {
        Greeting(SessionStore.name(), onNotify = { onSwitchTab(3) })
        Spacer(Modifier.height(12.dp))
        AssetCard(balanceVisible, account, loading, loadError, onRetry = { attempt++ }) { balanceVisible = !balanceVisible }
        Spacer(Modifier.height(12.dp))
        EntryGrid(onOpen, onSwitchTab) { transferInOpen = true }
        Spacer(Modifier.height(4.dp))
        RecentTransactions(onOpen, recentRows, loading, loadError)
    }

    if (transferInOpen) {
        TransferInSheet(onDismiss = { transferInOpen = false })
    }
}

@Composable
private fun Greeting(name: String, onNotify: () -> Unit) {
    val hour = java.time.LocalTime.now().hour
    val period = when (hour) {
        in 5..8 -> "早上好"
        in 9..11 -> "上午好"
        in 12..17 -> "下午好"
        else -> "晚上好"
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Text(period, fontSize = 12.sp, color = Tokens.Muted)
            Text(name.ifEmpty { "我的账户" }, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
        }
        Box(
            Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(Tokens.Surface)
                .border(1.dp, Tokens.Border, CircleShape)
                .clickable { onNotify() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Bell, contentDescription = "通知", tint = Tokens.Ink2, modifier = Modifier.size(17.dp))
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 6.dp, end = 6.dp)
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(Tokens.Coral)
            )
        }
    }
}

@Composable
private fun AssetCard(
    visible: Boolean,
    account: AccountDto?,
    loading: Boolean,
    loadError: String?,
    onRetry: () -> Unit,
    onToggle: () -> Unit,
) {
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("人民币储蓄余额", fontSize = 12.sp, color = Tokens.Muted)
                HSpacer(6)
                Icon(
                    Icons.Eye,
                    contentDescription = if (visible) "隐藏余额" else "显示余额",
                    tint = Tokens.Muted,
                    modifier = Modifier
                        .size(15.dp)
                        .clickable { onToggle() },
                )
            }
            VSpacer(6)
            val cny = account?.currencyBalances?.firstOrNull { it.currency == "CNY" }?.balance
                ?: account?.takeIf { it.currency == "CNY" }?.balance
            when {
                cny != null -> AmountText(if (visible) formatCents(cny) else "¥••••••")
                loading -> AmountText("加载中…", 27)
                loadError != null -> AmountText("加载失败", 27)
                else -> AmountText("暂无账户", 27)
            }
            if (loadError != null) {
                VSpacer(6)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(loadError, fontSize = 11.sp, color = Tokens.Coral, modifier = Modifier.weight(1f))
                    Text(
                        "重试",
                        fontSize = 11.sp,
                        color = Tokens.Ink2,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.clickable { onRetry() },
                    )
                }
            }
            VSpacer(12)
            Hairline()
            VSpacer(10)
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(account?.label?.ifEmpty { "储蓄账户" } ?: "储蓄账户", fontSize = 12.sp, color = Tokens.Muted)
                Text(
                    when {
                        !visible -> "••••••"
                        cny != null -> formatCents(cny)
                        else -> "—"
                    },
                    fontSize = 12.sp,
                    color = Tokens.Ink2,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun EntryGrid(onOpen: (String) -> Unit, onSwitchTab: (Int) -> Unit, onTransferIn: () -> Unit) {
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(vertical = 8.dp)) {
            entries.chunked(4).forEach { row ->
                Row(Modifier.fillMaxWidth()) {
                    row.forEach { entry ->
                        Column(
                            Modifier
                                .weight(1f)
                                .clickable {
                                    when (entry.label) {
                                        "转入" -> onTransferIn()
                                        "理财" -> onSwitchTab(1)
                                        "更多" -> onOpen("更多服务")
                                        else -> onOpen(entry.label)
                                    }
                                }
                                .padding(vertical = 10.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Box(
                                Modifier
                                    .size(40.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(Tokens.SurfaceWarm),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(entry.icon, contentDescription = entry.label, tint = Tokens.Ink2, modifier = Modifier.size(20.dp))
                            }
                            VSpacer(7)
                            Text(entry.label, fontSize = 11.sp, color = Tokens.Ink2)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RecentTransactions(
    onOpen: (String) -> Unit,
    rows: List<TransactionDto>,
    loading: Boolean,
    loadError: String?,
) {
    Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("最近交易", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clickable { onOpen("交易记录") },
            ) {
                Text("查看全部", fontSize = 11.sp, color = Tokens.Muted)
                Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(12.dp))
            }
        }
        VSpacer(6)
        HairlineCard {
            Column(Modifier.padding(horizontal = 14.dp)) {
                val shown = rows.take(4).map { dto ->
                    Txn(
                        name = dto.counterparty.ifEmpty { dto.memo.ifEmpty { "交易" } },
                        meta = dto.createdAt.take(16).replace('T', ' ') + " · " + BankApi.categoryLabel(dto.category),
                        amount = (if (dto.direction == "in") "+" else "-") +
                            formatCents(dto.amount).removePrefix("¥").removePrefix("HK$"),
                        income = dto.direction == "in",
                        icon = when (dto.category) {
                            "dining" -> Icons.Food
                            "shopping" -> Icons.Shop
                            "transport" -> Icons.Transfer
                            "housing" -> Icons.Receipt
                            "salary" -> Icons.DownIn
                            else -> Icons.Receipt
                        },
                    )
                }
                if (shown.isEmpty()) {
                    Text(
                        when {
                            loading -> "加载中…"
                            loadError != null -> "加载失败"
                            else -> "暂无交易记录"
                        },
                        fontSize = 12.sp,
                        color = Tokens.Muted,
                        modifier = Modifier.padding(vertical = 16.dp),
                    )
                }
                shown.forEachIndexed { index, txn ->
                    if (index > 0) Hairline()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onOpen("交易详情") }
                            .padding(vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(Tokens.SurfaceWarm),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(txn.icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(15.dp))
                        }
                        HSpacer(10)
                        Column(Modifier.weight(1f)) {
                            Text(txn.name, fontSize = 13.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                            Text(txn.meta, fontSize = 10.5.sp, color = Tokens.Muted)
                        }
                        Text(
                            txn.amount,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (txn.income) Tokens.Ink else Tokens.Coral,
                        )
                    }
                }
            }
        }
    }
}
