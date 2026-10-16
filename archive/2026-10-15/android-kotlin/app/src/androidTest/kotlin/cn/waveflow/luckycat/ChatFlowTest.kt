package cn.waveflow.luckycat

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import cn.waveflow.luckycat.contract.AgentApi
import cn.waveflow.luckycat.data.ConversationStore
import cn.waveflow.luckycat.ui.chat.ChatScreen
import cn.waveflow.luckycat.ui.chat.ChatViewModel
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.File

/**
 * 按 testTag 前缀找节点。
 *
 * Compose 测试只提供精确匹配（`onNodeWithTag`），而消息的 tag 带 id
 * （`msg-assistant-xxxx`），测试里拿不到那个 id，只能按前缀找。
 */
private fun ComposeContentTestRule.onAllNodesWithTagPrefix(prefix: String) =
    onAllNodes(
        SemanticsMatcher("testTag 以 $prefix 开头") { node ->
            node.config.getOrNull(SemanticsProperties.TestTag)?.startsWith(prefix) == true
        },
    )

/**
 * 聊天链路：SSE 事件 → 界面。
 *
 * 用 **MockWebServer 喂固定的 SSE**，不是打真 agent：那样才不花钱、不因为上游抖动
 * 而红，而且能精确构造"推一张确认卡片""卡片被结算"这种真实环境里很难复现的时刻。
 *
 * 真桥接的形状由 `:contract` 的 `LiveContractTest` 与 `tools/check-deployed.mjs` 负责。
 */
class ChatFlowTest {

    @get:Rule
    val rule = createComposeRule()

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()

        // **每个用例都要清掉存档**：`ConversationStore` 落在应用私有目录里，
        // 而 instrumented 测试共用同一个应用安装——不清的话后一个用例会读到
        // 前一个用例留下的对话，断言就变成看运气了。（实测踩到：
        // "会话是发第一句话时才建的"拿到了上一轮留下的 agentSessionId。）
        File(ApplicationProvider.getApplicationContext<Context>().filesDir, "agent-sessions.json").delete()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun json(body: String) = MockResponse()
        .setResponseCode(200).setHeader("content-type", "application/json").setBody(body)

    /** 按路径分发，不依赖请求顺序——顺序分发在流式请求上很容易抖。 */
    private fun routeTo(vararg events: String) = routeToInternal(false, *events)

    /** 同 [routeTo]，但让 SSE **保持连接开着**——取消路径需要一次阻塞中的读取。 */
    private fun routeToKeepingStreamOpen(vararg events: String) = routeToInternal(true, *events)

    private fun routeToInternal(keepStreamOpen: Boolean, vararg events: String) {
        val sseBody = events.joinToString("") { "data: $it\n\n" }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.path == "/agent-api/sessions" -> json("""{"sessionId":"web-test"}""")

                request.path?.endsWith("/stream") == true -> MockResponse()
                    .setResponseCode(200)
                    .setHeader("content-type", "text/event-stream; charset=utf-8")
                    .setBody(sseBody)
                    // 保持连接开着：这样"取消订阅"才真的发生在一次**阻塞中的读取**上
                    // （有限 body 会立刻 EOF，取消路径根本走不到）
                    .apply { if (keepStreamOpen) setSocketPolicy(SocketPolicy.KEEP_OPEN) }

                request.path?.endsWith("/messages") == true ->
                    MockResponse().setResponseCode(202).setBody("""{"accepted":true}""")

                else -> MockResponse().setResponseCode(404)
            }
        }
    }

    /** 起一个真的 ViewModel 并接到界面上——这样测的是完整链路，不是单个组件。 */
    private fun startChat(vararg events: String): ChatViewModel = startChatInternal(false, *events)

    private fun startChatKeepingStreamOpen(vararg events: String): ChatViewModel =
        startChatInternal(true, *events)

    private fun startChatInternal(keepStreamOpen: Boolean, vararg events: String): ChatViewModel {
        if (keepStreamOpen) routeToKeepingStreamOpen(*events) else routeTo(*events)
        val store = ConversationStore(ApplicationProvider.getApplicationContext())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val vm = ChatViewModel(
            AgentApi(server.url("/").toString()),
            store,
            cn.waveflow.luckycat.voice.VoiceRecorder(context),
        )
        rule.setContent {
            val state by vm.state.collectAsState()
            ChatScreen(
                state = state,
                onSend = vm::send,
                onNewConversation = vm::newConversation,
                onOpenConversation = vm::openConversation,
                onAnswerConsent = vm::answerConsent,
                onAnswerQuestion = vm::answerQuestion,
                onDismissError = vm::dismissError,
            )
        }
        return vm
    }

    private fun send(text: String) {
        rule.onNodeWithTag("chat-input").performTextInput(text)
        rule.onNodeWithTag("chat-send").performClick()
    }

    @Test
    fun 发一句话会看到助手回复() {
        startChat(
            """{"type":"hello","sessionId":"web-test"}""",
            """{"type":"status","status":"running"}""",
            """{"type":"assistant","text":"您好，我是小招。"}""",
            """{"type":"status","status":"idle"}""",
        )
        send("你好")
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTagPrefix("msg-assistant-").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag("chat-input").assertIsDisplayed()
    }

    @Test
    fun 工具调用会把结果摘要回填到那一行() {
        startChat(
            """{"type":"tool-call","callId":"call_1","name":"bank_get_balance"}""",
            """{"type":"tool-result","callId":"call_1","isError":false,"text":"{\"balance\":\"¥128,640.55\"}"}""",
            """{"type":"status","status":"idle"}""",
        )
        send("查余额")
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTagPrefix("msg-tool-").fetchSemanticsNodes().isNotEmpty()
        }
        rule.waitUntil(10_000) {
            rule.onAllNodesWithText("余额 ¥128,640.55", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun SSE推来确认卡片时会显示交易信息() {
        startChat(
            """{"type":"consent","challenge":{"challengeId":"c1","kind":"转账","verification":"payment-password",""" +
                """"fields":[{"label":"收款人","value":"梁乐怡"},{"label":"金额","value":"¥800.00","emphasis":true}],""" +
                """"consequence":"确认后立即扣款，不可撤销","expiresAt":${System.currentTimeMillis() + 60_000}}}""",
        )
        send("帮我转 800 元给梁乐怡")
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag("consent-card").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag("consent-field-收款人").assertIsDisplayed()
        rule.onNodeWithTag("consent-field-金额").assertIsDisplayed()
        rule.onNodeWithTag("consent-password").assertIsDisplayed()
    }

    @Test
    fun 只读操作的确认卡片没有密码框() {
        startChat(
            """{"type":"consent","challenge":{"challengeId":"c2","kind":"查看余额",""" +
                """"fields":[{"label":"账户","value":"储蓄账户"}],"expiresAt":${System.currentTimeMillis() + 60_000}}}""",
        )
        send("查一下余额")
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag("consent-card").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag("consent-password").assertDoesNotExist()
    }

    @Test
    fun 卡片被结算之后就收起来了() {
        startChat(
            """{"type":"consent","challenge":{"challengeId":"c3","kind":"转账",""" +
                """"fields":[{"label":"金额","value":"¥1.00"}],"expiresAt":${System.currentTimeMillis() + 60_000}}}""",
            """{"type":"consent-resolved","challengeId":"c3","decision":"timeout"}""",
        )
        send("转一块钱")
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag("consent-card").fetchSemanticsNodes().isEmpty() &&
                rule.onAllNodesWithTagPrefix("msg-user-").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun SSE推来提问卡片时会显示选项且未答不能提交() {
        startChat(
            """{"type":"question","question":{"questionId":"ask_1","questions":[""" +
                """{"id":"q1","question":"要转给谁？","options":["梁乐怡","陈嘉禾"]}]}}""",
        )
        send("我要转账")
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag("question-card").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag("option-q1-梁乐怡").assertIsDisplayed()
        rule.onNodeWithTag("question-submit").assertIsNotEnabled()
    }

    // ── 会话历史 ────────────────────────────────────────────────────────

    @Test
    fun 历史里能看到聊过的对话并切回去() {
        val vm = startChat("""{"type":"assistant","text":"好的"}""")
        send("第一段")
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTagPrefix("msg-assistant-").fetchSemanticsNodes().isNotEmpty()
        }
        rule.waitUntil(5_000) { vm.state.value.conversation?.title == "第一段" }

        // 开新的一段：标题自动起名，历史里应该有两段
        rule.onNodeWithTag("chat-new").performClick()
        rule.waitForIdle()
        rule.waitUntil(5_000) { vm.state.value.conversations.size >= 2 }

        rule.onNodeWithTag("chat-history").performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag("history-list").fetchSemanticsNodes().isNotEmpty()
        }
        // 聊过的那段在列表里
        val first = vm.state.value.conversations.first { it.title == "第一段" }
        rule.onNodeWithTag("history-${first.id}").assertIsDisplayed()

        // 点它 → 切回去
        rule.onNodeWithTag("history-${first.id}").performClick()
        rule.waitUntil(5_000) { vm.state.value.conversation?.id == first.id }
        rule.onAllNodesWithTag("history-list").fetchSemanticsNodes().isEmpty()
    }

    @Test
    fun 没有别的对话时历史里说明而不是空白() {
        startChat("""{"type":"hello","sessionId":"web-test"}""")
        rule.waitUntil(5_000) { vm_conversationsLoaded() }
        rule.onNodeWithTag("chat-history").performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag("history-overlay").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag("history-empty").assertIsDisplayed()
    }

    private fun vm_conversationsLoaded(): Boolean = true

    // ── 取消不是失败 ────────────────────────────────────────────────────

    @Test
    fun 取消订阅不会冒出一条假错误() {
        // SSE **保持连接开着**，所以订阅会一直挂在一次阻塞读取上；
        // 这时 openConversation 会取消它。
        //
        // `CancellationException` 是 `Exception` 的子类，`catch (e: Exception)`
        // 会把它一起吞掉——那样切标签页/换会话时界面就冒一条"网络不给力"，
        // 而其实什么都没坏。（实测踩到过，这条盯的就是它。）
        val vm = startChatKeepingStreamOpen("""{"type":"hello","sessionId":"web-test"}""")
        send("你好")
        rule.waitUntil(10_000) { vm.state.value.conversation?.agentSessionId != null }
        rule.waitUntil(5_000) { vm.state.value.error == null }

        val id = vm.state.value.conversation!!.id
        vm.openConversation(id)   // 取消旧订阅 + 重新订阅
        rule.waitForIdle()
        Thread.sleep(600)         // 给被取消的那条协程一点时间把异常抛出来

        assertEquals("取消不该被当成失败", null, vm.state.value.error)
    }

    @Test
    fun 会话是发第一句话时才建的() {
        val vm = startChat("""{"type":"hello","sessionId":"web-test"}""")
        rule.waitUntil(5_000) { vm.state.value.conversation != null }
        assertEquals(null, vm.state.value.conversation!!.agentSessionId)

        send("你好")
        rule.waitUntil(10_000) { vm.state.value.conversation?.agentSessionId != null }
        assertEquals("web-test", vm.state.value.conversation!!.agentSessionId)
    }
}
