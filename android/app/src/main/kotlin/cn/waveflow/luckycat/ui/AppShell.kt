package cn.waveflow.luckycat.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cn.waveflow.luckycat.data.AppGraph
import cn.waveflow.luckycat.data.ConversationStore
import cn.waveflow.luckycat.voice.VoiceRecorder
import cn.waveflow.luckycat.data.Session
import cn.waveflow.luckycat.ui.account.AccountScreen
import cn.waveflow.luckycat.ui.chat.ChatScreen
import cn.waveflow.luckycat.ui.cards.CardsScreen
import cn.waveflow.luckycat.ui.cards.CardsViewModel
import cn.waveflow.luckycat.ui.chat.ChatViewModel
import cn.waveflow.luckycat.ui.analysis.AnalysisScreen
import cn.waveflow.luckycat.ui.analysis.AnalysisViewModel
import cn.waveflow.luckycat.ui.security.SecurityScreen
import cn.waveflow.luckycat.ui.security.SecurityViewModel
import cn.waveflow.luckycat.ui.account.AccountViewModel
import cn.waveflow.luckycat.ui.home.HomeScreen
import cn.waveflow.luckycat.ui.home.HomeViewModel
import cn.waveflow.luckycat.ui.theme.NavGlyph
import cn.waveflow.luckycat.ui.theme.NavIcon
import cn.waveflow.luckycat.ui.theme.Palette
import cn.waveflow.luckycat.ui.transfer.TransferScreen
import cn.waveflow.luckycat.ui.wealth.WealthOpeningScreen
import cn.waveflow.luckycat.ui.wealth.WealthOpeningViewModel
import cn.waveflow.luckycat.ui.wealth.WealthScreen
import cn.waveflow.luckycat.ui.wealth.WealthViewModel
import cn.waveflow.luckycat.ui.transfer.TransferViewModel
import cn.waveflow.luckycat.ui.tx.TransactionScreen
import cn.waveflow.luckycat.ui.tx.TransactionViewModel

/** 底部导航的五个入口。客服放在中间——它是这个产品的核心，不该藏在二级页里。 */
enum class TabId(val label: String, val icon: NavIcon) {
    Home("首页", NavIcon.Home),
    Transfer("转账", NavIcon.Transfer),
    Support("客服", NavIcon.Support),
    Wealth("理财", NavIcon.Wealth),
    Profile("我的", NavIcon.Profile),
}

/**
 * 导航目的地。
 *
 * 只有"标签页"和"从标签页推进去的详情页"两类，所以一个 list 当返回栈就够，
 * 不引导航库（理由见 `MainActivity` 上的说明）。
 */
sealed interface Dest {
    data class Tab(val id: TabId) : Dest
    data class Account(val id: String) : Dest
    data class Transaction(val id: String) : Dest
    data object Cards : Dest
    data object Security : Dest
    data object Analysis : Dest
}

@Composable
fun AppShell(graph: AppGraph, session: Session) {
    var stack by remember { mutableStateOf(listOf<Dest>(Dest.Tab(TabId.Home))) }
    val current = stack.last()

    BackHandler(enabled = stack.size > 1) { stack = stack.dropLast(1) }

    Scaffold(containerColor = Palette.canvas) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
        Column(modifier = Modifier.fillMaxSize()) {
            when (current) {
                // 给悬浮底栏留位：不然滚动到底时最后一行会被药丸盖住
                is Dest.Tab -> Box(modifier = Modifier.padding(bottom = NAV_RESERVED)) {
                    TabContent(
                    tab = current.id,
                    graph = graph,
                    session = session,
                    onOpenAccount = { stack = stack + Dest.Account(it) },
                    onOpenSupport = { stack = listOf(Dest.Tab(TabId.Support)) },
                    onOpenCards = { stack = stack + Dest.Cards },
                    onOpenTab = { id -> stack = listOf(Dest.Tab(id)) },
                    onOpenSecurity = { stack = stack + Dest.Security },
                    onOpenAnalysis = { stack = stack + Dest.Analysis },
                    )
                }

                is Dest.Account -> {
                    DetailScaffold(title = "账户流水", onBack = { stack = stack.dropLast(1) }) {
                        // **按 id 给 key**：不给的话从 A 账户进 B 账户会复用前一个 ViewModel，
                        // 显示的会是 A 的流水（ViewModel 默认按类型做 key）。
                        val vm: AccountViewModel = viewModel(key = "account-${current.id}") {
                            AccountViewModel(graph.bank, current.id)
                        }
                        val state by vm.state.collectAsState()
                        AccountScreen(
                            state = state,
                            onOpenTransaction = { stack = stack + Dest.Transaction(it) },
                            onLoadMore = vm::loadMore,
                            onRetry = vm::refresh,
                        )
                    }
                }

                is Dest.Analysis -> {
                    DetailScaffold(title = "分析", onBack = { stack = stack.dropLast(1) }) {
                        val vm: AnalysisViewModel = viewModel { AnalysisViewModel(graph.bank) }
                        val state by vm.state.collectAsState()
                        AnalysisScreen(state = state, onRetry = vm::load)
                    }
                }

                is Dest.Security -> {
                    DetailScaffold(title = "安全中心", onBack = { stack = stack.dropLast(1) }) {
                        val vm: SecurityViewModel = viewModel { SecurityViewModel(graph.bank) }
                        val state by vm.state.collectAsState()
                        SecurityScreen(state = state, onToggleRule = vm::setRule, onRetry = vm::load)
                    }
                }

                is Dest.Cards -> {
                    DetailScaffold(title = "银行卡", onBack = { stack = stack.dropLast(1) }) {
                        val vm: CardsViewModel = viewModel(key = "cards-${session.user.id}") { CardsViewModel(graph.bank) }
                        val state by vm.state.collectAsState()
                        androidx.compose.runtime.LaunchedEffect(vm) { vm.load() }
                        CardsScreen(
                            state = state,
                            onToggleLock = vm::setLock,
                            onToggleOnline = vm::setOnlinePayment,
                            onToggleOverseas = vm::setOverseasPayment,
                            onRevealSecrets = vm::revealSecrets,
                            onDismissSecrets = vm::dismissSecrets,
                            onDismissError = vm::dismissError,
                            onRetry = vm::load,
                            onLoadProducts = vm::loadProducts,
                            onApply = vm::applyCard,
                            onSetLimit = vm::setDailyLimit,
                        )
                    }
                }

                is Dest.Transaction -> {
                    DetailScaffold(title = "交易详情", onBack = { stack = stack.dropLast(1) }) {
                        val vm: TransactionViewModel = viewModel(key = "tx-${current.id}") {
                            TransactionViewModel(graph.bank, current.id)
                        }
                        val state by vm.state.collectAsState()
                        TransactionScreen(state = state, onRetry = vm::load)
                    }
                }
            }
        }

        // **悬浮药丸底栏**，不是贴底的一条：它盖在内容上、两边留白、整条是圆的。
        // 只有停在标签页根上时才出现；推进详情页后让位给内容。
        if (current is Dest.Tab) {
            BottomBar(
                currentId = current.id,
                onSelect = { id -> stack = listOf(Dest.Tab(id)) },
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
        }
    }
}

/**
 * 悬浮药丸底栏。
 *
 * 三处是这套风格的关键，少一处就不像：
 *   1. **整条是药丸**（全圆角），两边留白、底下留白，**盖在内容上**；
 *   2. **选中态是一个实心金圆**，图标反过来是白的；
 *   3. 未选中只有灰色图标 + 灰字，**没有底板**。
 *
 * 内容区底部要留出它的高度（见 [NAV_RESERVED]），否则最后一行会被盖住。
 */
@Composable
private fun BottomBar(currentId: TabId, onSelect: (TabId) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(bottom = 14.dp)
            .shadow(10.dp, RoundedCornerShape(50))
            .clip(RoundedCornerShape(50))
            .background(Palette.navPill)
            .padding(vertical = 8.dp)
            .testTag("bottom-bar"),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TabId.entries.forEach { tab ->
            val selected = tab == currentId
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onSelect(tab) }
                    .padding(vertical = 2.dp)
                    .testTag("tab-${tab.name.lowercase()}"),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(50))
                        .background(if (selected) Palette.accent else Color.Transparent),
                    contentAlignment = Alignment.Center,
                ) {
                    NavGlyph(
                        icon = tab.icon,
                        color = if (selected) Color.White else Palette.navInactive,
                        size = 22.dp,
                    )
                }
                Text(
                    tab.label,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (selected) Palette.ink else Palette.navInactive,
                )
            }
        }
    }
}

/** 悬浮底栏占掉的高度。内容区底部要留这么多，否则最后一行被盖住。 */
private val NAV_RESERVED = 96.dp

@Composable
private fun TabContent(
    tab: TabId,
    graph: AppGraph,
    session: Session,
    onOpenAccount: (String) -> Unit,
    onOpenSupport: () -> Unit,
    onOpenCards: () -> Unit,
    onOpenTab: (TabId) -> Unit,
    onOpenSecurity: () -> Unit,
    onOpenAnalysis: () -> Unit,
) {
    when (tab) {
        TabId.Home -> {
            val vm: HomeViewModel = viewModel { HomeViewModel(graph.bank) }
            val state by vm.state.collectAsState()
            HomeScreen(
                state = state,
                userName = session.user.name.ifEmpty { "客户" },
                onOpenAccount = onOpenAccount,
                onSignOut = { graph.signOut() },
                onRetry = vm::refresh,
                onOpenSupport = onOpenSupport,
                // 首页那四个圆形入口就是底栏四个标签的另一条路：
                // 首屏够显眼，底栏又一直在，两条路都留着
                onOpenTransfer = { onOpenTab(TabId.Transfer) },
                onOpenWealth = { onOpenTab(TabId.Wealth) },
                onOpenCards = onOpenCards,
            )
        }

        TabId.Transfer -> {
            val vm: TransferViewModel = viewModel { TransferViewModel(graph.bank) }
            val state by vm.state.collectAsState()
            TransferScreen(
                state = state,
                onSelectAccount = vm::selectAccount,
                onSelectPayee = vm::selectPayee,
                onAmountChange = vm::updateAmount,
                onMemoChange = vm::updateMemo,
                onQuote = vm::requestQuote,
                onSubmit = vm::submit,
                onDismissError = vm::dismissError,
            )
        }

        TabId.Wealth -> {
            val vm: WealthViewModel = viewModel { WealthViewModel(graph.bank) }
            val state by vm.state.collectAsState()
            // 开理财账户走**独立一屏**：它是"银行账户 ≠ 理财账户"那条委托关系的
            // 建立过程，塞进理财页当弹窗会把它讲不清
            var opening by remember { mutableStateOf(false) }
            if (opening) {
                // 同开户页：系统返回键要回到理财页，而不是退出 App
                androidx.activity.compose.BackHandler { opening = false }
                val openVm: WealthOpeningViewModel = viewModel { WealthOpeningViewModel(graph.bank) }
                val openState by openVm.state.collectAsState()
                WealthOpeningScreen(
                    state = openState,
                    onChoose = openVm::choose,
                    onSubmitAssessment = openVm::submitAssessment,
                    onNameChange = openVm::updateName,
                    onIdChange = openVm::updateIdNumber,
                    onPhoneChange = openVm::updatePhone,
                    onSmsChange = openVm::updateSmsCode,
                    onSelectSettlement = openVm::selectSettlement,
                    onPledgedChange = openVm::setPledged,
                    onRequestSms = openVm::requestSms,
                    onVerifyFace = openVm::verifyFace,
                    onSubmit = openVm::submit,
                    onDismissError = openVm::dismissError,
                    onDone = {
                        opening = false
                        vm.load()
                    },
                )
            } else {
                WealthScreen(state = state, onRetry = vm::load, onOpenAccount = { opening = true })
            }
        }

        TabId.Support -> SupportTab(graph)

        TabId.Profile -> ProfileTab(
            session = session,
            onOpenCards = onOpenCards,
            onOpenSecurity = onOpenSecurity,
            onOpenAnalysis = onOpenAnalysis,
            onSignOut = { graph.signOut() },
        )

        else -> ComingSoon(tab.label)
    }
}

/**
 * 「我的」：一个入口枢纽。
 *
 * 银行卡、安全中心、分析、开户这些都从这进——底栏只有五个位置，
 * 再往下塞就该分层了。
 */
@Composable
private fun ProfileTab(
    session: Session,
    onOpenCards: () -> Unit,
    onOpenSecurity: () -> Unit,
    onOpenAnalysis: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text("我的", style = MaterialTheme.typography.headlineMedium)

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(28.dp))
                .background(Palette.ink)
                .padding(20.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(54.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Palette.accent),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    session.user.name.ifEmpty { "客" }.take(1),
                    style = MaterialTheme.typography.titleLarge,
                    color = Palette.onAccent,
                )
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    session.user.name.ifEmpty { "客户" },
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                )
                Text(
                    session.user.memberLevel.ifEmpty { "演示用户" },
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.68f),
                )
            }
            Text(
                "LUCKYCAT",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold,
                color = Palette.accent,
            )
        }

        Text("账户与服务", style = MaterialTheme.typography.titleLarge)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Palette.surface)
                .padding(vertical = 4.dp),
        ) {
            HubRow("银行卡", "申卡、换卡与支付管理", NavIcon.Card, "profile-cards", onOpenCards)
            HubDivider()
            HubRow("安全中心", "风控规则、登录设备、安全日志", NavIcon.Profile, "profile-security", onOpenSecurity)
            HubDivider()
            HubRow("财务分析", "支出构成、六个月趋势、现金流", NavIcon.Wealth, "profile-analysis", onOpenAnalysis)
        }
        // 「开立储蓄账户」**不在这里**：那是**注册时**的事（没有账户的人从登录页进），
        // 放进「我的」是把"开户"当成一个登录后随时可做的操作，与网页版不一致。

        TextButton(
            onClick = onSignOut,
            modifier = Modifier.fillMaxWidth().testTag("profile-sign-out"),
        ) {
            Text("退出登录", color = Palette.expense)
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun HubRow(
    title: String,
    subtitle: String,
    icon: NavIcon,
    tag: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 15.dp)
            .testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(50))
                .background(Palette.accentTint),
            contentAlignment = Alignment.Center,
        ) {
            NavGlyph(icon = icon, color = Palette.accentDeep, size = 22.dp)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
        }
        Text("›", style = MaterialTheme.typography.titleLarge, color = Palette.inkMute)
    }
}

@Composable
private fun HubDivider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 74.dp, end = 16.dp)
            .height(1.dp)
            .background(Palette.line),
    )
}

@Composable
private fun SupportTab(graph: AppGraph) {
    val context = LocalContext.current
    // store 只包一个文件路径，随 Composable 重建无所谓；真正要留住的是 ViewModel
    val store = remember(context) { ConversationStore(context.applicationContext) }
    // 录音器只包一个 MediaRecorder，随 Composable 重建无所谓；要留住的是 ViewModel
    val recorder = remember(context) { VoiceRecorder(context.applicationContext) }
    val vm: ChatViewModel = viewModel { ChatViewModel(graph.agent, store, recorder) }
    val state by vm.state.collectAsState()
    val voice by vm.voice.state.collectAsState()
    ChatScreen(
        state = state,
        voice = voice,
        onSpeak = vm::speak,
        onStopSpeaking = vm::stopSpeaking,
        onStartRecording = vm::startRecording,
        onStopRecording = vm::stopRecording,
        onDismissVoiceError = vm.voice::dismissError,
        onRegenerate = vm::regenerate,
        onEditResend = vm::editAndResend,
        onSend = vm::send,
        onNewConversation = vm::newConversation,
        onOpenConversation = vm::openConversation,
        onAnswerConsent = vm::answerConsent,
        onAnswerQuestion = vm::answerQuestion,
        onDismissError = vm::dismissError,
    )
}

/** 详情页的外壳：一行标题 + 返回。 */
@Composable
private fun DetailScaffold(title: String, onBack: () -> Unit, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        TextButton(onClick = onBack, modifier = Modifier.padding(start = 8.dp, top = 4.dp).testTag("detail-back")) {
            Text("‹ $title")
        }
        content()
    }
}

@Composable
private fun ComingSoon(label: String) {
    Column(
        modifier = Modifier.fillMaxSize().testTag("coming-soon"),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("$label 还在做", style = MaterialTheme.typography.titleMedium)
        Text(
            "这一屏还没接上，先留个位置。",
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkSoft,
        )
    }
}
