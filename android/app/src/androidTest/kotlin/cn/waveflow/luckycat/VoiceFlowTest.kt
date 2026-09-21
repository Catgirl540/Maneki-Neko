package cn.waveflow.luckycat

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import cn.waveflow.luckycat.contract.AgentApi
import cn.waveflow.luckycat.data.ConversationStore
import cn.waveflow.luckycat.ui.chat.ChatScreen
import cn.waveflow.luckycat.ui.chat.ChatViewModel
import cn.waveflow.luckycat.voice.VoiceRecorder
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test


/** 按 testTag 前缀找节点（与 ChatFlowTest 里那个同一个道理）。 */
private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTagPrefix(prefix: String) =
    this.onAllNodes(
        androidx.compose.ui.test.SemanticsMatcher("testTag 以 $prefix 开头") { node ->
            node.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)
                ?.startsWith(prefix) == true
        },
    )

/**
 * 语音：界面接线。
 *
 * **不断言"有没有声音"**——测试里听不到声音，硬去断言只会写出假的绿。
 * 这里验的是**接线**：点了朗读真的去请求 TTS、录音按钮在、拿不到麦克风时
 * 给出提示而不是崩。
 *
 * 真正需要耳朵的部分（首帧就出声、波形跟得上）只能真机手工验，
 * 这一点写在 `P13-ANDROID.md` 里，别假装它被覆盖了。
 */
class VoiceFlowTest {

    @get:Rule
    val rule = createComposeRule()

    private lateinit var server: MockWebServer
    private val requests = mutableListOf<String>()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                requests += path
                return when {
                    path == "/agent-api/sessions" -> json("""{"sessionId":"web-voice"}""")

                    path.endsWith("/stream") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("content-type", "text/event-stream; charset=utf-8")
                        .setBody(
                            """data: {"type":"hello","sessionId":"web-voice"}""" + "\n\n" +
                                """data: {"type":"assistant","text":"您好，我是小招。"}""" + "\n\n",
                        )

                    path.endsWith("/messages") -> MockResponse().setResponseCode(202).setBody("""{"accepted":true}""")

                    // TTS 流：start + 两帧音频 + end。**音频是裸 PCM16 的 base64**。
                    path == "/agent-api/tts/stream" -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("content-type", "text/event-stream; charset=utf-8")
                        .setBody(
                            "event: start\ndata: {\"format\":\"pcm\",\"sampleRate\":24000}\n\n" +
                                "event: audio\ndata: " + base64Pcm(2000) + "\n\n" +
                                "event: audio\ndata: " + base64Pcm(2000) + "\n\n" +
                                "event: end\ndata: {\"frames\":2,\"bytes\":8000,\"truncated\":false}\n\n",
                        )

                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
    }

    /** 一段有起伏的 PCM16（全 0 的话波形全是底噪，看不出对不对）。 */
    private fun base64Pcm(samples: Int): String {
        val bytes = ByteArray(samples * 2)
        for (i in 0 until samples) {
            val value = ((i % 100) * 300).toShort()
            bytes[i * 2] = (value.toInt() and 0xFF).toByte()
            bytes[i * 2 + 1] = ((value.toInt() shr 8) and 0xFF).toByte()
        }
        return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun json(b: String) = MockResponse()
        .setResponseCode(200).setHeader("content-type", "application/json").setBody(b)

    private fun startChat(): ChatViewModel {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val vm = ChatViewModel(
            AgentApi(server.url("/").toString()),
            ConversationStore(context),
            VoiceRecorder(context),
        )
        rule.setContent {
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

    private fun sendHello() {
        rule.onNodeWithTag("chat-input").performTextInput("你好")
        rule.onNodeWithTag("chat-send").performClick()
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTagPrefix("msg-assistant-").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun 助手回复上有朗读入口() {
        startChat()
        sendHello()
        val id = rule.onAllNodesWithTagPrefix("msg-assistant-").fetchSemanticsNodes().first()
            .config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)!!
            .removePrefix("msg-assistant-")
        rule.onNodeWithTag("speak-$id").assertExists()
    }

    @Test
    fun 点朗读会去请求语音流() {
        val vm = startChat()
        sendHello()
        vm.speak("您好，我是小招。")
        rule.waitUntil(10_000) { requests.contains("/agent-api/tts/stream") }
        assertTrue(requests.contains("/agent-api/tts/stream"))
    }

    @Test
    fun 输入区有按住说话的按钮() {
        startChat()
        rule.onNodeWithTag("chat-mic").assertExists()
    }

    @Test
    fun 拿不到麦克风时给提示而不是崩() {
        // instrumented 测试默认没有录音权限——这正是"没权限"的真实情形，
        // 要点是**不能崩**，而且要让用户看懂发生了什么
        // 只能 setContent 一次，所以这里拿那一次返回的 VM
        val vm = startChat()
        rule.onNodeWithTag("chat-mic").assertExists()
        val started = vm.startRecording()
        rule.waitForIdle()
        if (!started) {
            // 没权限时要有一条能看懂的错误，而不是静默什么都不发生
            assertTrue(
                "拿不到麦克风时应该有错误提示",
                vm.voice.state.value.error != null,
            )
        }
    }
}
