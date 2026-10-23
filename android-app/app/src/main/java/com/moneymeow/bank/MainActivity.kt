package com.moneymeow.bank

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.sin
import androidx.compose.foundation.Image
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.navigationBarsPadding

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        SessionStore.init(applicationContext)
        // 没有令牌就必须先登录；令牌过期（401）时统一清态回登录页。
        AuthState.loggedIn = BankApi.hasToken()
        BankApi.onUnauthorized = {
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                SessionStore.clear()
                AuthState.loggedIn = false
            }
        }
        AgentApi.bindToken { BankApi.currentToken() }
        setContent {
            MoneyMeowTheme {
                BankApp()
            }
        }
    }
}

/** 登录态：进程内唯一来源，退出登录与令牌失效都走这里。 */
object AuthState {
    var loggedIn by mutableStateOf(false)
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

private data class NavState(
    val tab: Int,
    val route: String?,
    val depth: Int,
)

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun BankApp() {
    // 未登录一律先登录，避免用界面里的静态占位数据冒充账户数据。
    if (!AuthState.loggedIn) {
        AuthGate(onLoggedIn = { AuthState.loggedIn = true })
        return
    }
    var tab by remember { mutableIntStateOf(0) }
    val stack = remember { mutableStateListOf<String>() }
    val push: (String) -> Unit = { stack.add(it) }
    val pop: () -> Unit = { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
    // 返回键：二级页回退；助手（全屏 tab）回主页；主页再按才退出应用
    BackHandler(enabled = stack.isNotEmpty() || tab == 2) {
        if (stack.isNotEmpty()) pop() else tab = 0
    }
    val goHome: () -> Unit = { stack.clear(); tab = 0 }
    var transferDraft by remember { mutableStateOf(TransferDraft()) }
    var transferResult by remember { mutableStateOf<TransferResultDto?>(null) }
    var selectedTxId by remember { mutableStateOf<String?>(null) }
    var selectedProductCode by remember { mutableStateOf<String?>(null) }
    var redeemedInfo by remember { mutableStateOf<Pair<String, Long>?>(null) }

    val navState = NavState(tab = tab, route = stack.lastOrNull(), depth = stack.size)
    val showBottomBar = navState.route == null && navState.tab != 2

    Scaffold(
        containerColor = Tokens.Page,
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Tokens.Page),
        ) {
            androidx.compose.animation.AnimatedContent(
                targetState = navState,
                modifier = Modifier.fillMaxSize(),
                transitionSpec = {
                    when {
                        // 1) Push 二级页：新页从右侧 18% 处短程滑入 + 淡入，旧页原位淡出（不叠加大幅横移残影）
                        targetState.depth > initialState.depth -> {
                            (androidx.compose.animation.slideInHorizontally(
                                tween(220, easing = StandardOutSlowIn)
                            ) { (it * 0.18f).toInt() } +
                                androidx.compose.animation.fadeIn(tween(180, easing = StandardOutSlowIn)))
                                .togetherWith(
                                    androidx.compose.animation.slideOutHorizontally(
                                        tween(220, easing = StandardOutSlowIn)
                                    ) { -(it * 0.06f).toInt() } +
                                        androidx.compose.animation.fadeOut(tween(150))
                                )
                                .apply { targetContentZIndex = targetState.depth.toFloat() }
                        }
                        // 2) Pop 返回上一页：当前页向右轻滑 18% + 淡出，上一页从左侧 -6% 归位
                        targetState.depth < initialState.depth -> {
                            (androidx.compose.animation.slideInHorizontally(
                                tween(200, easing = StandardOutSlowIn)
                            ) { -(it * 0.06f).toInt() } +
                                androidx.compose.animation.fadeIn(tween(160)))
                                .togetherWith(
                                    androidx.compose.animation.slideOutHorizontally(
                                        tween(200, easing = StandardOutSlowIn)
                                    ) { (it * 0.18f).toInt() } +
                                        androidx.compose.animation.fadeOut(tween(160))
                                )
                                .apply { targetContentZIndex = targetState.depth.toFloat() }
                        }
                        // 3) 同级路由替换
                        targetState.route != initialState.route -> {
                            androidx.compose.animation.fadeIn(tween(180))
                                .togetherWith(androidx.compose.animation.fadeOut(tween(140)))
                        }
                        // 4) 进入/退出智能助手：微上浮 24dp + 淡入淡出
                        targetState.tab == 2 || initialState.tab == 2 -> {
                            val entering = targetState.tab == 2
                            (androidx.compose.animation.slideInVertically(
                                tween(220, easing = StandardOutSlowIn)
                            ) { if (entering) (it * 0.05f).toInt() else -(it * 0.03f).toInt() } +
                                androidx.compose.animation.fadeIn(tween(180)))
                                .togetherWith(
                                    androidx.compose.animation.fadeOut(tween(140))
                                )
                        }
                        // 5) 底栏一级 Tab 切换：不加横向位移，让底栏图标描边动画当视觉焦点
                        else -> {
                            androidx.compose.animation.fadeIn(tween(120))
                                .togetherWith(androidx.compose.animation.fadeOut(tween(90)))
                        }
                    }
                },
                label = "page-nav",
            ) { state ->
                val route = state.route
                val stateHasBar = route == null && state.tab != 2
                Box(
                    Modifier
                        .fillMaxSize()
                        .padding(bottom = if (stateHasBar) 64.dp else 0.dp),
                ) {
                if (route == null) {
                    when (state.tab) {
                        0 -> HomeScreen(onOpen = push, onSwitchTab = { tab = it })
                        1 -> WealthTab(
                            onOpenProduct = { code -> selectedProductCode = code; push("产品详情") },
                            onOpenPlans = { push("储蓄与计划") },
                            onRedeemed = { name, amount ->
                                redeemedInfo = name to amount
                                push("赎回受理")
                            },
                        )
                        2 -> AssistantScreen(onBack = { tab = 0 })
                        3 -> NotifyTab(onOpenFilter = { push("筛选") })
                        else -> MeTab(onOpen = push, onLogout = {
                            SessionStore.clear()
                            AuthState.loggedIn = false
                        })
                    }
                } else {
                    when (route) {
                        "银行卡" -> CardsScreen(
                            onBack = pop,
                            onDelivery = { push("寄送信息") },
                            onApply = { push("申请受理") },
                        )
                        "交易记录" -> TransactionsScreen(
                            onBack = pop,
                            onAnalysis = { push("消费分析") },
                            onOpenTx = { id ->
                                selectedTxId = id
                                push("交易详情")
                            },
                        )
                        "更多服务" -> MoreScreen(onBack = pop) { target ->
                            when (target) {
                                "账户资产", "理财总览", "产品市场", "我的持仓", "理财记录" -> {
                                    stack.clear()
                                    tab = 1
                                }
                                "转账与支付" -> push("转出")
                                "收款与转入" -> push("存款")
                                "多币种换汇" -> push("换汇")
                                "银行卡管理" -> push("银行卡")
                                "账单与交易" -> push("交易记录")
                                "安全设置" -> push("安全中心")
                                "会员中心" -> push("会员等级")
                                else -> push(target)
                            }
                        }
                        "消费分析" -> AnalysisScreen(onBack = pop)
                        "存款" -> DepositsScreen(
                            onBack = pop,
                            onTransferIn = { push("转入") },
                            onTransferOut = { push("转出") },
                        )
                        "换汇" -> ExchangeScreen(onBack = pop)
                        "交易详情" -> TxDetailScreen(onBack = pop, transactionId = selectedTxId)
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
                        "登录" -> LoginScreen(
                            onBack = pop,
                            onLogin = goHome,
                            onRegister = { push("开户·手机号") },
                        )
                        "开户·手机号" -> OpenPhoneScreen(onBack = pop, onNext = { push("开户·实名") })
                        "开户·实名" -> OpenRealNameScreen(onBack = pop, onNext = { push("开户·核验") })
                        "开户·核验" -> OpenFaceScreen(onBack = pop, onNext = { push("开户·支付密码") })
                        "开户·支付密码" -> OpenPasswordScreen(onBack = pop, onDone = { push("开户完成") })
                        "开户完成" -> OpenDoneScreen(onBack = pop, onHome = goHome)
                        "自动扣款" -> AutoDebitScreen(onBack = pop)
                        "工资与备用金" -> PayrollScreen(onBack = pop)
                        "借款与分期" -> CreditScreen(onBack = pop)
                        "保险保障" -> InsuranceScreen(onBack = pop)
                        "邀请与奖励" -> InviteScreen(onBack = pop)
                        "申请受理" -> DoneScreen(
                            title = "申请受理",
                            headline = "申请已提交",
                            note = "审核通过后制卡并寄出",
                            rows = listOf(
                                "卡种" to "招财猫白金卡",
                                "制卡费" to "¥50.00",
                                "预计寄送" to "3–5 个工作日",
                            ),
                            actionLabel = "回到银行卡",
                            onBack = pop,
                            onAction = { stack.clear(); push("银行卡") },
                        )
                        "赎回受理" -> DoneScreen(
                            title = "赎回受理",
                            headline = "赎回已受理",
                            note = "回执标注预计 T+1 个工作日到账",
                            rows = listOf(
                                "产品" to (redeemedInfo?.first ?: "—"),
                                "赎回金额" to (redeemedInfo?.let { formatCents(it.second) } ?: "—"),
                                "赎回费" to "¥0.00",
                            ),
                            actionLabel = "回到理财",
                            onBack = pop,
                            onAction = goHome,
                        )
                        "转出" -> TransferSelectScreen(
                            onBack = pop,
                            onPick = { push(it) },
                            onPickPayee = { draft ->
                                transferDraft = draft
                                push("填写金额")
                            },
                        )
                        "手机号转账", "银行卡号转账", "跨境支付通" -> TransferFormScreen(
                            title = route,
                            onBack = pop,
                            draft = transferDraft,
                            onDraftChange = { transferDraft = it },
                            onNext = { push("填写金额") },
                        )
                        "填写金额" -> AmountScreen(
                            onBack = pop,
                            draft = transferDraft,
                            onSubmitted = { result ->
                                transferResult = result
                                push("转账结果")
                            },
                        )
                        "转账结果" -> TransferResultScreen(
                            result = transferResult,
                            onBack = pop,
                            onHome = goHome,
                        )
                        "产品详情" -> ProductDetailScreen(onBack = pop, productCode = selectedProductCode)
                        else -> SimplePushScreen(route, pop)
                    }
                }
                }
            }

            // 启动时检查一次更新（有新版本弹窗）
            UpdatePromptHost()

            // 底栏固定叠在底部（不改 Scaffold 布局高度，避免页面切换时上下抖动或切掉上浮的猫耳朵）
            if (showBottomBar) {
                Box(Modifier.align(Alignment.BottomCenter)) {
                    BottomBar(current = tab, onSelect = { tab = it })
                }
            }
        }
    }
}

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
    // 四个线图标的「画出来」动画：每次点击递增 tick 重播
    var ticks by remember { mutableStateOf(List(5) { 0 }) }
    // 中间猫钮的探身动画进度
    val peek = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()

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
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) {
                        ticks = ticks.toMutableList().also { it[index] = it[index] + 1 }
                        if (tab.icon == null) {
                            // 猫钮：先播探身，再进助手（设计稿延迟 300ms）
                            scope.launch {
                                peek.snapTo(0f)
                                peek.animateTo(1f, tween(durationMillis = 520, easing = LinearEasing))
                                peek.snapTo(0f)
                            }
                            scope.launch {
                                delay(300)
                                onSelect(index)
                            }
                        } else {
                            onSelect(index)
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (tab.icon == null) {
                    Box(
                        Modifier
                            .offset(y = (-6).dp)
                            .size(56.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            Modifier
                                .size(56.dp)
                                .graphicsLayer {
                                    val sc = peekBtnScale(peek.value)
                                    scaleX = sc
                                    scaleY = sc
                                }
                                .clip(CircleShape)
                                .background(Tokens.Primary),
                        )
                        Image(
                            painter = painterResource(R.drawable.support_cat),
                            contentDescription = "智能助手",
                            modifier = Modifier
                                .size(38.dp)
                                .graphicsLayer {
                                    val p = peek.value
                                    translationY = -peekLiftDp(p).dp.toPx()
                                    rotationZ = peekRotation(p)
                                },
                            contentScale = ContentScale.Fit,
                        )
                    }
                } else {
                    val paths = when (index) {
                        0 -> TabIconPaths.home
                        1 -> TabIconPaths.wealth
                        3 -> TabIconPaths.bell
                        else -> TabIconPaths.person
                    }
                    Box(contentAlignment = Alignment.Center) {
                        DrawnIcon(
                            paths = paths,
                            color = if (index == current) Tokens.Accent else Tokens.Muted,
                            tick = ticks[index],
                        )
                        if (index == 3) {
                            Box(
                                Modifier
                                    .align(Alignment.BottomEnd)
                                    .offset(x = 2.dp, y = 1.dp)
                                    .size(7.dp)
                                    .clip(CircleShape)
                                    .background(Tokens.Coral)
                                    .border(1.5.dp, Tokens.Surface, CircleShape),
                            )
                        }
                    }
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
