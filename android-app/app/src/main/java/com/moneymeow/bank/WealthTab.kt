package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
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
    val code: String = "",
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




@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WealthTab(
    onOpenProduct: (String) -> Unit,
    onOpenPlans: () -> Unit,
    onRedeemed: (productName: String, amount: Long) -> Unit,
) {
    var tab by remember { mutableIntStateOf(0) }
    var redeemTarget by remember { mutableStateOf<HoldingDto?>(null) }
    var redeeming by remember { mutableStateOf(false) }
    var redeemError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // 真实理财数据
    var overview by remember { mutableStateOf<WealthOverviewDto?>(null) }
    var catalog by remember { mutableStateOf<List<WealthProductDto>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        if (!BankApi.hasToken()) return@LaunchedEffect
        runCatching { BankApi.wealthOverview() }
            .onSuccess { overview = it }
            .onFailure { error = it.message }
        runCatching { BankApi.wealthProducts() }
            .onSuccess { catalog = it }
            .onFailure { if (error == null) error = it.message }
    }
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
                0 -> WealthOverview(overview, error, onOpenPlans) { tab = it }
                1 -> WealthProducts(catalog, error, onOpenProduct)
                2 -> WealthHoldings(overview, onRedeem = { redeemTarget = it })
                else -> WealthRecords()
            }
        }
    }


    val target = redeemTarget
    if (target != null) {
        androidx.compose.material3.ModalBottomSheet(
            onDismissRequest = { redeemTarget = null },
            sheetState = androidx.compose.material3.rememberModalBottomSheetState(),
            containerColor = Tokens.Surface,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text("赎回 · ${target.productName}", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                KvRow("持有市值", formatCents(target.marketValue))
                KvRow("本次赎回", formatCents(target.marketValue) + "（全部）")
                KvRow("预计到账", "T+1 个工作日")
                Spacer(Modifier.height(12.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Tokens.SurfaceWarm)
                        .padding(12.dp)
                ) {
                    Text(
                        "赎回金额按确认时的净值计算，以银行确认结果为准。",
                        fontSize = 11.5.sp,
                        color = Tokens.Ink2,
                        lineHeight = 18.sp,
                    )
                }
                if (redeemError != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(redeemError!!, fontSize = 11.sp, color = Tokens.Coral)
                }
                Spacer(Modifier.height(16.dp))
                PrimaryButton(if (redeeming) "赎回中…" else "确认赎回", {
                    if (redeeming) return@PrimaryButton
                    redeeming = true
                    redeemError = null
                    scope.launch {
                        runCatching { BankApi.redeemWealth(target.id) }
                            .onSuccess {
                                redeemTarget = null
                                runCatching { BankApi.wealthOverview() }.onSuccess { overview = it }
                                onRedeemed(target.productName, target.marketValue)
                            }
                            .onFailure { redeemError = it.message }
                        redeeming = false
                    }
                })
                Spacer(Modifier.height(12.dp))
            }
        }
    }

}

@Composable
private fun WealthOverview(overview: WealthOverviewDto?, error: String?, onOpenPlans: () -> Unit, onSwitch: (Int) -> Unit) {
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("持仓市值", fontSize = 12.sp, color = Tokens.Muted)
                Spacer(Modifier.size(6.dp))
                Icon(Icons.Eye, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(15.dp))
            }
            Spacer(Modifier.height(6.dp))
            AmountText(
                when {
                    overview != null -> formatCents(overview.totalValue)
                    error != null -> "加载失败"
                    else -> "加载中…"
                },
                27,
            )
            Spacer(Modifier.height(12.dp))
            Hairline()
            Spacer(Modifier.height(10.dp))
            KvInline("投入本金", overview?.let { formatCents(it.totalPrincipal) } ?: "—")
            KvInline(
                "累计盈亏",
                overview?.let { formatCents(it.totalProfit) } ?: "—",
                if ((overview?.totalProfit ?: 0) < 0) Tokens.Coral else Tokens.Ink2,
            )
            KvInline("昨日盈亏", overview?.let { formatCents(it.yesterdayProfit) } ?: "—")
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
            Icon(Icons.Check, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(15.dp))
            Spacer(Modifier.size(8.dp))
            Text(
                when {
                    overview == null -> "风险测评加载中…"
                    !overview.riskDone -> "尚未完成风险测评 · 申购前需先测评"
                    overview.riskLevel != null -> "风险测评 ${overview.riskLevel} · 有效至 ${overview.riskExpiresAt.take(10)}"
                    else -> "风险测评已完成"
                },
                fontSize = 12.sp,
                color = Tokens.Ink2,
            )
        }
    }
    Spacer(Modifier.height(10.dp))
    Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        QuickCard("产品市场", Icons.Pig, Modifier.weight(1f)) { onSwitch(1) }
        QuickCard("我的持仓", Icons.Wealth, Modifier.weight(1f)) { onSwitch(2) }
    }
    Spacer(Modifier.height(10.dp))
    Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        QuickCard("储蓄与计划", Icons.Receipt, Modifier.weight(1f)) { onOpenPlans() }
        QuickCard("交易记录", Icons.Transfer, Modifier.weight(1f)) { onSwitch(3) }
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

/** 产品分类中文名，与网页筛选口径一致。 */
private fun wealthCategoryLabel(code: String): String = when (code) {
    "cash" -> "现金管理"
    "fixed" -> "固定收益"
    "mixed" -> "混合"
    "equity" -> "权益"
    "derivative" -> "商品及衍生品"
    else -> code.ifEmpty { "理财" }
}

@Composable
private fun WealthProducts(catalog: List<WealthProductDto>, error: String?, onOpenProduct: (String) -> Unit) {
    var chip by remember { mutableIntStateOf(0) }
    ChipRow(listOf("全部", "现金管理", "固定收益", "混合", "权益", "商品"), chip) { chip = it }
    Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val shownProducts = if (catalog.isNotEmpty()) {
            catalog.map { dto ->
                Product(
                    name = dto.name,
                    risk = dto.risk,
                    metricLabel = if (dto.sevenDayYield != null) "七日年化" else "单位净值",
                    metric = if (dto.sevenDayYield != null) {
                        String.format("%.2f%%", dto.sevenDayYield * 100)
                    } else {
                        String.format("%.4f", dto.nav)
                    },
                    minAmount = formatCents(dto.minAmount),
                    term = dto.term.ifEmpty { if (dto.openEnded) "随时赎回" else "封闭期" },
                    meta = wealthCategoryLabel(dto.category) + " · " + if (dto.openEnded) "开放式" else "封闭期内不可赎回",
                    matched = true,
                    code = dto.code,
                )
            }
        } else {
            emptyList()
        }
        if (error != null && catalog.isEmpty()) {
            Text("产品目录加载失败：$error", fontSize = 11.sp, color = Tokens.Coral, modifier = Modifier.padding(bottom = 8.dp))
        }
        shownProducts.forEach { product ->
            HairlineCard {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpenProduct(product.code) }
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
private fun WealthHoldings(overview: WealthOverviewDto?, onRedeem: (HoldingDto) -> Unit) {
    var chip by remember { mutableIntStateOf(0) }
    ChipRow(listOf("全部", "可赎回", "封闭期"), chip) { chip = it }
    Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val shownHoldings = overview?.holdings?.map { dto ->
            Holding(
                name = dto.productName,
                risk = "—",
                marketValue = formatCents(dto.marketValue),
                shares = formatCents(dto.shares).removePrefix("¥"),
                pnl = formatCents(dto.profit),
                pnlUp = dto.profit >= 0,
                note = if (dto.closed) "封闭期内不可赎回" else "可赎回",
                redeemable = !dto.closed,
            ) to dto
        }.orEmpty()
        if (shownHoldings.isEmpty()) {
            Text(
                if (overview == null) "加载中…" else "暂无持仓",
                fontSize = 12.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(vertical = 16.dp),
            )
        }
        shownHoldings.forEach { (holding, dto) ->
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
                                    .clickable { onRedeem(dto) }
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
        EmptyNote("暂无理财记录\n申购与赎回成功后会出现在这里")
    }
}