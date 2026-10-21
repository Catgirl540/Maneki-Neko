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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val limitPresets = listOf("¥2,000", "¥5,000", "¥10,000", "¥50,000")

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun CardsScreen(onBack: () -> Unit, onDelivery: () -> Unit, onApply: () -> Unit) {
    var applyOpen by remember { mutableStateOf(false) }
    var locked by remember { mutableStateOf(false) }
    var online by remember { mutableStateOf(true) }
    var overseas by remember { mutableStateOf(false) }
    var limit by remember { mutableStateOf(3) }
    var panShown by remember { mutableStateOf(false) }
    var balanceShown by remember { mutableStateOf(true) }

    PushScreen(title = "银行卡", onBack = onBack) {
        SectionHeader("我的卡片", "2 张")
        LazyRow(
            Modifier.fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                CardFace(
                    name = "招财猫借记卡",
                    last4 = "8821",
                    status = if (locked) "已锁定" else "使用中",
                    color = Color(0xFF5840C4),
                    panShown = panShown,
                    onTogglePan = { panShown = !panShown },
                )
            }
            item {
                CardFace(
                    name = "招财猫白金卡",
                    last4 = "4417",
                    status = "待激活",
                    color = Color(0xFF08233E),
                    panShown = false,
                    onTogglePan = {},
                    dimmed = true,
                )
            }
            item {
                Box(
                    Modifier
                        .width(296.dp)
                        .aspectRatio(1.62f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Tokens.Surface)
                        .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
                        .clickable { applyOpen = true },
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Plus, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(26.dp))
                        Spacer(Modifier.height(9.dp))
                        Text("申请新卡", fontSize = 12.5.sp, color = Tokens.Muted)
                    }
                }
            }
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 10.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            listOf(0, 1, 2).forEach { index ->
                Box(
                    Modifier
                        .padding(horizontal = 3.dp)
                        .size(5.dp)
                        .clip(CircleShape)
                        .background(if (index == 0) Tokens.Ink2 else Tokens.Border)
                )
            }
        }
        // 三个动作
        Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionTile(if (locked) "解锁卡片" else "立即锁卡", Icons.Lock, Modifier.weight(1f)) { locked = !locked }
            ActionTile("换卡", Icons.Transfer, Modifier.weight(1f)) { applyOpen = true }
            ActionTile("寄送信息", Icons.Receipt, Modifier.weight(1f)) { onDelivery() }
        }

        SectionHeader("资金账户", "人民币活期 ··8821")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(horizontal = 14.dp)) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("人民币 CNY", fontSize = 12.5.sp, color = Tokens.Muted)
                    Text(if (balanceShown) "¥86,320.00" else "••••••", fontSize = 12.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                }
                Hairline()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("港币 HKD", fontSize = 12.5.sp, color = Tokens.Muted)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (balanceShown) "HK$8,720.00" else "••••••", fontSize = 12.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.size(8.dp))
                        Icon(
                            Icons.Eye,
                            contentDescription = "显示或隐藏余额",
                            tint = Tokens.Muted,
                            modifier = Modifier
                                .size(15.dp)
                                .clickable { balanceShown = !balanceShown },
                        )
                    }
                }
            }
        }

        SectionHeader("交易设置")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                SwitchRow("线上支付", online) { online = it }
                Hairline()
                SwitchRow("境外交易", overseas) { overseas = it }
                Hairline()
                Row(
                    Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    limitPresets.forEachIndexed { index, label ->
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(14.dp))
                                .background(if (index == limit) Tokens.Primary else Tokens.Surface)
                                .border(
                                    1.dp,
                                    if (index == limit) Tokens.Primary else Tokens.Border,
                                    RoundedCornerShape(14.dp),
                                )
                                .clickable { limit = index }
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                        ) {
                            Text(
                                label,
                                fontSize = 11.5.sp,
                                color = if (index == limit) Color.White else Tokens.Ink2,
                            )
                        }
                    }
                }
            }
        }
    }

    if (applyOpen) {
        androidx.compose.material3.ModalBottomSheet(
            onDismissRequest = { applyOpen = false },
            sheetState = androidx.compose.material3.rememberModalBottomSheetState(),
            containerColor = Tokens.Surface,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text("申请新卡", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                KvRow("卡种", "招财猫白金卡")
                KvRow("制卡费", "¥50.00 · 普通会员标准价")
                KvRow("寄送", "顺丰到付 · 3–5 个工作日")
                Spacer(Modifier.height(12.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Tokens.SurfaceWarm)
                        .padding(12.dp)
                ) {
                    Text(
                        "新卡与现有卡片同属一个资金账户，不新开户；收到后需签收并激活。",
                        fontSize = 11.5.sp,
                        color = Tokens.Ink2,
                        lineHeight = 18.sp,
                    )
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(6) { index ->
                        Box(
                            Modifier
                                .weight(1f)
                                .height(46.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Tokens.Surface)
                                .border(1.dp, Tokens.Border, RoundedCornerShape(8.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (index < 5) {
                                Box(Modifier.size(7.dp).clip(CircleShape).background(Tokens.Ink))
                            }
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text("请输入 6 位支付密码", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(16.dp))
                PrimaryButton("确认申请", {
                    applyOpen = false
                    onApply()
                })
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

@Composable
private fun CardFace(
    name: String,
    last4: String,
    status: String,
    color: Color,
    panShown: Boolean,
    onTogglePan: () -> Unit,
    dimmed: Boolean = false,
) {
    Box(
        Modifier
            .width(296.dp)
            .aspectRatio(1.62f)
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = if (dimmed) 0.62f else 1f))
            .border(1.dp, Color.White.copy(alpha = 0.25f), RoundedCornerShape(10.dp))
            .padding(16.dp),
    ) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.SpaceBetween) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(R.drawable.support_cat),
                    contentDescription = null,
                    modifier = Modifier.size(28.dp),
                    contentScale = ContentScale.Fit,
                )
                Spacer(Modifier.size(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(name, fontSize = 13.sp, color = Color.White, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.height(2.dp))
                    Text("尾号 $last4 · $status", fontSize = 11.sp, color = Color.White.copy(alpha = 0.75f))
                }
                Box(
                    Modifier
                        .border(1.dp, Color.White.copy(alpha = 0.35f), RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text("银联", fontSize = 10.sp, color = Color.White.copy(alpha = 0.85f))
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (panShown) "6222 0241 8823 8821" else "•••• •••• •••• ••••",
                    fontSize = 15.sp,
                    color = Color.White,
                    letterSpacing = 1.sp,
                )
                Spacer(Modifier.size(8.dp))
                Icon(
                    Icons.Eye,
                    contentDescription = "显示或隐藏卡号",
                    tint = Color.White.copy(alpha = 0.8f),
                    modifier = Modifier
                        .size(16.dp)
                        .clickable { onTogglePan() },
                )
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom,
            ) {
                Text("陈嘉禾", fontSize = 12.sp, color = Color.White.copy(alpha = 0.85f))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Column(horizontalAlignment = Alignment.End) {
                        Text("VALID THRU", fontSize = 8.5.sp, color = Color.White.copy(alpha = 0.7f))
                        Text(if (panShown) "08/29" else "••/••", fontSize = 12.sp, color = Color.White.copy(alpha = 0.85f))
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text("CVV", fontSize = 8.5.sp, color = Color.White.copy(alpha = 0.7f))
                        Text("•••", fontSize = 12.sp, color = Color.White.copy(alpha = 0.85f))
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionTile(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, onClick: () -> Unit) {
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
