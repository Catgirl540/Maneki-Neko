package cn.waveflow.luckycat

import android.content.Context
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ApplicationProvider
import cn.waveflow.luckycat.contract.AgentApi
import cn.waveflow.luckycat.data.ConversationStore
import cn.waveflow.luckycat.domain.conversation.ChatItem
import cn.waveflow.luckycat.ui.chat.ChatScreen
import cn.waveflow.luckycat.ui.chat.ChatViewModel
import cn.waveflow.luckycat.voice.VoiceRecorder
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * 消息上的两个动作：重新生成 / 编辑重发。
 *
 * 最要紧的两条：**重发不能产生重复的用户消息**（倒回之后那句已经在列表里了），
 * 以及**重新生成只能挂在最后一条助手回复上**（挂到中间那条就得把后面几轮全丢掉）。
 */
class MessageActionsUiTest {

    @get:Rule
    val rule = createComposeRule()

    private lateinit var server: MockWebServer
    private val sentTexts = mutableListOf<String>()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                if (path.endsWith("/messages")) {
                    val body = request.body.readUtf8()
                    val text = body.substringAfter("\"text\":\"").substringBefore("\"")
                    sentTexts += text
                }
                return when {
                    path == "/agent-api/sessions" -> json("""{"sessionId":"web-act"}""")
                    path.endsWith("/stream") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("content-type", "text/event-stream; charset=utf-8")
                        .setBody("""data: {"type":"assistant","text":"好的"}""" + "\n\n")
                    path.endsWith("/messages") -> MockResponse().setResponseCode(202).setBody("""{"accepted":true}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun json(b: String) = MockResponse()
        .setResponseCode(200).setHeader("content-type", "application/json").setBody(b)

    /**
     * 直接**播一段两轮对话的存档**再建 ViewModel。
     *
     * 不走"发两句等回复"：mock 的 SSE 只有一个 assistant 事件，
     * 第二轮根本不会有回复（真实桥接是长连接、每轮推一条）。
     * 种子存档更确定，而且这几个用例要测的本来就是"对已有消息做动作"。
     */
    private fun startChat(): ChatViewModel {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = ConversationStore(context)
        kotlinx.coroutines.runBlocking { store.save(listOf(seedConversation())) }
        val vm = ChatViewModel(
            AgentApi(server.url("/").toString()),
            store,
            VoiceRecorder(context),
        )
        rule.setContent {
            val state by vm.state.collectAsState()
            val voice by vm.voice.state.collectAsState()
            ChatScreen(
                state = state,
                voice = voice,
                onSpeak = vm::speak,
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
        return vm
    }

    /** 种一段两轮对话：u1/a1/u2/a2。 */
    private fun seedConversation() = cn.waveflow.luckycat.domain.conversation.StoredConversation(
        id = "c_seed",
        agentSessionId = "web-act",
        title = "测试对话",
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis(),
        items = listOf(
            ChatItem.User("u1", "第一句"),
            ChatItem.Assistant("a1", "好的"),
            ChatItem.User("u2", "第二句"),
            ChatItem.Assistant("a2", "好的"),
        ),
    )

    /** 等存档被读进来。`init` 是异步的，不等就 `send` 会直接返回。 */
    private fun twoTurns(vm: ChatViewModel) {
        rule.waitUntil(10_000) { vm.state.value.conversation?.items?.size == 4 }
    }

    private fun items(vm: ChatViewModel) = vm.state.value.conversation!!.items

    @Test
    fun 重新生成只出现在最后一条助手回复上() {
        val vm = startChat()
        twoTurns(vm)
        val assistantIds = items(vm).filterIsInstance<ChatItem.Assistant>().map { it.id }
        assertEquals(2, assistantIds.size)

        // 最后一条有
        rule.onNodeWithTag("regenerate-${assistantIds[1]}").assertExists()
        // **中间那条没有**——重新生成它就得把后面几轮全丢掉
        rule.onAllNodesWithTag("regenerate-${assistantIds[0]}").fetchSemanticsNodes().let {
            assertTrue("中间那条助手回复不该有「重新生成」", it.isEmpty())
        }
    }

    @Test
    fun 重新生成会把助手那条丢掉再问一遍() {
        val vm = startChat()
        twoTurns(vm)
        val before = items(vm)
        val lastAssistant = before.filterIsInstance<ChatItem.Assistant>().last()

        vm.regenerate(lastAssistant.id)
        // 种好的对话不会再发前两句，所以这里只会有**一次**发送（就是重发那一次）
        rule.waitUntil(10_000) { sentTexts.isNotEmpty() }
        // 发出去的仍然是那句提问
        assertEquals("第二句", sentTexts.last())
        // 倒回之后助手那条没了，随后流又推了一条回来
        rule.waitUntil(10_000) {
            items(vm).count { it is ChatItem.User } == 2
        }
    }

    @Test
    fun 编辑重发换掉那句提问且不产生重复() {
        val vm = startChat()
        twoTurns(vm)
        val secondUser = items(vm).filterIsInstance<ChatItem.User>().last()

        vm.editAndResend(secondUser.id, "改成第三句")
        // 同上：只有重发那一次
        rule.waitUntil(10_000) { sentTexts.isNotEmpty() }

        // 发出去的是改后的文字
        assertEquals("改成第三句", sentTexts.last())

        // **不能变成三条用户消息**：倒回之后那句已经在列表里了，再追加就是重复
        rule.waitUntil(10_000) {
            items(vm).filterIsInstance<ChatItem.User>().size == 2
        }
        val users = items(vm).filterIsInstance<ChatItem.User>()
        assertEquals(listOf("第一句", "改成第三句"), users.map { it.text })
    }

    @Test
    fun 用户消息上有编辑入口() {
        val vm = startChat()
        twoTurns(vm)
        val firstUser = items(vm).filterIsInstance<ChatItem.User>().first()
        rule.onNodeWithTag("edit-${firstUser.id}").assertExists()
    }

    @Test
    fun 编辑弹窗要说清服务端退不了() {
        // 助手那边仍然记得被丢掉的那些话，这件事不能藏着
        val vm = startChat()
        twoTurns(vm)
        val firstUser = items(vm).filterIsInstance<ChatItem.User>().first()
        rule.onNodeWithTag("edit-${firstUser.id}").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("edit-caveat").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("edit-caveat").assertExists()
    }

    @Test
    fun 编辑成空白时不提交() {
        val vm = startChat()
        twoTurns(vm)
        val firstUser = items(vm).filterIsInstance<ChatItem.User>().first()
        rule.onNodeWithTag("edit-${firstUser.id}").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("edit-input").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("edit-input").performTextReplacement("   ")
        rule.waitForIdle()
        rule.onNodeWithTag("edit-confirm").assertIsNotEnabled()
    }
}
