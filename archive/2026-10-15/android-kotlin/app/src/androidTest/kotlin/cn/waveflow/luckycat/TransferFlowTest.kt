package cn.waveflow.luckycat

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.ui.transfer.TransferScreen
import cn.waveflow.luckycat.ui.transfer.TransferViewModel
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * 转账页。
 *
 * 最要紧的一条是 **报价失效**：报价里带着手续费与单笔上限，用户报完价再改金额
 * 如果还留着旧报价，界面显示的数字和实际要发生的就不是一回事了。
 */
class TransferFlowTest {

    @get:Rule
    val rule = createComposeRule()

    private lateinit var server: MockWebServer
    private val quoteRequests = mutableListOf<String>()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                val body = request.body.readUtf8()
                return when {
                    path.startsWith("/api/accounts") -> json(
                        """[{"id":"acc_0001","label":"储蓄账户","accountNo":"8820000000112233445",""" +
                            """"currency":"CNY","balance":12864055,"available":12764055}]""",
                    )

                    path == "/api/payees" -> json(
                        """[{"id":"pay_1","name":"梁乐怡","channel":"bank","bankCode":"105",""" +
                            """"bankRegion":"CN","bankName":"建设银行","accountNo":"6222020200009123","scope":"domestic"}]""",
                    )

                    path == "/api/transfers/quote" -> {
                        quoteRequests += body
                        json("""{"fee":0,"etaText":"预计 2 小时内到账","maxAmount":5000000,""" +
                            """"singleLimit":5000000,"requiresConfirm":false,"channelNote":"境内实时到账免手续费"}""")
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

    private fun start(): TransferViewModel {
        val vm = TransferViewModel(BankApi(server.url("/").toString()))
        rule.setContent {
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
        return vm
    }

    private fun fillForm() {
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("payee-pay_1").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("payee-pay_1").performClick()
        rule.onNodeWithTag("transfer-amount").performTextInput("800")
        rule.waitForIdle()
    }

    @Test
    fun 三样没填齐时不能报价() {
        start()
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("transfer-quote").fetchSemanticsNodes().isNotEmpty() }
        // 只选了账户（默认第一个），没选收款人也没填金额
        rule.onNodeWithTag("transfer-quote").assertIsNotEnabled()
        rule.onNodeWithTag("payee-pay_1").performClick()
        rule.onNodeWithTag("transfer-quote").assertIsNotEnabled()  // 还差金额
        rule.onNodeWithTag("transfer-amount").performTextInput("800")
        rule.onNodeWithTag("transfer-quote").assertIsEnabled()
    }

    @Test
    fun 非法金额不算填好了() {
        start()
        fillForm()
        rule.onNodeWithTag("transfer-amount").performTextReplacement("800.555")
        rule.waitForIdle()
        // 超过两位小数判为无效而不是四舍五入——静默改用户的金额是不能接受的
        rule.onNodeWithTag("transfer-quote").assertIsNotEnabled()
    }

    @Test
    fun 报价之后才能提交() {
        start()
        fillForm()
        rule.onNodeWithTag("transfer-submit").assertIsNotEnabled()
        rule.onNodeWithTag("transfer-quote").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("transfer-quote-card").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("transfer-quote-card").assertIsDisplayed()
        rule.onNodeWithTag("transfer-submit").assertIsEnabled()
    }

    @Test
    fun 改金额会让报价失效() {
        // **这是这一页最关键的一条**：报价里有手续费与上限，
        // 改完金额还留着旧报价，用户看到的就是一组过期的数字。
        start()
        fillForm()
        rule.onNodeWithTag("transfer-quote").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("transfer-quote-card").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("transfer-submit").assertIsEnabled()

        rule.onNodeWithTag("transfer-amount").performTextReplacement("900")
        rule.waitForIdle()

        rule.onAllNodesWithTag("transfer-quote-card").fetchSemanticsNodes().let {
            assert(it.isEmpty()) { "改了金额之后报价卡片还留着" }
        }
        rule.onNodeWithTag("transfer-submit").assertIsNotEnabled()
    }

    @Test
    fun 换收款人也会让报价失效() {
        start()
        fillForm()
        rule.onNodeWithTag("transfer-quote").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("transfer-quote-card").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("payee-pay_1").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("transfer-submit").assertIsNotEnabled()
    }

    @Test
    fun 报价请求带的是当前填的那份() {
        start()
        fillForm()
        rule.onNodeWithTag("transfer-memo").performTextInput("房租")
        rule.onNodeWithTag("transfer-quote").performClick()
        rule.waitUntil(10_000) { quoteRequests.isNotEmpty() }
        val body = quoteRequests.last()
        assert(body.contains("\"fromAccountId\":\"acc_0001\"")) { body }
        assert(body.contains("\"payeeName\":\"梁乐怡\"")) { body }
        assert(body.contains("\"amount\":80000")) { body }
        assert(body.contains("\"payeeBankCode\":\"105\"")) { body }
        assert(body.contains("\"payeeBankRegion\":\"CN\"")) { body }
        assert(body.contains("\"memo\":\"房租\"")) { body }
    }
}
