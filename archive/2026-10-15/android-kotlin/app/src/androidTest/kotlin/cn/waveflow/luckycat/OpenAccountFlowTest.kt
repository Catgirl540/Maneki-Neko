package cn.waveflow.luckycat

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithTag
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.ui.openaccount.OpenAccountScreen
import cn.waveflow.luckycat.ui.openaccount.OpenAccountViewModel
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class OpenAccountFlowTest {
    @get:Rule val rule = createComposeRule()
    private lateinit var server: MockWebServer
    private val registerBodies = mutableListOf<String>()

    @Before fun setUp() {
        server = MockWebServer(); server.start()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8()
                return when (request.path) {
                    "/api/auth/sms-code" -> json("""{"sent":true,"expiresAt":"2026-09-21T06:00:00Z","demoCode":"285276"}""")
                    "/api/security/verify" -> json("""{"ticket":"face.ticket"}""")
                    "/api/auth/register" -> {
                        registerBodies += body
                        json("""{"token":"token.new","user":{"id":"u_new","name":"林小满","phone":"13800138000","memberLevel":"普通会员","avatarInitial":"林"},"account":{"id":"acc_new","kind":"savings","label":"储蓄账户","accountNo":"6222020200009123","currency":"CNY","balance":0,"available":0,"interestRate":0.0155,"monthNetChange":0},"openedAt":"2026-09-21T06:00:00Z"}""")
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
    }

    @After fun tearDown() { server.shutdown() }
    private fun json(body: String) = MockResponse().setResponseCode(200).setHeader("content-type", "application/json").setBody(body)

    private fun start(): OpenAccountViewModel {
        val vm = OpenAccountViewModel(BankApi(server.url("/").toString()))
        rule.setContent {
            val state by vm.state.collectAsState()
            OpenAccountScreen(
                state, vm::updatePhone, vm::updatePassword, vm::updateConfirmPassword,
                vm::updateName, vm::updateIdNumber, vm::updateSmsCode,
                vm::setPledged, vm::setConfirmed, vm::requestSms, vm::verifyFace,
                { vm.submit {} }, vm::dismissError,
            )
        }
        return vm
    }

    private fun complete(vm: OpenAccountViewModel) {
        vm.updateName("林小满")
        vm.updateIdNumber("310101199001011234")
        vm.updatePassword("123456")
        vm.updateConfirmPassword("123456")
        vm.updatePhone("13800138000")
        vm.requestSms()
        rule.waitUntil(10_000) { vm.state.value.draft.smsCode == "285276" }
        vm.verifyFace()
        rule.waitUntil(10_000) { vm.state.value.draft.faceTicket.isNotEmpty() }
        vm.setPledged(true)
        vm.setConfirmed(true)
    }

    @Test fun 不再显示账户三选一() {
        start()
        assertTrue(rule.onAllNodesWithTag("choice-II-current").fetchSemanticsNodes().isEmpty())
        rule.onNodeWithTag("open-submit").assertIsNotEnabled()
    }

    @Test fun 密码不一致时不能提交() {
        val vm = start(); complete(vm)
        vm.updateConfirmPassword("654321")
        rule.onNodeWithTag("open-submit").assertIsNotEnabled()
    }

    @Test fun 注册请求字段完整且没有类别参数() {
        val vm = start(); complete(vm)
        rule.onNodeWithTag("open-submit").assertIsEnabled()
        vm.submit {}
        rule.waitUntil(10_000) { registerBodies.isNotEmpty() }
        val body = registerBodies.last()
        assertTrue(body.contains("\"phone\":\"13800138000\""))
        assertTrue(body.contains("\"password\":\"123456\""))
        assertTrue(body.contains("\"faceTicket\":\"face.ticket\""))
        assertFalse(body.contains("\"tier\""))
        assertFalse(body.contains("\"kind\""))
    }
}
