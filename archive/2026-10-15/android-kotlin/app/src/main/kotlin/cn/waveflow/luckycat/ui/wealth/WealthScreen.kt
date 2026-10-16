package cn.waveflow.luckycat.ui.wealth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.contract.bank.WealthHolding
import cn.waveflow.luckycat.contract.bank.WealthProduct
import androidx.compose.material3.Button
import cn.waveflow.luckycat.domain.account.WealthOpening
import cn.waveflow.luckycat.domain.labels.Labels
import cn.waveflow.luckycat.domain.labels.WealthText
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.domain.time.Dates
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 理财。
 *
 * 三条与合规有关的显示规则，改代码时别动：
 *
 * 1. **业绩比较基准渲染成区间**（`1.60% ~ 2.10%`），不挑一个数字当"收益率"——
 *    它不是承诺收益。
 * 2. **不保本要显眼**。"产品名称 → 风险等级 → 是否保本"这个顺序是刻意的，
 *    用户扫一眼就该知道这东西可能亏。
 * 3. **理财账户没开立时明确提示**，而不是让用户点了才发现走不通。
 */
@Composable
fun WealthScreen(state: WealthUiState, onRetry: () -> Unit, onOpenAccount: () -> Unit = {}) {
    if (state.loading && state.overview == null) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.testTag("wealth-loading"))
        }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("理财", style = MaterialTheme.typography.headlineSmall)

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
                    modifier = Modifier.weight(1f).testTag("wealth-error"),
                )
                TextButton(onClick = onRetry, modifier = Modifier.testTag("wealth-retry")) { Text("重试") }
            }
        }

        state.overview?.takeIf { it.account.opened }?.let { overview ->
            OverviewCard(
                totalValue = overview.totalValue,
                totalProfit = overview.totalProfit,
                yesterdayProfit = overview.yesterdayProfit,
                accountOpened = overview.account.opened,
            )
        }

        // **未开立理财账户是一道闸门**，不是一个提示。
        // 银行账户 ≠ 理财账户：这里要把差别、要做的三件事、以及
        // "产品超市现在就能看"都说清楚，用户才知道点下去意味着什么。
        if (state.overview != null && !state.accountOpened) {
            GateCard(onOpenAccount = onOpenAccount)
        }

        val holdings = state.openHoldings
        if (holdings.isNotEmpty()) {
            SectionTitle("我的持仓")
            holdings.forEach { HoldingRow(it) }
        }

        SectionTitle("在售产品")
        state.products.forEach { ProductRow(it) }

        Text(
            "演示数据。理财非存款、产品有风险、投资须谨慎。",
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkMute,
            modifier = Modifier.testTag("wealth-disclaimer"),
        )
    }
}

@Composable
private fun OverviewCard(
    totalValue: Long,
    totalProfit: Long,
    yesterdayProfit: Long,
    accountOpened: Boolean,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.surface)
            .padding(16.dp)
            .testTag("wealth-overview"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("总市值", style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft)
        Text(
            Money.money(totalValue),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.testTag("wealth-total"),
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            ProfitCell("累计收益", totalProfit, "wealth-profit")
            ProfitCell("昨日收益", yesterdayProfit, "wealth-yesterday")
        }
        if (!accountOpened) {
            Text(
                "还没有理财账户",
                style = MaterialTheme.typography.bodySmall,
                color = Palette.accentDeep,
                modifier = Modifier.testTag("wealth-account-closed"),
            )
        }
    }
}

/**
 * 未开立理财账户时的闸门。
 *
 * 不是一句"请先开户"就完了：要讲清**为什么要单独开**（银行账户 ≠ 理财账户）、
 * **要经过哪三步**，以及**现在就能看产品**——最后这条决定了用户
 * 是"先去开户"还是"先逛逛再说"。
 */
@Composable
private fun GateCard(onOpenAccount: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.surface)
            .padding(16.dp)
            .testTag("wealth-gate"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("还没有理财账户", style = MaterialTheme.typography.titleMedium)
        Text(
            "银行账户是装钱的地方，理财账户才是买理财的资格。理财账户不装钱，" +
                "它把「你」和理财公司之间的委托关系立起来，申购扣款与赎回到账都走你指定的资金账户。",
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkSoft,
        )
        WealthOpening.STEPS.forEachIndexed { index, (title, desc) ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${index + 1}", style = MaterialTheme.typography.bodySmall, color = Palette.accentDeep)
                Column {
                    Text(title, style = MaterialTheme.typography.bodyMedium)
                    Text(desc, style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
                }
            }
        }
        Button(
            onClick = onOpenAccount,
            modifier = Modifier.fillMaxWidth().testTag("wealth-open-account"),
        ) {
            Text("开立理财账户")
        }
        Text(
            "开立后可以申购理财产品；产品超市现在就可以看。",
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkMute,
        )
    }
}

@Composable
private fun ProfitCell(label: String, profit: Long, tag: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft)
        Text(
            Money.moneySigned(profit),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = if (WealthText.isLoss(profit)) Palette.expense else Palette.income,
            modifier = Modifier.testTag(tag),
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
}

@Composable
private fun HoldingRow(holding: WealthHolding) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.surface)
            .padding(14.dp)
            .testTag("holding-${holding.id}"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(holding.productName, style = MaterialTheme.typography.bodyLarge)
            Text(
                Money.money(holding.marketValue),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                "${Labels.risk(holding.risk)} · 本金 ${Money.money(holding.principal)}",
                style = MaterialTheme.typography.bodySmall,
                color = Palette.inkMute,
            )
            Text(
                Money.moneySigned(holding.profit),
                style = MaterialTheme.typography.bodySmall,
                color = if (WealthText.isLoss(holding.profit)) Palette.expense else Palette.income,
            )
        }
        if (holding.purchasedAt.isNotEmpty()) {
            Text(
                "买入于 ${Dates.date(holding.purchasedAt)}",
                style = MaterialTheme.typography.bodySmall,
                color = Palette.inkMute,
            )
        }
    }
}

@Composable
private fun ProductRow(product: WealthProduct) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.surface)
            .padding(14.dp)
            .testTag("product-${product.code}"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(product.name, style = MaterialTheme.typography.bodyLarge)
            Text(
                Labels.risk(product.risk),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.accentDeep,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                Labels.wealthCategory(product.category),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.inkMute,
            )
            Text(
                // **不要写 Markdown 的星号**：Compose 不解析 Markdown，
                // 写了就会把 `**` 原样显示出来（实测踩到）。强调靠颜色和位置做。
                if (product.principalProtected) "保本" else "不保本",
                style = MaterialTheme.typography.bodySmall,
                color = if (product.principalProtected) Palette.income else Palette.expense,
                modifier = Modifier.testTag("principal-${product.code}"),
            )
        }
        Text(
            // 区间，不是承诺收益
            "业绩比较基准 ${WealthText.benchmark(product.benchmark.kind, product.benchmark.low, product.benchmark.high)}",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.testTag("benchmark-${product.code}"),
        )
        Text(
            "${Money.money(product.minAmount)} 起购 · ${product.term.ifEmpty { "—" }}",
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkMute,
        )
        if (product.benchmark.basis.isNotEmpty()) {
            Text(
                product.benchmark.basis,
                style = MaterialTheme.typography.bodySmall,
                color = Palette.inkMute,
            )
        }
    }
}
