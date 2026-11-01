package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate

/** 通知的真实来源只有银行流水与自动扣款预告；银行卡、安全、服务类没有后端来源。 */
private enum class NoticeType(val label: String) {
    ALL("全部"),
    TRANSACTION("交易"),
    CARD("银行卡"),
    REMINDER("提醒"),
    SECURITY("安全"),
    SERVICE("服务通知"),
}

private enum class NoticeKind { TRANSACTION, DEBIT }

private data class Notice(
    val title: String,
    val body: String,
    val time: String,
    val day: String,
    val date: LocalDate?,
    val icon: ImageVector,
    val kind: NoticeKind,
)

private data class NoticeFilters(
    val type: NoticeType = NoticeType.ALL,
    val rangeDays: Int? = null,
) {
    val activeLabels: List<String>
        get() = buildList {
            if (type != NoticeType.ALL) add(type.label)
            rangeDays?.let { add("近 $it 天") }
        }
}

private val noticeTypeOptions = listOf("全部", "交易", "银行卡", "提醒", "安全", "服务通知")
private val noticeRangeOptions = listOf("不限" to null, "近 7 天" to 7, "近 30 天" to 30, "近 90 天" to 90)
private val noticeChips = listOf(
    NoticeType.ALL,
    NoticeType.TRANSACTION,
    NoticeType.CARD,
    NoticeType.REMINDER,
    NoticeType.SECURITY,
)

/** 通知由真实流水与自动扣款推导，不预置示例消息。 */
private fun buildNotices(
    transactions: List<TxRecord>,
    debits: List<AutoDebitDto>,
    today: LocalDate,
): List<Notice> {
    val fromTx = transactions.map { dto ->
        val incoming = dto.direction == "in"
        val date = parseBankTime(dto.createdAt)?.toLocalDate()
        Notice(
            title = if (incoming) "转入到账" else BankApi.categoryLabel(dto.category) + "消费",
            body = dto.counterparty.ifEmpty { dto.memo.ifEmpty { "交易" } } +
                " " + (if (incoming) "+" else "-") + formatCents(dto.amount, dto.currency),
            time = bankTimeText(dto.createdAt) ?: "时间未知",
            day = date?.let { bankDayLabel(it, today) } ?: "时间未知",
            date = date,
            icon = if (incoming) Icons.DownIn else Icons.UpOut,
            kind = NoticeKind.TRANSACTION,
        )
    }
    val fromDebits = debits.filter { it.enabled }.mapNotNull { dto ->
        // 只看还没发生的扣款；已过期的 nextRunAt 不当作预告。
        val next = parseBankTime(dto.nextRunAt) ?: return@mapNotNull null
        val date = next.toLocalDate()
        if (date.isBefore(today)) return@mapNotNull null
        Notice(
            title = "自动扣款预告",
            body = "「${dto.merchant}」将于 ${date.monthValue}月${date.dayOfMonth}日 扣款 ${formatCents(dto.amount)}。",
            time = "${date.monthValue}月${date.dayOfMonth}日",
            day = "待扣款提醒",
            date = date,
            icon = Icons.Receipt,
            kind = NoticeKind.DEBIT,
        )
    }.sortedBy { it.date }
    // 待扣款是“还没发生的事”，放最前面；流水已按真实时间倒序。
    return fromDebits + fromTx
}

@Composable
fun NotifyTab(onOpenFilter: () -> Unit) {
    var filters by remember { mutableStateOf(NoticeFilters()) }
    var filterOpen by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableIntStateOf(0) }

    var notices by remember { mutableStateOf<List<Notice>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    // 两类来源分别记录失败原因：任一失败都不能伪装成“没有提醒”。
    var txError by remember { mutableStateOf<String?>(null) }
    var debitError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(reloadKey) {
        loading = true
        txError = null
        debitError = null
        if (!BankApi.hasToken()) {
            txError = "登录已失效，请重新登录"
            notices = emptyList()
            loading = false
            return@LaunchedEffect
        }
        var transactions: List<TxRecord> = emptyList()
        runCatching {
            val partitions = BankApi.accounts().firstOrNull()?.partitions().orEmpty()
            if (partitions.isEmpty()) emptyList() else LedgerApi.recent(partitions, size = 10).items
        }
            .onSuccess { transactions = it }
            .onFailure { txError = it.message ?: "交易通知加载失败" }

        var debits: List<AutoDebitDto> = emptyList()
        runCatching { BankApi.autoDebits() }
            .onSuccess { debits = it }
            .onFailure { debitError = it.message ?: "扣款提醒加载失败" }

        notices = buildNotices(transactions, debits, LocalDate.now(bankZone))
        loading = false
    }

    val chipsSelected = noticeChips.indexOf(filters.type)
    val today = LocalDate.now(bankZone)
    val rangeDays = filters.rangeDays
    // 流水看过去 N 天，待扣款看未来 N 天；两类都不拿“今天”给无日期记录兜底。
    val cutoff = rangeDays?.let { today.minusDays((it - 1).toLong()) }
    val windowEnd = rangeDays?.let { today.plusDays((it - 1).toLong()) }
    val typeNotices = when (filters.type) {
        NoticeType.ALL -> notices
        NoticeType.TRANSACTION -> notices.filter { it.kind == NoticeKind.TRANSACTION }
        NoticeType.REMINDER -> notices.filter { it.kind == NoticeKind.DEBIT }
        NoticeType.CARD, NoticeType.SECURITY, NoticeType.SERVICE -> emptyList()
    }
    val visibleNotices = typeNotices.filter { notice ->
        val date = notice.date
        when {
            rangeDays == null -> true
            date == null -> false
            notice.kind == NoticeKind.DEBIT ->
                !date.isBefore(today) && (windowEnd == null || !date.isAfter(windowEnd))
            else -> !date.isBefore(cutoff ?: today) && !date.isAfter(today)
        }
    }

    val txRelevant = filters.type == NoticeType.ALL || filters.type == NoticeType.TRANSACTION
    val debitRelevant = filters.type == NoticeType.ALL || filters.type == NoticeType.REMINDER
    val txFailed = txError != null && txRelevant
    val debitFailed = debitError != null && debitRelevant
    val noRealSource = filters.type == NoticeType.CARD ||
        filters.type == NoticeType.SECURITY ||
        filters.type == NoticeType.SERVICE

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            TabBar("通知")
            ChipRow(
                noticeChips.map { it.label },
                chipsSelected,
                trailing = {
                    Box(
                        Modifier
                            .size(width = 34.dp, height = 32.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (filters.activeLabels.isNotEmpty()) Tokens.Primary else Tokens.Surface),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filter,
                            contentDescription = "筛选",
                            tint = if (filters.activeLabels.isNotEmpty()) androidx.compose.ui.graphics.Color.White else Tokens.Ink2,
                            modifier = Modifier
                                .size(16.dp)
                                .clickable { filterOpen = true },
                        )
                    }
                },
                onSelect = { index -> filters = filters.copy(type = noticeChips[index]) },
            )
            if (filters.activeLabels.isNotEmpty()) {
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "已筛选：${filters.activeLabels.joinToString(" · ")}",
                        fontSize = 10.5.sp,
                        color = Tokens.Ink2,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "清除",
                        fontSize = 10.5.sp,
                        color = Tokens.Muted,
                        modifier = Modifier.clickable { filters = NoticeFilters() },
                    )
                }
            }
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 16.dp),
            ) {
                when {
                    loading -> LoadText("加载中…", Tokens.Muted)
                    noRealSource -> LoadText(
                        when (filters.type) {
                            NoticeType.CARD -> "银行卡通知暂无真实数据来源；如需卡片状态请到银行卡页查看"
                            NoticeType.SECURITY -> "安全通知暂无真实数据来源；如需安全设置请到安全中心查看"
                            else -> "服务通知暂无真实数据来源"
                        },
                        Tokens.Muted,
                    )
                    visibleNotices.isEmpty() -> {
                        if (txFailed || debitFailed) {
                            SourceErrors(txError, debitError, txRelevant, debitRelevant) { reloadKey++ }
                        } else {
                            LoadText(
                                when (filters.type) {
                                    NoticeType.TRANSACTION -> "暂无交易通知"
                                    NoticeType.REMINDER -> "暂无待扣款提醒"
                                    else -> "暂无通知"
                                },
                                Tokens.Muted,
                            )
                        }
                    }
                    else -> {
                        // 流水仍可展示时，单独提示另一类来源未加载，避免静默丢失。
                        if (txFailed || debitFailed) {
                            SourceErrors(txError, debitError, txRelevant, debitRelevant) { reloadKey++ }
                        }
                        var lastDay: String? = null
                        visibleNotices.forEach { notice ->
                            if (notice.day != lastDay) {
                                GroupLabel(notice.day)
                                lastDay = notice.day
                            }
                            HairlineCard(Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) {
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                ) {
                                    Box(
                                        Modifier
                                            .size(36.dp)
                                            .clip(CircleShape)
                                            .background(Tokens.SurfaceWarm),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(notice.icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(17.dp))
                                    }
                                    Spacer(Modifier.size(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            notice.title,
                                            fontSize = 13.5.sp,
                                            fontWeight = FontWeight.Normal,
                                            color = Tokens.Ink,
                                        )
                                        Spacer(Modifier.height(3.dp))
                                        Text(notice.body, fontSize = 12.sp, color = Tokens.Muted, lineHeight = 18.sp)
                                    }
                                    Spacer(Modifier.size(10.dp))
                                    Text(notice.time, fontSize = 11.sp, color = Tokens.Muted)
                                }
                            }
                        }
                    }
                }
            }
        }

        FilterDrawer(
            title = "筛选",
            groups = listOf(
                FilterGroup("类型", noticeTypeOptions),
                FilterGroup("时间范围", noticeRangeOptions.map { it.first }),
            ),
            visible = filterOpen,
            onClose = { filterOpen = false },
            onApply = { applied ->
                filters = NoticeFilters(
                    type = NoticeType.entries.firstOrNull { it.label == (applied["类型"] ?: "全部") }
                        ?: NoticeType.ALL,
                    rangeDays = noticeRangeOptions
                        .firstOrNull { it.first == (applied["时间范围"] ?: "不限") }
                        ?.second,
                )
                filterOpen = false
            },
        )
    }
}

@Composable
private fun LoadText(text: String, color: androidx.compose.ui.graphics.Color) {
    Text(
        text,
        fontSize = 12.sp,
        color = color,
        lineHeight = 18.sp,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 20.dp),
    )
}

@Composable
private fun SourceErrors(
    txError: String?,
    debitError: String?,
    txRelevant: Boolean,
    debitRelevant: Boolean,
    onRetry: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        if (txError != null && txRelevant) {
            Text("交易通知加载失败：$txError", fontSize = 12.sp, color = Tokens.Coral, lineHeight = 18.sp)
        }
        if (debitError != null && debitRelevant) {
            Text("扣款提醒加载失败：$debitError", fontSize = 12.sp, color = Tokens.Coral, lineHeight = 18.sp)
        }
        Text(
            "重试",
            fontSize = 11.sp,
            color = Tokens.Ink2,
            fontWeight = FontWeight.Medium,
            modifier = Modifier
                .clickable { onRetry() }
                .padding(top = 6.dp),
        )
    }
}

@Composable
private fun GroupLabel(text: String) {
    Text(
        text,
        fontSize = 11.sp,
        color = Tokens.Muted,
        modifier = Modifier.padding(start = 16.dp, top = 10.dp, bottom = 2.dp),
    )
}

/** 无涟漪点击，保持设计稿的克制反馈。 */
fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier =
    this.clickable(onClick = onClick)
