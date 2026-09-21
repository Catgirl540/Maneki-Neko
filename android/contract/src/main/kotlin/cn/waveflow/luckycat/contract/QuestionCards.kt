package cn.waveflow.luckycat.contract

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * 提问卡片里的一道题。
 *
 * [multiSelect] 缺省是 **false**（单选）——与插件侧的约定一致，
 * 不是"没说就是随便选几个"。
 */
data class QuestionItem(
    val id: String,
    val question: String,
    val header: String?,
    val options: List<String>,
    val multiSelect: Boolean,
)

/** 一次提问（可能包含多道题）。 */
data class QuestionSet(
    val questionId: String,
    val items: List<QuestionItem>,
    val expiresAt: Long?,
)

/**
 * 从 `question` 事件的原始 JSON 里解出提问卡片。
 *
 * 形状见 `framework/design/P12-ASK.md` 与 `bridge/demo-server.mjs`：
 * `{ questionId, sessionId, questions: [{ id, question, header?, options?, multiSelect? }],
 *    createdAt, expiresAt }`
 *
 * 逐字段都做了兜底：提问卡片是模型驱动生成的，字段缺一个就整个卡片不显示
 * 是最糟的结果——用户会看到"助手问了什么"但界面上什么都没有。
 */
fun parseQuestionSet(raw: JsonObject): QuestionSet? {
    val questionId = (raw["questionId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: return null
    val items = (raw["questions"] as? JsonArray)?.mapNotNull { element ->
        val row = (element as? JsonObject) ?: return@mapNotNull null
        val id = row.stringOrNull("id") ?: return@mapNotNull null
        QuestionItem(
            id = id,
            question = row.stringOrNull("question") ?: "",
            header = row.stringOrNull("header"),
            options = (row["options"] as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
                ?: emptyList(),
            multiSelect = row.boolOrNull("multiSelect") ?: false,
        )
    } ?: return null
    if (items.isEmpty()) return null
    return QuestionSet(
        questionId = questionId,
        items = items,
        expiresAt = (raw["expiresAt"] as? JsonPrimitive)?.longOrNull,
    )
}
