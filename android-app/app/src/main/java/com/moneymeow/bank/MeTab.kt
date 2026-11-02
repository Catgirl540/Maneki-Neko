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
import androidx.compose.runtime.mutableIntStateOf
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

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun MeTab(onOpen: (String) -> Unit, onLogout: () -> Unit) {
    // 会员档位与持卡数量取真实接口，未加载时不显示编造的数字。
    // 先渲染上次的结果，再后台刷新；没有缓存时才显示占位。
    var membership by remember { mutableStateOf(ReadCache.get<MembershipDto>(ReadCache.Key.ME_MEMBERSHIP)) }
    // 头像跟着资料走：进页面拉一次，失败就退回品牌猫。
    var avatarId by remember { mutableStateOf(ReadCache.get<String>(ReadCache.Key.ME_AVATAR)) }
    var cardCount by remember { mutableStateOf(ReadCache.get<Int>(ReadCache.Key.ME_CARD_COUNT)) }
    var refreshing by remember { mutableStateOf(false) }
    var refreshKey by remember { mutableIntStateOf(0) }
    LaunchedEffect(refreshKey) {
        runCatching { BankApi.profile() }.onSuccess {
            avatarId = it.avatarId
            ReadCache.put(ReadCache.Key.ME_AVATAR, it.avatarId)
        }
        runCatching { BankApi.membership() }.onSuccess {
            membership = it
            ReadCache.put(ReadCache.Key.ME_MEMBERSHIP, it)
        }
        runCatching { BankApi.cards() }.onSuccess {
            cardCount = it.size
            ReadCache.put(ReadCache.Key.ME_CARD_COUNT, it.size)
        }
        refreshing = false
    }
    Column(Modifier.fillMaxSize()) {
        TabBar("我的", onRefresh = { if (!refreshing) { refreshing = true; BankApi.invalidateReads(); refreshKey++ } }, refreshing = refreshing)
        BankPullRefresh(
            isRefreshing = refreshing,
            onRefresh = {
                if (!refreshing) {
                    refreshing = true
                    BankApi.invalidateReads()
                    refreshKey++
                }
            },
            modifier = Modifier.weight(1f),
        ) {
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
                UserAvatar(avatarId = avatarId, size = 54.dp)
                Spacer(Modifier.size(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        SessionStore.nickname().ifEmpty { "我的账户" },
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Ink,
                    )
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

                        Spacer(Modifier.height(10.dp))
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column {
                    IconRow(Icons.Person, "个人资料") { onOpen("个人资料") }
                    Hairline()
                    IconRow(Icons.Lock, "安全中心") { onOpen("安全中心") }
                    Hairline()
                    IconRow(Icons.Card, "银行卡管理") { onOpen("银行卡") }
                    Hairline()
                    IconRow(Icons.Crown, "会员等级") { onOpen("会员等级") }
                }
            }

                                    Spacer(Modifier.height(10.dp))
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
        }
        }
    }
}
