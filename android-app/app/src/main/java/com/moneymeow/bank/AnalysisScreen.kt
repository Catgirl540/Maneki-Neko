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
    PushScreen(title = "消费分析", onBack = onBack) {
        Box(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            SegTabs(months, month) { month = it }
        }
        Row(
            Modifier.padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            HairlineCard(Modifier.weight(1f)) {
                Column(Modifier.padding(13.dp)) {
                    Text("本月支出", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(5.dp))
                    Text("¥3,486.50", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(4.dp))
                    Text("较 2026-09 ↓ 12.0%", fontSize = 11.sp, color = Tokens.Muted)
                }
            }
            HairlineCard(Modifier.weight(1f)) {
                Column(Modifier.padding(13.dp)) {
                    Text("最大支出分类", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(5.dp))
                    Text("房租", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(4.dp))
                    Text("¥1,120.00 · 占比 32%", fontSize = 11.sp, color = Tokens.Muted)
                }
            }
        }

        SectionHeader("支出构成")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                DonutChart()
                Spacer(Modifier.size(16.dp))
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    slices.forEach { slice ->
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
                "收入" to "+¥23,000.00",
                "支出" to "-¥12,486.50",
                "净流入" to "+¥10,513.50",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
    }
}

@Composable
private fun DonutChart() {
    Box(Modifier.size(118.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(118.dp)) {
            val stroke = Stroke(width = 34f)
            var start = -90f
            slices.forEach { slice ->
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
            Text("10 月合计", fontSize = 9.5.sp, color = Tokens.Muted)
            Text("¥3,486.50", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
        }
    }
}
