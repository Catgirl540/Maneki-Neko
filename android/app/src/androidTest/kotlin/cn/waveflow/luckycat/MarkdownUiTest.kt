package cn.waveflow.luckycat

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import cn.waveflow.luckycat.ui.chat.MarkdownText
import org.junit.Rule
import org.junit.Test

/**
 * Markdown 渲染的界面侧。
 *
 * 解析规则由 `:domain` 的 `MarkdownTest` 管；这里只管**画出来对不对**，
 * 尤其是"Markdown 记号不能出现在界面上"——解析漏一种，用户就会读到源码。
 */
class MarkdownUiTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun 粗体不显示星号() {
        rule.setContent { MarkdownText("请把 **800 元** 转给梁乐怡") }
        // 渲染出来应该是去掉记号的文字
        rule.onNodeWithText("请把 800 元 转给梁乐怡").assertIsDisplayed()
        rule.onAllNodesWithText("**").fetchSemanticsNodes().let {
            assert(it.isEmpty()) { "界面上不该出现 **" }
        }
    }

    @Test
    fun 列表渲染成条目() {
        rule.setContent { MarkdownText("- 查余额\n- 看流水") }
        rule.onNodeWithText("查余额").assertIsDisplayed()
        rule.onNodeWithText("看流水").assertIsDisplayed()
        rule.onAllNodesWithText("- 查余额").fetchSemanticsNodes().let {
            assert(it.isEmpty()) { "不该把列表记号一起显示出来" }
        }
    }

    @Test
    fun 表格渲染成表格且不显示分隔行() {
        rule.setContent {
            MarkdownText("| 收款人 | 金额 |\n| --- | --- |\n| 梁乐怡 | 800.00 |")
        }
        rule.onNodeWithTag("md-table").assertIsDisplayed()
        rule.onNodeWithText("梁乐怡").assertIsDisplayed()
        rule.onAllNodesWithText("---").fetchSemanticsNodes().let {
            assert(it.isEmpty()) { "分隔行不该被显示出来" }
        }
    }

    @Test
    fun 代码块原样显示() {
        rule.setContent { MarkdownText("```json\n{\"a\": 1}\n```") }
        rule.onNodeWithTag("md-code").assertIsDisplayed()
        rule.onNodeWithText("{\"a\": 1}").assertIsDisplayed()
    }

    @Test
    fun 图片退化成一行提示而不是去加载() {
        // 渲染图片会把 URL 变成一次自动请求——那是把对话内容编码进地址外带的通道
        rule.setContent { MarkdownText("![转账截图](https://evil.example/pixel.png)") }
        rule.onNodeWithTag("md-image-hint").assertIsDisplayed()
        rule.onAllNodesWithText("evil.example").fetchSemanticsNodes().let {
            assert(it.isEmpty()) { "不该把图片地址显示出来，更不该去请求它" }
        }
    }

    @Test
    fun 不安全协议的链接只当文字() {
        rule.setContent { MarkdownText("[点我](javascript:alert(1))") }
        // 文字在，但它是个普通 Text 而不是链接
        rule.onNodeWithText("点我").assertIsDisplayed()
    }

    @Test
    fun HTML标签原样当文字() {
        rule.setContent { MarkdownText("<b>加粗</b>") }
        rule.onNodeWithText("<b>加粗</b>").assertIsDisplayed()
    }
}
