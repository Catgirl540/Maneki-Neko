package com.moneymeow.bank

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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

private data class Tx(
    val name: String,
    val meta: String,
    val amount: String,
    val income: Boolean,
    val icon: ImageVector,
)

private val txToday = listOf(
    Tx("星巴克咖啡", "09:12 · 餐饮", "-38.00", false, Icons.Pig),
    Tx("转入 · 他行卡", "08:40 · 转账", "+5,000.00", true, Icons.DownIn),
    Tx("地铁出行", "07:48 · 交通", "-6.00", false, Icons.Transfer),
)
private val txYesterday = listOf(
    Tx("转出 · 陈嘉禾", "15:26 · 转账", "-500.00", false, Icons.UpOut),
    Tx("永辉超市", "12:05 · 购物", "-126.50", false, Icons.Card),
    Tx("视频会员续费", "10:00 · 订阅服务", "-25.00", false, Icons.Receipt),
)
private val txEarlier = listOf(
    Tx("换汇 · 人民币 → 港币", "16:42 · 其他", "-8,000.00", false, Icons.Globe),
    Tx("工资入账", "10:00 · 工资入账", "+18,000.00", true, Icons.DownIn),
    Tx("房租", "09:00 · 房租", "-4,500.00", false, Icons.Pig),
)

@Composable
fun TransactionsScreen(onBack: () -> Unit, onAnalysis: () -> Unit, onOpenTx: () -> Unit) {
    var chip by remember { mutableIntStateOf(0) }
    PushScreen(title = "交易记录", onBack = onBack, action = "消费分析", onAction = onAnalysis) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SummaryCard("本月支出", "¥3,486.50", true, Modifier.weight(1f))
            SummaryCard("本月收入", "¥23,000.00", false, Modifier.weight(1f))
        }
        ChipRow(listOf("全部", "餐饮", "购物", "房租", "交通", "订阅"), chip) { chip = it }
        Column(Modifier.padding(horizontal = 14.dp)) {
            TxGroup("今天", txToday, onOpenTx)
            Spacer(Modifier.height(10.dp))
            TxGroup("昨天", txYesterday, onOpenTx)
            Spacer(Modifier.height(10.dp))
            TxGroup("10月18日", txEarlier, onOpenTx)
        }
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
private fun TxGroup(title: String, rows: List<Tx>, onOpenTx: () -> Unit) {
    Text(title, fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(start = 2.dp, bottom = 4.dp))
    HairlineCard {
        Column(Modifier.padding(horizontal = 14.dp)) {
            rows.forEachIndexed { index, tx ->
                if (index > 0) Hairline()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpenTx() }
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
            "保险保障" to Icons.Card,
            "安全设置" to Icons.Transfer,
            "邀请与奖励" to Icons.Person,
            "会员中心" to Icons.Person,
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
        Spacer(Modifier.height(8.dp))
        Text(
            "所有服务都在同一个资金账户下办理",
            fontSize = 11.sp,
            color = Tokens.Muted,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Spacer(Modifier.height(16.dp))
    }
}
