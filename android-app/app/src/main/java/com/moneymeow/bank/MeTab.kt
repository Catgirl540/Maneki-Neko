package com.moneymeow.bank

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun MeTab(onOpen: (String) -> Unit, onLogout: () -> Unit) {
    // 会员档位与持卡数量取真实接口，未加载时不显示编造的数字。
    var membership by remember { mutableStateOf<MembershipDto?>(null) }
    var cardCount by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(Unit) {
        runCatching { BankApi.membership() }.onSuccess { membership = it }
        runCatching { BankApi.cards() }.onSuccess { cardCount = it.size }
    }
    Column(Modifier.fillMaxSize()) {
        TabBar("我的")
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 20.dp),
        ) {
            // 资料区
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Tokens.Surface)
                    .padding(16.dp),
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
                    Image(
                        painter = painterResource(R.drawable.brand_cat),
                        contentDescription = null,
                        modifier = Modifier.size(44.dp),
                        contentScale = ContentScale.Fit,
                    )
                }
                Spacer(Modifier.size(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        SessionStore.name().ifEmpty { "我的账户" },
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Ink,
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(maskPhone(SessionStore.phone()), fontSize = 12.sp, color = Tokens.Muted)
                }
                Row(
                    Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(Tokens.SurfaceWarm)
                        .border(1.dp, Tokens.Border, RoundedCornerShape(6.dp))
                        .clickable { onOpen("会员等级") }
                        .padding(horizontal = 9.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(membership?.tierLabel ?: "—", fontSize = 11.5.sp, color = Tokens.Ink2)
                    Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(12.dp))
                }
            }
            Hairline()

            SectionHeader("账户与安全")
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column {
                    IconRow(Icons.Person, "个人资料") { onOpen("个人资料") }
                    Hairline()
                    IconRow(Icons.Lock, "安全中心") { onOpen("安全中心") }
                    Hairline()
                    IconRow(Icons.Card, "银行卡管理", cardCount?.let { "$it 张" } ?: "—") { onOpen("银行卡") }
                    Hairline()
                    IconRow(
                        Icons.Wealth,
                        "会员等级",
                        membership?.let {
                            val gap = it.nextThreshold - it.aum
                            if (gap > 0) "距${tierLabel(it.nextTier)}差 " + formatCents(gap) else it.tierLabel
                        } ?: "—",
                    ) { onOpen("会员等级") }
                }
            }

            SectionHeader("连接与偏好")
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column {
                    IconRow(Icons.Bell, "IM 连接", "未绑定") { onOpen("IM 连接") }
                    Hairline()
                    IconRow(Icons.Dots, "通知设置", "全部开启") { onOpen("通知设置") }
                    Hairline()
                    IconRow(Icons.Globe, "语言与地区", "简体中文") { onOpen("语言与地区") }
                }
            }

            SectionHeader("其他")
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column {
                    IconRow(Icons.Help, "帮助与客服") { onOpen("帮助与客服") }
                    Hairline()
                    IconRow(Icons.Info, "关于招财猫银行") { onOpen("关于") }
                    Hairline()
                    IconRow(Icons.UpOut, "退出登录", danger = true) { onLogout() }
                }
            }

            Spacer(Modifier.height(20.dp))
            Text(
                "招财猫银行 v1.0.0",
                fontSize = 11.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

/** 会员档位中文名，与网页 `shared/membership.mjs` 一致。 */
private fun tierLabel(code: String): String = when (code) {
    "standard" -> "标准会员"
    "gold" -> "金卡"
    "platinum" -> "白金卡"
    "diamond" -> "钻石卡"
    else -> code
}

/** 手机号打码：13800138000 → 138 **** 8000。 */
private fun maskPhone(phone: String): String =
    if (phone.length >= 7) phone.take(3) + " **** " + phone.takeLast(4) else phone
