package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class Tx(
    val id: String? = null,
    val name: String,
    val meta: String,
    val amount: String,
    val income: Boolean,
    val icon: ImageVector,
)

private val txToday = listOf(
    Tx(name = "星巴克咖啡", meta = "09:12 · 餐饮", amount = "-38.00", income = false, icon = Icons.Food),
    Tx(name = "转入 · 他行卡", meta = "08:40 · 转账", amount = "+5,000.00", income = true, icon = Icons.DownIn),
    Tx(name = "地铁出行", meta = "07:48 · 交通", amount = "-6.00", income = false, icon = Icons.Transfer),
)
private val txYesterday = listOf(
    Tx(name = "转出 · 陈嘉禾", meta = "15:26 · 转账", amount = "-500.00", income = false, icon = Icons.UpOut),
    Tx(name = "永辉超市", meta = "12:05 · 购物", amount = "-126.50", income = false, icon = Icons.Shop),
    Tx(name = "视频会员续费", meta = "10:00 · 订阅服务", amount = "-25.00", income = false, icon = Icons.Receipt),
)
private val txEarlier = listOf(
    Tx(name = "换汇 · 人民币 → 港币", meta = "16:42 · 其他", amount = "-8,000.00", income = false, icon = Icons.Globe),
    Tx(name = "工资入账", meta = "10:00 · 工资入账", amount = "+18,000.00", income = true, icon = Icons.DownIn),
    Tx(name = "房租", meta = "09:00 · 房租", amount = "-4,500.00", income = false, icon = Icons.Receipt),
)

@Composable
fun TransactionsScreen(onBack: () -> Unit, onAnalysis: () -> Unit, onOpenTx: (String?) -> Unit) {
    var chip by remember { mutableIntStateOf(0) }
    var filterOpen by remember { mutableStateOf(false) }
    var filterCount by remember { mutableIntStateOf(0) }
    // 真实流水：登录后按分类筛选向服务端查询
    var rows by remember { mutableStateOf<List<TransactionDto>>(emptyList()) }
    var loadError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(chip) {
        if (!BankApi.hasToken()) return@LaunchedEffect
        loadError = null
        runCatching {
            val account = BankApi.accounts().firstOrNull() ?: return@runCatching emptyList()
            BankApi.transactions(account.id, 30)
        }
            .onSuccess { rows = it }
            .onFailure { loadError = it.message }
    }
    val categoryKeys = listOf("all", "dining", "shopping", "housing", "transport", "subscription")
    val visible = remember(rows, chip) {
        if (chip == 0) rows else rows.filter { it.category == categoryKeys.getOrNull(chip) }
    }

    Box(Modifier.fillMaxWidth()) {
        Column {
            PushScreen(title = "交易记录", onBack = onBack, action = "消费分析", onAction = onAnalysis) {
                Row(
                    Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    val month = java.time.LocalDate.now().toString().take(7)
                    val monthRows = rows.filter { it.createdAt.startsWith(month) }
                    val expense = monthRows.filter { it.direction == "out" }.sumOf { it.amount }
                    val income = monthRows.filter { it.direction == "in" }.sumOf { it.amount }
                    SummaryCard("本月支出", formatCents(expense), true, Modifier.weight(1f))
                    SummaryCard("本月收入", formatCents(income), false, Modifier.weight(1f))
                }
                ChipRow(
                    listOf("全部", "餐饮", "购物", "房租", "交通", "订阅"),
                    chip,
                    trailing = {
                        Box(
                            Modifier
                                .size(width = 34.dp, height = 32.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(if (filterCount > 0) Tokens.Primary else Tokens.Surface),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Filter,
                                contentDescription = "筛选",
                                tint = if (filterCount > 0) androidx.compose.ui.graphics.Color.White else Tokens.Ink2,
                                modifier = Modifier
                                    .size(16.dp)
                                    .clickable { filterOpen = true },
                            )
                        }
                    },
                ) { chip = it }
                Column(Modifier.padding(horizontal = 14.dp)) {
                    when {
                        loadError != null -> Text(
                            "加载失败：$loadError",
                            fontSize = 12.sp,
                            color = Tokens.Coral,
                            modifier = Modifier.padding(vertical = 16.dp),
                        )
                        rows.isEmpty() -> Text(
                            "暂无流水",
                            fontSize = 12.sp,
                            color = Tokens.Muted,
                            modifier = Modifier.padding(vertical = 16.dp),
                        )
                        else -> {
                            val grouped = visible.groupBy { it.createdAt.take(10) }
                            grouped.forEach { (day, list) ->
                                TxGroup(day, list.map { it.toRow() }, onOpenTx)
                                Spacer(Modifier.height(10.dp))
                            }
                        }
                    }
                }
            }
        }

        FilterDrawer(
            title = "筛选",
            groups = listOf(
                FilterGroup("收支", listOf("全部", "支出", "收入")),
                FilterGroup("分类", listOf("全部", "餐饮", "购物", "房租", "交通", "订阅服务", "转账", "工资入账", "其他")),
                FilterGroup("时间范围", listOf("不限", "近 7 天", "近 30 天", "近 90 天")),
                FilterGroup("币种", listOf("全部", "人民币 CNY", "港币 HKD")),
            ),
            visible = filterOpen,
            onClose = { filterOpen = false },
            onApply = { applied ->
                filterCount = applied.count { (key, value) ->
                    val default = when (key) {
                        "时间范围" -> "不限"
                        else -> "全部"
                    }
                    value != default
                }
                filterOpen = false
            },
        )
    }
}

@Composable
private fun SummaryCard(label: String, value: String, negative: Boolean, modifier: Modifier) {
    HairlineCard(modifier) {
        Column(Modifier.padding(13.dp)) {
            Text(label, fontSize = 11.sp, color = Tokens.Muted)
            Spacer(Modifier.height(5.dp))
            Text(
                value,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (negative) Tokens.Coral else Tokens.Ink,
            )
        }
    }
}

@Composable
private fun TxGroup(title: String, rows: List<Tx>, onOpenTx: (String?) -> Unit) {
    Text(title, fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(start = 2.dp, bottom = 4.dp))
    HairlineCard {
        Column(Modifier.padding(horizontal = 14.dp)) {
            rows.forEachIndexed { index, tx ->
                if (index > 0) Hairline()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpenTx(tx.id) }
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
                        Icon(tx.icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(15.dp))
                    }
                    Spacer(Modifier.size(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(tx.name, fontSize = 13.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                        Text(tx.meta, fontSize = 10.5.sp, color = Tokens.Muted)
                    }
                    Text(
                        tx.amount,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (tx.income) Tokens.Ink else Tokens.Coral,
                    )
                }
            }
        }
    }
}

/** 更多服务：按侧栏四个分组铺开。 */
private data class ServiceGroup(val title: String, val items: List<Pair<String, ImageVector>>)

private val serviceGroups = listOf(
    ServiceGroup(
        "账户与支付",
        listOf(
            "账户资产" to Icons.Eye,
            "转账与支付" to Icons.Transfer,
            "收款与转入" to Icons.DownIn,
            "多币种换汇" to Icons.Globe,
            "银行卡管理" to Icons.Card,
            "存款" to Icons.Pig,
        ),
    ),
    ServiceGroup(
        "账单与资金",
        listOf(
            "账单与交易" to Icons.Receipt,
            "消费分析" to Icons.Wealth,
            "自动扣款" to Icons.UpOut,
            "工资与备用金" to Icons.DownIn,
            "借款与分期" to Icons.Card,
        ),
    ),
    ServiceGroup(
        "理财与储蓄",
        listOf(
            "理财总览" to Icons.Pig,
            "产品市场" to Icons.Wealth,
            "我的持仓" to Icons.Wealth,
            "储蓄与计划" to Icons.Pig,
            "理财记录" to Icons.Receipt,
        ),
    ),
    ServiceGroup(
        "个人与安全",
        listOf(
            "保险保障" to Icons.Shield,
            "安全设置" to Icons.Lock,
            "邀请与奖励" to Icons.Person,
            "会员中心" to Icons.Check,
        ),
    ),
)

@Composable
fun MoreScreen(onBack: () -> Unit, onOpen: (String) -> Unit) {
    PushScreen(title = "更多服务", onBack = onBack) {
        serviceGroups.forEach { group ->
            SectionHeader(group.title)
            Column(Modifier.padding(horizontal = 8.dp)) {
                group.items.chunked(4).forEach { row ->
                    Row(Modifier.fillMaxWidth()) {
                        row.forEach { (label, icon) ->
                            Column(
                                Modifier
                                    .weight(1f)
                                    .clickable { onOpen(label) }
                                    .padding(vertical = 10.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Box(
                                    Modifier
                                        .size(38.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Tokens.SurfaceWarm),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(19.dp))
                                }
                                Spacer(Modifier.height(7.dp))
                                Text(label, fontSize = 11.sp, color = Tokens.Ink2)
                            }
                        }
                        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

/** 后端流水转成列表行。 */
private fun TransactionDto.toRow(): Tx = Tx(
    id = id,
    name = counterparty.ifEmpty { memo.ifEmpty { "交易" } },
    meta = createdAt.substringAfter('T').take(5) + " · " + BankApi.categoryLabel(category),
    amount = (if (direction == "in") "+" else "-") + formatCents(amount).substringAfter('¥').substringAfter("HK$"),
    income = direction == "in",
    icon = when (category) {
        "dining" -> Icons.Food
        "shopping" -> Icons.Shop
        "transport" -> Icons.Transfer
        "housing" -> Icons.Receipt
        "salary" -> Icons.DownIn
        else -> Icons.Receipt
    },
)
