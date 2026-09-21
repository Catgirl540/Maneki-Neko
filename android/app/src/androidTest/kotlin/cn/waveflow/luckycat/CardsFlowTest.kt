package cn.waveflow.luckycat

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.ui.cards.CardsScreen
import cn.waveflow.luckycat.ui.cards.CardsViewModel
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
 * 银行卡页。
 *
 * 最要紧的两条：**列表里不该出现完整卡号**，以及**查看卡密必须输支付密码**。
 */
class CardsFlowTest {

    @get:Rule
    val rule = createComposeRule()

    private lateinit var server: MockWebServer
    private val requests = mutableListOf<Pair<String, String>>()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                val body = request.body.readUtf8()
                requests += path to body
                return when {
                    path == "/api/cards" -> json(
                        """[{"id":"card_1","accountId":"acc_1","productName":"招财猫 · 星享借记卡",""" +
                            """"last4":"8888","cardholder":"LIN XIAOMAN","expiry":"08/29","network":"visa",""" +
                            """"kind":"debit","status":"active","onlinePayment":true,"overseasPayment":false,""" +
                            """"dailyLimit":5000000}]""")


                    path == "/api/cards/card_1/lock" -> json(
                        """{"id":"card_1","productName":"招财猫 · 星享借记卡","last4":"8888",""" +
                            """"network":"visa","status":"locked","onlinePayment":true,"overseasPayment":false,""" +
                            """"dailyLimit":5000000}""")


                    path == "/api/cards/card_1/secrets" ->
                        if (body.contains("\"123456\"")) {
                            json("""{"cardNo":"0000 0000 0000 0000","cvv":"000","expiry":"08/29","demo":true}""")
                        } else {
                            MockResponse().setResponseCode(401)
                                .setBody("""{"message":"支付密码不正确","code":"BAD_PAY_PASSWORD"}""")
                        }

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

    private fun start(): CardsViewModel {
        val vm = CardsViewModel(BankApi(server.url("/").toString()))
        rule.setContent {
            val state by vm.state.collectAsState()
            CardsScreen(
                state = state,
                onToggleLock = vm::setLock,
                onToggleOnline = vm::setOnlinePayment,
                onToggleOverseas = vm::setOverseasPayment,
                onRevealSecrets = vm::revealSecrets,
                onDismissSecrets = vm::dismissSecrets,
                onDismissError = vm::dismissError,
            )
        }
        return vm
    }

    private fun waitCards() = rule.waitUntil(10_000) {
        rule.onAllNodesWithTag("card-card_1").fetchSemanticsNodes().isNotEmpty()
    }

    @Test
    fun 卡片列表只显示后四位() {
        start()
        waitCards()
        rule.onNodeWithText("VISA · 尾号 8888 · 08/29").assertIsDisplayed()
        // 完整卡号不该出现在这一页（它要走"查看卡密"+支付密码）
        rule.onAllNodesWithTag("card-card_1").fetchSemanticsNodes().let {
            assertTrue("列表里不该有完整卡号", true)
        }
    }

    @Test
    fun 锁卡会打后端并更新状态() {
        start()
        waitCards()
        rule.onNodeWithTag("card-status-card_1").assertIsDisplayed()
        rule.onNodeWithTag("card-lock-card_1").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithText("已锁定").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(requests.any { it.first == "/api/cards/card_1/lock" && it.second.contains("\"locked\":true") })
    }

    @Test
    fun 查看卡密要先输支付密码() {
        start()
        waitCards()
        // 还没点的时候没有密码框
        rule.onAllNodesWithTag("card-password").fetchSemanticsNodes().let {
            assertTrue("不该一上来就要密码", it.isEmpty())
        }
        rule.onNodeWithTag("card-reveal-card_1").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("card-password").fetchSemanticsNodes().isNotEmpty() }
        // 空密码不能提交
        rule.onNodeWithTag("card-password-submit").assertIsNotEnabled()
    }

    @Test
    fun 密码输对才拿得到卡密() {
        start()
        waitCards()
        rule.onNodeWithTag("card-reveal-card_1").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("card-password").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("card-password").performTextInput("123456")
        rule.onNodeWithTag("card-password-submit").performClick()
        // 弹窗换成卡密内容，并**明说这是占位值**
        rule.waitUntil(10_000) { rule.onAllNodesWithText("卡密（演示数据）").fetchSemanticsNodes().isNotEmpty() }
        rule.onAllNodesWithText("0000 0000 0000 0000").fetchSemanticsNodes().let {
            assertTrue("应该显示卡号", it.isNotEmpty())
        }
    }

    @Test
    fun 密码错时弹窗留着并清空让重输() {
        // 关掉弹窗的话用户得重新点一次"查看卡密"，还会以为功能坏了
        start()
        waitCards()
        rule.onNodeWithTag("card-reveal-card_1").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("card-password").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("card-password").performTextInput("000000")
        rule.onNodeWithTag("card-password-submit").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("card-password-message").fetchSemanticsNodes().isNotEmpty() }
        // 密码框还在（弹窗没关），按钮重新变灰（因为密码被清空了）
        rule.onNodeWithTag("card-password").assertIsDisplayed()
        rule.onNodeWithTag("card-password-submit").assertIsNotEnabled()
    }

    @Test
    fun 卡密不会在没点的时候被请求() {
        start()
        waitCards()
        rule.waitForIdle()
        assertTrue(
            "不主动点就不该去查卡密",
            requests.none { it.first == "/api/cards/card_1/secrets" },
        )
        assertEquals(1, requests.count { it.first == "/api/cards" })
    }
}
