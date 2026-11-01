package com.moneymeow.bank

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate

/** 图表配色只用于区分分类，不代表固定分类金额。 */
private val categoryPalette = listOf(
    Tokens.Primary,
    Color(0xFF5840C4),
    Color(0xFF306FDB),
    Color(0xFF8FA3B8),
    Tokens.Coral,
    Color(0xFF3E7C59),
    Color(0xFFB58A2E),
    Color(0xFF7A5C9E),
)

@Composable
fun AnalysisScreen(onBack: () -> Unit) {
    var month by remember { mutableIntStateOf(0) }
    var spending by remember { mutableStateOf<SpendingDto?>(null) }
    var spendingLoading by remember { mutableStateOf(true) }
    var spendingError by remember { mutableStateOf<String?>(null) }
    var spendingReload by remember { mutableIntStateOf(0) }

    var cash by remember { mutableStateOf<CashFlowDto?>(null) }
    var cashLoading by remember { mutableStateOf(true) }
    var cashError by remember { mutableStateOf<String?>(null) }
    var cashReload by remember { mutableIntStateOf(0) }

    val monthsList = remember {
        val now = LocalDate.now(bankZone)
        List(3) { now.minusMonths(it.toLong()).toString().take(7) }
    }

    LaunchedEffect(month, spendingReload) {
        // 切月先清空旧数据，失败时不拿上个月的数字冒充本月。
        spendingLoading = true
        spending = null
        spendingError = null
        if (!BankApi.hasToken()) {
            spendingError = "登录已失效，请重新登录"
            spendingLoading = false
            return@LaunchedEffect
        }
        runCatching { BankApi.spending(monthsList[month]) }
            .onSuccess { spending = it }
            .onFailure { spendingError = it.message ?: "支出统计加载失败" }
        spendingLoading = false
    }

    LaunchedEffect(cashReload) {
        cashLoading = true
        cash = null
        cashError = null
        if (!BankApi.hasToken()) {
            cashError = "登录已失效，请重新登录"
            cashLoading = false
            return@LaunchedEffect
        }
        runCatching { BankApi.cashFlow(30) }
            .onSuccess { cash = it }
            .onFailure { cashError = it.message ?: "现金流加载失败" }
        cashLoading = false
    }

    val monthKey = monthsList[month]
    val currentMonth = month == 0
    val categories = spending?.categories.orEmpty()
    val top = categories.maxByOrNull { it.amount }
    val trend = spending?.trend.orEmpty()
    val selectedTrend = trend.firstOrNull { it.month == monthKey }

    PushScreen(title = "消费分析", onBack = onBack) {
        Box(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            SegTabs(monthsList, month) { month = it }
        }
        Row(
            Modifier.padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            HairlineCard(Modifier.weight(1f)) {
                Column(Modifier.padding(13.dp)) {
                    Text(
                        if (currentMonth) "本月支出 · 截至今天" else "$monthKey 支出",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                    )
                    Spacer(Modifier.height(5.dp))
                    Text(
                        when {
                            spendingLoading -> "…"
                            spendingError != null -> "—"
                            else -> formatCents(spending?.total ?: 0)
                        },
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Ink,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        when {
                            spendingLoading -> "加载中…"
                            spendingError != null -> "统计不可用"
                            spending?.comparable == true && spending?.monthOverMonth != null -> {
                                val s = spending!!
                                val change = s.monthOverMonth ?: 0.0
                                "较 ${s.previousMonth} " +
                                    (if (change >= 0) "↑ " else "↓ ") +
                                    String.format("%.1f%%", kotlin.math.abs(change) * 100)
                            }
                            else -> "无可比基数（上月无支出或数据不可比）"
                        },
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                    )
                }
            }
            HairlineCard(Modifier.weight(1f)) {
                Column(Modifier.padding(13.dp)) {
                    Text("最大支出分类", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(5.dp))
                    Text(
                        when {
                            spendingLoading -> "…"
                            spendingError != null -> "—"
                            top == null -> "暂无支出"
                            else -> top.label
                        },
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Ink,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        if (top == null) "—" else formatCents(top.amount) +
                            " · 占比 " + String.format("%.0f%%", top.ratio * 100),
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                    )
                }
            }
        }
        if (spendingError != null) {
            ErrorWithRetry("支出统计加载失败：$spendingError") { spendingReload++ }
        }

        SectionHeader("支出构成", "人民币 CNY")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            when {
                spendingLoading -> PaddingHint("加载中…")
                spendingError != null -> PaddingHint("支出构成不可用")
                categories.isEmpty() -> PaddingHint("${monthKey} 暂无支出分类")
                else -> Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    DonutChart(categories, spending?.total ?: 0, monthKey)
                    Spacer(Modifier.size(16.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        categories.forEachIndexed { index, category ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    Modifier
                                        .size(8.dp)
                                        .clip(RoundedCornerShape(2.dp))
                                        .background(categoryPalette[index % categoryPalette.size])
                                )
                                Spacer(Modifier.size(7.dp))
                                Text(
                                    category.label,
                                    fontSize = 11.5.sp,
                                    color = Tokens.Ink2,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    formatCents(category.amount),
                                    fontSize = 11.5.sp,
                                    color = Tokens.Ink,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                        }
                    }
                }
            }
        }

        SectionHeader(
            "近 6 个月走势",
            selectedTrend?.let { "人民币 CNY · ${formatCents(it.amount)}" } ?: "人民币 CNY",
        )
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            when {
                spendingLoading -> PaddingHint("加载中…")
                spendingError != null -> PaddingHint("走势不可用")
                trend.isEmpty() -> PaddingHint("暂无走势数据")
                else -> TrendBars(trend, monthKey)
            }
        }

        SectionHeader("现金流 · 近 30 天", "人民币 CNY")
        KvCard(
            listOf(
                "收入" to when {
                    cashLoading -> "…"
                    cashError != null -> "—"
                    else -> "+" + formatCents(cash?.totalIncome ?: 0)
                },
                "支出" to when {
                    cashLoading -> "…"
                    cashError != null -> "—"
                    else -> "-" + formatCents(cash?.totalExpense ?: 0)
                },
                "净流入" to when {
                    cashLoading -> "…"
                    cashError != null -> "—"
                    else -> formatCents((cash?.totalIncome ?: 0) - (cash?.totalExpense ?: 0))
                },
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        if (cashError != null) {
            ErrorWithRetry("现金流加载失败：$cashError") { cashReload++ }
        } else if (cashLoading) {
            Text(
                "加载中…",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )
        } else {
            Text(
                "含成功与清算中流水，排除账户内换汇；不合计外币。",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
                lineHeight = 15.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun PaddingHint(text: String) {
    Text(
        text,
        fontSize = 12.sp,
        color = Tokens.Muted,
        modifier = Modifier.padding(14.dp),
    )
}

@Composable
private fun ErrorWithRetry(text: String, onRetry: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text,
            fontSize = 11.sp,
            color = Tokens.Coral,
            lineHeight = 17.sp,
            modifier = Modifier.weight(1f),
        )
        Text(
            "重试",
            fontSize = 11.sp,
            color = Tokens.Ink2,
            fontWeight = FontWeight.Medium,
            modifier = Modifier
                .clickable { onRetry() }
                .padding(start = 10.dp),
        )
    }
}

/** 6 个月柱状走势使用服务端返回的真实金额，按最大值归一化；0 支出保留基线。 */
@Composable
private fun TrendBars(trend: List<TrendPointDto>, selectedMonth: String) {
    val max = trend.maxOfOrNull { it.amount } ?: 0L
    Row(
        Modifier
            .fillMaxWidth()
            .height(120.dp)
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        trend.forEach { point ->
            val ratio = if (max > 0) point.amount.toFloat() / max else 0f
            val selected = point.month == selectedMonth
            Column(
                Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Bottom,
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(0.5f)
                        .height(if (point.amount > 0) (ratio * 84).dp else 2.dp)
                        .clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp))
                        .background(if (selected) Tokens.Primary else Tokens.Border)
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    point.month.takeLast(2).trimStart('0') + " 月",
                    fontSize = 9.5.sp,
                    color = if (selected) Tokens.Ink2 else Tokens.Muted,
                )
            }
        }
    }
}

@Composable
private fun DonutChart(categories: List<SpendingCategoryDto>, total: Long, monthKey: String) {
    Box(Modifier.size(118.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(118.dp)) {
            val stroke = Stroke(width = 34f)
            var start = -90f
            categories.forEachIndexed { index, category ->
                val sweep = category.ratio.toFloat() * 360f
                if (sweep > 0f) {
                    drawArc(
                        color = categoryPalette[index % categoryPalette.size],
                        startAngle = start,
                        sweepAngle = (sweep - 1.5f).coerceAtLeast(0.5f),
                        useCenter = false,
                        style = stroke,
                        size = Size(size.width, size.height),
                    )
                }
                start += sweep
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(monthKey.takeLast(2).trimStart('0') + " 月合计", fontSize = 9.5.sp, color = Tokens.Muted)
            Text(
                formatCents(total),
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Ink,
            )
        }
    }
}
