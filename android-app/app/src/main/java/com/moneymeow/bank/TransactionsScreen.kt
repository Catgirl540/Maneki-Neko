package com.moneymeow.bank

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate

private data class Tx(
    val id: String? = null,
    val name: String,
    val meta: String,
    val amount: String,
    val income: Boolean,
    val icon: ImageVector,
)

/** 交易列表筛选条件；分类/方向/日期都交给服务端，避免只过滤第一页。 */
private data class TxFilters(
    val direction: String = "all",
    val category: String = "all",
    val rangeDays: Int? = null,
    val currency: String = "all",
) {
    val activeLabels: List<String>
        get() = buildList {
            when (direction) {
                "out" -> add("支出")
                "in" -> add("收入")
            }
            if (category != "all") {
                txCategories.firstOrNull { it.first == category }?.let { add(it.second) }
            }
            rangeDays?.let { add("近 $it 天") }
            if (currency != "all") {
                currencyOptions.firstOrNull { it.second == currency }?.let { add(it.first) }
            }
        }

    fun toQuery(): TxQuery {
        val today = LocalDate.now(bankZone)
        return TxQuery(
            direction = direction.takeIf { it != "all" },
            category = category.takeIf { it != "all" },
            from = rangeDays?.let { today.minusDays((it - 1).toLong()).toString() },
            to = rangeDays?.let { today.toString() },
        )
    }
}

/** 分类 key 与中文名和 `BankApi.categoryLabel` 保持一致。 */
private val txCategories = listOf(
    "all" to "全部",
    "dining" to "餐饮",
    "shopping" to "购物",
    "housing" to "房租",
    "transport" to "交通",
    "subscription" to "订阅服务",
    "transfer" to "转账",
    "salary" to "工资入账",
    "other" to "其他",
)
private val chipCategories = listOf("all", "dining", "shopping", "housing", "transport", "subscription")
private val chipCategoryLabels = listOf("全部", "餐饮", "购物", "房租", "交通", "订阅")
private val rangeOptions = listOf("不限" to null, "近 7 天" to 7, "近 30 天" to 30, "近 90 天" to 90)
private val currencyOptions = listOf(
    "全部" to "all",
    "人民币 CNY" to "CNY",
    "港币 HKD" to "HKD",
    "美元 USD" to "USD",
)

@Composable
fun TransactionsScreen(onBack: () -> Unit, onAnalysis: () -> Unit, onOpenTx: (String?) -> Unit) {
    var filters by remember { mutableStateOf(TxFilters()) }
    var filterOpen by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableIntStateOf(0) }

    var partitions by remember { mutableStateOf<List<CurrencyPartition>>(emptyList()) }
    var partitionsReady by remember { mutableStateOf(false) }
    var accountError by remember { mutableStateOf<String?>(null) }

    var rows by remember { mutableStateOf<List<TxRecord>>(emptyList()) }
    var totalCount by remember { mutableIntStateOf(0) }
    var listError by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }

    var report by remember { mutableStateOf<MonthReport?>(null) }
    var reportError by remember { mutableStateOf<String?>(null) }
    var reportLoading by remember { mutableStateOf(true) }

    val summaryCurrency = if (filters.currency == "all") "CNY" else filters.currency

    // 币种分区按账户读取；列表参数使用分区 ID，而不是卡号或账户号。
    LaunchedEffect(reloadKey) {
        partitionsReady = false
        accountError = null
        if (!BankApi.hasToken()) {
            accountError = "登录已失效，请重新登录"
            partitionsReady = true
            return@LaunchedEffect
        }
        runCatching { BankApi.accounts().firstOrNull()?.partitions().orEmpty() }
            .onSuccess { partitions = it; partitionsReady = true }
            .onFailure {
                accountError = it.message ?: "账户加载失败"
                partitions = emptyList()
                partitionsReady = true
            }
    }

    LaunchedEffect(filters, partitions, partitionsReady, reloadKey) {
        if (!partitionsReady) return@LaunchedEffect
        if (accountError != null) {
            rows = emptyList()
            totalCount = 0
            loading = false
            return@LaunchedEffect
        }
        val selected = partitions.filter { filters.currency == "all" || it.currency == filters.currency }
        if (selected.isEmpty()) {
            rows = emptyList()
            totalCount = 0
            listError = null
            loading = false
            return@LaunchedEffect
        }
        loading = true
        listError = null
        runCatching { LedgerApi.recent(selected, size = 30, query = filters.toQuery()) }
            .onSuccess { page -> rows = page.items; totalCount = page.total }
            .onFailure { failure -> rows = emptyList(); totalCount = 0; listError = failure.message ?: "流水加载失败" }
        loading = false
    }

    // 月度收支用完整账本报表，不再把最近 30 笔流水当成整月。
    LaunchedEffect(summaryCurrency, reloadKey) {
        reportLoading = true
        report = null
        reportError = null
        if (!BankApi.hasToken()) {
            reportError = "登录已失效，请重新登录"
            reportLoading = false
            return@LaunchedEffect
        }
        val month = LocalDate.now(bankZone).toString().take(7)
        runCatching { LedgerApi.monthlyReport(month, summaryCurrency) }
            .onSuccess { report = it }
            .onFailure { failure -> reportError = failure.message ?: "统计加载失败" }
        reportLoading = false
    }

    val filtersActive = filters.activeLabels
    val chipIndex = chipCategories.indexOf(filters.category)

    Box(Modifier.fillMaxWidth()) {
        Column {
            PushScreen(title = "交易记录", onBack = onBack, action = "消费分析", onAction = onAnalysis) {
                Row(
                    Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    SummaryCard(
                        label = "本月支出 · ${currencyTitle(summaryCurrency)}",
                        value = when {
                            reportLoading -> "…"
                            reportError != null -> "—"
                            else -> formatCents(report?.totalExpense ?: 0, summaryCurrency)
                        },
                        negative = true,
                        modifier = Modifier.weight(1f),
                    )
                    SummaryCard(
                        label = "本月收入 · ${currencyTitle(summaryCurrency)}",
                        value = when {
                            reportLoading -> "…"
                            reportError != null -> "—"
                            else -> formatCents(report?.totalIncome ?: 0, summaryCurrency)
                        },
                        negative = false,
                        modifier = Modifier.weight(1f),
                    )
                }
                val reportHint = buildList {
                    when {
                        reportError != null -> add("本月统计加载失败：$reportError")
                        report != null -> add(
                            if (report?.periodStatus == "partial") {
                                "完整账本 · 截至 ${reportAsOfText(report!!)}"
                            } else {
                                "完整账本 · 全月"
                            }
                        )
                    }
                    if (filters.currency == "all") add("统计为人民币；其他币种请切换币种筛选")
                }
                if (reportHint.isNotEmpty()) {
                    Row(
                        Modifier.padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            reportHint.joinToString(" · "),
                            fontSize = 10.5.sp,
                            color = if (reportError != null) Tokens.Coral else Tokens.Muted,
                            lineHeight = 15.sp,
                            modifier = Modifier.weight(1f),
                        )
                        if (reportError != null) {
                            Text(
                                "重试",
                                fontSize = 11.sp,
                                color = Tokens.Ink2,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier
                                    .clickable { reloadKey++ }
                                    .padding(start = 8.dp),
                            )
                        }
                    }
                }

                ChipRow(
                    chipCategoryLabels,
                    chipIndex,
                    trailing = {
                        Box(
                            Modifier
                                .size(width = 34.dp, height = 32.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(if (filtersActive.isNotEmpty()) Tokens.Primary else Tokens.Surface),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Filter,
                                contentDescription = "筛选",
                                tint = if (filtersActive.isNotEmpty()) androidx.compose.ui.graphics.Color.White else Tokens.Ink2,
                                modifier = Modifier
                                    .size(16.dp)
                                    .clickable { filterOpen = true },
                            )
                        }
                    },
                ) { index -> filters = filters.copy(category = chipCategories[index]) }

                if (filtersActive.isNotEmpty()) {
                    Row(
                        Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "已筛选：${filtersActive.joinToString(" · ")}",
                            fontSize = 10.5.sp,
                            color = Tokens.Ink2,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "清除",
                            fontSize = 10.5.sp,
                            color = Tokens.Muted,
                            modifier = Modifier.clickable { filters = TxFilters() },
                        )
                    }
                }

                Column(Modifier.padding(horizontal = 14.dp)) {
                    when {
                        accountError != null -> LoadError("账户加载失败：$accountError") { reloadKey++ }
                        loading -> LoadHint("加载中…")
                        listError != null -> LoadError("流水加载失败：$listError") { reloadKey++ }
                        rows.isEmpty() -> LoadHint(
                            when {
                                partitions.isEmpty() -> "暂无资金账户或流水"
                                filters.currency != "all" &&
                                    partitions.none { it.currency == filters.currency } ->
                                    "当前资金账户没有${currencyTitle(filters.currency)}余额分区"
                                filtersActive.isNotEmpty() -> "没有符合筛选条件的流水"
                                else -> "暂无流水"
                            }
                        )
                        else -> {
                            Text(
                                if (totalCount > rows.size) "共 $totalCount 笔 · 显示最近 ${rows.size} 笔" else "共 $totalCount 笔",
                                fontSize = 10.5.sp,
                                color = Tokens.Muted,
                                modifier = Modifier.padding(top = 4.dp, bottom = 8.dp, start = 2.dp),
                            )
                            val grouped = rows.groupBy { bankDayKey(it.createdAt) }
                            grouped.entries.sortedByDescending { it.key ?: "" }.forEach { (day, list) ->
                                TxGroup(dayTitle(day), list.map { it.toRow() }, onOpenTx)
                                Spacer(Modifier.height(10.dp))
                            }
                        }
                    }
                }
            }
        }

        FilterDrawer(
            title = "筛选",
            groups = listOf(
                FilterGroup("收支", listOf("全部", "支出", "收入")),
                FilterGroup("分类", txCategories.map { it.second }),
                FilterGroup("时间范围", rangeOptions.map { it.first }),
                FilterGroup("币种", currencyOptions.map { it.first }),
            ),
            visible = filterOpen,
            onClose = { filterOpen = false },
            onApply = { applied ->
                filters = TxFilters(
                    direction = when (applied["收支"]) {
                        "支出" -> "out"
                        "收入" -> "in"
                        else -> "all"
                    },
                    category = txCategories.firstOrNull { it.second == (applied["分类"] ?: "全部") }?.first ?: "all",
                    rangeDays = rangeOptions.firstOrNull { it.first == (applied["时间范围"] ?: "不限") }?.second,
                    currency = currencyOptions.firstOrNull { it.first == (applied["币种"] ?: "全部") }?.second ?: "all",
                )
                filterOpen = false
            },
        )
    }
}

private fun currencyTitle(code: String): String = when (code) {
    "HKD" -> "港币 HKD"
    "USD" -> "美元 USD"
    else -> "人民币 CNY"
}

private fun reportAsOfText(report: MonthReport): String =
    parseBankTime(report.asOf)?.toLocalDate()?.let { "${it.monthValue}月${it.dayOfMonth}日" }
        ?: report.month

/** 日期分组标题按北京时间解析；解析失败明确显示“时间未知”。 */
private fun dayTitle(dayKey: String?): String {
    if (dayKey == null) return "时间未知"
    val date = runCatching { LocalDate.parse(dayKey) }.getOrNull() ?: return dayKey
    return bankDayLabel(date)
}

@Composable
private fun LoadHint(text: String) {
    Text(
        text,
        fontSize = 12.sp,
        color = Tokens.Muted,
        lineHeight = 18.sp,
        modifier = Modifier.padding(vertical = 16.dp),
    )
}

@Composable
private fun LoadError(text: String, onRetry: () -> Unit) {
    Row(
        Modifier.padding(vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text,
            fontSize = 12.sp,
            color = Tokens.Coral,
            lineHeight = 18.sp,
            modifier = Modifier.weight(1f),
        )
        Text(
            "重试",
            fontSize = 12.sp,
            color = Tokens.Ink2,
            fontWeight = FontWeight.Medium,
            modifier = Modifier
                .clickable { onRetry() }
                .padding(start = 10.dp),
        )
    }
}

@Composable
private fun SummaryCard(label: String, value: String, negative: Boolean, modifier: Modifier) {
    HairlineCard(modifier) {
        Column(Modifier.padding(13.dp)) {
            Text(label, fontSize = 11.sp, color = Tokens.Muted)
            Spacer(Modifier.height(5.dp))
            Text(
                value,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (negative) Tokens.Coral else Tokens.Ink,
            )
        }
    }
}

@Composable
private fun TxGroup(title: String, rows: List<Tx>, onOpenTx: (String?) -> Unit) {
    Text(title, fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(start = 2.dp, bottom = 4.dp))
    HairlineCard {
        Column(Modifier.padding(horizontal = 14.dp)) {
            rows.forEachIndexed { index, tx ->
                if (index > 0) Hairline()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpenTx(tx.id) }
                        .padding(vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(Tokens.SurfaceWarm),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(tx.icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(15.dp))
                    }
                    Spacer(Modifier.size(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(tx.name, fontSize = 13.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                        Text(tx.meta, fontSize = 10.5.sp, color = Tokens.Muted)
                    }
                    Text(
                        tx.amount,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (tx.income) Tokens.Ink else Tokens.Coral,
                    )
                }
            }
        }
    }
}

/** 更多服务：按侧栏四个分组铺开。 */
private data class ServiceGroup(val title: String, val items: List<Pair<String, ImageVector>>)

private val serviceGroups = listOf(
    ServiceGroup(
        "账户与支付",
        listOf(
            "账户资产" to Icons.Eye,
            "转账与支付" to Icons.Transfer,
            "收款与转入" to Icons.DownIn,
            "多币种换汇" to Icons.Globe,
            "银行卡管理" to Icons.Card,
            "存款" to Icons.Pig,
        ),
    ),
    ServiceGroup(
        "账单与资金",
        listOf(
            "账单与交易" to Icons.Receipt,
            "消费分析" to Icons.Wealth,
            "自动扣款" to Icons.UpOut,
            "工资与备用金" to Icons.DownIn,
            "借款与分期" to Icons.Card,
        ),
    ),
    ServiceGroup(
        "理财与储蓄",
        listOf(
            "理财总览" to Icons.Pig,
            "产品市场" to Icons.Wealth,
            "我的持仓" to Icons.Wealth,
            "储蓄与计划" to Icons.Pig,
            "理财记录" to Icons.Receipt,
        ),
    ),
    ServiceGroup(
        "个人与安全",
        listOf(
            "保险保障" to Icons.Shield,
            "安全设置" to Icons.Lock,
            "邀请与奖励" to Icons.Person,
            "会员中心" to Icons.Check,
        ),
    ),
)

@Composable
fun MoreScreen(onBack: () -> Unit, onOpen: (String) -> Unit) {
    PushScreen(title = "更多服务", onBack = onBack) {
        serviceGroups.forEach { group ->
            SectionHeader(group.title)
            Column(Modifier.padding(horizontal = 8.dp)) {
                group.items.chunked(4).forEach { row ->
                    Row(Modifier.fillMaxWidth()) {
                        row.forEach { (label, icon) ->
                            Column(
                                Modifier
                                    .weight(1f)
                                    .clickable { onOpen(label) }
                                    .padding(vertical = 10.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Box(
                                    Modifier
                                        .size(38.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Tokens.SurfaceWarm),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(19.dp))
                                }
                                Spacer(Modifier.height(7.dp))
                                Text(label, fontSize = 11.sp, color = Tokens.Ink2)
                            }
                        }
                        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

/** 后端流水转成列表行；金额带各自的币种符号，不跨币种混用。 */
private fun TxRecord.toRow(): Tx = Tx(
    id = id,
    name = counterparty.ifEmpty { memo.ifEmpty { "交易" } },
    meta = buildString {
        append(bankTimeText(createdAt) ?: "时间未知")
        append(" · ")
        append(BankApi.categoryLabel(category))
        statusHint()?.let { append(" · ").append(it) }
    },
    amount = (if (direction == "in") "+" else "-") + formatCents(amount, currency),
    income = direction == "in",
    icon = when (category) {
        "dining" -> Icons.Food
        "shopping" -> Icons.Shop
        "transport" -> Icons.Transfer
        "housing" -> Icons.Receipt
        "salary" -> Icons.DownIn
        else -> Icons.Receipt
    },
)

private fun TxRecord.statusHint(): String? = when {
    status == "failed" -> "失败"
    status == "pending" && pendingReason == "clearing" -> "清算中"
    status == "pending" && pendingReason == "inflight" -> "在途"
    status == "pending" -> "处理中"
    classificationState == "pending" -> "分类中"
    else -> null
}
