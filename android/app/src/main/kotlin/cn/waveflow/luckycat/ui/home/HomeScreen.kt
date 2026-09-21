package cn.waveflow.luckycat.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.contract.bank.Account
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.ui.theme.NavGlyph
import cn.waveflow.luckycat.ui.theme.NavIcon
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 首页：总资产 + 圆形入口宫格 + 账户列表。
 *
 * 三处参考了用户给的那套风格：
 *   1. **金额居中、超大、超粗**，头上一个可遮罩的小开关（点一下变 `＊＊＊＊`）——
 *      在公共场合打开银行 App，第一眼不该被别人看到余额；
 *   2. **四个圆形入口**排成一行图标宫格；
 *   3. **整页单列滚动**，不套 `LazyColumn`（下拉时不会出现"半屏卡住"的观感）。
 *
 * 空列表、加载中、出错三种状态都显式画出来。**出错时不清空已有数据**：
 * 刷新失败却把账户列表抹掉，用户会以为钱没了。
 */
@Composable
fun HomeScreen(
    state: HomeUiState,
    userName: String,
    onOpenAccount: (String) -> Unit,
    onSignOut: () -> Unit,
    onRetry: () -> Unit,
    onOpenSupport: () -> Unit,
    onOpenTransfer: () -> Unit = {},
    onOpenWealth: () -> Unit = {},
    onOpenCards: () -> Unit = {},
) {
    // 默认**显示**：一进来就是空白的余额更容易让人以为坏了
    var hidden by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("您好，$userName", style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = onSignOut, modifier = Modifier.testTag("home-sign-out")) { Text("退出") }
        }

        // ── 余额：居中、超大、可遮罩 ────────────────────────────────────
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("储蓄账户余额（演示数据）", style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
                TextButton(
                    onClick = { hidden = !hidden },
                    modifier = Modifier.testTag("home-toggle-balance"),
                ) {
                    Text(
                        if (hidden) "显示" else "隐藏",
                        style = MaterialTheme.typography.bodySmall,
                        color = Palette.accentDeep,
                    )
                }
            }
            Text(
                if (hidden) "＊＊＊＊" else Money.money(state.totalBalance),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = Palette.ink,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag("home-total"),
            )
        }

        // ── 圆形入口宫格 ────────────────────────────────────────────────
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            ActionTile("转账", NavIcon.Transfer, onOpenTransfer, "tile-transfer")
            ActionTile("客服", NavIcon.Support, onOpenSupport, "tile-support")
            ActionTile("理财", NavIcon.Wealth, onOpenWealth, "tile-wealth")
            ActionTile("卡片", NavIcon.Card, onOpenCards, "tile-cards")
        }

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
                    modifier = Modifier.weight(1f).testTag("home-error"),
                )
                TextButton(onClick = onRetry, modifier = Modifier.testTag("home-retry")) { Text("重试") }
            }
        }

        // 客服入口：它是这个产品的核心，首页再给一条显眼的
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Palette.accentTint)
                .clickable(onClick = onOpenSupport)
                .padding(16.dp)
                .testTag("home-open-support"),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("有问题问小招", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    "查余额、看流水、转账、理财，也可以发截图",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkSoft,
                )
            }
            Text("›", style = MaterialTheme.typography.titleLarge, color = Palette.accentDeep)
        }

        // ── 账户 ────────────────────────────────────────────────────────
        Text("我的账户", style = MaterialTheme.typography.titleMedium)

        when {
            state.loading && state.accounts.isEmpty() ->
                Box(modifier = Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(modifier = Modifier.testTag("home-loading"))
                }

            state.accounts.isEmpty() && state.error == null ->
                Text(
                    "还没有账户",
                    color = Palette.inkSoft,
                    modifier = Modifier.testTag("home-empty"),
                )

            else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                state.accounts.forEach { account ->
                    AccountRow(account = account, onClick = { onOpenAccount(account.id) })
                }
            }
        }
    }
}

/** 圆形入口：浅色圆底 + 主色图标 + 下方标签。 */
@Composable
private fun ActionTile(label: String, icon: NavIcon, onClick: () -> Unit, tag: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .testTag(tag),
    ) {
        Box(
            modifier = Modifier
                .size(56.dp)
                .clip(RoundedCornerShape(50))
                .background(Palette.accentTint),
            contentAlignment = Alignment.Center,
        ) {
            NavGlyph(icon = icon, color = Palette.accentDeep, size = 24.dp)
        }
        Text(label, style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft)
    }
}

@Composable
private fun AccountRow(account: Account, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Palette.surface)
            .clickable(onClick = onClick)
            .padding(16.dp)
            .testTag("account-${account.id}"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(account.label, style = MaterialTheme.typography.titleMedium)
            Text("年化 ${"%.2f".format(account.interestRate * 100)}%", style = MaterialTheme.typography.bodySmall, color = Palette.accentDeep)
        }
        // 卡号在演示数据里是完整的，界面上仍然按惯例打码——养成习惯比"反正是假的"重要
        Text(maskAccountNo(account.accountNo), style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(Money.money(account.balance), style = MaterialTheme.typography.titleLarge)
            Text(
                "本月 ${Money.moneySigned(account.monthNetChange)}",
                style = MaterialTheme.typography.bodySmall,
                color = if (account.monthNetChange < 0) Palette.expense else Palette.income,
            )
        }
    }
}

/** 只留前 4 位与后 4 位。与网页版的打码口径一致。 */
internal fun maskAccountNo(accountNo: String): String {
    if (accountNo.length <= 8) return accountNo
    return accountNo.take(4) + " **** " + accountNo.takeLast(4)
}
