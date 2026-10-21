package com.moneymeow.bank

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class Product(
    val name: String,
    val risk: String,
    val metricLabel: String,
    val metric: String,
    val minAmount: String,
    val term: String,
    val meta: String,
    val matched: Boolean,
)

private val products = listOf(
    Product("招财猫现金添利 A", "R1", "七日年化", "1.86%", "¥1.00", "随时赎回", "现金管理 · 开放式", true),
    Product("招财猫稳盈 90 天", "R2", "单位净值", "1.0064", "¥10,000", "90 天", "固定收益 · 封闭期内不可赎回", true),
    Product("招财猫稳盈 365 天", "R2", "单位净值", "1.0128", "¥10,000", "365 天", "固定收益 · 白金优先购中", true),
    Product("招财猫平衡配置 180 天", "R3", "单位净值", "0.9984", "¥10,000", "180 天", "混合 · 封闭期内不可赎回", true),
    Product("招财猫沪深 300 指数增强", "R4", "单位净值", "1.0342", "¥10,000", "随时赎回", "权益 · 开放式", false),
    Product("招财猫黄金挂钩 365 天", "R5", "单位净值", "1.0571", "¥50,000", "365 天", "商品及衍生品 · 封闭期内不可赎回", false),
)

private data class Holding(
    val name: String,
    val risk: String,
    val marketValue: String,
    val shares: String,
    val pnl: String,
    val pnlUp: Boolean,
    val note: String,
    val redeemable: Boolean,
)

private val holdings = listOf(
    Holding("招财猫现金添利 A", "R1", "¥20,014.50", "19,985.02", "+14.50", true, "确认日 2026-10-18", true),
    Holding("招财猫稳盈 90 天", "R2", "¥10,032.00", "9,968.21", "+32.00", true, "封闭期至 2027-01-18", false),
    Holding("招财猫沪深 300 指数增强", "R4", "¥12,410.40", "12,000.00", "-589.60", false, "确认日 2026-09-28", true),
)

private data class WealthRecord(val title: String, val tag: String, val meta: String, val amount: String, val income: Boolean)

private val records = listOf(
    WealthRecord("申购 · 招财猫现金添利 A", "申购", "2026-10-18 14:32 · 份额 19,985.02", "-¥20,000.00", false),
    WealthRecord("赎回 · 招财猫稳盈 90 天", "赎回", "2026-10-12 10:05 · 预计 T+1 到账", "+¥10,032.00", true),
    WealthRecord("申购 · 招财猫沪深 300 指数增强", "申购", "2026-09-28 09:41 · 份额 12,000.00", "-¥13,000.00", false),
)

@Composable
fun WealthTab(onOpenProduct: () -> Unit, onOpenPlans: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        TabBar("理财")
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            SegTabs(listOf("总览", "产品", "持仓", "记录"), tab) { tab = it }
        }
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 16.dp),
        ) {
            when (tab) {
                0 -> WealthOverview(onOpenPlans)
                1 -> WealthProducts(onOpenProduct)
                2 -> WealthHoldings()
                else -> WealthRecords()
            }
        }
    }
}

@Composable
private fun WealthOverview(onOpenPlans: () -> Unit) {
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("持仓市值", fontSize = 12.sp, color = Tokens.Muted)
                Spacer(Modifier.size(6.dp))
                Icon(Icons.Eye, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(15.dp))
            }
            Spacer(Modifier.height(6.dp))
            AmountText("¥42,456.90", 27)
            Spacer(Modifier.height(12.dp))
            Hairline()
            Spacer(Modifier.height(10.dp))
            KvInline("投入本金", "¥42,999.00")
            KvInline("累计盈亏", "-542.10", Tokens.Coral)
            KvInline("昨日盈亏", "+18.40")
        }
    }
    Spacer(Modifier.height(10.dp))
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(15.dp))
            Spacer(Modifier.size(8.dp))
            Text("风险测评 R3 · 有效至 2027-05-12", fontSize = 12.sp, color = Tokens.Ink2)
        }
    }
    Spacer(Modifier.height(10.dp))
    Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        QuickCard("产品市场", Icons.Pig, Modifier.weight(1f)) { }
        QuickCard("我的持仓", Icons.Wealth, Modifier.weight(1f)) { }
    }
    Spacer(Modifier.height(10.dp))
    Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        QuickCard("储蓄与计划", Icons.Receipt, Modifier.weight(1f)) { onOpenPlans() }
        QuickCard("交易记录", Icons.Transfer, Modifier.weight(1f)) { }
    }
}

@Composable
fun KvInline(label: String, value: String, color: Color = Tokens.Ink2) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, fontSize = 12.sp, color = Tokens.Muted)
        Text(value, fontSize = 12.sp, color = color, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun QuickCard(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, onClick: () -> Unit) {
    HairlineCard(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { onClick() }
                .padding(13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(30.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Tokens.SurfaceWarm),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(16.dp))
            }
            Spacer(Modifier.size(10.dp))
            Text(label, fontSize = 13.sp, color = Tokens.Ink)
        }
    }
}

@Composable
private fun WealthProducts(onOpenProduct: () -> Unit) {
    var chip by remember { mutableIntStateOf(0) }
    ChipRow(listOf("全部", "现金管理", "固定收益", "混合", "权益", "商品"), chip) { chip = it }
    Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        products.forEach { product ->
            HairlineCard {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpenProduct() }
                        .padding(14.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            product.name,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Tokens.Ink,
                            modifier = Modifier.weight(1f),
                        )
                        RiskBadge(product.risk)
                    }
                    Spacer(Modifier.height(9.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        MetricBlock(product.metricLabel, product.metric)
                        MetricBlock("起购", product.minAmount)
                        MetricBlock("期限", product.term)
                    }
                    Spacer(Modifier.height(9.dp))
                    Hairline()
                    Spacer(Modifier.height(9.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(product.meta, fontSize = 11.sp, color = Tokens.Muted)
                        Text(
                            if (product.matched) "风险匹配" else "超出你的风险承受能力",
                            fontSize = 11.sp,
                            color = if (product.matched) Tokens.Ink2 else Tokens.Coral,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricBlock(label: String, value: String) {
    Column {
        Text(label, fontSize = 10.5.sp, color = Tokens.Muted)
        Spacer(Modifier.height(2.dp))
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
    }
}

@Composable
fun RiskBadge(risk: String) {
    val high = risk == "R4" || risk == "R5"
    Box(
        Modifier
            .clip(RoundedCornerShape(5.dp))
            .background(if (high) Color(0xFFFDF1F4) else Tokens.SurfaceWarm),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            risk,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (high) Tokens.Coral else Tokens.Ink2,
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun WealthHoldings() {
    var chip by remember { mutableIntStateOf(0) }
    ChipRow(listOf("全部", "可赎回", "封闭期"), chip) { chip = it }
    Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        holdings.forEach { holding ->
            HairlineCard {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            holding.name,
                            fontSize = 13.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Tokens.Ink,
                            modifier = Modifier.weight(1f),
                        )
                        RiskBadge(holding.risk)
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        MetricBlock("市值", holding.marketValue)
                        MetricBlock("份额", holding.shares)
                        Column {
                            Text("盈亏", fontSize = 10.5.sp, color = Tokens.Muted)
                            Spacer(Modifier.height(2.dp))
                            Text(
                                holding.pnl,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (holding.pnlUp) Tokens.Ink else Tokens.Coral,
                            )
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Hairline()
                    Spacer(Modifier.height(10.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(holding.note, fontSize = 11.sp, color = Tokens.Muted)
                        if (holding.redeemable) {
                            Box(
                                Modifier
                                    .clip(RoundedCornerShape(15.dp))
                                    .background(Tokens.Primary)
                                    .padding(horizontal = 14.dp, vertical = 6.dp),
                            ) {
                                Text("赎回", fontSize = 12.sp, color = Color.White)
                            }
                        } else {
                            Text("封闭期不可赎回", fontSize = 11.sp, color = Tokens.Muted)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WealthRecords() {
    var chip by remember { mutableIntStateOf(0) }
    ChipRow(listOf("全部", "申购", "赎回"), chip) { chip = it }
    Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        records.forEach { record ->
            HairlineCard {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            record.title,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = Tokens.Ink,
                            modifier = Modifier.weight(1f),
                        )
                        RiskBadge(record.tag)
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(record.meta, fontSize = 11.sp, color = Tokens.Muted)
                        Text(
                            record.amount,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = if (record.income) Tokens.Ink else Tokens.Coral,
                        )
                    }
                }
            }
        }
    }
}
