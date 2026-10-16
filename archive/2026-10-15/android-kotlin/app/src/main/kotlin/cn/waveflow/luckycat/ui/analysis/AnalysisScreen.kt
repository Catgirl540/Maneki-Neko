package cn.waveflow.luckycat.ui.analysis

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.domain.labels.WealthText
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 分析：本月支出构成 + 六个月趋势 + 现金流。
 *
 * 分类的**占比直接用后端给的 `ratio`**，不自己拿 amount 除总数——
 * 两边的分母口径必须一致（后端可能按"已分类支出"算，而总数含未分类）。
 * 自己算会出现"各项加起来 103%"这种解释不清的画面。
 */
@Composable
fun AnalysisScreen(state: AnalysisUiState, onRetry: () -> Unit) {
    val spending = state.spending
    if (state.loading && spending == null) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.testTag("analysis-loading"))
        }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("分析", style = MaterialTheme.typography.headlineSmall)

        state.error?.let {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f).testTag("analysis-error"),
                )
                TextButton(onClick = onRetry, modifier = Modifier.testTag("analysis-retry")) { Text("重试") }
            }
        }

        spending?.let { data ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(Palette.surface)
                    .padding(16.dp)
                    .testTag("analysis-total"),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("${data.month} 支出", style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft)
                Text(
                    Money.money(data.total),
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.testTag("analysis-total-value"),
                )
                Text(
                    monthOverMonthText(data.monthOverMonth),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (data.monthOverMonth > 0) Palette.expense else Palette.income,
                    modifier = Modifier.testTag("analysis-mom"),
                )
            }

            if (data.categories.isNotEmpty()) {
                SectionTitle("支出构成")
                data.categories.forEach { category ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Palette.surface)
                            .padding(12.dp)
                            .testTag("category-${category.key}"),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(category.label, style = MaterialTheme.typography.bodyMedium)
                            Text(Money.money(category.amount), style = MaterialTheme.typography.bodyMedium)
                        }
                        // 占比条：宽度来自后端给的 ratio，不自己算
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(3.dp))
                                .background(Palette.line),
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth(category.ratio.coerceIn(0.0, 1.0).toFloat())
                                    .height(6.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(Palette.accent),
                            )
                        }
                        Text(
                            WealthText.percent(category.ratio),
                            style = MaterialTheme.typography.bodySmall,
                            color = Palette.inkMute,
                            modifier = Modifier.testTag("category-ratio-${category.key}"),
                        )
                    }
                }
            }

            if (data.trend.isNotEmpty()) {
                SectionTitle("近六个月")
                TrendBars(data.trend.map { it.month to it.amount })
            }
        }

        state.cashFlow?.let { flow ->
            SectionTitle("近 ${flow.days} 天现金流")
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Palette.surface)
                    .padding(14.dp)
                    .testTag("cashflow"),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                AmountRow("收入", flow.totalIncome, Palette.income, "cashflow-income")
                AmountRow("支出", -flow.totalExpense, Palette.expense, "cashflow-expense")
                AmountRow(
                    "净流入",
                    state.net,
                    if (state.net < 0) Palette.expense else Palette.income,
                    "cashflow-net",
                )
            }
        }
    }
}

/** 「比上月少 29.2%」/「比上月多 12.0%」。 */
internal fun monthOverMonthText(ratio: Double): String {
    val formatted = String.format(java.util.Locale.US, "%.1f%%", kotlin.math.abs(ratio * 100))
    return when {
        ratio > 0 -> "比上月多 $formatted"
        ratio < 0 -> "比上月少 $formatted"
        else -> "与上月持平"
    }
}

@Composable
private fun TrendBars(points: List<Pair<String, Long>>) {
    val max = points.maxOfOrNull { it.second }?.takeIf { it > 0 } ?: 1
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(120.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.surface)
            .padding(12.dp)
            .testTag("analysis-trend"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        points.forEach { (month, amount) ->
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Bottom,
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(((amount.toDouble() / max) * 72).dp.coerceAtLeast(2.dp))
                        .clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp))
                        .background(Palette.accent),
                )
                Text(
                    month.takeLast(2),
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkMute,
                )
            }
        }
    }
}

@Composable
private fun AmountRow(label: String, amount: Long, color: Color, tag: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = Palette.inkSoft)
        Text(
            Money.moneySigned(amount),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = color,
            modifier = Modifier.testTag(tag),
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
}
