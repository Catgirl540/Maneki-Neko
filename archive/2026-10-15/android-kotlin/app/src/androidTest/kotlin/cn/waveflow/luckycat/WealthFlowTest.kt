package cn.waveflow.luckycat

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.ui.wealth.WealthScreen
import cn.waveflow.luckycat.ui.wealth.WealthViewModel
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo

/**
 * 理财页。
 *
 * 盯的是**合规显示**：业绩比较基准必须是区间、不保本要显眼、
 * 理财账户没开立要明说。这三条都是"错了会被监管挑出来"的东西。
 */
class WealthFlowTest {

    @get:Rule
    val rule = createComposeRule()

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""

                // 独立路径先判：`/api/wealth/products` 不能被 overview 那条吃掉
                return when (path) {
                    "/api/wealth/products" -> json(
                        """[{"code":"LCB-CASH-A","name":"招财猫现金添利 A","category":"cash","risk":"R1",""" +
                            """"principalProtected":false,"sevenDayYield":0.0186,"minAmount":10000,""" +
                            """"stepAmount":10000,"term":"随时赎回","openEnded":true,""" +
                            """"benchmark":{"kind":"range","low":0.016,"high":0.021,""" +
                            """"basis":"以组合平均剩余期限 90 天以内测算"}}]""",
                    )

                    "/api/wealth/overview" -> json(
                        """{"account":{"opened":false,"accountNo":""},"totalValue":0,""" +
                            """"totalPrincipal":0,"totalProfit":0,"yesterdayProfit":0,"holdings":[]}""",
                    )

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

    private var opened = false

    private fun start(): WealthViewModel {
        val vm = WealthViewModel(BankApi(server.url("/").toString()))
        rule.setContent {
            val state by vm.state.collectAsState()
            WealthScreen(state = state, onRetry = vm::load, onOpenAccount = { opened = true })
        }
        return vm
    }

    private fun waitLoaded() = rule.waitUntil(10_000) {
        rule.onAllNodesWithTag("wealth-gate").fetchSemanticsNodes().isNotEmpty()
    }

    @Test
    fun 业绩比较基准显示成区间而不是一个数() {
        // 它不是承诺收益。挑一个数字当"收益率"是会被监管挑出来的
        start()
        waitLoaded()
        rule.onNodeWithTag("benchmark-LCB-CASH-A")
            .assertTextContains("1.60% ~ 2.10%", substring = true)
    }

    @Test
    fun 不保本要显眼地写出来() {
        start()
        waitLoaded()
        // 用**精确匹配**：写成 substring = true 的话，界面上显示成
        // `**不保本**`（字面星号）也会通过——实测就是那么漏过去的
        rule.onNodeWithTag("principal-LCB-CASH-A").assertTextEquals("不保本")
    }

    @Test
    fun 风险等级用通俗说法而不是只给R符号() {
        start()
        waitLoaded()
        // 持仓那一行是「低风险 · 本金 ¥5,000.00」
        rule.waitUntil(10_000) {
            rule.onAllNodesWithText("低风险", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun 理财账户没开立时明确提示() {
        // 不提示的话用户点了申购才发现走不通
        start()
        waitLoaded()
        rule.onNodeWithTag("wealth-gate").assertIsDisplayed()
        rule.onNodeWithTag("wealth-open-account").assertIsDisplayed()
    }

    @Test
    fun 未开户不显示总市值与收益() {
        start()
        waitLoaded()
        assertTrue(rule.onAllNodesWithTag("wealth-total").fetchSemanticsNodes().isEmpty())
        assertTrue(rule.onAllNodesWithTag("wealth-profit").fetchSemanticsNodes().isEmpty())
        assertTrue(rule.onAllNodesWithTag("wealth-yesterday").fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun 未开户不显示持仓但仍可浏览产品() {
        start()
        waitLoaded()
        assertTrue(rule.onAllNodesWithTag("holding-hold_1").fetchSemanticsNodes().isEmpty())
        rule.onNodeWithTag("product-LCB-CASH-A").assertIsDisplayed()
        assertTrue(
            rule.onAllNodesWithTag("product-LCB-CASH-A").fetchSemanticsNodes().isNotEmpty(),
        )
    }


    @Test
    fun 没开理财账户时是一道闸门不是一个提示() {
        // 网页版的规矩：银行账户 ≠ 理财账户。这里要讲清差别、要做的三步，
        // 以及"产品超市现在就能看"
        start()
        waitLoaded()
        rule.onNodeWithTag("wealth-gate").assertIsDisplayed()
        rule.onNodeWithTag("wealth-open-account").assertIsDisplayed()
        rule.onNodeWithTag("wealth-open-account").assertTextContains("开立理财账户", substring = true)
    }

    @Test
    fun 闸门里说清了为什么不装钱() {
        start()
        waitLoaded()
        // "银行账户是装钱的地方，理财账户才是买理财的资格"
        rule.onAllNodesWithText("银行账户是装钱的地方", substring = true).fetchSemanticsNodes().let {
            assertTrue("闸门要说清两者的差别", it.isNotEmpty())
        }
    }

    @Test
    fun 闸门上的按钮能触发开户() {
        start()
        waitLoaded()
        rule.onNodeWithTag("wealth-open-account").performScrollTo().performClick()
        rule.waitForIdle()
        assertTrue("点闸门按钮应该进开户流程", opened)
    }

    @Test
    fun 产品超市没开户也能看() {
        // 这条决定了用户是"先去开户"还是"先逛逛再说"
        start()
        waitLoaded()
        rule.onNodeWithTag("product-LCB-CASH-A").assertExists()
    }

    @Test
    fun 底部有风险提示() {
        // "理财非存款、产品有风险、投资须谨慎"这句是必须出现的
        start()
        waitLoaded()
        rule.onNodeWithTag("wealth-disclaimer").assertTextContains("理财非存款", substring = true)
    }
}
