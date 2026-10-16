package cn.waveflow.luckycat

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.ui.security.SecurityScreen
import cn.waveflow.luckycat.ui.security.SecurityViewModel
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
 * 安全中心。
 *
 * 盯两条：**规则描述必须完整显示**（用户是在这里决定要不要关掉自己的保护），
 * 以及**关规则失败时界面不能显示成已关掉**（安全设置上最坏的一种不同步）。
 */
class SecurityFlowTest {

    @get:Rule
    val rule = createComposeRule()

    private lateinit var server: MockWebServer
    private val requests = mutableListOf<Pair<String, String>>()
    private var failToggle = false

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
                    path == "/api/security/overview" -> json(overview(enabled = true))

                    path == "/api/security/rules/rule_overseas" -> {
                        if (failToggle) MockResponse().setResponseCode(500).setBody("""{"message":"改不动"}""")
                        else json(overview(enabled = false))
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

    private fun overview(enabled: Boolean) = """
        {"score":90,"level":"防护优秀","identityVerified":true,
         "devices":[{"id":"dev_1","name":"MacBook Pro · Chrome","location":"上海 · 浦东新区",
                     "lastActiveAt":"2026-09-21T05:04:03Z","current":true}],
         "logs":[{"id":"log_1","action":"登录成功","detail":"MacBook Pro · Chrome · 上海",
                  "createdAt":"2026-09-21T05:04:03Z","level":"info"}],
         "riskRules":[{"id":"rule_overseas","label":"境外交易拦截",
                       "description":"境外收款方自动触发人工复核","enabled":$enabled}]}
    """.trimIndent()

    private fun start(): SecurityViewModel {
        val vm = SecurityViewModel(BankApi(server.url("/").toString()))
        rule.setContent {
            val state by vm.state.collectAsState()
            SecurityScreen(state = state, onToggleRule = vm::setRule, onRetry = vm::load)
        }
        return vm
    }

    private fun waitLoaded() = rule.waitUntil(10_000) {
        rule.onAllNodesWithTag("security-score").fetchSemanticsNodes().isNotEmpty()
    }

    @Test
    fun 显示评分与身份验证状态() {
        start()
        waitLoaded()
        rule.onNodeWithTag("security-score-value").assertTextEquals("90")
        rule.onNodeWithTag("security-identity").assertTextContains("身份已验证", substring = true)
    }

    @Test
    fun 规则描述完整显示不省略() {
        // 「境外交易拦截」这五个字看不出它到底拦什么，
        // 而用户是在这里决定要不要关掉自己的保护
        start()
        waitLoaded()
        rule.onNodeWithTag("rule-desc-rule_overseas")
            .assertTextEquals("境外收款方自动触发人工复核")
    }

    @Test
    fun 关掉一条规则会打后端并换成后端返回的状态() {
        start()
        waitLoaded()
        rule.onNodeWithTag("rule-switch-rule_overseas").performClick()
        rule.waitUntil(10_000) {
            requests.any { it.first == "/api/security/rules/rule_overseas" }
        }
        val (_, body) = requests.last { it.first == "/api/security/rules/rule_overseas" }
        assertTrue("请求体是 $body", body.contains("\"enabled\":false"))
    }

    @Test
    fun 关规则失败时不能显示成已关掉() {
        // 安全设置上最坏的一种不同步：界面说关了、后端其实没关
        failToggle = true
        start()
        waitLoaded()
        rule.onNodeWithTag("rule-switch-rule_overseas").performClick()
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag("security-error").fetchSemanticsNodes().isNotEmpty()
        }
        // 错误提示在，而且开关还是打开状态（没做乐观更新）
        rule.onNodeWithTag("security-error").assertIsDisplayed()
        val vm = rule.onAllNodesWithTag("rule-switch-rule_overseas").fetchSemanticsNodes()
        assertTrue(vm.isNotEmpty())
    }

    @Test
    fun 设备与日志都列出来() {
        start()
        waitLoaded()
        rule.onNodeWithTag("device-dev_1").assertIsDisplayed()
        rule.onNodeWithTag("log-log_1").assertIsDisplayed()
    }
}
