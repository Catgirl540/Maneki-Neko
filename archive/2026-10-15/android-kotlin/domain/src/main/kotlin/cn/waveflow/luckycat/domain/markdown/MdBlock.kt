package cn.waveflow.luckycat.domain.markdown

/**
 * 助手回复的一个块。
 *
 * ## 为什么要有这一层
 *
 * 模型天然输出 Markdown（表格、粗体、列表）。原样显示，客户读到的是
 * `**转账**` `|---|` 这样的源码而不是答案。
 *
 * ## 三条**安全**上的选择（与网页版一致，输入是模型产出，不能当可信内容）
 *
 * 1. **不解析 HTML**：`<b>` 之类原样当文字。它是模型写的，不该变成结构。
 * 2. **图片不渲染**：Markdown 图片会把 URL 变成一次自动请求——
 *    那是"把对话内容编码进请求地址外带"的经典通道，也能当追踪像素。
 *    这里退化成一行文字提示（[MdBlock.Image]）。
 * 3. **链接只认 `http` / `https` / `mailto`**：`javascript:` `data:` 之类
 *    原样显示成文字，不做成可点的链接（[MdSpan.UnsafeLink]）。
 *
 * 解析放在 `:domain` 是因为上面三条都能离线验——它们在界面上看不出对错，
 * 只有拿恶意输入喂进去才知道。
 */
sealed interface MdBlock {
    /** `#` 标题，[level] 1..6。 */
    data class Heading(val level: Int, val spans: List<MdSpan>) : MdBlock

    data class Paragraph(val spans: List<MdSpan>) : MdBlock

    /** `- ` / `* ` 列表，[items] 每项是一行的若干段。 */
    data class Bullet(val items: List<List<MdSpan>>) : MdBlock

    /** GFM 表格。[header] 与每一行 [rows] 的列数可能不一致，渲染时按行对齐。 */
    data class Table(
        val header: List<List<MdSpan>>,
        val rows: List<List<List<MdSpan>>>,
    ) : MdBlock

    /** 围栏代码块的内容（原样，不做行内解析）。 */
    data class Code(val text: String, val language: String?) : MdBlock

    /**
     * 图片。**刻意不渲染**，只留一行提示——见类文档第 2 条。
     * [alt] 是替代文字，通常能说明这张图是什么。
     */
    data class Image(val alt: String) : MdBlock
}

/** 行内的一段。[MdSpan.Text] 之外的都带样式。 */
sealed interface MdSpan {
    data class Text(val text: String) : MdSpan
    data class Bold(val text: String) : MdSpan
    data class Italic(val text: String) : MdSpan
    data class Code(val text: String) : MdSpan

    /** 可点的安全链接。 */
    data class Link(val text: String, val href: String) : MdSpan

    /**
     * 协议不在白名单里的链接。**原样显示成文字，不做成链接**——
     * `[点我](javascript:alert(1))` 在网页上就是一次 XSS。
     */
    data class UnsafeLink(val text: String) : MdSpan
}
