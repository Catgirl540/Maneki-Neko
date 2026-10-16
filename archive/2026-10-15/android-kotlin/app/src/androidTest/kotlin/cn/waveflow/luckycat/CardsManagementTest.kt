package cn.waveflow.luckycat

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.ui.theme.Palette
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.lifecycle.ViewModelStore
import androidx.test.core.app.ApplicationProvider
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.ui.cards.*
import cn.waveflow.luckycat.ui.theme.LuckyCatTheme
import okhttp3.mockwebserver.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

class CardsManagementTest {
    @get:Rule val rule = createComposeRule()
    private lateinit var server: MockWebServer
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()
    private val store = ViewModelStore()
    private var status = "active"
    private var failApplication = false
    private var failList = false
    private var empty = false
    private var delaySecrets = false
    private var compact = false
    private lateinit var vm: CardsViewModel
    private fun card(id: String = "c1", state: String = status, limit: Long = 200_000) = """{"id":"$id","productName":"招财猫 · 星享借记卡","last4":"8888","cardholder":"LIN XIAOMAN","expiry":"08/29","theme":"midnight","network":"visa","status":"$state","dailyLimit":$limit,"onlinePayment":true,"overseasPayment":false}"""
    private fun json(body: String) = MockResponse().setHeader("content-type", "application/json").setBody(body)
    @Before fun setup() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty(); val body = request.body.readUtf8(); requests += path to body
                return when {
                    path == "/api/cards" && failList -> { failList = false; json("""{"message":"列表加载失败"}""").setResponseCode(503) }
                    path == "/api/cards" -> json(if (empty) "[]" else "[${card()}]")
                    path == "/api/cards/products" -> json("""[{"code":"visa","name":"星享借记卡","network":"visa","issuingFee":2300,"deliveryFee":700,"deliveryDays":5,"perks":["全球支付"]}]""")
                    path == "/api/cards/open" || path == "/api/cards/c1/replace" -> {
                        if (failApplication) { failApplication = false; json("""{"message":"支付密码不正确","code":"BAD_PAY_PASSWORD"}""").setResponseCode(401) }
                        else json(card("new", "pending"))
                    }
                    path == "/api/cards/c1/settings" -> json(card(limit = 500_000))
                    path == "/api/cards/c1/secrets" -> json("""{"pan":"4026880000008888","cvv":"123","expiry":"08/29","revealSeconds":1}""").let { if (delaySecrets) it.setBodyDelay(1,TimeUnit.SECONDS) else it }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
    }
    @After fun cleanup() { rule.runOnIdle { store.clear() }; server.shutdown() }
    private fun start() {
        vm = CardsViewModel(BankApi(server.url("/").toString())); store.put("cards", vm)
        rule.setContent { LuckyCatTheme {
            val state by vm.state.collectAsState()
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, if (compact) 1.5f else density.fontScale)) {
            Surface(color = Palette.canvas, modifier = if (compact) Modifier.width(320.dp).fillMaxHeight() else Modifier.fillMaxSize()) {
            CardsScreen(state, vm::setLock, vm::setOnlinePayment, vm::setOverseasPayment, vm::revealSecrets, vm::dismissSecrets, vm::dismissError,
                vm::load, vm::loadProducts, vm::applyCard, vm::setDailyLimit)
            } }
        } }
        rule.waitUntil(10_000) { !vm.state.value.loading }
    }
    private fun tap(tag: String) {
        val node = rule.onNodeWithTag(tag)
        if (tag.startsWith("cards-") || tag.endsWith("-c1")) node.performScrollTo()
        node.performClick()
    }
    private fun fill(tag: String, value: String) {
        val node = rule.onNodeWithTag(tag)
        if (tag != "card-password") node.performScrollTo()
        node.performTextInput(value)
    }
    private fun address() {
        fill("card-address-recipient", "林小满"); fill("card-address-phone", "13800138000")
        fill("card-address-region", "上海市"); fill("card-address-city", "上海市"); fill("card-address-detail", "测试路 100 号")
        fill("card-application-password", "123456")
    }
    private fun applicationReady() { rule.waitUntil(10_000) { vm.state.value.products.isNotEmpty() && !vm.state.value.productsLoading } }

    @Test fun emptyStateOffersNewCardWithoutAccountOpening() {
        empty = true; start()
        rule.onNodeWithTag("cards-empty").assertIsDisplayed()
        rule.onAllNodesWithText("去开立账户").assertCountEquals(0)
        tap("cards-apply"); applicationReady()
        rule.onNodeWithTag("card-application-fee").assertTextContains("¥23.00", substring = true)
        rule.onNodeWithTag("card-application-submit").assertTextContains("¥30.00", substring = true)
        rule.onNodeWithTag("card-application-submit").assertIsNotEnabled()
        address(); tap("card-application-submit")
        rule.waitUntil(10_000) { vm.state.value.cards.any { it.id == "new" } }
        assertEquals(1, requests.count { it.first == "/api/cards/open" })
        assertTrue(requests.single { it.first == "/api/cards/open" }.second.contains("\"productCode\":\"visa\""))
        assertEquals("pending", vm.state.value.cards.single().status)
    }
    @Test fun failedApplicationKeepsAddressAndCanRetry() {
        failApplication = true; start(); tap("cards-apply"); applicationReady(); address(); tap("card-application-submit")
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("card-application-error").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("card-application-submit").assertIsNotEnabled()
        rule.onNodeWithTag("card-address-recipient").assertTextContains("林小满")
        assertEquals(1, requests.count { it.first == "/api/cards/open" })
        fill("card-application-password", "123456"); tap("card-application-submit")
        rule.waitUntil(10_000) { vm.state.value.cards.any { it.id == "new" } }
        assertEquals(2, requests.count { it.first == "/api/cards/open" })
    }
    @Test fun replacementInvalidatesOldCardAndDisablesItsActions() {
        start(); tap("card-replace-c1"); applicationReady(); address(); tap("card-application-submit")
        rule.waitUntil(10_000) { vm.state.value.card("c1")?.status == "replaced" }
        assertEquals("pending", vm.state.value.card("new")?.status)
        assertEquals(1, requests.count { it.first == "/api/cards/c1/replace" })
        rule.onNodeWithTag("card-lock-c1").assertIsNotEnabled()
        rule.onNodeWithTag("card-reveal-c1").assertIsNotEnabled()
        rule.onNodeWithTag("card-replace-c1").assertIsNotEnabled()
    }
    @Test fun dailyLimitUsesCents() {
        start(); tap("card-limit-c1"); tap("card-limit-500000")
        rule.waitUntil(10_000) { vm.state.value.card("c1")?.dailyLimit == 500_000L }
        assertEquals("{\"dailyLimit\":500000}", requests.single { it.first.endsWith("/settings") }.second)
    }
    @Test fun pendingCardCannotBeUnlockedOrRevealSecrets() {
        status = "pending"; start()
        rule.onNodeWithTag("card-lock-c1").assertIsNotEnabled()
        rule.onNodeWithTag("card-online-c1").assertIsNotEnabled()
        rule.onNodeWithTag("card-limit-c1").assertIsNotEnabled()
        rule.onNodeWithTag("card-reveal-c1").assertIsNotEnabled()
        rule.runOnIdle { vm.setLock("c1", false); vm.setOnlinePayment("c1", true) }
        assertTrue(requests.none { it.first.endsWith("/lock") || it.first.endsWith("/settings") })
    }
    @Test fun secretsUseCurrentApiAndExpire() {
        start(); tap("card-reveal-c1"); fill("card-password", "123456"); tap("card-password-submit")
        rule.waitUntil(10_000) { vm.state.value.revealed != null }
        rule.onNodeWithTag("card-secret-pan").assertTextContains("4026880000008888")
        rule.waitUntil(5_000) { vm.state.value.revealed == null }
        rule.onAllNodesWithTag("card-secret-pan").assertCountEquals(0)
        assertEquals(1, requests.count { it.first.endsWith("/secrets") })
    }
    @Test fun closingDuringRequestDiscardsLateSecrets() {
        delaySecrets = true; start(); tap("card-reveal-c1"); fill("card-password", "123456"); tap("card-password-submit")
        rule.waitUntil(10_000) { requests.any { it.first.endsWith("/secrets") } }
        tap("card-password-cancel")
        rule.waitUntil(10_000) { vm.state.value.busyId == null }
        assertNull(vm.state.value.revealed)
        rule.onAllNodesWithTag("card-secret-pan").assertCountEquals(0)
        rule.onAllNodesWithTag("card-password").assertCountEquals(0)
    }
    @Test fun compactLargeTextKeepsManagementReachable() {
        compact = true; start()
        tap("card-limit-c1"); rule.onNodeWithTag("card-limit-500000").assertIsDisplayed()
        rule.onNodeWithText("取消", useUnmergedTree = false).performClick()
        tap("cards-apply"); applicationReady(); address()
        rule.onNodeWithTag("card-application-submit").assertIsEnabled()
        rule.onNodeWithTag("card-application-submit").assertIsDisplayed()
    }
    @Test fun listFailureCanRetryAndCaptureCardPreview() {
        failList = true; start(); rule.onNodeWithTag("cards-error").assertIsDisplayed(); tap("cards-retry")
        rule.waitUntil(10_000) { vm.state.value.cards.isNotEmpty() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val image = rule.onRoot().captureToImage().asAndroidBitmap()
        File(context.getExternalFilesDir(null), "cards-preview.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertNull(vm.state.value.error)
    }
}
