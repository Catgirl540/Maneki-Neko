package cn.waveflow.luckycat

import android.content.Context
import android.graphics.Bitmap
import android.util.Base64
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
import cn.waveflow.luckycat.image.PreparedImage
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
import java.io.ByteArrayOutputStream

/**
 * 发图。
 *
 * 系统的相册选择器**测不了**（那是另一个应用）。这里验的是它之后的部分：
 * 带图的消息体发对了没有、界面上那张缩略图出没出来。
 */
class ImageFlowTest {

    @get:Rule
    val rule = createComposeRule()

    private lateinit var server: MockWebServer
    private val bodies = mutableListOf<String>()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                if (path.endsWith("/messages")) bodies += request.body.readUtf8()
                return when {
                    path == "/agent-api/sessions" -> json("""{"sessionId":"web-img"}""")
                    path.endsWith("/stream") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("content-type", "text/event-stream; charset=utf-8")
                        .setBody("""data: {"type":"hello","sessionId":"web-img"}""" + "\n\n")
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

    /** 造一张真的 JPEG（几张纯色像素就够了，测试不需要真图片内容）。 */
    private fun sampleImage(): PreparedImage {
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888).apply {
            eraseColor(android.graphics.Color.RED)
        }
        val bytes = ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 60, out)
            out.toByteArray()
        }
        return PreparedImage(
            bytes = bytes,
            mimeType = "image/jpeg",
            thumbBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
            name = "账单截图.png",
        )
    }

    private fun startChat(): ChatViewModel {
        val context = ApplicationProvider.getApplicationContext<Context>()
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

    @Test
    fun 输入区有选图入口() {
        startChat()
        rule.onNodeWithTag("chat-attach").assertExists()
    }

    @Test
    fun 带图发送的消息体里有image字段() {
        val vm = startChat()
        vm.send("看看这张", sampleImage())
        rule.waitUntil(10_000) { bodies.isNotEmpty() }
        val body = bodies.last()
        assertTrue("请求体应该有 image 字段：$body", body.contains("\"image\""))
        assertTrue("应该带裸 base64 的 data", body.contains("\"data\""))
        assertTrue("应该带 mimeType", body.contains("\"mimeType\":\"image/jpeg\""))
        assertTrue("文字也要在", body.contains("看看这张"))
    }

    @Test
    fun 只有图没有文字也能发出去() {
        // 发一张截图问"这是什么"是正常用法，不该被"文字不能为空"拦住
        val vm = startChat()
        vm.send("", sampleImage())
        rule.waitUntil(10_000) { bodies.isNotEmpty() }
        val body = bodies.last()
        assertTrue(body.contains("\"image\""))
        assertTrue("文字可以是空串", body.contains("\"text\":\"\""))
    }

    @Test
    fun 发出去之后界面上有缩略图() {
        val vm = startChat()
        vm.send("看看这张", sampleImage())
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTagPrefix("msg-image-").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun 只有图时标题不会停在默认名() {
        val vm = startChat()
        vm.send("", sampleImage())
        rule.waitUntil(10_000) { vm.state.value.conversation?.title != "新对话" }
        // 纯图片消息没有文字可用，标题该用兜底名而不是空
        assertTrue(vm.state.value.conversation!!.title.isNotEmpty())
    }
    @Test
    fun 真图会被压到能发的大小并生成缩略图() {
        // ImagePreparer 是整条链里最容易出问题的一环：解码可能 OOM、
        // 压出来可能还是超 6MB、MIME 可能写错。所以拿一张**真图**过一遍。
        val context = ApplicationProvider.getApplicationContext<Context>()
        val uri = insertBitmap(context, 3000, 2000)

        val prepared = cn.waveflow.luckycat.image.ImagePreparer.prepare(context, uri)
        assertTrue("应该处理成功", prepared != null)
        prepared!!

        // 长边压到 1600 以内
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(prepared.bytes, 0, prepared.bytes.size, bounds)
        assertTrue("长边应压到 1600 以内，实际 ${maxOf(bounds.outWidth, bounds.outHeight)}",
            maxOf(bounds.outWidth, bounds.outHeight) <= cn.waveflow.luckycat.domain.image.ImageRules.SEND_MAX_EDGE)

        // 压完必须小于服务端的策略上限，否则会被 413
        assertTrue("压完还超过 6MB", prepared.bytes.size <= cn.waveflow.luckycat.domain.image.ImageRules.MAX_SEND_BYTES)
        assertEquals("统一编码成 jpeg", "image/jpeg", prepared.mimeType)

        // 缩略图要明显更小（存档总预算只有 2MB）
        val thumbBytes = Base64.decode(prepared.thumbBase64, Base64.NO_WRAP)
        val thumbBounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(thumbBytes, 0, thumbBytes.size, thumbBounds)
        assertTrue("缩略图长边应 <= 160，实际 ${maxOf(thumbBounds.outWidth, thumbBounds.outHeight)}",
            maxOf(thumbBounds.outWidth, thumbBounds.outHeight) <= cn.waveflow.luckycat.domain.image.ImageRules.THUMB_MAX_EDGE)
    }

    /** 往 MediaStore 塞一张真图，拿到它的 content Uri。 */
    private fun insertBitmap(context: Context, width: Int, height: Int): android.net.Uri {
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, "luckycat-test-${System.nanoTime()}.jpg")
            put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        }
        val uri = context.contentResolver.insert(
            android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values,
        )!!
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply {
            eraseColor(android.graphics.Color.BLUE)
        }
        context.contentResolver.openOutputStream(uri)!!.use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        }
        bitmap.recycle()
        return uri
    }
}

/** 按 testTag 前缀找节点。 */
private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTagPrefix(prefix: String) =
    this.onAllNodes(
        androidx.compose.ui.test.SemanticsMatcher("testTag 以 $prefix 开头") { node ->
            node.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)
                ?.startsWith(prefix) == true
        },
    )
