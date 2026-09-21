package cn.waveflow.luckycat.domain.voice

/**
 * 把助手回复的 Markdown 变成"**能念出来**的话"。
 *
 * 助手回复是按 Markdown 写的，直接丢给语音合成会念出 `**`、`|---|`、`](https://…)`
 * 这些东西——对听的人来说是纯噪音，而且一句话里夹一堆符号会让整段都听不懂。
 * （界面上怎么渲染是另一件事：这里只管**听**。）
 *
 * 逐条照抄网页版 `app/src/lib/speech.ts`，取舍也一样：
 *
 * - **代码块、图片整段丢掉**。念代码没有意义，念图片地址更是。
 * - **链接只留文字**，丢掉地址。把 URL 逐字符念出来对谁都没用。
 * - **表格每行拼成「表头，值。」**。确认卡片那种两列表格，念出来正好是
 *   "收款人，梁乐怡。转账金额，800.00 元。"
 * - **公式去掉 `$` 定界符**，内容留着（念 LaTeX 不理想，但比丢掉信息好）。
 *
 * 纯函数，能离线测——这是它放在 `:domain` 的全部理由。
 */
object SpeechText {

    /** 默认最多念多少字（与服务端的上限保持一致）。 */
    const val MAX_CHARS = 600

    /** 表格的分隔行，例如 `| --- | :---: |`。 */
    private val TABLE_SEPARATOR = Regex("""^\s*\|?[\s:|-]+\|[\s:|-]*$""")

    /**
     * @param markdown - 助手回复原文。
     * @param maxChars - 最多保留多少字；超出会在句子边界断开。
     * @returns 朗读用文本；没有可念的内容时返回空串。
     */
    fun of(markdown: String, maxChars: Int = MAX_CHARS): String {
        var text = markdown

        // 代码块整段丢掉（含围栏本身）。**必须先做这一步**：里面的 `#`、`*`
        // 之类不该被后面的规则碰到。
        text = text.replace(Regex("```[\\s\\S]*?```"), " ")
        text = text.replace(Regex("~~~[\\s\\S]*?~~~"), " ")

        // 图片整段丢掉，链接只留文字
        text = text.replace(Regex("!\\[[^\\]]*\\]\\([^)]*\\)"), " ")
        text = text.replace(Regex("\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")

        // 表格：分隔行丢掉，数据行拼成「单元格，单元格。」
        text = text.split('\n').joinToString("\n") { line ->
            if (!line.trim().startsWith("|")) line
            else if (TABLE_SEPARATOR.matches(line)) ""
            else {
                val cells = line.split('|').map { it.trim() }.filter { it.isNotEmpty() }
                if (cells.isEmpty()) "" else cells.joinToString("，") + "。"
            }
        }

        // 行首标记：标题、引用、列表项、有序列表
        text = text.replace(Regex("^\\s{0,3}#{1,6}\\s+", RegexOption.MULTILINE), "")
        text = text.replace(Regex("^\\s{0,3}>\\s?", RegexOption.MULTILINE), "")
        text = text.replace(Regex("^\\s{0,3}[-*+]\\s+", RegexOption.MULTILINE), "")
        text = text.replace(Regex("^\\s{0,3}\\d+[.)]\\s+", RegexOption.MULTILINE), "")

        // 分隔线
        text = text.replace(Regex("^\\s{0,3}([-*_])\\s*(\\1\\s*){2,}$", RegexOption.MULTILINE), "")

        // 行内样式：粗体 / 斜体 / 删除线 / 行内代码 / 公式定界符
        text = text.replace(Regex("(\\*\\*|__)(.*?)\\1"), "$2")
        text = text.replace(Regex("(\\*|_)(.*?)\\1"), "$2")
        text = text.replace(Regex("~~(.*?)~~"), "$1")
        text = text.replace(Regex("`([^`]*)`"), "$1")
        text = text.replace(Regex("\\$+([^$]*)\\$+"), "$1")

        // HTML 标签（回复里偶尔夹 <br> 之类）与剩余的反斜杠转义
        text = text.replace(Regex("<[^>]+>"), " ")
        text = text.replace(Regex("\\\\([\\\\`*_{}\\[\\]()#+\\-.!])"), "$1")

        // 逐行接起来。**中文不能拿空格当标点**——语音合成靠标点决定在哪停。
        // 直接把换行抹掉的话，列表项会连成「手续费 0.00到账时间：实时」这样一口气的长句；
        // 而一律补句号又会在 Markdown 硬折行的地方凭空断句。所以：换行两侧都不是标点时
        // 补一个**逗号**——它只表示停顿，不断言一句话结束。
        val lines = text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        val joined = StringBuilder()
        for (line in lines) {
            if (joined.isEmpty()) {
                joined.append(line)
                continue
            }
            val previous = joined.last()
            joined.append(if (STOPS.contains(previous)) line else "，$line")
        }

        text = joined.toString().replace(Regex("[ \t]+"), " ").trim()
        return truncateAtSentence(text, maxChars)
    }

    /** 截断到上限，尽量断在句子边界上。 */
    private fun truncateAtSentence(text: String, maxChars: Int): String {
        if (text.length <= maxChars) return text
        val head = text.take(maxChars)
        // 从后往前找最近的句末标点，避免把一句话念一半。
        // 找不到就用硬截断——总比不念强。
        val lastStop = STOPS.maxOf { head.lastIndexOf(it) }
        val cut = if (lastStop > maxChars * 0.5) head.take(lastStop + 1) else head
        return "$cut……"
    }

    /** 句末与停顿标点。`joined.last()` 用它判断要不要补逗号。 */
    private const val STOPS = "。！？；：，、!?;:,. "
}
