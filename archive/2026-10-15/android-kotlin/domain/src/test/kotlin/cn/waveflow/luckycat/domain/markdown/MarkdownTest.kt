package cn.waveflow.luckycat.domain.markdown

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Markdown 解析。
 *
 * 最要紧的是**安全那三条**：不解析 HTML、不渲染图片、链接只认白名单协议。
 * 它们在界面上看不出对错，只有拿恶意输入喂进去才知道。
 */
class MarkdownTest {

    private fun firstParagraph(text: String) = Markdown.parse(text).first() as MdBlock.Paragraph

    // ── 块 ──────────────────────────────────────────────────────────────

    @Test
    fun `标题按层号解出来`() {
        val blocks = Markdown.parse("## 转账结果\n### 明细")
        assertEquals(MdBlock.Heading(2, listOf(MdSpan.Text("转账结果"))), blocks[0])
        assertEquals(MdBlock.Heading(3, listOf(MdSpan.Text("明细"))), blocks[1])
    }

    @Test
    fun `列表把每一项分开`() {
        val block = Markdown.parse("- 查余额\n- 看流水\n- 转账")[0] as MdBlock.Bullet
        assertEquals(3, block.items.size)
        assertEquals(listOf(MdSpan.Text("查余额")), block.items[0])
    }

    @Test
    fun `表格解出表头与数据行`() {
        val block = Markdown.parse("| 收款人 | 金额 |\n| --- | --- |\n| 梁乐怡 | 800.00 |")[0] as MdBlock.Table
        assertEquals(2, block.header.size)
        assertEquals(1, block.rows.size)
        assertEquals(listOf(MdSpan.Text("梁乐怡")), block.rows[0][0])
    }

    @Test
    fun `不是表格的竖线行不当表格`() {
        // 表格必须有分隔行；没有的话它只是一段普通文字
        val blocks = Markdown.parse("| 这只是普通一行 |")
        assertTrue(blocks[0] is MdBlock.Paragraph)
    }

    @Test
    fun `围栏代码块原样收走且内部不解析`() {
        val block = Markdown.parse("```json\n{\"a\": **1**}\n```\n后面的字")[0] as MdBlock.Code
        assertEquals("json", block.language)
        // 代码块里 `**1**` 不该被当成粗体——那样代码就被改写了
        assertEquals("{\"a\": **1**}", block.text)
    }

    @Test
    fun `连续普通行合成一段`() {
        val blocks = Markdown.parse("第一行\n第二行\n\n另一段")
        assertEquals(2, blocks.size)
        assertEquals(listOf(MdSpan.Text("第一行\n第二行")), (blocks[0] as MdBlock.Paragraph).spans)
    }

    // ── 行内 ────────────────────────────────────────────────────────────

    @Test
    fun `粗体`() {
        assertEquals(listOf(MdSpan.Bold("转账")), Markdown.inline("**转账**"))
    }

    @Test
    fun `下划线粗体也认`() {
        assertEquals(listOf(MdSpan.Bold("转账")), Markdown.inline("__转账__"))
    }

    @Test
    fun `粗体优先于斜体`() {
        // 先试短线的话 `**x**` 会被当成两个斜体
        val spans = Markdown.inline("**粗**和*斜*")
        assertEquals(MdSpan.Bold("粗"), spans[0])
        assertTrue(spans.any { it is MdSpan.Italic && it.text == "斜" })
    }

    @Test
    fun `行内代码`() {
        assertEquals(listOf(MdSpan.Code("0000")), Markdown.inline("`0000`"))
    }

    @Test
    fun `普通文字与样式混排`() {
        val spans = Markdown.inline("请把 **800 元** 转给 `梁乐怡`")
        assertEquals(MdSpan.Text("请把 "), spans[0])
        assertEquals(MdSpan.Bold("800 元"), spans[1])
        assertEquals(MdSpan.Text(" 转给 "), spans[2])
        assertEquals(MdSpan.Code("梁乐怡"), spans[3])
    }

    // ── 安全（三条）──────────────────────────────────────────────────────

    @Test
    fun `javascript 链接只当文字 不做成链接`() {
        // 做成可点链接在网页上就是一次 XSS；安卓上虽然没那么致命，
        // 但同一个解析器两边共用，规矩必须一致
        val spans = Markdown.inline("[点我](javascript:alert(1))")
        assertEquals(listOf(MdSpan.UnsafeLink("点我")), spans)
    }

    @Test
    fun `data 与 file 协议也不认`() {
        assertTrue(Markdown.inline("[x](data:text/html,<script>)")[0] is MdSpan.UnsafeLink)
        assertTrue(Markdown.inline("[x](file:///etc/passwd)")[0] is MdSpan.UnsafeLink)
    }

    @Test
    fun `协议大小写不敏感`() {
        // `JavaScript:` 一样危险
        assertTrue(Markdown.inline("[x](JavaScript:alert(1))")[0] is MdSpan.UnsafeLink)
    }

    @Test
    fun `http https mailto 是安全链接`() {
        assertEquals(MdSpan.Link("帮助", "https://example.com/a"), Markdown.inline("[帮助](https://example.com/a)")[0])
        assertEquals(MdSpan.Link("邮件", "mailto:a@b.c"), Markdown.inline("[邮件](mailto:a@b.c)")[0])
    }

    @Test
    fun `图片不渲染 只留一行提示`() {
        // 图片会把 URL 变成一次自动请求——那是把对话内容编码进地址外带的通道，
        // 也能当追踪像素
        val blocks = Markdown.parse("![转账截图](https://evil.example/pixel.png)")
        assertEquals(MdBlock.Image("转账截图"), blocks[0])
    }

    @Test
    fun `行内图片也只是提示 不产生链接`() {
        val spans = Markdown.inline("见 ![图](https://evil.example/x.png) 所示")
        assertTrue("不该出现任何链接 span", spans.none { it is MdSpan.Link })
        assertTrue(spans.any { it is MdSpan.Text && it.text.contains("图片") })
    }

    @Test
    fun `HTML 标签原样当文字`() {
        // 不解析 HTML：它是模型写的，不该变成结构
        val spans = Markdown.inline("<b>加粗</b>")
        assertEquals(1, spans.size)
        assertTrue(spans[0] is MdSpan.Text)
        assertEquals("<b>加粗</b>", (spans[0] as MdSpan.Text).text)
    }

    @Test
    fun `HTML 里夹的脚本也不会变成结构`() {
        val spans = Markdown.inline("<script>alert(1)</script>")
        assertTrue(spans.all { it is MdSpan.Text })
        assertFalse(spans.any { it is MdSpan.Bold || it is MdSpan.Link })
    }
}
