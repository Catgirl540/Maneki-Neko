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

private data class Notice(
    val title: String,
    val body: String,
    val time: String,
    val icon: ImageVector,
    val unread: Boolean,
)

private val notices = listOf(
    Notice("转入到账", "他行卡尾号 6633 转入 ¥5,000.00 已到账，当前余额 ¥86,320.00。", "09:12", Icons.DownIn, true),
    Notice("银行卡已寄出", "你申请的招财猫借记卡（尾号 8821）已通过审核并寄出，请注意签收。", "08:40", Icons.Card, true),
    Notice("自动扣款预告", "「话费月缴」将于 10月21日 从人民币活期扣款 ¥98.00。", "19:05", Icons.Receipt, false),
    Notice("转出成功", "向陈嘉禾（招财猫银行 ··8821）转出 ¥500.00 已到账。", "15:26", Icons.UpOut, false),
    Notice("新设备登录", "你的账户于 10月18日 在 Android 设备登录。", "10月18日", Icons.Phone, false),
)

@Composable
fun NotifyTab(onOpenFilter: () -> Unit) {
    var chip by remember { mutableIntStateOf(0) }
    var filterOpen by remember { mutableStateOf(false) }
    var filterCount by remember { mutableIntStateOf(0) }

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
                notices.forEachIndexed { index, notice ->
                    if (index == 0) GroupLabel("今天")
                    if (index == 2) GroupLabel("昨天")
                    if (index == 4) GroupLabel("更早")
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
