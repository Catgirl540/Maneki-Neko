package cn.waveflow.luckycat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cn.waveflow.luckycat.data.AppGraph
import cn.waveflow.luckycat.ui.AppShell
import cn.waveflow.luckycat.ui.login.LoginScreen
import cn.waveflow.luckycat.ui.openaccount.OpenAccountScreen
import cn.waveflow.luckycat.ui.openaccount.OpenAccountViewModel
import cn.waveflow.luckycat.ui.login.LoginViewModel
import cn.waveflow.luckycat.ui.theme.LuckyCatTheme
import cn.waveflow.luckycat.ui.theme.Palette

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Android 15 起，targetSdk ≥ 35 的应用被**强制** edge-to-edge：窗口铺满整屏，
        // 内容默认从 y=0 开始画，窗口自己不再让位给状态栏。
        //
        // 真机上（AMG-AN00 / API 36 / 1200×2664）实测：状态栏 inset 126px，
        // 而登录页标题顶端落在 78px——**被状态栏压住 48px**。模拟器同属 API 35+，
        // 一样中招，只是当时没盯着系统栏看。
        //
        // 显式进入 edge-to-edge 还有第二个理由：深浅图标。不写这句，状态栏图标
        // 在米白底上是白的，等于没有状态栏。
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            LuckyCatTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Palette.canvas) {
                    val graph = (application as LuckyCatApplication).graph
                    // **系统栏 inset 只在根部消费一次**，见下面这段注释。
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .windowInsetsPadding(WindowInsets.systemBars),
                    ) {
                        LuckyCatRoot(graph)
                    }
                }
            }
        }
    }
}

/**
 * 登录与已登录两条路。
 *
 * **不引导航库**：只有"标签页 + 推进去的详情页"两类目的地，
 * 一个 list 当返回栈 + 一个 `BackHandler` 就够，少一个依赖也少一层要学的 API。
 * 真需要深链接 / 嵌套图的时候再换（替换点就是这里）。
 *
 * ## 系统栏 inset 为什么在根部一次消费（而不是每屏自己管）
 *
 * 两条路里只有已登录那条走了 `AppShell`，`Scaffold` 会替它把 systemBars 内边距加好；
 * **登录页和开户页在 shell 外面**，谁都不会替它们加——真机上就是它们被压住。
 * 与其在 shell 外逐屏补、以后每加一个屏再踩一次，不如在 `onCreate` 里包一层
 * 消费掉：`Scaffold` 拿到的 inset 归零，**不会重复加一份**。
 *
 * 用的是 `systemBars` 而不是 `safeDrawing`：后者含 IME，在根部吃掉键盘 inset 后
 * 客服页自己的 `imePadding()` 会变成空操作，消息列表的收缩行为也跟着变
 * （那边要的是"只有输入栏让位"，不是整页被顶上去）。
 */
@Composable
fun LuckyCatRoot(graph: AppGraph) {
    val session by graph.session.collectAsState()
    // **开户在登录之前**，所以这个目的地得挂在 shell 外面：
    // 没有账户的人根本进不去 AppShell。网页版也是登录页底部直接给的开户入口。
    var openingAccount by remember { mutableStateOf(false) }

    if (session == null) {
        if (openingAccount) {
            // **系统返回键要回到登录**，而不是退出 App。
            // 只放一个「返回登录」按钮不够：安卓用户的肌肉记忆是点返回键，
            // 那一下会把整个 App 关掉（实测踩到）。
            androidx.activity.compose.BackHandler { openingAccount = false }
            // 开户要手机号，但**不需要已登录**——手机号由用户在这一页自己填
            val vm: OpenAccountViewModel = viewModel { OpenAccountViewModel(graph.bank) }
            val state by vm.state.collectAsState()
            Column(modifier = Modifier.fillMaxSize()) {
                TextButton(
                    onClick = { openingAccount = false },
                    modifier = Modifier.padding(start = 8.dp, top = 4.dp).testTag("join-back"),
                ) {
                    Text("‹ 返回登录")
                }
                OpenAccountScreen(
                    state = state,
                    onPhoneChange = vm::updatePhone,
                    onPasswordChange = vm::updatePassword,
                    onConfirmPasswordChange = vm::updateConfirmPassword,
                    onNameChange = vm::updateName,
                    onIdNumberChange = vm::updateIdNumber,
                    onSmsChange = vm::updateSmsCode,
                    onPledgedChange = vm::setPledged,
                    onConfirmedChange = vm::setConfirmed,
                    onRequestSms = vm::requestSms,
                    onVerifyFace = vm::verifyFace,
                    onSubmit = {
                        vm.submit { result -> graph.signIn(result.token, result.user) }
                    },
                    onDismissError = vm::dismissError,
                )
            }
            return
        }
        val vm: LoginViewModel = viewModel { LoginViewModel(graph.bank) }
        val state by vm.state.collectAsState()
        LoginScreen(
            state = state,
            onPhoneChange = vm::updatePhone,
            onPasswordChange = vm::updatePassword,
            onSmsCodeChange = vm::updateSmsCode,
            onRequestSms = vm::requestSms,
            onSubmit = { vm.submit(graph::signIn) },
            onOpenAccount = { openingAccount = true },
        )
    } else {
        // session 在这里一定非空；AppShell 只需要用户信息
        AppShell(graph = graph, session = session!!)
    }
}
