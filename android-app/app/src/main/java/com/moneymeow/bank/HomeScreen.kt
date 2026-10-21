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

private val recent = listOf(
    Txn("星巴克咖啡", "09:12 · 餐饮", "-38.00", false, Icons.Food),
    Txn("转入 · 他行卡", "08:40 · 转账", "+5,000.00", true, Icons.DownIn),
    Txn("地铁出行", "07:48 · 交通", "-6.00", false, Icons.Transfer),
    Txn("转出 · 陈嘉禾", "昨天 15:26 · 转账", "-500.00", false, Icons.UpOut),
)

@Composable
fun HomeScreen(onOpen: (String) -> Unit, onSwitchTab: (Int) -> Unit) {
    var balanceVisible by remember { mutableStateOf(true) }
    var transferInOpen by remember { mutableStateOf(false) }
    // 真实数据：登录后从 server/ 拉账户与最近流水
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var recentRows by remember { mutableStateOf<List<TransactionDto>>(emptyList()) }
    var loadError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        if (!BankApi.hasToken()) return@LaunchedEffect
        runCatching { BankApi.accounts() }
            .onSuccess { list ->
                account = list.firstOrNull()
                account?.let { acc ->
                    runCatching { BankApi.transactions(acc.id, 6) }
                        .onSuccess { recentRows = it }
                }
            }
            .onFailure { loadError = it.message }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 12.dp),
    ) {
        Greeting(onNotify = { onSwitchTab(3) })
        Spacer(Modifier.height(12.dp))
        AssetCard(balanceVisible, account, loadError) { balanceVisible = !balanceVisible }
        Spacer(Modifier.height(12.dp))
        EntryGrid(onOpen, onSwitchTab) { transferInOpen = true }
        Spacer(Modifier.height(4.dp))
        RecentTransactions(onOpen, recentRows)
    }

    if (transferInOpen) {
        TransferInSheet(onDismiss = { transferInOpen = false })
    }
}

@Composable
private fun Greeting(onNotify: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Text("上午好", fontSize = 12.sp, color = Tokens.Muted)
            Text("陈先生", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
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
private fun AssetCard(visible: Boolean, account: AccountDto?, loadError: String?, onToggle: () -> Unit) {
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("总资产", fontSize = 12.sp, color = Tokens.Muted)
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
                ?: account?.balance
            val total = when {
                cny != null -> formatCents(cny)
                loadError != null -> "—"
                else -> "¥86,320.00"
            }
            AmountText(if (visible) total else "¥••••••")
            VSpacer(12)
            Hairline()
            VSpacer(10)
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(account?.label?.ifEmpty { "人民币活期" } ?: "人民币活期", fontSize = 12.sp, color = Tokens.Muted)
                Text(
                    if (!visible) "••••••" else if (cny != null) formatCents(cny) else "—",
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
private fun RecentTransactions(onOpen: (String) -> Unit, rows: List<TransactionDto>) {
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
                val shown = if (rows.isNotEmpty()) {
                    rows.take(4).map { dto ->
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
                } else {
                    recent
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
