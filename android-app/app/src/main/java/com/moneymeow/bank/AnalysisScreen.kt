package com.moneymeow.bank

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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

private data class Slice(val label: String, val amount: String, val percent: Float, val color: Color)

private val slices = listOf(
    Slice("房租", "¥1,120.00", 0.32f, Tokens.Primary),
    Slice("餐饮", "¥1,020.50", 0.29f, Color(0xFF5840C4)),
    Slice("购物", "¥860.00", 0.25f, Color(0xFF306FDB)),
    Slice("交通", "¥286.00", 0.08f, Color(0xFF8FA3B8)),
    Slice("订阅服务", "¥200.00", 0.06f, Tokens.Coral),
)

private val months = listOf("2026-10", "2026-09", "2026-08")

@Composable
fun AnalysisScreen(onBack: () -> Unit) {
    var month by remember { mutableIntStateOf(0) }
    var spending by remember { mutableStateOf<SpendingDto?>(null) }
    var cash by remember { mutableStateOf<CashFlowDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val monthsList = remember {
        val now = java.time.LocalDate.now()
        List(3) { now.minusMonths(it.toLong()).toString().take(7) }
    }
    LaunchedEffect(month) {
        if (!BankApi.hasToken()) return@LaunchedEffect
        runCatching { BankApi.spending(monthsList[month]) }
            .onSuccess { spending = it; error = null }
            .onFailure { error = it.message }
    }
    LaunchedEffect(Unit) {
        runCatching { BankApi.cashFlow(30) }.onSuccess { cash = it }
    }
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
                    Text("本月支出", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(5.dp))
                    Text(
                        spending?.let { formatCents(it.total) } ?: (error?.let { "—" } ?: "…"),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Ink,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        spending?.let { s ->
                            if (s.comparable && s.monthOverMonth != null) {
                                "较 ${s.previousMonth} " + (if (s.monthOverMonth >= 0) "↑ " else "↓ ") +
                                    String.format("%.1f%%", kotlin.math.abs(s.monthOverMonth) * 100)
                            } else {
                                "环比口径暂不可用"
                            }
                        } ?: "—",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                    )
                }
            }
            HairlineCard(Modifier.weight(1f)) {
                Column(Modifier.padding(13.dp)) {
                    val top = spending?.categories?.maxByOrNull { it.amount }
                    Text("最大支出分类", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(5.dp))
                    Text(top?.label ?: "—", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        top?.let { formatCents(it.amount) + " · 占比 " + String.format("%.0f%%", it.ratio * 100) } ?: "—",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                    )
                }
            }
        }

        SectionHeader("支出构成")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                DonutChart(spending)
                Spacer(Modifier.size(16.dp))
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    val slices = spending?.categories?.map { c ->
                        Slice(c.label, formatCents(c.amount), c.ratio.toFloat(), Tokens.Ink2)
                    } ?: slices
                    (spending?.categories?.map { it.ratio.toFloat() }?.let { ratios ->
                slices.mapIndexed { index, slice ->
                    slice.copy(percent = ratios.getOrElse(index) { slice.percent })
                }
            } ?: slices).forEach { slice ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier
                                    .size(8.dp)
                                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(2.dp))
                                    .background(slice.color)
                            )
                            Spacer(Modifier.size(7.dp))
                            Text(slice.label, fontSize = 11.5.sp, color = Tokens.Ink2, modifier = Modifier.weight(1f))
                            Text(slice.amount, fontSize = 11.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        }

        SectionHeader("近 6 个月走势", "人民币 CNY")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(120.dp)
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                val bars = listOf(0.78f, 0.86f, 0.74f, 0.94f, 0.82f, 0.72f)
                bars.forEachIndexed { index, ratio ->
                    Column(
                        Modifier.weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Bottom,
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(0.5f)
                                .height((ratio * 84).dp)
                                .clip(androidx.compose.foundation.shape.RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp))
                                .background(if (index == bars.lastIndex) Tokens.Primary else Tokens.Border)
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(listOf("5 月", "6 月", "7 月", "8 月", "9 月", "10 月")[index], fontSize = 9.5.sp, color = Tokens.Muted)
                    }
                }
            }
        }

        SectionHeader("现金流 · 近 30 天", "人民币 CNY")
        KvCard(
            listOf(
                "收入" to (cash?.let { "+" + formatCents(it.totalIncome) } ?: "—"),
                "支出" to (cash?.let { "-" + formatCents(it.totalExpense) } ?: "—"),
                "净流入" to (cash?.let { formatCents(it.totalIncome - it.totalExpense) } ?: "—"),
            ),
            Modifier.padding(horizontal = 14.dp),
        )
    }
}

@Composable
private fun DonutChart(spending: SpendingDto?) {
    Box(Modifier.size(118.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(118.dp)) {
            val stroke = Stroke(width = 34f)
            var start = -90f
            (spending?.categories?.map { it.ratio.toFloat() }?.let { ratios ->
                slices.mapIndexed { index, slice ->
                    slice.copy(percent = ratios.getOrElse(index) { slice.percent })
                }
            } ?: slices).forEach { slice ->
                val sweep = slice.percent * 360f
                drawArc(
                    color = slice.color,
                    startAngle = start,
                    sweepAngle = sweep - 1.5f,
                    useCenter = false,
                    style = stroke,
                    size = Size(size.width, size.height),
                )
                start += sweep
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(spending?.month?.takeLast(2)?.plus(" 月合计") ?: "本月合计", fontSize = 9.5.sp, color = Tokens.Muted)
            Text(
                spending?.let { formatCents(it.total) } ?: "—",
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Ink,
            )
        }
    }
}
