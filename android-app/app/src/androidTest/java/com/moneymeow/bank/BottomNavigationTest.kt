package com.moneymeow.bank

import android.content.Intent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** A navigation regression without a bank login or financial requests. */
class BottomNavigationTest {
    @Test fun canReturnFromProfileToOverviewAndOpenCards() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val automation = instrumentation.uiAutomation
        Thread.sleep(500)
        val oldBase = BankApi.baseUrl
        SessionStore.init(context)
        BankApi.baseUrl = "http://127.0.0.1:9"
        SessionStore.save(LoginResult("isolated-navigation-test", "界面测试", ""))
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        try {
            fun node(label: String): AccessibilityNodeInfo? {
                fun walk(value: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
                    if (value == null) return null
                    if (value.isVisibleToUser && (value.contentDescription?.toString() == label || value.text?.toString() == label)) return value
                    for (index in 0 until value.childCount) walk(value.getChild(index))?.let { return it }
                    return null
                }
                return walk(instrumentation.uiAutomation.rootInActiveWindow)
            }
            fun click(label: String) {
                var target: AccessibilityNodeInfo? = null
                repeat(50) { if (target == null) { target = node(label); Thread.sleep(100) } }
                assertNotNull("Missing node: $label", target)
                println("CLICK $label: $target")
                val bounds = android.graphics.Rect()
                target!!.getBoundsInScreen(bounds)
                assertFalse(bounds.isEmpty)
                val now = android.os.SystemClock.uptimeMillis()
                instrumentation.sendPointerSync(android.view.MotionEvent.obtain(now, now, android.view.MotionEvent.ACTION_DOWN, bounds.exactCenterX(), bounds.exactCenterY(), 0))
                instrumentation.sendPointerSync(android.view.MotionEvent.obtain(now, now + 80, android.view.MotionEvent.ACTION_UP, bounds.exactCenterX(), bounds.exactCenterY(), 0))
                Thread.sleep(700)
                instrumentation.waitForIdleSync()
            }
            Thread.sleep(1500)
            click("我的")
            click("总览")
            Thread.sleep(600)
            click("银行卡")
            Thread.sleep(1000)
            assertNotNull(node("我的卡片"))
        } catch (failure: Throwable) {
            val screenshot = instrumentation.uiAutomation.takeScreenshot()
            File(context.filesDir, "nav-debug.png").outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            throw failure
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
            BankApi.baseUrl = oldBase
            SessionStore.clear()
        }
    }
}
