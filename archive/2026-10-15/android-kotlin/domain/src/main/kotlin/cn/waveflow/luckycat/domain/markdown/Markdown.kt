package cn.waveflow.luckycat.domain.markdown

/**
 * 助手回复的 Markdown 解析。
 *
 * **刻意只做一小块**：模型实际会用的那几种（标题、列表、表格、粗体、斜体、
 * 行内代码、链接、围栏代码块、图片）。不追 GFM 完备性——多支持一种语法就多
 * 一份会被恶意输入探到的解析代码，而多出来的那点表达能力在这个场景里没人用。
 *
 * **不支持的**：KaTeX 公式。网页版会真的排版出来；这里原样显示 `$…$`。
 * 这是个明确的缺口，不是"顺手支持一下"——排公式要引入整套 LaTeX 排版器。
 */
object Markdown {

    private val HEADING = Regex("^(#{1,6})\\s+(.*)$")
    private val BULLET = Regex("^\\s*[-*+]\\s+(.*)$")
    private val FENCE = Regex("^\\s*```(\\w*)\\s*$")
    private val TABLE_SEPARATOR = Regex("^\\s*\\|?[\\s:|-]+\\|[\\s:|-]*$")

    /** 允许成链接的协议白名单。 */
    private val SAFE_PROTOCOLS = setOf("http", "https", "mailto")

    fun parse(source: String): List<MdBlock> {
        val blocks = mutableListOf<MdBlock>()
        val lines = source.replace("\r\n", "\n").split('\n')
        var i = 0

        while (i < lines.size) {
            val line = lines[i]

            // 围栏代码块：整段原样收走，内部不做任何解析
            val fence = FENCE.matchEntire(line)
            if (fence != null) {
                val language = fence.groupValues[1].ifEmpty { null }
                val body = StringBuilder()
                i += 1
                while (i < lines.size && FENCE.matchEntire(lines[i]) == null) {
                    if (body.isNotEmpty()) body.append('\n')
                    body.append(lines[i])
                    i += 1
                }
                i += 1  // 跳过收尾的那行 ```
                blocks += MdBlock.Code(body.toString(), language)
                continue
            }

            // 空行：块之间
            if (line.isBlank()) {
                i += 1
                continue
            }

            HEADING.matchEntire(line)?.let { match ->
                blocks += MdBlock.Heading(match.groupValues[1].length, inline(match.groupValues[2]))
                i += 1
                continue
            }

            if (BULLET.matchEntire(line) != null) {
                val items = mutableListOf<List<MdSpan>>()
                while (i < lines.size) {
                    val item = BULLET.matchEntire(lines[i]) ?: break
                    items += inline(item.groupValues[1])
                    i += 1
                }
                blocks += MdBlock.Bullet(items)
                continue
            }

            if (isTableStart(lines, i)) {
                val table = parseTable(lines, i)!!
                blocks += table.first
                i = table.second
                continue
            }

            // 整段图片：单独成块的图片退化成一行提示
            val imageOnly = IMAGE_ONLY.matchEntire(line.trim())
            if (imageOnly != null) {
                blocks += MdBlock.Image(imageOnly.groupValues[1])
                i += 1
                continue
            }

            // 段落：连续的普通行合到一块
            val paragraph = mutableListOf<String>()
            while (i < lines.size) {
                val candidate = lines[i]
                if (candidate.isBlank() || FENCE.matchEntire(candidate) != null ||
                    HEADING.matchEntire(candidate) != null || BULLET.matchEntire(candidate) != null ||
                    // **必须与主循环用同一个判断**：主循环用 "以 | 开头 **且下一行是分隔行**"，
                    // 这里要是只判 "以 | 开头"，那"以 | 开头但不是表格"的行会两边都不吃，
                    // i 不前进 → 死循环。（实测踩到，整个测试跑挂了 10 分钟。）
                    isTableStart(lines, i) || IMAGE_ONLY.matchEntire(candidate.trim()) != null
                ) {
                    break
                }
                paragraph += candidate
                i += 1
            }
            if (paragraph.isEmpty()) {
                // 兜底：任何"一个分支都不吃这行"的情况都在这里前进一格。
                // 宁可显示得难看一点，也不能死循环。
                i += 1
            } else {
                blocks += MdBlock.Paragraph(inline(paragraph.joinToString("\n")))
            }
        }
        return blocks
    }

    /** 这一行是不是表格的开头（**必须下一行是分隔行**才算）。 */
    private fun isTableStart(lines: List<String>, index: Int): Boolean {
        val head = lines.getOrNull(index) ?: return false
        val separator = lines.getOrNull(index + 1) ?: return false
        return head.trim().startsWith("|") && TABLE_SEPARATOR.matches(separator)
    }

    /** @returns 块与下一个下标；第一行不是表格时返回 `null`。 */
    private fun parseTable(lines: List<String>, start: Int): Pair<MdBlock.Table, Int>? {
        val headerLine = lines.getOrNull(start) ?: return null
        val separator = lines.getOrNull(start + 1) ?: return null
        if (!TABLE_SEPARATOR.matches(separator)) return null

        val header = splitRow(headerLine)
        val rows = mutableListOf<List<List<MdSpan>>>()
        var i = start + 2
        while (i < lines.size && lines[i].trim().startsWith("|")) {
            rows += splitRow(lines[i])
            i += 1
        }
        return MdBlock.Table(header, rows) to i
    }

    private fun splitRow(line: String): List<List<MdSpan>> =
        line.trim().trim('|').split('|').map { inline(it.trim()) }

    /**
     * 行内解析。
     *
     * **按"先长后短"的顺序**匹配：`**粗**` 必须比 `*斜*` 先试，否则
     * `**x**` 会被当成两个斜体。
     */
    internal fun inline(text: String): List<MdSpan> {
        val spans = mutableListOf<MdSpan>()
        val plain = StringBuilder()
        var i = 0

        fun flush() {
            if (plain.isNotEmpty()) {
                spans += MdSpan.Text(plain.toString())
                plain.setLength(0)
            }
        }

        while (i < text.length) {
            val rest = text.substring(i)

            // 顺序是**先长后短**：`**粗**` 必须比 `*斜*` 先试，
            // 否则 `**x**` 会被当成两个斜体。
            val image = IMAGE.find(rest)?.takeIf { it.range.first == 0 }
            if (image != null) {
                flush()
                // 图片**不渲染**，退化成一行提示（见 MdBlock 的类文档）
                spans += MdSpan.Text("［图片：${image.groupValues[1].ifEmpty { "无说明" }}］")
                i += image.value.length
                continue
            }

            val link = LINK.find(rest)?.takeIf { it.range.first == 0 }
            if (link != null) {
                flush()
                val label = link.groupValues[1]
                val href = link.groupValues[2].trim()
                spans += if (isSafe(href)) MdSpan.Link(label, href) else MdSpan.UnsafeLink(label)
                i += link.value.length
                continue
            }

            val bold = BOLD.find(rest)?.takeIf { it.range.first == 0 }
            if (bold != null) {
                flush()
                spans += MdSpan.Bold(bold.groupValues[1].ifEmpty { bold.groupValues[2] })
                i += bold.value.length
                continue
            }

            val code = CODE.find(rest)?.takeIf { it.range.first == 0 }
            if (code != null) {
                flush()
                spans += MdSpan.Code(code.groupValues[1])
                i += code.value.length
                continue
            }

            val italic = ITALIC.find(rest)?.takeIf { it.range.first == 0 }
            if (italic != null) {
                flush()
                spans += MdSpan.Italic(italic.groupValues[1].ifEmpty { italic.groupValues[2] })
                i += italic.value.length
                continue
            }

            // 都不匹配：当成普通文字吃掉一个字符
            plain.append(text[i])
            i += 1
        }
        flush()
        return spans
    }

    /** 协议白名单。**大小写不敏感**：`JavaScript:` 一样是危险的。 */
    private fun isSafe(href: String): Boolean {
        val scheme = href.substringBefore(':', "").lowercase()
        if (scheme.isEmpty()) return false
        return scheme in SAFE_PROTOCOLS
    }

    /** URL 部分允许**一层配对括号**：`javascript:alert(1)` 这种写法很常见。 */
    private val URL_PART = "((?:[^()]|\\([^()]*\\))*)"
    private val IMAGE = Regex("^!\\[([^\\]]*)\\]\\($URL_PART\\)")
    private val IMAGE_ONLY = Regex("^!\\[([^\\]]*)\\]\\($URL_PART\\)$")
    private val LINK = Regex("^\\[([^\\]]*)\\]\\($URL_PART\\)")
    private val BOLD = Regex("^\\*\\*([^*]+)\\*\\*|^__([^_]+)__")
    private val CODE = Regex("^`([^`]+)`")
    private val ITALIC = Regex("^\\*([^*]+)\\*|^_([^_]+)_")
}
