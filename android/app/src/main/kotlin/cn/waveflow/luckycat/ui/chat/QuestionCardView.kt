package cn.waveflow.luckycat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.contract.QuestionItem
import cn.waveflow.luckycat.contract.QuestionSet
import cn.waveflow.luckycat.domain.ask.QuestionAnswers
import cn.waveflow.luckycat.domain.ask.QuestionDraft
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 提问卡片：单选 / 多选 / 自由输入。
 *
 * 与网页版同一套规则（见 `:domain` 的 [QuestionAnswers]）：
 * 单选是**替换**不是追加；每题都要答完才能提交；自写空白不算答。
 *
 * 这些是**后端会校验的硬规则**（桥接在单选收到多个选项时直接 400），
 * 违反了用户看到的现象只是"点了没反应"，所以规则本身有离线测试兜着。
 */
@Composable
fun QuestionCardView(
    set: QuestionSet,
    onSubmit: (Map<String, QuestionDraft>) -> Unit,
) {
    // 按 questionId 重置草稿：换了一张卡片不该带着上一张的答案
    val drafts = remember(set.questionId) { mutableStateMapOf<String, QuestionDraft>() }
    var submitting by remember(set.questionId) { mutableStateOf(false) }

    fun draftOf(id: String): QuestionDraft = drafts[id] ?: QuestionDraft()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.accentTint)
            .padding(16.dp)
            .testTag("question-card"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            QuestionAnswers.title(set),
            style = MaterialTheme.typography.titleMedium,
            color = Palette.accentDeep,
        )

        set.items.forEach { item -> QuestionRow(item, draftOf(item.id)) { drafts[item.id] = it } }

        Button(
            onClick = {
                submitting = true
                onSubmit(set.items.associate { it.id to draftOf(it.id) })
            },
            enabled = QuestionAnswers.canSubmit(set, drafts) && !submitting,
            modifier = Modifier.align(Alignment.End).testTag("question-submit"),
        ) {
            Text("提交")
        }
    }
}

@Composable
private fun QuestionRow(item: QuestionItem, draft: QuestionDraft, onChange: (QuestionDraft) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.surface)
            .padding(12.dp)
            .testTag("question-${item.id}"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item.header?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.accentDeep)
        }
        Text(item.question, style = MaterialTheme.typography.bodyMedium)

        item.options.forEach { label ->
            val selected = draft.selected.contains(label)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onChange(QuestionAnswers.toggle(item, draft, label)) }
                    .testTag("option-${item.id}-$label"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (item.multiSelect) {
                    Checkbox(checked = selected, onCheckedChange = { onChange(QuestionAnswers.toggle(item, draft, label)) })
                } else {
                    RadioButton(selected = selected, onClick = { onChange(QuestionAnswers.toggle(item, draft, label)) })
                }
                Text(label, style = MaterialTheme.typography.bodyMedium)
            }
        }

        OutlinedTextField(
            value = draft.custom,
            onValueChange = { onChange(QuestionAnswers.withCustom(draft, it)) },
            label = { Text(if (item.options.isEmpty()) "写一个答案" else "或者自己写一个") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("custom-${item.id}"),
        )
    }
}
