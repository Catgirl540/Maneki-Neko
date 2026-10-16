package cn.waveflow.luckycat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.domain.markdown.Markdown
import cn.waveflow.luckycat.domain.markdown.MdBlock
import cn.waveflow.luckycat.domain.markdown.MdSpan
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 助手回复的 Markdown 渲染。
 *
 * 解析在 `:domain` 的 [Markdown] 里（可离线测，含那三条安全规则），
 * 这里只负责把块画出来。
 *
 * **公式（KaTeX）不支持**——网页版会真的排版出来，这里原样显示 `$…$`。
 * 这是个明确的缺口：排公式要引入整套 LaTeX 排版器，不是"顺手支持一下"。
 */
@Composable
fun MarkdownText(text: String, modifier: Modifier = Modifier) {
    val blocks = Markdown.parse(text)
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        blocks.forEach { block -> Block(block) }
    }
}

@Composable
private fun Block(block: MdBlock) {
    when (block) {
        is MdBlock.Heading -> Text(
            spans(block.spans),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.testTag("md-heading"),
        )

        is MdBlock.Paragraph -> Text(spans(block.spans), style = MaterialTheme.typography.bodyLarge)

        is MdBlock.Bullet -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            block.items.forEach { item ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("·", style = MaterialTheme.typography.bodyLarge, color = Palette.accentDeep)
                    Text(spans(item), style = MaterialTheme.typography.bodyLarge)
                }
            }
        }

        is MdBlock.Table -> Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(Palette.sunk)
                .padding(10.dp)
                .testTag("md-table"),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // 表头加粗，与数据行之间不加分隔线——小屏上多一条线更乱
            TableRow(block.header, header = true)
            block.rows.forEach { TableRow(it, header = false) }
        }

        is MdBlock.Code -> Text(
            block.text,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(Palette.sunk)
                .padding(10.dp)
                .testTag("md-code"),
        )

        // 图片**不渲染**，只留一行提示——见 MdBlock 的类文档
        is MdBlock.Image -> Text(
            "［图片：${block.alt.ifEmpty { "无说明" }}］",
            style = MaterialTheme.typography.bodyMedium,
            color = Palette.inkMute,
            modifier = Modifier.testTag("md-image-hint"),
        )
    }
}

@Composable
private fun TableRow(cells: List<List<MdSpan>>, header: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        cells.forEach { cell ->
            Text(
                spans(cell),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (header) FontWeight.SemiBold else FontWeight.Normal,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** 行内段 → [AnnotatedString]。 */
private fun spans(list: List<MdSpan>): AnnotatedString = buildAnnotatedString {
    list.forEach { span ->
        when (span) {
            is MdSpan.Text -> append(span.text)
            is MdSpan.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(span.text) }
            is MdSpan.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(span.text) }
            is MdSpan.Code -> withStyle(
                SpanStyle(fontFamily = FontFamily.Monospace, background = Palette.sunk),
            ) { append(span.text) }

            is MdSpan.Link -> withStyle(
                SpanStyle(color = Palette.income, fontWeight = FontWeight.Medium),
            ) { append(span.text) }

            // **不安全协议的就当普通文字**，不做成可点链接、也不上链接色——
            // 让用户一眼看出"这里本来是个链接，但没被当成链接"
            is MdSpan.UnsafeLink -> append(span.text)
        }
    }
}
