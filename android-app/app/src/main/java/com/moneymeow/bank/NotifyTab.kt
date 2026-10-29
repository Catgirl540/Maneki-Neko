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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
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

/** 通知的真实来源：银行流水或自动扣款预告。银行卡、安全类没有真实来源，不生成通知。 */
private enum class NoticeKind { TRANSACTION, DEBIT }

private data class Notice(
    val title: String,
    val body: String,
    val time: String,
    val day: String,
    val icon: ImageVector,
    val unread: Boolean,
    val kind: NoticeKind,
)

/** 通知由真实流水与自动扣款推导，不预置示例消息。 */
private fun buildNotices(transactions: List<TransactionDto>, debits: List<AutoDebitDto>): List<Notice> {
    val today = java.time.LocalDate.now()
    fun dayLabel(date: java.time.LocalDate): String = when {
        date == today -> "今天"
        date == today.minusDays(1) -> "昨天"
        else -> "${date.monthValue}月${date.dayOfMonth}日"
    }
    val fromTx = transactions.map { dto ->
        val incoming = dto.direction == "in"
        val when_ = runCatching { java.time.LocalDateTime.parse(dto.createdAt.take(19)) }.getOrNull()
        val date = when_?.toLocalDate() ?: today
        Notice(
            title = if (incoming) "转入到账" else BankApi.categoryLabel(dto.category) + "消费",
            body = dto.counterparty.ifEmpty { dto.memo.ifEmpty { "交易" } } +
                " " + (if (incoming) "+" else "-") + formatCents(dto.amount),
            time = when_?.let { "%02d:%02d".format(it.hour, it.minute) } ?: date.toString(),
            day = dayLabel(date),
            icon = if (incoming) Icons.DownIn else Icons.UpOut,
            unread = false,
            kind = NoticeKind.TRANSACTION,
        )
    }
    val fromDebits = debits.filter { it.enabled }.mapNotNull { dto ->
        // 只看还没发生的扣款；已过期的 nextRunAt 不当作预告。
        val next = runCatching { java.time.LocalDateTime.parse(dto.nextRunAt.take(19)) }.getOrNull() ?: return@mapNotNull null
        if (next.toLocalDate().isBefore(today)) return@mapNotNull null
        Notice(
            title = "自动扣款预告",
            body = "「${dto.merchant}」将于 ${next.monthValue}月${next.dayOfMonth}日 扣款 ${formatCents(dto.amount)}。",
            time = "${next.monthValue}月${next.dayOfMonth}日",
            day = "待扣款提醒",
            icon = Icons.Receipt,
            unread = false,
            kind = NoticeKind.DEBIT,
        )
    }
    // 待扣款是“还没发生的事”，放最前面；其余按流水时间顺序。
    return fromDebits + fromTx
}

@Composable
fun NotifyTab(onOpenFilter: () -> Unit) {
    var chip by remember { mutableIntStateOf(0) }
    var filterOpen by remember { mutableStateOf(false) }
    var filterCount by remember { mutableIntStateOf(0) }
    var notices by remember { mutableStateOf<List<Notice>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    // 扣款接口失败不能伪装成“没有提醒”，单独记录原因并在界面明确提示。
    var debitError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching {
            val account = BankApi.accounts().firstOrNull()
            val txns = account?.let { BankApi.transactions(it.id, 10) }.orEmpty()
            val debits = runCatching { BankApi.autoDebits() }
                .onFailure { debitError = it.message ?: "未知错误" }
                .getOrDefault(emptyList())
            buildNotices(txns, debits)
        }
            .onSuccess { notices = it }
            .onFailure { error = it.message }
        loading = false
    }

    // 顶部分类：0 全部、1 交易（流水）、2 银行卡、3 提醒（扣款预告）、4 安全。
    // 银行卡与安全当前没有真实通知来源，始终为空态，不用假消息填充。
    val visibleNotices = when (chip) {
        1 -> notices.filter { it.kind == NoticeKind.TRANSACTION }
        3 -> notices.filter { it.kind == NoticeKind.DEBIT }
        2, 4 -> emptyList()
        else -> notices
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            TabBar("通知")
            ChipRow(
                listOf("全部", "交易", "银行卡", "提醒", "安全"),
                chip,
                trailing = {
                    Box(
                        Modifier
                            .size(width = 34.dp, height = 32.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (filterCount > 0) Tokens.Primary else Tokens.Surface),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filter,
                            contentDescription = "筛选",
                            tint = if (filterCount > 0) androidx.compose.ui.graphics.Color.White else Tokens.Ink2,
                            modifier = Modifier
                                .size(16.dp)
                                .clickable { filterOpen = true },
                        )
                    }
                },
                onSelect = { chip = it },
            )
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 16.dp),
            ) {
                // 只有“全部”和“提醒”两个分类依赖扣款接口；接口失败时这两个分类要明确报错，
                // 不能显示成“暂无扣款提醒/暂无通知”而让人误以为真的没有待扣款。
                val showDebitError = debitError != null && (chip == 0 || chip == 3)
                if (visibleNotices.isEmpty()) {
                    val showError = (error != null || showDebitError) && chip != 2 && chip != 4
                    Text(
                        when {
                            chip == 2 -> "暂无银行卡通知"
                            chip == 4 -> "暂无安全通知"
                            loading -> "加载中…"
                            error != null -> "加载失败：$error"
                            chip == 1 -> "暂无交易通知"
                            showDebitError -> "扣款提醒加载失败：$debitError"
                            chip == 3 -> "暂无扣款提醒"
                            else -> "暂无通知"
                        },
                        fontSize = 12.sp,
                        color = if (showError) Tokens.Coral else Tokens.Muted,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 20.dp),
                    )
                } else if (showDebitError) {
                    // 流水仍可展示时，单独提示扣款提醒未能加载，避免静默丢失。
                    Text(
                        "扣款提醒加载失败：$debitError",
                        fontSize = 12.sp,
                        color = Tokens.Coral,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    )
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
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (notice.unread) {
                                        Box(
                                            Modifier
                                                .size(6.dp)
                                                .clip(CircleShape)
                                                .background(Tokens.Accent)
                                        )
                                        Spacer(Modifier.size(6.dp))
                                    }
                                    Text(
                                        notice.title,
                                        fontSize = 13.5.sp,
                                        fontWeight = if (notice.unread) FontWeight.SemiBold else FontWeight.Normal,
                                        color = Tokens.Ink,
                                    )
                                }
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

        FilterDrawer(
            title = "筛选",
            groups = listOf(
                FilterGroup("类型", listOf("全部", "交易", "银行卡", "提醒", "安全", "服务通知")),
                FilterGroup("状态", listOf("全部", "未读", "已读")),
                FilterGroup("时间范围", listOf("不限", "近 7 天", "近 30 天", "近 90 天")),
            ),
            visible = filterOpen,
            onClose = { filterOpen = false },
            onApply = { applied ->
                filterCount = applied.count { (key, value) ->
                    val default = if (key == "时间范围") "不限" else "全部"
                    value != default
                }
                filterOpen = false
            },
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
