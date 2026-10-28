package com.moneymeow.bank

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/* ─────────────────────────── 存款 ─────────────────────────── */

@Composable
fun DepositsScreen(onBack: () -> Unit, onTransferIn: () -> Unit, onTransferOut: () -> Unit) {
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        runCatching { BankApi.accounts() }
            .onSuccess { account = it.firstOrNull() }
            .onFailure { error = it.message }
        loading = false
    }
    val balances = account?.currencyBalances.orEmpty()
    PushScreen(title = "存款", onBack = onBack) {
        SectionHeader("活期存款", account?.let { "储蓄账户 ··${it.accountNo.takeLast(4)}" } ?: "储蓄账户")
        KvCard(
            buildList {
                balances.forEach { add(currencyName(it.currency) to formatCurrency(it.currency, it.balance)) }
                balances.firstOrNull { it.currency == "CNY" }?.let { add("人民币活期年利率" to "1.55%") }
                balances.firstOrNull { it.currency == "HKD" }?.let { add("港币活期年利率" to "1.25%") }
                if (balances.isEmpty()) {
                    add("账户余额" to when {
                        loading -> "加载中…"
                        error != null -> "加载失败"
                        else -> "暂无账户"
                    })
                }
            },
            Modifier.padding(horizontal = 14.dp),
        )
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(
                error!!,
                fontSize = 11.sp,
                color = Tokens.Coral,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SmallAction("转入", Icons.DownIn, Modifier.weight(1f), onTransferIn)
            SmallAction("转出", Icons.UpOut, Modifier.weight(1f), onTransferOut)
            SmallAction("利息流水", Icons.Receipt, Modifier.weight(1f)) { }
        }
        SectionHeader("定期存款")
        EmptyNote("暂无可用的定期存款产品\n当前仅提供活期存款")
    }
}

/** 币种中文名，与网页 `lib/format.ts` 的显示口径一致。 */
private fun currencyName(code: String): String = when (code) {
    "CNY" -> "人民币 CNY"
    "HKD" -> "港币 HKD"
    "USD" -> "美元 USD"
    "EUR" -> "欧元 EUR"
    "JPY" -> "日元 JPY"
    "GBP" -> "英镑 GBP"
    else -> code
}

private fun formatCurrency(code: String, cents: Long): String = when (code) {
    "CNY" -> formatCents(cents)
    else -> {
        val symbol = when (code) {
            "HKD" -> "HK$"
            "USD" -> "$"
            "EUR" -> "€"
            "JPY" -> "¥"
            "GBP" -> "£"
            else -> ""
        }
        symbol + formatCents(cents).removePrefix("¥")
    }
}

@Composable
private fun SmallAction(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, onClick: () -> Unit) {
    HairlineCard(modifier) {
        Column(
            Modifier
                .fillMaxWidth()
                .clickable { onClick() }
                .padding(vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(18.dp))
            Spacer(Modifier.height(7.dp))
            Text(label, fontSize = 11.5.sp, color = Tokens.Ink2)
        }
    }
}

@Composable
internal fun EmptyNote(text: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Tokens.Surface)
            .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
            .padding(vertical = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 12.sp, color = Tokens.Muted, lineHeight = 20.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/* ─────────────────────────── 换汇 ─────────────────────────── */

@Composable
fun ExchangeScreen(onBack: () -> Unit) {
    var amountText by remember { mutableStateOf("8000") }
    var quote by remember { mutableStateOf<ExchangeQuoteDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf(false) }
    var accountId by remember { mutableStateOf<String?>(null) }
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var password by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val amountCents = remember(amountText) {
        amountText.toDoubleOrNull()?.let { Math.round(it * 100) } ?: 0L
    }
    LaunchedEffect(Unit) {
        runCatching { BankApi.accounts().firstOrNull() }
            .onSuccess { account = it; accountId = it?.id }
    }
    LaunchedEffect(accountId, amountCents) {
        val id = accountId ?: return@LaunchedEffect
        if (amountCents <= 0) return@LaunchedEffect
        runCatching { BankApi.exchangeQuote(id, "HKD", amountCents) }
            .onSuccess { quote = it; error = null }
            .onFailure { error = it.message }
    }
    FormScaffold(title = "换汇", onBack = onBack, actionLabel = if (done) "已完成" else "确认换汇", onAction = {
        val id = accountId ?: return@FormScaffold
        val q = quote ?: return@FormScaffold
        if (password.length != 6) {
            error = "请输入 6 位支付密码"
            return@FormScaffold
        }
        scope.launch {
            runCatching { BankApi.exchange(q.quoteId, id, "HKD", amountCents, password) }
                .onSuccess { done = true; error = null }
                .onFailure { error = it.message }
        }
    }) {
        Box(Modifier.fillMaxWidth()) {
            HairlineCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Text("卖出", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(5.dp))
                    Text("¥ " + String.format("%,.2f", amountCents / 100.0), fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(7.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Tag("CNY")
                        Spacer(Modifier.size(6.dp))
                        Text(
                            account?.let { "储蓄账户 ··${it.accountNo.takeLast(4)}" } ?: "储蓄账户",
                            fontSize = 12.sp,
                            color = Tokens.Ink2,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            account?.let {
                                "可用 " + formatCents(it.currencyBalances.firstOrNull { b -> b.currency == "CNY" }?.balance ?: it.balance)
                            } ?: "可用 —",
                            fontSize = 11.sp,
                            color = Tokens.Muted,
                        )
                    }
                    Spacer(Modifier.height(16.dp))
                    Text("买入", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(5.dp))
                    Text(
                        quote?.let { "HK$ " + String.format("%,.2f", it.toAmount / 100.0) } ?: "—",
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Ink,
                    )
                    Spacer(Modifier.height(7.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Tag("HKD")
                        Spacer(Modifier.size(6.dp))
                        Text("港币活期", fontSize = 12.sp, color = Tokens.Ink2)
                    }
                    Spacer(Modifier.height(14.dp))
                    Hairline()
                    Spacer(Modifier.height(10.dp))
                    Text(
                        quote?.let { "参考汇率 1 CNY ≈ " + String.format("%.4f", it.rate) + " HKD，含点差，以成交时为准。" }
                            ?: "正在获取报价…",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        lineHeight = 18.sp,
                    )
                    if (error != null) {
                        Spacer(Modifier.height(8.dp))
                        Text(error!!, fontSize = 11.sp, color = Tokens.Coral)
                    }
                    Spacer(Modifier.height(12.dp))
                    TextFieldRow(
                        label = "支付密码",
                        value = password,
                        onValueChange = { password = it.filter(Char::isDigit).take(6) },
                        placeholder = "6 位支付密码",
                        password = true,
                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                    )
                }
            }
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 16.dp)
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(Tokens.SurfaceWarm)
                    .border(1.dp, Tokens.Border, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Transfer, contentDescription = "互换", tint = Tokens.Ink2, modifier = Modifier.size(16.dp).rotate(90f))
            }
        }
    }
}

/* ─────────────────────────── 交易详情 ─────────────────────────── */

@Composable
fun TxDetailScreen(onBack: () -> Unit, transactionId: String?) {
    var detail by remember { mutableStateOf<TransactionDetailDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(transactionId) {
        val id = transactionId ?: return@LaunchedEffect
        if (!BankApi.hasToken()) return@LaunchedEffect
        runCatching { BankApi.transaction(id) }
            .onSuccess { detail = it }
            .onFailure { error = it.message }
    }
    PushScreen(title = "交易详情", onBack = onBack) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(Tokens.Primary),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Food, contentDescription = null, tint = Color.White, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.height(12.dp))
            Text(
                detail?.let { (if (it.direction == "in") "+" else "-") + formatCents(it.amount) } ?: "—",
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Ink,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                detail?.let { it.counterparty + " · " + (if (it.status == "success") "交易成功" else it.status) }
                    ?: (error ?: "—"),
                fontSize = 12.5.sp,
                color = Tokens.Muted,
            )
        }
        KvCard(
            listOf(
                "交易时间" to (detail?.createdAt?.replace('T', ' ')?.take(19) ?: "—"),
                "交易类型" to (detail?.let { if (it.direction == "in") "收入" else "支出" } ?: "—"),
                "分类" to (detail?.let { BankApi.categoryLabel(it.category) } ?: "—"),
                "付款卡片" to (detail?.cardLast4?.let { "尾号 $it" } ?: "—"),
                "资金账户" to (detail?.accountLabel?.ifEmpty { "—" } ?: "—"),
                "交易号" to (detail?.referenceNo?.ifEmpty { detail?.id } ?: "—"),
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(14.dp))
        PrimaryButton("下载电子回单", {}, Modifier.padding(horizontal = 14.dp))
    }
}

/* ─────────────────────────── 寄送信息 ─────────────────────────── */

@Composable
fun DeliveryScreen(onBack: () -> Unit) {
    PushScreen(title = "寄送信息", onBack = onBack) {
        Spacer(Modifier.height(4.dp))
        KvCard(
            listOf(
                "银行卡" to "招财猫白金卡 · 尾号 4417",
                "收件人" to SessionStore.name().ifEmpty { "—" },
                "联系电话" to "138 **** 8000",
                "寄送地址" to "上海市徐汇区漕溪北路 88 号",
                "已收制卡费" to "¥50.00",
                "物流状态" to "已寄出 · 待签收",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
    }
}

/* ─────────────────────────── 会员等级 ─────────────────────────── */

@Composable
fun MembershipScreen(onBack: () -> Unit) {
    var membership by remember { mutableStateOf<MembershipDto?>(null) }
    LaunchedEffect(Unit) {
        if (BankApi.hasToken()) runCatching { BankApi.membership() }.onSuccess { membership = it }
    }
    val tierIndex = when (membership?.tier) {
        "gold" -> 1
        "platinum" -> 2
        "diamond" -> 3
        else -> 0
    }
    PushScreen(title = "会员等级", onBack = onBack) {
        SectionHeader("会员卡", (membership?.tierLabel ?: "普通会员") + " · 使用中")
        LazyRow(
            Modifier.fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val cards = listOf(
                R.drawable.member_standard to 0,
                R.drawable.member_gold to 1,
                R.drawable.member_platinum to 2,
                R.drawable.member_diamond to 3,
            )
            cards.forEach { (res, index) ->
                item { MemberCard(res, dimmed = index != tierIndex, current = index == tierIndex) }
            }
        }
        Spacer(Modifier.height(12.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("当前等级", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(5.dp))
                Text(
                    membership?.tierLabel ?: "普通会员",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Tokens.Ink,
                )
                Spacer(Modifier.height(12.dp))
                Hairline()
                Spacer(Modifier.height(10.dp))
                KvInline("上月日均资产", membership?.let { formatCents(it.aum) } ?: "—")
                KvInline(
                    "距下一档还差",
                    membership?.let { formatCents((it.nextThreshold - it.aum).coerceAtLeast(0)) } ?: "—",
                )
            }
        }
        SectionHeader("权益")
        KvCard(
            (membership?.benefits?.take(4)?.map { it to "已开通" } ?: listOf(
                "制卡费减免" to "每年 0 张",
                "换汇点差" to "标准价",
                "机场贵宾厅" to "—",
                "专属顾问" to "—",
            )),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            "等级按上月日均资产每月 1 号重算，实时达标当天升级；缺快照的日子按 0 计入日均。",
            fontSize = 11.sp,
            color = Tokens.Muted,
            lineHeight = 18.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

@Composable
private fun MemberCard(drawable: Int, dimmed: Boolean, current: Boolean = false) {
    Box(
        Modifier
            .width(296.dp)
            .aspectRatio(1.585f)
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
    ) {
        Image(
            painter = painterResource(drawable),
            contentDescription = null,
            modifier = Modifier.fillMaxWidth(),
            contentScale = ContentScale.Crop,
            alpha = if (dimmed) 0.55f else 1f,
        )
        if (current) {
            // 卡面右下空白区的升级进度
            Column(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 15.dp, bottom = 17.dp)
                    .width(116.dp)
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("距金卡", fontSize = 9.sp, color = Tokens.Ink.copy(alpha = 0.72f))
                    Text("88%", fontSize = 9.sp, color = Tokens.Ink.copy(alpha = 0.72f))
                }
                Spacer(Modifier.height(5.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(2.5.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Tokens.Ink.copy(alpha = 0.18f))
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(0.88f)
                            .height(2.5.dp)
                            .background(Tokens.Ink.copy(alpha = 0.6f))
                    )
                }
            }
        }
    }
}

/* ─────────────────────────── 储蓄与计划 ─────────────────────────── */

@Composable
fun PlansScreen(onBack: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    var savings by remember { mutableStateOf<SavingsDto?>(null) }
    LaunchedEffect(Unit) {
        if (BankApi.hasToken()) runCatching { BankApi.savingsOverview() }.onSuccess { savings = it }
    }
    PushScreen(title = "储蓄与计划", onBack = onBack) {
        Box(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
            SegTabs(listOf("存钱目标", "定投计划"), tab) { tab = it }
        }
        if (tab == 0) {
            Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val goals = savings?.goals.orEmpty()
                if (goals.isEmpty()) {
                    Text("暂无存钱目标", fontSize = 12.sp, color = Tokens.Muted)
                } else {
                    goals.forEach { goal ->
                        GoalCard(
                            name = goal.name,
                            deadline = if (goal.deadline.isNotEmpty()) "目标日 ${goal.deadline.take(10)}" else "无固定期限",
                            saved = formatCents(goal.savedAmount),
                            target = formatCents(goal.targetAmount),
                            ratio = if (goal.targetAmount > 0) {
                                (goal.savedAmount.toFloat() / goal.targetAmount).coerceIn(0f, 1f)
                            } else 0f,
                            sweep = if (goal.sweepText.isNotEmpty()) "归集设置 · ${goal.sweepText}" else "暂无归集设置",
                        )
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                SwitchRow(
                    "消费凑整",
                    savings?.roundupEnabled ?: false,
                    subtitle = savings?.let {
                        "凑整到 ${formatCents(it.roundupTo)} · 单日上限 ${formatCents(it.roundupDailyCap)}"
                    } ?: "—",
                ) { }
            }
            Spacer(Modifier.height(14.dp))
            PrimaryButton("新建存钱目标", {}, Modifier.padding(horizontal = 14.dp))
        } else {
            Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PlanCard("沪深 300 指数基金", "每月", "¥1,000", "11-01", "¥6,000", "运行中", "暂停")
                PlanCard("稳利纯债基金 A", "每月", "¥500", "11-15", "¥1,500", "已暂停", "恢复")
            }
            Spacer(Modifier.height(12.dp))
            EmptyNote("计划只保存规则\n自动扣款与执行尚未开放")
            Spacer(Modifier.height(14.dp))
            PrimaryButton("新建定投计划", {}, Modifier.padding(horizontal = 14.dp))
        }
    }
}

@Composable
internal fun GoalCard(name: String, deadline: String, saved: String, target: String, ratio: Float, sweep: String) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(3.dp))
                    Text(deadline, fontSize = 11.sp, color = Tokens.Muted)
                }
                Icon(Icons.Pig, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(16.dp))
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                Text(saved, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Text("目标 $target", fontSize = 11.5.sp, color = Tokens.Muted)
            }
            Spacer(Modifier.height(9.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(7.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(Tokens.SurfaceWarm)
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(ratio)
                        .height(7.dp)
                        .background(Tokens.Primary)
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(sweep, fontSize = 11.sp, color = Tokens.Muted)
                Text("${(ratio * 100).toInt()}%", fontSize = 11.sp, color = Tokens.Muted)
            }
        }
    }
}

@Composable
private fun PlanCard(name: String, freq: String, amount: String, next: String, total: String, status: String, action: String) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                RiskBadge(freq)
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                Metric("每期金额", amount)
                Metric("下次拟定", next)
                Metric("累计投入", total)
            }
            Spacer(Modifier.height(10.dp))
            Hairline()
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("定投计划 · $status", fontSize = 11.sp, color = Tokens.Muted)
                Text(action, fontSize = 11.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
internal fun Metric(label: String, value: String) {
    Column {
        Text(label, fontSize = 10.5.sp, color = Tokens.Muted)
        Spacer(Modifier.height(2.dp))
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
    }
}

/* ─────────────────────────── 我的 · 设置类二级页 ─────────────────────────── */

@Composable
fun SecurityScreen(onBack: () -> Unit) {
    var security by remember { mutableStateOf<SecurityDto?>(null) }
    var passwordOpen by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        if (BankApi.hasToken()) runCatching { BankApi.securityOverview() }.onSuccess { security = it }
    }
    PushScreen(title = "安全中心", onBack = onBack) {
        Spacer(Modifier.height(4.dp))
        KvCard(
            listOf(
                "安全评分" to (security?.let { "${it.score} · ${it.level}" } ?: "—"),
                "实名核验" to (security?.let { if (it.identityVerified) "已通过" else "未完成" } ?: "—"),
                "已登录设备" to (security?.let { "${it.devices.size} 台" } ?: "—"),
                "最近活跃设备" to (security?.devices?.firstOrNull()?.name ?: "—"),
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(12.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                SwitchRow("人脸识别登录", true, subtitle = "下次登录可用人脸代替密码") { }
                Hairline()
                SwitchRow("大额转账二次确认", true, subtitle = "超过 ¥50,000 需再次验证") { }
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SmallAction("修改登录密码", Icons.Lock, Modifier.weight(1f)) { passwordOpen = true }
            SmallAction("修改支付密码", Icons.Check, Modifier.weight(1f)) { }
            SmallAction("设备管理", Icons.Phone, Modifier.weight(1f)) { }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "支付密码连续输错 5 次会冻结账号，需联系工作人员解冻；重新登录或人脸核身均不能解除冻结。",
            fontSize = 12.sp,
            color = Tokens.Muted,
            lineHeight = 20.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        notice?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, fontSize = 12.sp, color = Tokens.Ink, modifier = Modifier.padding(horizontal = 16.dp))
        }
    }
    if (passwordOpen) {
        LoginPasswordDialog(
            onDismiss = { passwordOpen = false },
            onDone = {
                passwordOpen = false
                notice = "登录密码已更新，请在其他设备重新登录"
            },
        )
    }
}

@Composable
private fun LoginPasswordDialog(onDismiss: () -> Unit, onDone: () -> Unit) {
    var oldPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val validPassword = PasswordPolicy.isValid(newPassword)
    val canSubmit = !busy && oldPassword.isNotEmpty() && validPassword && newPassword == confirmation

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        containerColor = Tokens.Surface,
        title = { Text("修改登录密码", fontSize = 18.sp, color = Tokens.Ink) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("输入当前密码，再设置新的登录密码。", fontSize = 12.sp, color = Tokens.Muted)
                TextFieldRow(
                    label = "原密码", value = oldPassword,
                    onValueChange = { if (!busy) { oldPassword = it; error = null } },
                    placeholder = "请输入原密码", password = true,
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Password,
                )
                TextFieldRow(
                    label = "新密码", value = newPassword,
                    onValueChange = { if (!busy) { newPassword = it; error = null } },
                    placeholder = "至少 8 位", password = true,
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Password,
                )
                Text(
                    PasswordPolicy.requirements,
                    fontSize = 12.sp, lineHeight = 19.sp,
                    color = if (newPassword.isNotEmpty() && !validPassword) Tokens.Coral else Tokens.Muted,
                )
                TextFieldRow(
                    label = "确认新密码", value = confirmation,
                    onValueChange = { if (!busy) { confirmation = it; error = null } },
                    placeholder = "再次输入新密码", password = true,
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Password,
                )
                if (confirmation.isNotEmpty() && confirmation != newPassword) {
                    Text("两次输入的新密码不一致", fontSize = 12.sp, color = Tokens.Coral)
                }
                error?.let { Text(it, fontSize = 12.sp, color = Tokens.Coral) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = canSubmit,
                onClick = {
                    if (canSubmit) {
                        busy = true
                        error = null
                        scope.launch {
                            runCatching { BankApi.changeLoginPassword(oldPassword, newPassword) }
                                .onSuccess { onDone() }
                                .onFailure { error = it.message ?: "修改失败，请稍后重试" }
                            busy = false
                        }
                    }
                },
            ) { Text(if (busy) "修改中…" else "确认修改") }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = onDismiss) { Text("取消", color = Tokens.Ink2) }
        },
    )
}

@Composable
fun ProfileScreen(onBack: () -> Unit) {
    var profile by remember { mutableStateOf<ProfileDto?>(null) }
    LaunchedEffect(Unit) {
        if (BankApi.hasToken()) runCatching { BankApi.profile() }.onSuccess { profile = it }
    }
    PushScreen(title = "个人资料", onBack = onBack) {
        Spacer(Modifier.height(4.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(54.dp)
                    .clip(CircleShape)
                    .background(Tokens.SurfaceWarm)
                    .border(1.dp, Tokens.Border, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Image(painterResource(R.drawable.brand_cat), null, Modifier.size(44.dp), contentScale = ContentScale.Fit)
            }
            Spacer(Modifier.size(14.dp))
            Column {
                Text(profile?.name?.ifEmpty { "—" } ?: "—", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(3.dp))
                Text(profile?.phone ?: "—", fontSize = 12.sp, color = Tokens.Muted)
            }
        }
        KvCard(
            listOf(
                "姓名" to (profile?.name?.ifEmpty { "—" } ?: "—"),
                "手机号" to (profile?.phone ?: "—"),
                "身份证号" to (profile?.idNumberMasked?.ifEmpty { "—" } ?: "—"),
                "开户日期" to (profile?.openedAt?.take(10)?.ifEmpty { "—" } ?: "—"),
                "联系地址" to (profile?.address?.ifEmpty { "—" } ?: "—"),
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(14.dp))
        PrimaryButton("修改手机号", {}, Modifier.padding(horizontal = 14.dp))
    }
}

@Composable
fun ImScreen(onBack: () -> Unit) {
    PushScreen(title = "IM 连接", onBack = onBack) {
        SectionHeader("输入绑定码")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(14.dp)) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(46.dp)
                        .clip(CircleShape)
                        .background(Tokens.Surface)
                        .border(1.dp, Tokens.Border, CircleShape)
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text("例如 WX-8F2K", fontSize = 13.sp, color = Tokens.Muted)
                }
                Spacer(Modifier.height(12.dp))
                PrimaryButton("确认绑定", {})
            }
        }
        Spacer(Modifier.height(4.dp))
        KvCard(
            listOf("绑定状态" to "未绑定", "支持渠道" to "微信 / 企业微信"),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(12.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                SwitchRow("账户变动提醒", true, subtitle = "入账、转出、扣款成功时推送") { }
                Hairline()
                SwitchRow("提醒尚未启用", false, subtitle = "桥接服务未开启时不推送") { }
            }
        }
    }
}

@Composable
fun NotifySettingsScreen(onBack: () -> Unit) {
    PushScreen(title = "通知设置", onBack = onBack) {
        Spacer(Modifier.height(4.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                SwitchRow("交易通知", true, subtitle = "入账、转出、消费") { }
                Hairline()
                SwitchRow("安全提醒", true, subtitle = "新设备登录、密码变更") { }
                Hairline()
                SwitchRow("产品与活动", false, subtitle = "理财上新、会员权益") { }
            }
        }
    }
}

@Composable
fun LanguageScreen(onBack: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    PushScreen(title = "语言与地区", onBack = onBack) {
        SectionHeader("语言")
        Box(Modifier.padding(horizontal = 14.dp)) {
            SegTabs(listOf("简体中文", "English"), tab) { tab = it }
        }
        Spacer(Modifier.height(4.dp))
        KvCard(
            listOf("地区" to "中国大陆", "时区" to "北京时间 UTC+8", "记账币种" to "人民币 CNY"),
            Modifier.padding(horizontal = 14.dp),
        )
    }
}

@Composable
fun HelpScreen(onBack: () -> Unit) {
    PushScreen(title = "帮助与客服", onBack = onBack) {
        SectionHeader("常见问题")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                listOf(
                    "转账多久到账",
                    "如何提高单日限额",
                    "忘记支付密码怎么办",
                    "理财赎回什么时候到账",
                ).forEachIndexed { index, question ->
                    if (index > 0) Hairline()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(question, fontSize = 13.sp, color = Tokens.Ink)
                        Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(13.dp))
                    }
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton("联系在线客服", {}, Modifier.padding(horizontal = 14.dp))
    }
}

@Composable
fun AboutScreen(onBack: () -> Unit) {
    PushScreen(title = "关于", onBack = onBack) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(painterResource(R.drawable.brand_cat), null, Modifier.size(62.dp), contentScale = ContentScale.Fit)
            Spacer(Modifier.height(9.dp))
            Text("招财猫银行", fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
        }
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                UpdateRow()
                Hairline()
                IconRow(Icons.Receipt, "服务条款") { }
                Hairline()
                IconRow(Icons.Receipt, "隐私政策") { }
                Hairline()
                IconRow(Icons.Receipt, "开源许可") { }
            }
        }
    }
}

/** 通用「已受理」结果页（申请 / 赎回等）：黑底白勾 + 结果卡 + 贴底按钮。 */
@Composable
fun DoneScreen(
    title: String,
    headline: String,
    note: String,
    rows: List<Pair<String, String>>,
    actionLabel: String,
    onBack: () -> Unit,
    onAction: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Page),
    ) {
        TopBar(title, onBack)
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 26.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier
                        .size(62.dp)
                        .clip(CircleShape)
                        .background(Tokens.Primary),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(28.dp))
                }
                Spacer(Modifier.height(14.dp))
                Text(headline, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(6.dp))
                Text(note, fontSize = 12.5.sp, color = Tokens.Muted)
            }
            KvCard(rows, Modifier.padding(horizontal = 14.dp))
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
        ) {
            PrimaryButton(actionLabel, onAction)
        }
    }
}

/** 币种小标签。 */
@Composable
private fun Tag(text: String) {
    Box(
        Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Tokens.SurfaceWarm)
            .border(1.dp, Tokens.Border, RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(text, fontSize = 11.sp, color = Tokens.Ink2)
    }
}
