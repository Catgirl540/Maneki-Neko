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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import java.util.Locale

private data class ProductRow(
    val code: String,
    val name: String,
    val risk: String,
    val metricLabel: String,
    val metric: String,
    val minAmount: String,
    val term: String,
    val meta: String,
    val matched: Boolean,
    val matchLabel: String,
)

@Suppress("UNUSED_PARAMETER")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WealthTab(
    onOpenProduct: (String) -> Unit,
    onOpenPlans: () -> Unit,
    initialTab: Int = 0,
) {
    var tab by remember(initialTab) { mutableIntStateOf(initialTab) }
    var overview by remember { mutableStateOf<WealthOverviewDto?>(null) }
    var catalog by remember { mutableStateOf<List<WealthProductDto>>(emptyList()) }
    var accounts by remember { mutableStateOf<List<AccountDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshKey by remember { mutableIntStateOf(0) }

    var showRisk by remember { mutableStateOf(false) }
    var showOpen by remember { mutableStateOf(false) }

    var redeemTarget by remember { mutableStateOf<HoldingDto?>(null) }
    var redeemMode by remember { mutableIntStateOf(0) }
    var redeemSharesText by remember { mutableStateOf("") }
    var redeeming by remember { mutableStateOf(false) }
    var redeemError by remember { mutableStateOf<String?>(null) }
    var redeemResult by remember { mutableStateOf<WealthRedeemResultDto?>(null) }
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val redeemSheetState = rememberModalBottomSheetState()
    val resultSheetState = rememberModalBottomSheetState()

    LaunchedEffect(refreshKey, tab) {
        if (!BankApi.hasToken()) return@LaunchedEffect
        loading = overview == null
        error = null
        runCatching { BankApi.wealthOverview() }
            .onSuccess { overview = it }
            .onFailure { error = it.message }
        runCatching { BankApi.wealthProducts() }
            .onSuccess { catalog = it }
        runCatching { BankApi.accounts() }
            .onSuccess { accounts = it }
        loading = false
        refreshing = false
    }

    Column(Modifier.fillMaxSize()) {
        TabBar("理财", onRefresh = { if (!loading) { refreshing = true; BankApi.invalidateReads(); refreshKey++ } }, refreshing = loading)
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            SegTabs(listOf("总览", "产品", "持仓", "记录"), tab) { tab = it }
        }
        BankPullRefresh(
            isRefreshing = refreshing,
            onRefresh = {
                if (!refreshing) { refreshing = true; BankApi.invalidateReads(); refreshKey++ }
            },
            modifier = Modifier.weight(1f),
        ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 16.dp),
        ) {
            when (tab) {
                0 -> WealthOverviewContent(
                    overview = overview,
                    error = error,
                    loading = loading,
                    accounts = accounts,
                    onOpenAccount = { showOpen = true },
                    onRisk = { showRisk = true },
                    onOpenPlans = onOpenPlans,
                    onSwitch = { tab = it },
                )
                1 -> WealthProducts(
                    catalog = catalog,
                    riskLevel = overview?.riskLevel,
                    onOpenProduct = onOpenProduct,
                )
                2 -> WealthHoldings(
                    overview = overview,
                    loading = loading,
                    onBrowse = { tab = 1 },
                    onRedeem = { target ->
                        redeemMode = 0
                        redeemSharesText = formatShares(target.redeemableShares).replace(",", "")
                        redeemError = null
                        redeemTarget = target
                    },
                )
                else -> WealthRecords(accountId = overview?.settlementAccountId.orEmpty(), opened = overview?.opened == true, onBrowse = { tab = 1 })
            }
        }
        }
    }

    if (showOpen) {
        Dialog(
            onDismissRequest = { showOpen = false },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Tokens.Page)
                    .statusBarsPadding()
                    .navigationBarsPadding(),
            ) {
                WealthAccountOpeningScreen(
                    onBack = { showOpen = false },
                    onOpened = {
                        showOpen = false
                        refreshKey++
                    },
                )
            }
        }
    }

    if (showRisk) {
        Dialog(
            onDismissRequest = { showRisk = false },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Tokens.Page)
                    .statusBarsPadding()
                    .navigationBarsPadding(),
            ) {
                RiskAssessmentScreen(
                    onBack = { showRisk = false },
                    onCompleted = {
                        showRisk = false
                        refreshKey++
                    },
                )
            }
        }
    }

    val target = redeemTarget
    if (target != null) {
        ModalBottomSheet(
            onDismissRequest = { if (!redeeming) redeemTarget = null },
            sheetState = redeemSheetState,
            containerColor = Tokens.Surface,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text("赎回 · ${target.productName}", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                KvRow("持有市值", formatCents(target.marketValue))
                KvRow("持有份额", formatShares(target.shares))
                KvRow("可赎回份额", formatShares(target.redeemableShares))
                Spacer(Modifier.height(10.dp))
                ChipRow(listOf("全部赎回", "部分赎回"), redeemMode) { redeemMode = it }
                if (redeemMode == 1) {
                    SecureNumberField(
                        label = "本次赎回份额",
                        value = redeemSharesText,
                        onValueChange = { redeemSharesText = it },
                        placeholder = "最多 " + formatShares(target.redeemableShares),
                        allowDecimal = true,
                    )
                    Spacer(Modifier.height(10.dp))
                } else {
                    KvRow("本次赎回", formatShares(target.redeemableShares) + " 份（全部）")
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Tokens.SurfaceWarm)
                        .padding(12.dp),
                ) {
                    Text(
                        "最终到账金额、赎回费与清算方式以服务端逐笔确认结果为准。",
                        fontSize = 11.5.sp,
                        color = Tokens.Ink2,
                        lineHeight = 18.sp,
                    )
                }
                if (redeemError != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(redeemError!!, fontSize = 11.sp, color = Tokens.Coral, lineHeight = 18.sp)
                }
                Spacer(Modifier.height(16.dp))
                PrimaryButton(if (redeeming) "赎回中…" else "确认赎回", {
                    if (redeeming) return@PrimaryButton
                    val shares = if (redeemMode == 0) {
                        target.redeemableShares
                    } else {
                        redeemSharesText.toDoubleOrNull()
                    }
                    redeemError = when {
                        redeemMode == 1 && (shares == null || shares <= 0.0) -> "请输入本次赎回份额"
                        redeemMode == 1 && shares != null && shares > target.redeemableShares ->
                            "赎回份额不能超过可赎回份额"
                        else -> null
                    }
                    if (redeemError != null) return@PrimaryButton
                    redeeming = true
                    redeemError = null
                    scope.launch {
                        runCatching { BankApi.redeemWealthDetailed(target.id, shares) }
                            .onSuccess { result ->
                                redeemTarget = null
                                redeemResult = result
                                refreshKey++
                            }
                            .onFailure { redeemError = it.message ?: "赎回失败" }
                        redeeming = false
                    }
                })
                Spacer(Modifier.height(12.dp))
            }
        }
    }

    val result = redeemResult
    if (result != null) {
        ModalBottomSheet(
            onDismissRequest = { redeemResult = null },
            sheetState = resultSheetState,
            containerColor = Tokens.Surface,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text("赎回结果", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(4.dp))
                Text(
                    if (result.settlementMode == "sandbox-immediate") "演示资金已即时到账" else "已按服务端结果记账",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                )
                Spacer(Modifier.height(12.dp))
                KvRow("到账金额", formatCents(result.estimatedAmount))
                KvRow("赎回份额", formatShares(result.shares))
                KvRow("赎回费", formatCents(result.fees))
                KvRow("清算方式", if (result.settlementMode == "sandbox-immediate") "演示资金即时到账" else result.settlementMode.ifEmpty { "—" })
                KvRow("到账说明", result.etaText.ifEmpty { "—" })
                KvRow("确认时间", formatDateTime(result.settledAt.ifEmpty { result.acceptedAt }))
                Spacer(Modifier.height(8.dp))
                Text(
                    "以上为本次赎回的实际确认结果。",
                    fontSize = 10.5.sp,
                    color = Tokens.Muted,
                    lineHeight = 16.sp,
                )
                Spacer(Modifier.height(16.dp))
                PrimaryButton("完成", { redeemResult = null })
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

@Composable
private fun WealthOverviewContent(
    overview: WealthOverviewDto?,
    error: String?,
    loading: Boolean,
    accounts: List<AccountDto>,
    onOpenAccount: () -> Unit,
    onRisk: () -> Unit,
    onOpenPlans: () -> Unit,
    onSwitch: (Int) -> Unit,
) {
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("持仓市值", style = Tokens.Text.note)
                Spacer(Modifier.size(6.dp))
                Icon(Icons.Eye, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(15.dp))
            }
            Spacer(Modifier.height(6.dp))
            if (overview == null && loading) {
                SkeletonBox(Modifier.width(178.dp).height(27.dp), RoundedCornerShape(6.dp))
            } else {
                AmountText(
                    when {
                        overview != null -> formatCents(overview.totalValue)
                        error != null -> "加载失败"
                        else -> "—"
                    },
                    27,
                )
            }
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
    if (error != null) {
        Text(
            "理财数据加载失败：$error",
            fontSize = 11.sp,
            color = Tokens.Coral,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
            lineHeight = 17.sp,
        )
    }

    Spacer(Modifier.height(10.dp))
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("理财账户", style = Tokens.Text.note, modifier = Modifier.weight(1f))
                if (overview?.opened == true) {
                    Text("已开立", fontSize = 11.sp, color = Tokens.Ink2)
                }
            }
            Spacer(Modifier.height(6.dp))
            if (overview == null) {
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    SkeletonBox(Modifier.fillMaxWidth(0.4f).height(14.dp), RoundedCornerShape(4.dp))
                    SkeletonBox(Modifier.fillMaxWidth(0.8f).height(11.dp), RoundedCornerShape(4.dp))
                }
            } else if (!overview.opened) {
                Text("尚未开立理财账户", style = Tokens.Text.body, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(3.dp))
                Text(
                    "开立后才有投资资格；它不是第二个存款账户，申购扣款与赎回到账都走你的储蓄账户。",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                    lineHeight = 17.sp,
                )
                Spacer(Modifier.height(10.dp))
                PrimaryButton("开立理财账户", onOpenAccount)
            } else {
                val settlement = accounts.firstOrNull { it.id == overview.settlementAccountId }
                Text(
                    "理财账户 " + maskAccountNo(overview.wealthAccountNo),
                    fontSize = 13.sp,
                    color = Tokens.Ink,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    "结算资金账户：" + (settlement?.let { it.label + " · " + maskAccountNo(it.accountNo) } ?: "—"),
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                )
                Text(
                    "开户时间：" + formatDateTime(overview.wealthOpenedAt),
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                )
            }
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
            Icon(Icons.Shield, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(20.dp))
            Spacer(Modifier.size(8.dp))
            Column(Modifier.weight(1f)) {
                if (overview == null) {
                    SkeletonBox(Modifier.fillMaxWidth(0.7f).height(12.dp), RoundedCornerShape(4.dp))
                } else Text(
                    when {
                        !overview.riskValid && overview.riskExpired -> "风险测评已过期，需重新测评"
                        !overview.riskValid -> "尚未完成风险测评 · 申购前需先测评"
                        else -> "风险测评 " + toleranceText(overview.riskLevel) + " · 可购买 " +
                            (maxRiskFor(overview.riskLevel)?.let { "$it 及以下" } ?: "—")
                    },
                    fontSize = 12.sp,
                    color = Tokens.Ink2,
                    lineHeight = 18.sp,
                )
                if (overview?.riskValid == true) {
                    Text(
                        "有效期至 " + formatDate(overview.riskExpiresAt),
                        fontSize = 10.5.sp,
                        color = Tokens.Muted,
                    )
                }
            }
            if (overview != null) {
                GhostButton(if (overview.riskValid) "重新测评" else "去测评", onRisk)
            }
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
        Text(label, style = Tokens.Text.note)
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
                .padding(horizontal = 13.dp, vertical = 15.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.bolder(icon),
                contentDescription = null,
                tint = Tokens.Ink2,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.size(12.dp))
            Text(label, style = Tokens.Text.body)
        }
    }
}

@Composable
private fun WealthProducts(
    catalog: List<WealthProductDto>,
    riskLevel: String?,
    onOpenProduct: (String) -> Unit,
) {
    var chip by remember { mutableIntStateOf(0) }
    val categories = listOf("all", "cash", "fixed", "mixed", "equity", "derivative")
    ChipRow(listOf("全部", "现金管理", "固定收益", "混合", "权益", "商品"), chip) { chip = it }
    PageColumn {
        val shownProducts = catalog
            .filter { categories.getOrNull(chip) == "all" || it.category == categories.getOrNull(chip) }
            .map { dto ->
                val matched = canBuyRisk(riskLevel, dto.risk)
                ProductRow(
                    code = dto.code,
                    name = dto.name,
                    risk = dto.risk,
                    metricLabel = if (dto.sevenDayYield != null) "七日年化" else "单位净值",
                    metric = if (dto.sevenDayYield != null) {
                        formatRate(dto.sevenDayYield)
                    } else {
                        formatNav(dto.nav)
                    },
                    minAmount = formatCents(dto.minAmount),
                    term = dto.term.ifEmpty { if (dto.openEnded) "随时赎回" else "封闭期" },
                    meta = wealthCategoryName(dto.category) + " · " + if (dto.openEnded) "开放式" else "封闭期内不可赎回",
                    matched = matched,
                    matchLabel = when {
                        riskLevel == null -> "需先完成风险测评"
                        matched -> "风险匹配"
                        else -> "超出风险承受能力"
                    },
                )
            }
        if (shownProducts.isEmpty()) {
            Text(
                "暂无产品",
                fontSize = 12.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(vertical = 16.dp),
            )
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
                        Text(product.meta, style = Tokens.Text.hint)
                        Text(
                            product.matchLabel,
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
        Text(label, style = Tokens.Text.caption)
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
private fun WealthHoldings(
    overview: WealthOverviewDto?,
    loading: Boolean,
    onBrowse: () -> Unit,
    onRedeem: (HoldingDto) -> Unit,
) {
    var chip by remember { mutableIntStateOf(0) }
    ChipRow(listOf("全部", "可赎回", "封闭期"), chip) { chip = it }
    PageColumn {
        val all = overview?.holdings.orEmpty()
        val shownHoldings = when (chip) {
            1 -> all.filter { !it.closed && it.redeemableShares > 0 }
            2 -> all.filter { it.closed }
            else -> all
        }
        if (shownHoldings.isEmpty()) {
            if (loading && overview == null) SkeletonCardLines()
            else BankEmptyState(if (overview == null) "持仓暂不可用" else if (all.isEmpty()) "还没有理财持仓" else "当前分类暂无持仓",
                if (overview == null) "请刷新后查看。" else "了解产品风险与期限，再选择适合自己的产品。", Icons.Portfolio,
                if (overview != null) "去产品市场" else null, if (overview != null) onBrowse else null)
        }
        shownHoldings.forEach { dto ->
            val redeemable = !dto.closed && dto.redeemableShares > 0
            HairlineCard {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            dto.productName,
                            fontSize = 13.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Tokens.Ink,
                            modifier = Modifier.weight(1f),
                        )
                        RiskBadge(dto.risk)
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        MetricBlock("市值", formatCents(dto.marketValue))
                        MetricBlock("份额", formatShares(dto.shares))
                        Column {
                            Text("盈亏", style = Tokens.Text.caption)
                            Spacer(Modifier.height(2.dp))
                            Text(
                                formatCents(dto.profit) + "（" + String.format(Locale.US, "%.2f%%", dto.profitRate * 100) + "）",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (dto.profit >= 0) Tokens.Ink else Tokens.Coral,
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "本金 " + formatCents(dto.principal) + " · 买入 " + formatDateTime(dto.purchasedAt),
                        fontSize = 10.5.sp,
                        color = Tokens.Muted,
                    )
                    Spacer(Modifier.height(10.dp))
                    Hairline()
                    Spacer(Modifier.height(10.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            when {
                                !dto.closed -> "可赎回 " + formatShares(dto.redeemableShares) + " 份"
                                dto.redeemableAt != null -> "封闭期至 " + formatDate(dto.redeemableAt) + " 后可赎回"
                                else -> "封闭期内不可赎回"
                            },
                            fontSize = 11.sp,
                            color = Tokens.Muted,
                        )
                        if (redeemable) {
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
                            Text("暂不可赎回", style = Tokens.Text.hint)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WealthRecords(accountId: String, opened: Boolean, onBrowse: () -> Unit) {
    var kind by remember { mutableIntStateOf(0) }
    var page by remember(kind) { mutableIntStateOf(1) }
    var records by remember { mutableStateOf<List<TxRecord>>(emptyList()) }
    var total by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    LaunchedEffect(accountId, kind, page, refresh) {
        records = emptyList(); failure = null
        if (!opened || accountId.isBlank()) return@LaunchedEffect
        loading = true
        runCatching { LedgerApi.transactions(accountId, page, 10, TxQuery(category = "other", keyword = if (kind == 0) "申购 · " else "赎回 · ")) }
            .onSuccess { records = it.items; total = it.total }
            .onFailure { failure = it.message ?: "理财记录加载失败" }
        loading = false
    }
    PageColumn {
        ChipRow(listOf("申购", "赎回"), kind) { kind = it }
        when {
            !opened -> EmptyNote("开立理财账户后可查看申购与赎回记录")
            loading -> SkeletonCardList()
            failure != null -> { Text(failure!!, color = Tokens.Coral, fontSize = 12.sp); GhostButton("重试", { refresh++ }) }
            records.isEmpty() -> BankEmptyState("暂无理财记录", "成功申购或赎回后的资金记录会显示在这里。", Icons.Hist, "去产品市场", onBrowse)
            else -> {
                Text("资金记账记录，以实际份额和到账回执为准", style = Tokens.Text.hint)
                records.forEach { tx -> HairlineCard {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(tx.counterparty, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                        Text("${formatCents(tx.amount, tx.currency)} · ${tx.createdAt}", style = Tokens.Text.hint)
                    }
                } }
                Row {
                    androidx.compose.material3.TextButton(enabled = page > 1, onClick = { page-- }) { Text("上一页") }
                    Text("第 $page 页 · 共 $total 笔", fontSize = 11.sp, modifier = Modifier.padding(top = 12.dp))
                    androidx.compose.material3.TextButton(enabled = page * 10 < total, onClick = { page++ }) { Text("下一页") }
                }
            }
        }
    }
}
