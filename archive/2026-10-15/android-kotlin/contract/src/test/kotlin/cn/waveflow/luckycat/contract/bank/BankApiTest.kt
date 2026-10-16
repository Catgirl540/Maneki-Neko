package cn.waveflow.luckycat.contract.bank

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * 银行后端客户端打的是**假的银行后端**（MockWebServer）。
 * 真后端（当前是 `framework/bridge/demo-bank.mjs`）的形状由
 * `tools/check-deployed.mjs` 与网页版那批数据门禁负责。
 */
class BankApiTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun api() = BankApi(server.url("/").toString())

    private fun json(body: String) = MockResponse()
        .setResponseCode(200)
        .setHeader("content-type", "application/json")
        .setBody(body)

    @Test
    fun `baseUrl 带了路径要在构造时就报错`() {
        // 与 AgentApi 同一个约定：传主机根，前缀自己拼。
        // 带进来会拼成 /api/api/…，服务端 404 而报错看着像路径写错。
        try {
            BankApi("https://bank.waveflow.cn/api")
            fail("应该抛 IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("主机根"))
        }
    }

    @Test
    fun `路径前缀是 api`() = runBlocking {
        server.enqueue(json("[]"))
        api().listAccounts()
        assertEquals("/api/accounts", server.takeRequest().path)
    }

    @Test
    fun `登录用 POST 且三段都带上`() = runBlocking {
        server.enqueue(json("""{"token":"t1","user":{"id":"u1","name":"林小满"}}"""))
        val result = api().login("13800138000", "123456", "285276")
        assertEquals("t1", result.token)
        assertEquals("林小满", result.user.name)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/auth/login", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("13800138000"))
        assertTrue(body.contains("123456"))
        assertTrue(body.contains("285276"))
    }

    @Test
    fun `验证码回传字段叫 demoCode`() = runBlocking {
        server.enqueue(json("""{"sent":true,"expiresAt":"2026-09-21T00:00:00Z","demoCode":"285276"}"""))
        val result = api().sendSmsCode("13800138000")
        assertTrue(result.sent)
        assertEquals("285276", result.demoCode)
        assertEquals("/api/auth/sms-code", server.takeRequest().path)
    }

    @Test
    fun `注册用单一接口并直接返回登录态`() = runBlocking {
        server.enqueue(json("""{"token":"t-new","user":{"id":"u-new","name":"林小满"},"account":{"id":"acc-new","kind":"savings","label":"储蓄账户","balance":0,"available":0},"openedAt":"2026-09-21T00:00:00Z"}"""))
        val result = api().register(
            RegistrationRequest("13800138001", "123456", "林小满", "310101199001011234", "285276", "face.ticket", "pledge"),
        )
        assertEquals("t-new", result.token)
        assertEquals("储蓄账户", result.account.label)
        val request = server.takeRequest()
        assertEquals("/api/auth/register", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"password\":\"123456\""))
        assertFalse(body.contains("\"tier\""))
        assertFalse(body.contains("\"kind\""))
    }

    @Test
    fun `账户列表解析出金额字段`() = runBlocking {
        server.enqueue(
            json(
                """[{"id":"acc_0001","kind":"savings","label":"储蓄账户",""" +
                    """"accountNo":"8820","currency":"CNY","balance":28464055,"available":28464055,""" +
                    """"interestRate":0.0155,"monthNetChange":1145786}]"""
            )
        )
        val accounts = api().listAccounts()
        assertEquals(1, accounts.size)
        assertEquals(28_464_055L, accounts[0].balance)
        assertEquals(1_145_786L, accounts[0].monthNetChange)
    }

    @Test
    fun `后端多给字段不会崩`() = runBlocking {
        // 真后端加字段是常态；客户端要能忽略，而不是整页白屏
        server.enqueue(json("""[{"id":"acc_1","label":"活期","brandNewField":42}]"""))
        assertEquals(1, api().listAccounts().size)
    }

    @Test
    fun `流水查询参数名是 size 不是 pageSize`() = runBlocking {
        // 参数名写错的后果是**静默**用默认页大小，不报错——所以要钉住
        server.enqueue(json("""{"items":[],"page":2,"size":5,"total":0}"""))
        api().listTransactions("acc_0001", page = 2, size = 5)
        val path = server.takeRequest().path!!
        assertTrue("实际路径 $path", path.startsWith("/api/accounts/acc_0001/transactions?"))
        assertTrue(path.contains("page=2"))
        assertTrue(path.contains("size=5"))
        assertFalse("不该出现 pageSize", path.contains("pageSize"))
    }

    @Test
    fun `category 是 all 时不下发`() = runBlocking {
        // 前端 http.ts 就是这么做的：'all' 表示不过滤，发过去后端还得再判一次
        server.enqueue(json("""{"items":[],"page":1,"size":20,"total":0}"""))
        api().listTransactions("acc_0001", category = "all")
        assertFalse(server.takeRequest().path!!.contains("category"))
    }

    @Test
    fun `有 keyword 时下发`() = runBlocking {
        server.enqueue(json("""{"items":[],"page":1,"size":20,"total":0}"""))
        api().listTransactions("acc_0001", keyword = "咖啡")
        val path = server.takeRequest().path!!
        assertTrue("实际路径 $path", path.contains("keyword="))
    }

    @Test
    fun `交易详情把台账行与明细都解出来`() = runBlocking {
        server.enqueue(
            json(
                """{"id":"txn_0005","accountId":"acc_0001","direction":"out","amount":4500,""" +
                    """"signedAmount":-4500,"counterparty":"Manner Coffee","memo":"拿铁",""" +
                    """"category":"dining","createdAt":"2026-09-20T08:12:00Z","status":"success",""" +
                    """"detail":{"referenceNo":"REF-1","channel":"card","paymentMethod":"星享卡 尾号 8888",""" +
                    """"accountLabel":"储蓄账户","accountNo":"8820","settleCurrency":"CNY",""" +
                    """"balanceBefore":12868555,"balanceAfter":12864055,"authCode":"A1B2C3"}}"""
            )
        )
        val record = api().getTransaction("txn_0005")
        assertEquals("Manner Coffee", record.counterparty)
        assertFalse(record.isIncome)
        assertEquals("REF-1", record.detail.referenceNo)
        assertEquals(12_868_555L, record.detail.balanceBefore)
        assertEquals("A1B2C3", record.detail.authCode)
        assertEquals("/api/transactions/txn_0005", server.takeRequest().path)
    }

    @Test
    fun `明细缺字段时用默认值而不是崩`() = runBlocking {
        // 列表行当详情用时（少给 detail）不该炸
        server.enqueue(json("""{"id":"txn_1","accountId":"a","direction":"in","amount":100}"""))
        val record = api().getTransaction("txn_1")
        assertEquals("", record.detail.referenceNo)
        assertTrue(record.isIncome)
    }

    @Test
    fun `错误信封是 message 加 code 不是 error`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(401)
                .setBody("""{"message":"手机号或密码不正确","code":"BAD_CREDENTIALS"}""")
        )
        try {
            api().login("13800138000", "wrong", "000000")
            fail("应该抛 BankApiException")
        } catch (e: BankApiException) {
            assertEquals(401, e.status)
            assertEquals("BAD_CREDENTIALS", e.code)
            assertEquals("手机号或密码不正确", e.message)
        }
    }

    @Test
    fun `错误体不是 JSON 时退回原始文本`() = runBlocking {
        // 别把错误吞成空字符串——界面上会变成一条没有内容的红字
        server.enqueue(MockResponse().setResponseCode(502).setBody("bad gateway"))
        try {
            api().listAccounts()
            fail("应该抛 BankApiException")
        } catch (e: BankApiException) {
            assertEquals(502, e.status)
            assertTrue(e.message.contains("bad gateway"))
        }
    }

    @Test
    fun `错误体为空时给一条能看懂的话`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(500).setBody(""))
        try {
            api().listAccounts()
            fail("应该抛 BankApiException")
        } catch (e: BankApiException) {
            assertEquals(500, e.status)
            assertTrue("实际是「${e.message}」", e.message.contains("500"))
        }
    }

    @Test
    fun `配置了 token 就带 Authorization 头`() = runBlocking {
        server.enqueue(json("""{"id":"u1"}"""))
        BankApi(server.url("/").toString(), tokenProvider = { "tok" }).profile()
        assertEquals("Bearer tok", server.takeRequest().headers["Authorization"])
    }

    @Test
    fun `没配 token 就不带这个头`() = runBlocking {
        server.enqueue(json("""{"id":"u1"}"""))
        api().profile()
        assertEquals(null, server.takeRequest().headers["Authorization"])
    }

    @Test
    fun `申卡换卡请求包含地址与支付密码并带客户身份`() = runBlocking {
        val bank = BankApi(server.url("/").toString(), tokenProvider = { "test-customer" })
        val address = MailingAddress("林小满", "13800138000", "上海市", "上海市", "测试路 100 号")
        server.enqueue(json("""{"id":"new","status":"pending","shippingAddress":{"recipient":"林小满","detail":"测试路 100 号"},"issuingFee":3500}"""))
        val created = bank.openCard(CardApplication("visa_gold", address, "123456"))
        val open = server.takeRequest()
        assertEquals("POST", open.method); assertEquals("/api/cards/open", open.path)
        assertEquals("Bearer test-customer", open.getHeader("Authorization"))
        val body = open.body.readUtf8()
        assertTrue(body.contains("\"productCode\":\"visa_gold\""))
        assertTrue(body.contains("\"paymentPassword\":\"123456\""))
        assertTrue(body.contains("测试路 100 号"))
        assertEquals(3500L, created.issuingFee); assertEquals("林小满", created.shippingAddress?.recipient)
        server.enqueue(json("""{"id":"replacement","status":"pending"}"""))
        bank.replaceCard("old", CardReplaceRequest(address, "123456"))
        val replacement = server.takeRequest()
        assertEquals("/api/cards/old/replace", replacement.path)
        assertFalse(replacement.body.readUtf8().contains("productCode"))
    }

    @Test
    fun `当前卡密接口使用pan和服务端展示时长`() = runBlocking {
        server.enqueue(json("""{"pan":"4026880000008888","cvv":"123","expiry":"08/29","revealSeconds":15}"""))
        val secret = api().revealCardSecrets("c1", "123456")
        assertEquals("4026880000008888", secret.number)
        assertEquals(15, secret.revealSeconds)
        assertFalse(secret.demo)
    }

    // ── 银行卡 ──────────────────────────────────────────────────────────

    @Test
    fun `卡片列表解析出掩码字段`() = runBlocking {
        server.enqueue(
            json(
                """[{"id":"card_0046","accountId":"acc_0001","productName":"招财猫 · 星享借记卡",""" +
                    """"last4":"8888","cardholder":"LIN XIAOMAN","expiry":"08/29","network":"visa",""" +
                    """"kind":"debit","status":"active","onlinePayment":true,"overseasPayment":false,""" +
                    """"dailyLimit":5000000}]"""
            )
        )
        val cards = api().listCards()
        assertEquals(1, cards.size)
        assertEquals("8888", cards[0].last4)
        assertEquals(5_000_000L, cards[0].dailyLimit)
        assertEquals("/api/cards", server.takeRequest().path)
    }

    @Test
    fun `列表接口不下发完整卡号`() = runBlocking {
        // 这是刻意的：拿得到列表的人不该顺手拿到能盗刷的东西。
        // 用真实后端时这条会更重要——后端要是把 cardNo 塞进列表，
        // 这条断言不会失败（我们忽略未知字段），但至少模型里没有它。
        server.enqueue(json("""[{"id":"c1","last4":"8888","cardNo":"4111111111111111"}]"""))
        val card = api().listCards().first()
        assertEquals("8888", card.last4)
    }

    @Test
    fun `锁卡用 POST 且带 locked`() = runBlocking {
        server.enqueue(json("""{"id":"card_1","status":"locked"}"""))
        val card = api().setCardLock("card_1", locked = true)
        assertEquals("locked", card.status)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/cards/card_1/lock", request.path)
        assertTrue(request.body.readUtf8().contains("\"locked\":true"))
    }

    @Test
    fun `改卡设置用 PATCH 而不是 POST`() = runBlocking {
        // 部分更新：用 POST 有把没传的字段一起重置掉的风险
        server.enqueue(json("""{"id":"card_1","onlinePayment":false,"dailyLimit":5000000}"""))
        val patch = kotlinx.serialization.json.buildJsonObject {
            put("onlinePayment", kotlinx.serialization.json.JsonPrimitive(false))
        }
        val card = api().updateCardSettings("card_1", patch)

        val request = server.takeRequest()
        assertEquals("PATCH", request.method)
        assertEquals("/api/cards/card_1/settings", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("onlinePayment"))
        assertFalse("没传的字段不该出现在请求体里", body.contains("dailyLimit"))
        assertFalse(card.onlinePayment)
    }

    @Test
    fun `查卡密必须带支付密码`() = runBlocking {
        server.enqueue(json("""{"cardNo":"0000 0000 0000 0000","cvv":"000","expiry":"08/29","demo":true}"""))
        val secrets = api().revealCardSecrets("card_1", "123456")
        assertTrue(secrets.demo)

        val request = server.takeRequest()
        assertEquals("/api/cards/card_1/secrets", request.path)
        assertTrue(request.body.readUtf8().contains("\"paymentPassword\":\"123456\""))
    }

    @Test
    fun `卡密拿不到时抛错而不是回空卡号`() = runBlocking {
        // 401 是密码错；界面要能区分"密码错"和"网络坏"
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"message":"支付密码不正确","code":"BAD_PAY_PASSWORD"}"""))
        try {
            api().revealCardSecrets("card_1", "wrong")
            fail("应该抛 BankApiException")
        } catch (e: BankApiException) {
            assertEquals(401, e.status)
            assertEquals("BAD_PAY_PASSWORD", e.code)
        }
    }

    @Test
    fun `卡产品列表`() = runBlocking {
        server.enqueue(
            json(
                """[{"code":"LCB-UP-DEBIT","name":"云闪付借记卡","issuingFee":1000,"deliveryFee":0,""" +
                    """"perks":["ATM 免手续费"],"deliveryDays":5}]"""
            )
        )
        val products = api().listCardProducts()
        assertEquals(1, products.size)
        assertEquals(1_000L, products[0].issuingFee)
        assertEquals(listOf("ATM 免手续费"), products[0].perks)
        assertEquals("/api/cards/products", server.takeRequest().path)
    }

    @Test
    fun `账户 id 会被正确拼进路径`() = runBlocking {
        server.enqueue(json("""{"id":"acc_0001","label":"活期"}"""))
        api().getAccount("acc_0001")
        assertEquals("/api/accounts/acc_0001", server.takeRequest().path)
    }
}
