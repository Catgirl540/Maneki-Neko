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
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.selection.selectable
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role

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

/** dev 包自动登录用的演示账户（与 README 里的演示账号一致）。 */
private const val DEV_LOGIN_PHONE = "13800138000"
private const val DEV_LOGIN_PASSWORD = "123456"

/**
 * dev 包启动时的自动登录：向演示环境要一条验证码再登录（演示环境会把码回传）。
 * 失败不阻塞——直接退回正常登录页，人工登录即可。
 */
@Composable
private fun DevAutoLogin(onLoggedIn: () -> Unit) {
    var failure by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        failure = null
        runCatching {
            val code = BankApi.sendSmsCode(DEV_LOGIN_PHONE)
                ?: throw IllegalStateException("演示环境没有返回验证码")
            BankApi.login(DEV_LOGIN_PHONE, DEV_LOGIN_PASSWORD, code)
        }.onSuccess { result ->
            SessionStore.save(result)
            onLoggedIn()
        }.onFailure {
            android.util.Log.e("DevAutoLogin", "自动登录失败", it)
            failure = it.message ?: "自动登录失败"
        }
    }
    if (failure == null) {
        Box(
            Modifier.fillMaxSize().background(Tokens.Page),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Image(
                    painter = painterResource(R.drawable.brand_cat),
                    contentDescription = null,
                    modifier = Modifier.size(72.dp),
                    contentScale = ContentScale.Fit,
                )
                Spacer(Modifier.height(14.dp))
                Text("正在登录演示账户…", style = Tokens.Text.note)
            }
        }
    } else {
        AuthGate(onLoggedIn = onLoggedIn)
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

private data class NavState(
    val tab: Int,
    val route: String?,
    val depth: Int,
)

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun BankApp() {
    // 未登录一律先登录，避免用界面里的静态占位数据冒充账户数据。
    // dev 包（包名 .dev）例外：直接登录演示账户，省掉每次联调的手动登录。
    if (!AuthState.loggedIn) {
        if (BuildConfig.AUTO_LOGIN_DEMO) {
            DevAutoLogin(onLoggedIn = { AuthState.loggedIn = true })
        } else {
            AuthGate(onLoggedIn = { AuthState.loggedIn = true })
        }
        return
    }
    LaunchedEffect(Unit) { runCatching { BankApi.refreshFinancialRecovery() } }
    var tab by remember { mutableIntStateOf(0) }
    var wealthInitialTab by remember { mutableIntStateOf(0) }
    val stack = remember { mutableStateListOf<String>() }
    val push: (String) -> Unit = { stack.add(it) }
    val pop: () -> Unit = { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
    // 返回键：二级页回退；助手（全屏 tab）回主页；主页再按才退出应用
    BackHandler(enabled = stack.isNotEmpty() || tab == 2) {
        if (stack.isNotEmpty()) pop() else tab = 0
    }
    val goHome: () -> Unit = { stack.clear(); tab = 0 }
    FinancialRecoveryDialog(onResolved = goHome)
    var transferDraft by remember { mutableStateOf(TransferDraft()) }
    var transferResult by remember { mutableStateOf<TransferResultDto?>(null) }
    var selectedTxId by remember { mutableStateOf<String?>(null) }
    var selectedProductCode by remember { mutableStateOf<String?>(null) }

    val navState = NavState(tab = tab, route = stack.lastOrNull(), depth = stack.size)
    val showBottomBar = navState.route == null && navState.tab != 2

    Scaffold(
        containerColor = Tokens.Page,
        bottomBar = {
            // 底栏跟页面一起进退：二级页推入时向下滑出，回来时滑入，避免"啪"地消失。
            androidx.compose.animation.AnimatedVisibility(
                visible = showBottomBar,
                enter = androidx.compose.animation.slideInVertically(tween(200, easing = StandardOutSlowIn)) { it } +
                    androidx.compose.animation.fadeIn(tween(160)),
                exit = androidx.compose.animation.slideOutVertically(tween(200, easing = StandardOutSlowIn)) { it } +
                    androidx.compose.animation.fadeOut(tween(140)),
            ) { BottomBar(current = tab, onSelect = { tab = it }) }
        },
    ) { padding ->
        // 转场容器固定铺满：底栏显隐只改页面内部留白，不再改变容器尺寸。
        val topInset = padding.calculateTopPadding()
        val navInset = WindowInsets.navigationBars
            .asPaddingValues().calculateBottomPadding()
        val tabBottomInset = navInset + 64.dp
        Box(
            Modifier
                .fillMaxSize()
                .background(Tokens.Page),
        ) {
            androidx.compose.animation.AnimatedContent(
                targetState = navState,
                modifier = Modifier.fillMaxSize(),
                transitionSpec = {
                    when {
                        // 1) Push 二级页：新页整页从右侧推入，旧页向左让出一小段并淡出。
                        // 之前只位移 18% 再交叉淡出，看起来像整页在抖，这里改成标准推入。
                        targetState.depth > initialState.depth -> {
                            (androidx.compose.animation.slideInHorizontally(
                                tween(260, easing = StandardOutSlowIn)
                            ) { it } +
                                androidx.compose.animation.fadeIn(tween(150, easing = StandardOutSlowIn)))
                                .togetherWith(
                                    androidx.compose.animation.slideOutHorizontally(
                                        tween(260, easing = StandardOutSlowIn)
                                    ) { -(it * 0.22f).toInt() } +
                                        androidx.compose.animation.fadeOut(tween(200))
                                )
                                .using(androidx.compose.animation.SizeTransform(clip = false) { _, _ -> tween(0) })
                                .apply { targetContentZIndex = 1f }
                        }
                        // 2) Pop 返回：上一页从左归位，当前页整页推出右侧。
                        targetState.depth < initialState.depth -> {
                            (androidx.compose.animation.slideInHorizontally(
                                tween(260, easing = StandardOutSlowIn)
                            ) { -(it * 0.22f).toInt() } +
                                androidx.compose.animation.fadeIn(tween(200)))
                                .togetherWith(
                                    androidx.compose.animation.slideOutHorizontally(
                                        tween(260, easing = StandardOutSlowIn)
                                    ) { it } +
                                        androidx.compose.animation.fadeOut(tween(150))
                                )
                                .using(androidx.compose.animation.SizeTransform(clip = false) { _, _ -> tween(0) })
                                .apply { targetContentZIndex = 1f }
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
                Box(
                    Modifier
                        .fillMaxSize()
                        .padding(top = topInset)
                        .padding(bottom = if (route == null) tabBottomInset else navInset),
                ) {
                if (route == null) {
                    when (state.tab) {
                        0 -> HomeScreen(onOpen = push, onSwitchTab = { tab = it }, onOpenTx = { id -> selectedTxId = id; push("交易详情") })
                        1 -> WealthTab(
                            onOpenProduct = { code -> selectedProductCode = code; push("产品详情") },
                            onOpenPlans = { push("储蓄与计划") },
                            initialTab = wealthInitialTab,
                        )
                        2 -> AssistantScreen(onBack = { tab = 0 }, onSupport = { push("人工客服工单") })
                        3 -> NotifyTab(onOpenAa = { push("AA 付款") }, onOpenTx = { id -> selectedTxId = id; push("交易详情") })
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
                                "账户资产" -> push("存款")
                                "理财总览", "产品市场", "我的持仓", "理财记录" -> {
                                    wealthInitialTab = when (target) { "产品市场" -> 1; "我的持仓" -> 2; "理财记录" -> 3; else -> 0 }
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
                        "消费分析" -> AnalysisScreen(onBack = pop, onReport = { push("账单报告") })
                        "账单报告" -> BillingReportScreen(onBack = pop, onBudgets = { push("支出预算") })
                        "支出预算" -> BudgetScreen(onBack = pop)
                        "模拟消费" -> SpendScreen(onBack = pop, onTransactions = { push("交易记录") })
                        "存款" -> DepositsScreen(
                            onBack = pop,
                            onTransferIn = { push("转入") },
                            onTransferOut = { push("转出") },
                            onTransactions = { push("交易记录") },
                        )
                        "转入" -> TransferInSheet(onDismiss = pop)
                        "换汇" -> ExchangeScreen(onBack = pop)
                        "交易详情" -> TxDetailScreen(onBack = pop, transactionId = selectedTxId)
                        "寄送信息" -> DeliveryScreen(onBack = pop)
                        "会员等级" -> MembershipScreen(onBack = pop)
                        "储蓄与计划" -> PlansScreen(onBack = pop)
                        "安全中心" -> SecurityScreen(onBack = pop)
                        "个人资料" -> ProfileScreen(onBack = pop, onChangePhone = { push("修改手机号") })
                        "修改手机号" -> ChangePhoneScreen(onBack = pop)
                        "IM 连接" -> ImScreen(onBack = pop, onReminders = { push("微信日程提醒") })
                        "微信日程提醒" -> ImRemindersScreen(onBack = pop)
                        "通知设置" -> NotifySettingsScreen(onBack = pop)
                        "语言与地区" -> LanguageScreen(onBack = pop)
                        "帮助与客服" -> HelpScreen(onBack = pop, onAssistant = { stack.clear(); tab = 2 })
                        "人工客服工单" -> SupportTicketsScreen(onBack = pop)
                        "关于" -> AboutScreen(onBack = pop)
                        "登录" -> LoginScreen(
                            onBack = pop,
                            onLogin = goHome,
                            onRegister = { push("开户·手机号") },
                        )
                        // 开户四步现在走「未登录根流程」，这几个遗留入口只展示提示页。
                        "开户·手机号" -> OpenPhoneScreen(onBack = pop)
                        "开户·实名" -> OpenRealNameScreen(onBack = pop)
                        "开户·核验" -> OpenFaceScreen(onBack = pop)
                        "开户·支付密码" -> OpenPasswordScreen(onBack = pop)
                        "开户完成" -> OpenDoneScreen(onBack = pop, onHome = goHome)
                        "自动扣款" -> AutoDebitScreen(onBack = pop)
                        "定时转账与 AA" -> PaymentPlansScreen(onBack = pop)
                        "AA 付款" -> PaymentPlansScreen(onBack = pop, initialTab = 2)
                        "工资与备用金" -> PayrollScreen(onBack = pop)
                        "借款与分期" -> CreditScreen(onBack = pop)
                        "保险保障" -> InsuranceScreen(onBack = pop)
                        "邀请与奖励" -> InviteScreen(onBack = pop)
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
                            heading = when (route) {
                                "银行卡号转账" -> "内地转账"
                                "跨境支付通" -> "境外转账"
                                else -> route
                            },
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
                    .semantics {
                        contentDescription = tab.label
                    }
                    .selectable(
                        selected = index == current,
                        role = Role.Tab,
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
        Text(title, style = Tokens.Text.note)
        if (trailing != null) Text(trailing, style = Tokens.Text.hint)
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
