package com.moneymeow.bank

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.net.ServerSocket
import org.json.JSONObject

class FinancialRecoveryTest {
    private lateinit var context: Context
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Before fun setUp() {
        context = instrumentation.targetContext
        context.getSharedPreferences("financial_recovery", Context.MODE_PRIVATE).edit().clear().commit()
        SessionStore.init(context)
        SessionStore.save(LoginResult("test-token-a", "测试客户", "13800000001"))
    }

    @After fun tearDown() {
        context.getSharedPreferences("financial_recovery", Context.MODE_PRIVATE).edit().clear().commit()
        SessionStore.clear()
    }

    @Test fun pendingSurvivesReinitializationAndIsScopedByStableOwner() {
        val key = FinancialRecovery.begin("理财申购", owner = "owner-a", token = "test-token-a")
        instrumentation.waitForIdleSync()
        assertEquals(key, FinancialRecovery.pending?.key)
        FinancialRecovery.finished("owner-a", "test-token-a", key)
        instrumentation.waitForIdleSync()
        FinancialRecovery.init(context)
        instrumentation.runOnMainSync { FinancialRecovery.refresh("owner-b", "test-token-a") }
        assertNull(FinancialRecovery.pending)
        instrumentation.runOnMainSync { FinancialRecovery.refresh("owner-a", "test-token-a") }
        assertEquals(key, FinancialRecovery.pending?.key)
        try {
            FinancialRecovery.begin("理财赎回", owner = "owner-a", token = "test-token-a")
            fail("different operations cannot replace an unresolved key")
        } catch (_: IllegalStateException) { }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync { FinancialRecovery.acknowledge(key, "owner-a") }
        assertNull(FinancialRecovery.pending)
    }

    @Test fun concurrentStartsKeepOnlyOnePendingOperation() {
        val pool = Executors.newFixedThreadPool(2)
        val gate = CountDownLatch(1)
        try {
            val results = (1..2).map {
                pool.submit<Boolean> {
                    gate.await()
                    runCatching { FinancialRecovery.begin("换汇", owner = "owner-a", token = "test-token-a") }.isSuccess
                }
            }
            gate.countDown()
            assertEquals(1, results.count { it.get(10, TimeUnit.SECONDS) })
        } finally { pool.shutdownNow() }
    }

    @Test fun receivedSuccessClearsOnlyItsOwnPendingRecord() {
        val key = FinancialRecovery.begin("转账", owner = "owner-a", token = "test-token-a")
        instrumentation.waitForIdleSync()
        FinancialRecovery.completed("owner-a", "test-token-a", "different-key")
        instrumentation.waitForIdleSync()
        assertEquals(key, FinancialRecovery.pending?.key)
        FinancialRecovery.completed("owner-a", "test-token-a", key)
        instrumentation.waitForIdleSync()
        assertNull(FinancialRecovery.pending)
        assertFalse(FinancialRecovery.inFlight)
    }

    @Test fun crossCurrencyQuoteMustMatchConfirmedAmountAndCurrencies() {
        val fx = TransferFxConfirmation("CNY", "HKD", 1.09, 10000, 10900, 0.0035)
        val quote = TransferQuoteDto(10, "即时", 20000, 20000, false, 10900, 1.09, fx, 60, 1)
        assertNull(quoteProblem(quote, 10000, 20000, "CNY", "HKD"))
        assertNotNull(quoteProblem(quote, 9999, 20000, "CNY", "HKD"))
        assertNotNull(quoteProblem(quote, 10000, 20000, "USD", "HKD"))
        assertNotNull(quoteProblem(quote.copy(fx = fx.copy(rate = Double.NaN)), 10000, 20000, "CNY", "HKD"))
        assertNotNull(quoteProblem(quote.copy(fxTtlSeconds = 0), 10000, 20000, "CNY", "HKD"))
        assertNotNull(quoteProblem(quote, 10000, 20000, "CNY", "CNY"))
    }

    @Test fun splitAllocationMatchesPerItemRoundingAndExcludesCollector() {
        val jia = SplitIdentity("甲", phone = "13800138000")
        val yi = SplitIdentity("乙", phone = "13800138001")
        val bing = SplitIdentity("丙", accountNo = "6222021234567890")
        // 余数从前往后各加 1 分，与服务端 sharesOf 一致。
        assertEquals(listOf(34L, 34L, 33L), allocateSplit(101, listOf(jia, yi, bing)).participants.map { it.amount })
        val result = allocateExpenses(jia, listOf(
            SplitExpenseInput("餐费", 101, listOf(jia, yi, bing)),
            SplitExpenseInput("车费", 5, listOf(yi, bing)),
        ))
        assertEquals(34L, result.selfAmount)
        assertEquals(listOf(yi.key to 37L, bing.key to 35L), result.participants.map { it.identity.key to it.amount })
        assertEquals(72L, result.amount)
        assertEquals(106L, result.expenseTotal)
        // 同一身份重复出现要拦下；同名的两个人只要手机号不同就是两个人。
        assertTrue(runCatching { allocateSplit(100, listOf(jia, jia)) }.isFailure)
        // 同名不同手机号 = 两个人，各分 50 分。
        assertEquals(listOf(50L, 50L), allocateSplit(100, listOf(jia, jia.copy(phone = "13800138009"))).participants.map { it.amount })
        // 只填姓名不行：没有手机号或账号就没法确定钱付给谁。
        assertTrue(runCatching { identityOf("丁", "") }.isFailure)
        assertTrue(runCatching { identityOf("丁", "12345") }.isFailure)
        assertEquals(SplitIdentity("丁", accountNo = "6222021234567890"), identityOf("丁", "6222021234567890"))
    }

    @Test fun scheduledTimeRejectsInvalidCalendarDatesAndUsesBeijing() {
        assertEquals("2028-02-29T02:00:00Z", scheduledIso("2028-02-29 10:00"))
        assertTrue(runCatching { scheduledIso("2026-02-30 10:00") }.isFailure)
        assertTrue(runCatching { scheduledIso("2026-11-01 24:00") }.isFailure)
    }

    @Test fun fpsIdentifiersAndReceiptsRejectIncompleteData() {
        assertNull(fpsIdentifierProblem("mobile", "91234567"))
        assertNotNull(fpsIdentifierProblem("mobile", "13800138000"))
        assertNull(fpsIdentifierProblem("email", "test@example.com"))
        assertNotNull(fpsIdentifierProblem("fpsid", "123456"))
        assertFalse(BankApi.financialReceiptValid("/api/transfers", JSONObject()))
        assertFalse(BankApi.financialReceiptValid("/api/transfers", JSONObject().put("transactionId", "x")))
        assertFalse(BankApi.financialReceiptValid("/api/transfers/scheduled", JSONObject().put("id", "x")))
    }

    @Test fun csvEscapesDetailsAndTreatsMerchantTextAsText() {
        val data = JSONObject().put("columns", org.json.JSONArray().put(JSONObject().put("key", "memo").put("label", "备注")).put(JSONObject().put("key", "net").put("label", "净额")))
            .put("rows", org.json.JSONArray().put(JSONObject().put("memo", "=1+1").put("net", "-1.00")).put(JSONObject().put("memo", "商户,\"商品\"\n备注").put("net", "0")))
        val csv = LedgerApi.datasetsCsv(listOf(data))
        assertTrue(csv.startsWith("\uFEFF备注,净额\r\n"))
        assertTrue(csv.contains("'=1+1,-1.00"))
        assertTrue(csv.contains("\"商户,\"\"商品\"\"\n备注\",0"))
    }

    @Test fun httpSuccessClearsPendingButIncompleteResponseKeepsIt() {
        val server = ServerSocket(0)
        val pool = Executors.newSingleThreadExecutor()
        val originalUrl = BankApi.baseUrl
        val keys = mutableListOf<String>()
        val worker = pool.submit {
            repeat(4) { index ->
                server.accept().use { socket ->
                    val input = socket.getInputStream().bufferedReader()
                    val request = input.readLine()
                    val headers = mutableMapOf<String, String>()
                    while (true) {
                        val line = input.readLine() ?: break
                        if (line.isEmpty()) break
                        val parts = line.split(':', limit = 2)
                        if (parts.size == 2) headers[parts[0].lowercase()] = parts[1].trim()
                    }
                    repeat(headers["content-length"]?.toIntOrNull() ?: 0) { input.read() }
                    assertEquals("Bearer test-token-a", headers["authorization"])
                    val response = if (request.contains("/api/idempotency/capabilities")) {
                        "{\"version\":1,\"atomicSeal\":true,\"ownerId\":\"owner-a\"}"
                    } else {
                        keys.add(headers["idempotency-key"] ?: "")
                        if (index == 1) "{\"transactionId\":\"test\",\"settlementStatus\":\"success\"}" else "{"
                    }
                    val bytes = response.toByteArray()
                    val declaredLength = bytes.size + if (index == 3) 10 else 0
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: $declaredLength\r\nConnection: close\r\n\r\n".toByteArray() + bytes)
                }
            }
        }
        try {
            BankApi.baseUrl = "http://127.0.0.1:${server.localPort}"
            assertTrue(BankApi.protectedFinancialRequest("POST", "/api/transfers", JSONObject(), "转账").contains("transactionId"))
            instrumentation.waitForIdleSync()
            assertNull(FinancialRecovery.pending)
            assertTrue(runCatching { BankApi.protectedFinancialRequest("POST", "/api/transfers", JSONObject(), "转账") }.isFailure)
            instrumentation.waitForIdleSync()
            worker.get(10, TimeUnit.SECONDS)
            assertEquals(2, keys.size)
            assertNotEquals(keys[0], keys[1])
            assertEquals(keys[1], FinancialRecovery.pending?.key)
        } finally {
            BankApi.baseUrl = originalUrl
            server.close()
            pool.shutdownNow()
        }
    }
}
