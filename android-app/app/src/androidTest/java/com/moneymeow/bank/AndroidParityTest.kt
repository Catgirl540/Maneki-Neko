package com.moneymeow.bank

import androidx.test.platform.app.InstrumentationRegistry
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import android.content.Intent
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.time.Instant
import java.util.UUID
import android.view.accessibility.AccessibilityNodeInfo
import android.os.Bundle

/** Executed only by tools/check-android-parity.mjs against its disposable fixture. */
class AndroidParityTest {
    @Test fun financialAndLedgerFlowsUseTheRealLocalBackend() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val file = File(context.filesDir, "parity-fixture.json")
        assumeTrue("requires the isolated PostgreSQL runner", file.isFile)
        val config = JSONObject(file.readText())
        val base = config.getString("baseUrl")
        require(base.matches(Regex("http://127\\.0\\.0\\.1:[0-9]+")))
        val oldBase = BankApi.baseUrl
        val sender = config.getJSONObject("sender").let { LoginResult(it.getString("token"), it.getString("name"), it.getString("phone")) }
        val receiver = config.getJSONObject("recipient").let { LoginResult(it.getString("token"), it.getString("name"), it.getString("phone")) }
        SessionStore.init(context)
        context.getSharedPreferences("financial_recovery", 0).edit().clear().commit()
        try {
            BankApi.baseUrl = base
            SessionStore.save(receiver)
            val receiving = BankApi.accounts().single()
            SessionStore.save(sender)
            val source = BankApi.accounts().single()
            val cny = source.currencyBalances.first { it.currency == "CNY" }
            val quote = BankApi.transferQuote(cny.id, "bank", "domestic", 100, "LCB", "CN", "HKD")
            assertNull(quoteProblem(quote, 100, cny.available, "CNY", "HKD"))
            val result = BankApi.submitTransfer(cny.id, "bank", "domestic", receiver.name, 100, "ANDROID TEST cross currency", "LCB", "CN", receiving.accountNo, "HKD", "888888", TransferConfirmation("CNY", quote.fee, System.currentTimeMillis() + 20000, quote.fx))
            assertTrue(result.transactionId.isNotBlank())
            val debitDetail = BankApi.transaction(result.transactionId)
            assertEquals("CNY", debitDetail.currency)
            assertEquals("HKD", debitDetail.originCurrency)
            assertEquals(quote.fx!!.toAmount, debitDetail.originAmount)
            assertEquals(1 / quote.fx!!.rate, debitDetail.exchangeRate!!, 0.0000001)
            SessionStore.save(receiver)
            assertEquals(1, BankApi.accounts().size)
            val received = BankApi.accounts().single().currencyBalances.first { it.currency == "HKD" }
            val receiverRows = LedgerApi.transactions(received.id, fallbackCurrency = "HKD")
            assertEquals("HKD", BankApi.transaction(receiverRows.items.first { it.direction == "in" }.id).currency)
            assertEquals((receiving.currencyBalances.firstOrNull { it.currency == "HKD" }?.balance ?: 0L) + quote.fx!!.toAmount, received.balance)
            SessionStore.save(sender)
            assertEquals(cny.balance - 100 - quote.fee, BankApi.accounts().single().currencyBalances.first { it.currency == "CNY" }.balance)
            val fps = BankApi.resolveFps("mobile", "91234567")
            assertEquals("HK", fps.bankRegion)
            val fpsQuote = BankApi.transferQuote(cny.id, "fps", "overseas", 100, fps.bankCode, "HK", "HKD")
            val fpsResult = BankApi.submitTransfer(cny.id, "fps", "overseas", fps.name, 100, "ANDROID TEST FPS", fps.bankCode, "HK", "", "HKD", "888888", TransferConfirmation("CNY", fpsQuote.fee, System.currentTimeMillis() + 20000, fpsQuote.fx), fpsMethod = "mobile", fpsId = "91234567", confirmedRecipient = fps)
            assertTrue(fpsResult.transactionId.isNotBlank())
            val payees = BankApi.savedPayees(receiver.name)
            assertTrue(payees.length() > 0)
            val payeeId = payees.getJSONObject(0).getString("id")
            assertEquals("ANDROID TEST friend", BankApi.payeeRemark(payeeId, "ANDROID TEST friend").getString("remark"))
            assertTrue(BankApi.savedPayees("ANDROID TEST friend").length() > 0)
            val scheduled = BankApi.paymentPlanWrite("POST", "/api/transfers/scheduled", JSONObject().put("fromAccountId", source.id).put("channel", "bank").put("scope", "domestic").put("payeeName", receiver.name).put("payeeAccountNo", receiving.accountNo).put("payeeBankCode", "LCB").put("payeeBankRegion", "CN").put("amount", 100).put("memo", "ANDROID TEST schedule").put("executeAt", Instant.now().plusSeconds(3600).truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString()).put("paymentPassword", "888888").put("confirmed", true).put("clientRequestId", UUID.randomUUID().toString()))
            assertEquals("scheduled", scheduled.getString("status"))
            val cancelled = BankApi.paymentPlanWrite("DELETE", "/api/transfers/scheduled/${scheduled.getString("id")}", JSONObject().put("version", scheduled.getInt("version")))
            assertEquals("cancelled", cancelled.getString("status"))
            val collection = BankApi.paymentPlanWrite("POST", "/api/transfers/splits", JSONObject().put("title", "ANDROID TEST AA").put("currency", "CNY").put("confirmed", true).put("clientRequestId", UUID.randomUUID().toString()).put("allocation", JSONObject().put("amount", 101).put("participants", JSONArray(listOf("参与人甲", "参与人乙")))).put("members", JSONArray().put(JSONObject().put("phone", receiver.phone).put("amount", 51).put("memo", "ANDROID TEST AA 甲")).put(JSONObject().put("phone", "13900000000").put("amount", 50).put("memo", "ANDROID TEST AA 乙"))))
            SessionStore.save(receiver)
            val requests = BankApi.paymentPlanList("/api/transfers/aa-payments")
            val due = (0 until requests.length()).map { requests.getJSONObject(it) }.single { it.getString("collectionId") == collection.getString("id") }
            val paid = BankApi.paymentPlanWrite("POST", "/api/transfers/aa-payments/${due.getString("id")}/pay", JSONObject().put("version", due.getInt("version")).put("confirmed", true).put("paymentPassword", "888888"))
            assertEquals("paid", paid.getString("status"))
            SessionStore.save(sender)
            val collections = BankApi.paymentPlanList("/api/transfers/splits")
            val stored = (0 until collections.length()).map { collections.getJSONObject(it) }.single { it.getString("id") == collection.getString("id") }
            assertTrue(stored.getJSONArray("participants").getJSONObject(0).getString("status") == "paid")
            BankApi.paymentPlanWrite("DELETE", "/api/transfers/splits/${stored.getString("id")}", JSONObject().put("version", stored.getInt("version")))
            val budget = BankApi.budgetRequest("POST", "/api/budgets", JSONObject().put("name", "ANDROID TEST budget").put("platforms", JSONArray(listOf("luckin"))).put("dailyLimit", 2000).put("pointThreshold", 1000))
            val updated = BankApi.budgetRequest("PATCH", "/api/budgets/${budget.getString("id")}", JSONObject().put("enabled", false))
            assertFalse(updated.getBoolean("enabled"))
            BankApi.budgetRequest("DELETE", "/api/budgets/${budget.getString("id")}")
            val beforeRules = BankApi.accounts().single().currencyBalances.first { it.currency == "CNY" }
            val goal = BankApi.savingsRequest("POST", "/api/savings/goals", JSONObject().put("name", "ANDROID TEST savings").put("targetAmount", 10000)) as JSONObject
            val roundup = BankApi.savingsRequest("PATCH", "/api/savings/roundup", JSONObject().put("enabled", true).put("roundupTo", 100).put("dailyCap", 1000).put("accountId", source.id).put("goalId", goal.getString("id"))) as JSONObject
            assertTrue(roundup.getBoolean("enabled"))
            BankApi.savingsRequest("DELETE", "/api/savings/goals/${goal.getString("id")}")
            val investments = BankApi.savingsRequest("GET", "/api/wealth/investments") as JSONObject
            val product = investments.getJSONArray("products").let { rows -> (0 until rows.length()).map { rows.getJSONObject(it) }.first { it.getString("risk") == "low" } }
            val investment = BankApi.savingsRequest("POST", "/api/wealth/investments/plan", JSONObject().put("productCode", product.getString("code")).put("amount", product.getLong("minAmount")).put("cycle", "每月").put("accountId", source.id).put("paymentPassword", "888888")) as JSONObject
            val paused = BankApi.savingsRequest("PATCH", "/api/wealth/investments/plan/${investment.getString("id")}", JSONObject().put("status", "paused").put("expectedRevision", investment.getInt("revision"))) as JSONObject
            assertEquals("paused", paused.getString("status"))
            val resumed = BankApi.savingsRequest("PATCH", "/api/wealth/investments/plan/${investment.getString("id")}", JSONObject().put("status", "active").put("expectedRevision", paused.getInt("revision")).put("paymentPassword", "888888")) as JSONObject
            BankApi.savingsRequest("PATCH", "/api/wealth/investments/plan/${investment.getString("id")}", JSONObject().put("status", "cancelled").put("expectedRevision", resumed.getInt("revision")))
            val cash = BankApi.savingsRequest("PATCH", "/api/wealth/cash-management/sweep", JSONObject().put("enabled", true).put("threshold", 10000)) as JSONObject
            assertEquals(10000L, cash.getLong("sweepThreshold"))
            assertEquals(beforeRules.balance, BankApi.accounts().single().currencyBalances.first { it.currency == "CNY" }.balance)
            val birthdayBody = JSONObject().put("contactName", "测试联系人").put("relationship", "朋友").put("eventDate", java.time.LocalDate.now(bankZone).plusDays(10).toString()).put("currency", "CNY").put("amountCents", 100).put("accountId", source.id)
            val preview = BankApi.savingsRequest("POST", "/api/linked/birthdays/preview", birthdayBody) as JSONObject
            assertFalse(preview.getBoolean("merchantConnected"))
            val birthday = BankApi.savingsRequest("POST", "/api/linked/birthdays", JSONObject(birthdayBody.toString()).put("confirmed", true).put("paymentPassword", "888888").put("requestId", UUID.randomUUID().toString())) as JSONObject
            val birthdayCancelled = BankApi.savingsRequest("POST", "/api/linked/birthdays/${birthday.getString("id")}/cancel", JSONObject().put("confirmed", true)) as JSONObject
            assertEquals("cancelled", birthdayCancelled.getString("status"))
            assertEquals(beforeRules.available, BankApi.accounts().single().currencyBalances.first { it.currency == "CNY" }.available)
            val spendingCard = CardApi.cards().first { it.status == "active" }
            val spent = CardApi.spend(spendingCard.id, JSONObject().put("platform", "netease-music").put("amount", 100).put("subscription", true).put("note", "ANDROID TEST subscription"))
            assertTrue(spent.getJSONObject("transaction").getString("id").isNotBlank())
            assertEquals(100L, spent.getJSONObject("autoDebit").getLong("amount"))
            val ticket = BankApi.supportRequest("POST", "/api/support/tickets", JSONObject().put("requestId", UUID.randomUUID().toString()).put("reason", "ANDROID TEST help"))
            BankApi.supportRequest("POST", "/api/support/tickets/${ticket.getString("ticketId")}/messages", JSONObject().put("requestId", UUID.randomUUID().toString()).put("text", "ANDROID TEST reply"))
            assertEquals(1, BankApi.supportRequest("GET", "/api/support/tickets/${ticket.getString("ticketId")}").getJSONArray("messages").length())
            val partitions = BankApi.accounts().single().partitions()
            val first = LedgerApi.recent(partitions, size = 10)
            val extended = LedgerApi.recent(partitions, size = 10, pages = 2)
            assertTrue(extended.items.size > first.items.size)
            assertEquals(extended.items.size, extended.items.distinctBy { it.id }.size)
            val month = java.time.YearMonth.now(bankZone).toString()
            assertEquals("CNY", LedgerApi.report("month", month, "CNY").getString("currency"))
            assertTrue(LedgerApi.reportCsv("year", month.take(4), "CNY").startsWith("\uFEFF"))
            assertTrue(LedgerApi.transactionsCsv(partitions, TxQuery()).startsWith("\uFEFF"))
            instrumentation.waitForIdleSync()
            assertNull(FinancialRecovery.pending)
            val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val oldAgent = AgentApi.baseUrl
            AgentApi.baseUrl = "$base/agent-api"
            try {
                fun findUi(label: String): AccessibilityNodeInfo? {
                    fun visit(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
                        if (node == null) return null
                        if (node.isVisibleToUser && (node.text?.toString() == label || node.contentDescription?.toString() == label)) return node
                        for (index in 0 until node.childCount) visit(node.getChild(index))?.let { return it }
                        return null
                    }
                    return visit(instrumentation.uiAutomation.rootInActiveWindow)
                }
                fun awaitUi(label: String): AccessibilityNodeInfo {
                    repeat(60) {
                        findUi(label)?.let { return it }
                        Thread.sleep(100)
                    }
                    error("UI label missing: $label")
                }
                fun clickUi(label: String) {
                    repeat(6) {
                        val observed = awaitUi(label)
                        var node: AccessibilityNodeInfo? = observed
                        while (node != null && node.actionList.none { action -> action.id == AccessibilityNodeInfo.ACTION_CLICK }) node = node.parent
                        if (node != null && node.refresh() && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                            Thread.sleep(450)
                            instrumentation.waitForIdleSync()
                            return
                        }
                        if (observed.isVisibleToUser && observed.isEnabled) {
                            val bounds = android.graphics.Rect()
                            observed.getBoundsInScreen(bounds)
                            if (!bounds.isEmpty) {
                                val now = android.os.SystemClock.uptimeMillis()
                                instrumentation.sendPointerSync(android.view.MotionEvent.obtain(now, now, android.view.MotionEvent.ACTION_DOWN, bounds.exactCenterX(), bounds.exactCenterY(), 0))
                                instrumentation.sendPointerSync(android.view.MotionEvent.obtain(now, now + 80, android.view.MotionEvent.ACTION_UP, bounds.exactCenterX(), bounds.exactCenterY(), 0))
                                Thread.sleep(450)
                                instrumentation.waitForIdleSync()
                                return
                            }
                        }
                        Thread.sleep(200)
                    }
                    error("Not clickable: $label")
                }
                fun saveUi(name: String) {
                    instrumentation.waitForIdleSync()
                    val bitmap = instrumentation.uiAutomation.takeScreenshot()
                    assertNotNull(bitmap)
                    File(context.filesDir, "parity-$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
                }
                fun capture(name: String, fullApp: Boolean = false, content: @androidx.compose.runtime.Composable () -> Unit) {
                    instrumentation.runOnMainSync { activity.setContent { MoneyMeowTheme { if (fullApp) content() else androidx.compose.material3.Scaffold(containerColor = Tokens.Page) { insets -> Box(Modifier.padding(insets)) { content() } } } } }
                    Thread.sleep(1800)
                    instrumentation.waitForIdleSync()
                    saveUi(name)
                }
                capture("plans") { PaymentPlansScreen(onBack = {}) }
                assertNull(findUi("收款人姓名"))
                clickUi("新建定时转账")
                awaitUi("收款人姓名")
                saveUi("plans-form")
                clickUi("返回")
                capture("report") { BillingReportScreen(onBack = {}, onBudgets = {}) }
                capture("budgets") { BudgetScreen(onBack = {}) }
                assertNull("Overview must not expose the create form", findUi("预算名称"))
                clickUi("创建支出预算")
                val budgetName = awaitUi("预算名称")
                // Prefer the editable node labelled for accessibility, rather than screen coordinates.
                fun firstEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
                    if (node == null) return null
                    if (node.isEditable) return node
                    for (index in 0 until node.childCount) firstEditable(node.getChild(index))?.let { return it }
                    return null
                }
                val input = if (budgetName.isEditable) budgetName else firstEditable(instrumentation.uiAutomation.rootInActiveWindow)
                assertNotNull(input)
                assertTrue(input!!.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "出行预算草稿") }))
                Thread.sleep(250)
                saveUi("budgets-form")
                clickUi("返回")
                clickUi("创建支出预算")
                awaitUi("出行预算草稿")
                clickUi("返回")
                capture("savings") { PlansScreen(onBack = {}) }
                clickUi("定投")
                clickUi("新建定投计划")
                awaitUi("每期金额（元）")
                saveUi("savings-dca-form")
                clickUi("返回")
                clickUi("现金管理")
                awaitUi("管理自动转入")
                saveUi("savings-cash")
                clickUi("管理自动转入")
                awaitUi("保留金额（元）")
                saveUi("savings-cash-form")
                clickUi("返回")
                clickUi("生日")
                clickUi("新建生日计划")
                awaitUi("联系人姓名")
                saveUi("savings-birthday-form")
                clickUi("返回")
                capture("spend") { SpendScreen(onBack = {}, onTransactions = {}) }
                assertNull(findUi("消费金额（元）"))
                clickUi("新建模拟消费")
                awaitUi("消费金额（元）")
                saveUi("spend-form")
                clickUi("返回")
                capture("aa") { PaymentPlansScreen(onBack = {}, initialTab = 1) }
                clickUi("发起 AA 收款")
                awaitUi("收款事由")
                saveUi("aa-form")
                clickUi("返回")
                SessionStore.save(receiver)
                capture("aapay") { PaymentPlansScreen(onBack = {}, initialTab = 2) }
                SessionStore.save(sender)
                capture("detail") { TxDetailScreen(onBack = {}, transactionId = result.transactionId) }
                capture("membership") { MembershipScreen(onBack = {}) }
                capture("delivery") { DeliveryScreen(onBack = {}) }
                capture("transfers") { TransferSelectScreen(onBack = {}, onPick = {}, onPickPayee = {}) }
                capture("fps-amount") { AmountScreen(onBack = {}, draft = TransferDraft(channel = "fps", method = "fps", payeeName = fps.name, bankCode = fps.bankCode, bankRegion = "HK", fpsMethod = "mobile", fpsId = "91234567"), onSubmitted = {}) }
                capture("transfer-amount") { AmountScreen(onBack = {}, draft = TransferDraft(payeeName = receiver.name, payeeAccountNo = receiving.accountNo, bankCode = "LCB"), onSubmitted = { error("UI inspection must not submit a transfer") }) }
                val amountLabel = awaitUi("转账金额")
                val amountInput = if (amountLabel.isEditable) amountLabel else firstEditable(amountLabel) ?: firstEditable(instrumentation.uiAutomation.rootInActiveWindow)
                assertNotNull("Transfer amount must expose an editable field", amountInput)
                assertTrue(amountInput!!.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "1.00") }))
                awaitUi("1.00")
                Thread.sleep(600)
                clickUi("确认转出")
                awaitUi("支付密码")
                assertNull("Confirmation must not repeat the complete recipient account", findUi(receiving.accountNo))
                saveUi("transfer-confirm")
                instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
                Thread.sleep(400)
                capture("more") { MoreScreen(onBack = {}, onOpen = {}) }
                capture("analysis") { AnalysisScreen(onBack = {}, onReport = {}) }
                capture("im") { ImScreen(onBack = {}, onReminders = {}) }
                capture("home") { HomeScreen(onOpen = {}, onSwitchTab = {}, onOpenTx = {}) }
                capture("app-home", fullApp = true) { BankApp() }
                clickUi("我的")
                awaitUi("银行卡管理")
                saveUi("app-me")
                clickUi("总览")
                clickUi("银行卡")
                awaitUi("我的卡片")
                saveUi("app-cards")
            } finally {
                AgentApi.baseUrl = oldAgent
                instrumentation.runOnMainSync { activity.finish() }
            }
        } finally {
            BankApi.baseUrl = oldBase
            SessionStore.clear()
            context.getSharedPreferences("financial_recovery", 0).edit().clear().commit()
        }
    }
}
