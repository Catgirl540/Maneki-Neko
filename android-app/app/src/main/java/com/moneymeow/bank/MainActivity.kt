package com.moneymeow.bank

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.navigationBarsPadding

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            MoneyMeowTheme {
                BankApp()
            }
        }
    }
}

/** 底栏五个位置：总览 / 理财 / 猫钮 / 通知 / 我的。 */
private data class Tab(val label: String, val icon: ImageVector?)

private val tabs = listOf(
    Tab("总览", Icons.Home),
    Tab("理财", Icons.Wealth),
    Tab("助手", null),
    Tab("通知", Icons.Bell),
    Tab("我的", Icons.Person),
)

@Composable
fun BankApp() {
    var tab by remember { mutableIntStateOf(0) }
    val stack = remember { mutableStateListOf<String>() }
    val push: (String) -> Unit = { stack.add(it) }
    val pop: () -> Unit = { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
    BackHandler(enabled = stack.isNotEmpty()) { pop() }
    val goHome: () -> Unit = { stack.clear(); tab = 0 }

    Scaffold(
        containerColor = Tokens.Page,
        bottomBar = {
            if (stack.isEmpty()) BottomBar(current = tab, onSelect = { tab = it })
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Tokens.Page)
        ) {
            val route = stack.lastOrNull()
            if (route == null) {
                when (tab) {
                    0 -> HomeScreen(onOpen = push, onSwitchTab = { tab = it })
                    1 -> WealthTab(onOpenProduct = { push("产品详情") }, onOpenPlans = { push("储蓄与计划") })
                    2 -> AssistantScreen(onBack = { tab = 0 })
                    3 -> NotifyTab(onOpenFilter = { push("筛选") })
                    else -> MeTab(onOpen = push, onLogout = { push("登录") })
                }
            } else {
                when (route) {
                    "银行卡" -> CardsScreen(
                        onBack = pop,
                        onDelivery = { push("寄送信息") },
                        onApply = { push("申请新卡") },
                    )
                    "交易记录" -> TransactionsScreen(
                        onBack = pop,
                        onAnalysis = { push("消费分析") },
                        onOpenTx = { push("交易详情") },
                    )
                    "更多服务" -> MoreScreen(onBack = pop) { push(it) }
                    "消费分析" -> AnalysisScreen(onBack = pop)
                    "存款" -> DepositsScreen(
                        onBack = pop,
                        onTransferIn = { push("转入") },
                        onTransferOut = { push("转出") },
                    )
                    "换汇" -> ExchangeScreen(onBack = pop)
                    "交易详情" -> TxDetailScreen(onBack = pop)
                    "寄送信息" -> DeliveryScreen(onBack = pop)
                    "会员等级" -> MembershipScreen(onBack = pop)
                    "储蓄与计划" -> PlansScreen(onBack = pop)
                    "安全中心" -> SecurityScreen(onBack = pop)
                    "个人资料" -> ProfileScreen(onBack = pop)
                    "IM 连接" -> ImScreen(onBack = pop)
                    "通知设置" -> NotifySettingsScreen(onBack = pop)
                    "语言与地区" -> LanguageScreen(onBack = pop)
                    "帮助与客服" -> HelpScreen(onBack = pop)
                    "关于" -> AboutScreen(onBack = pop)
                    "转出" -> TransferSelectScreen(onBack = pop) { push(it) }
                    "手机号转账", "银行卡号转账", "跨境支付通" ->
                        TransferFormScreen(route, onBack = pop, onNext = { push("填写金额") })
                    "填写金额" -> AmountScreen(onBack = pop, onDone = { push("转账结果") })
                    "转账结果" -> TransferResultScreen(onBack = pop, onHome = goHome)
                    "产品详情" -> ProductDetailScreen(onBack = pop)
                    else -> SimplePushScreen(route, pop)
                }
            }
        }
    }
}

/** 尚未实现的页面：保留返回栏，避免出现死路。 */
@Composable
private fun SimplePushScreen(title: String, onBack: () -> Unit) {
    PushScreen(title = title, onBack = onBack) {
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = 80.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("页面施工中", fontSize = 13.sp, color = Tokens.Muted)
        }
    }
}

@Composable
private fun BottomBar(current: Int, onSelect: (Int) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Tokens.Surface)
            .navigationBarsPadding()
            .height(64.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEachIndexed { index, tab ->
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxSize()
                    .clickable { onSelect(index) },
                contentAlignment = Alignment.Center,
            ) {
                if (tab.icon == null) {
                    // 中间猫钮：黑底圆钮上浮，进入助手
                    Box(
                        Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(Tokens.Primary),
                        contentAlignment = Alignment.Center,
                    ) {
                        Image(
                            painter = painterResource(R.drawable.support_cat),
                            contentDescription = "智能助手",
                            modifier = Modifier.size(38.dp),
                            contentScale = ContentScale.Fit,
                        )
                    }
                } else {
                    Icon(
                        imageVector = tab.icon,
                        contentDescription = tab.label,
                        tint = if (index == current) Tokens.Accent else Tokens.Muted,
                        modifier = Modifier.size(23.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun PlaceholderScreen(title: String) {
    Column(Modifier.fillMaxSize()) {
        Text(
            title,
            modifier = Modifier
                .fillMaxWidth()
                .background(Tokens.Surface)
                .padding(horizontal = 16.dp, vertical = 16.dp),
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            color = Tokens.Ink,
        )
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("页面施工中", fontSize = 13.sp, color = Tokens.Muted)
        }
    }
}

/** 通用白卡：白底 + 发丝线 + 10dp 圆角。 */
@Composable
fun HairlineCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(Tokens.CardRadius.dp))
            .background(Tokens.Surface)
            .border(1.dp, Tokens.Border, RoundedCornerShape(Tokens.CardRadius.dp))
    ) {
        content()
    }
}

/** 一条发丝分隔线。 */
@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Spacer(
        modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Tokens.Border)
    )
}

@Composable
fun SectionHeader(title: String, trailing: String? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontSize = 12.sp, color = Tokens.Muted)
        if (trailing != null) Text(trailing, fontSize = 11.sp, color = Tokens.Muted)
    }
}

/** 金额显示：¥ 与数字分开排版，数字用等宽感。 */
@Composable
fun AmountText(text: String, size: Int = 30, color: Color = Tokens.Ink) {
    Text(
        text,
        fontSize = size.sp,
        fontWeight = FontWeight.SemiBold,
        color = color,
        letterSpacing = (-0.4).sp,
    )
}

@Composable
fun HSpacer(w: Int) = Spacer(Modifier.width(w.dp))

@Composable
fun VSpacer(h: Int) = Spacer(Modifier.height(h.dp))
