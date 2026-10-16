package cn.waveflow.luckycat

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * 系统栏不许压住内容。
 *
 * 起因是真机上的实测：`AMG-AN00` / Android 16 / 1200×2664，状态栏 inset 126px，
 * 而登录页标题顶端落在 78px——**标题被状态栏压住 48px**。
 * 根因是 targetSdk 36 下 Android 15+ 强制 edge-to-edge，而窗口里没有一处消费
 * `WindowInsets`（模拟器也是 API 35+，同样中招，只是没盯着系统栏看）。
 *
 * ## 为什么断言用"实测 inset"而不是写死的 dp
 *
 * 各机型状态栏高度不同（这台 38.8dp，模拟器 24dp 左右），写死一个数字会在别的
 * 设备上变成假红/假绿。这里取**设备自己报的 inset** 做基准，验的是不变量本身：
 * 内容顶端必须在状态栏之下。
 *
 * ## 空断言防线
 *
 * 如果 inset 取不到（时序问题），断言会退化成"必然成立"——本项目已经栽过两次空
 * 断言，所以这里显式要求 `statusTop > 0`：取不到 inset 就直接红，不许安静通过。
 */
class EdgeToEdgeInsetsTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    @Test
    fun 登录页内容不被系统栏遮挡() {
        val decor = rule.activity.window.decorView
        // inset 是异步派发到窗口的，先等它到，再读。
        rule.waitUntil(5_000) { ViewCompat.getRootWindowInsets(decor) != null }
        val insets = ViewCompat.getRootWindowInsets(decor)!!
        val statusTop = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
        val navBottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom

        assertTrue(
            "状态栏 inset 读成 $statusTop——取不到 inset 时这条断言没有意义，直接红掉",
            statusTop > 0,
        )

        val titleTop = rule.onNodeWithTag("login-title").fetchSemanticsNode().boundsInRoot.top
        assertTrue(
            "标题顶端 ${titleTop}px 落在状态栏 ${statusTop}px 里面（内容被压住了）",
            titleTop >= statusTop,
        )

        // 底部这条只在真报了导航栏 inset 时才验：手势导航的三键/手势模式下
        // bottom inset 可能是 0，那时"不越界"是个恒真命题。
        if (navBottom > 0) {
            val contentBottom = rule.onNodeWithTag("login-open-account")
                .fetchSemanticsNode().boundsInRoot.bottom
            assertTrue(
                "底部控件 ${contentBottom}px 落在导航栏里（屏高 ${decor.height} − ${navBottom}）",
                contentBottom <= decor.height - navBottom,
            )
        }
    }
}
