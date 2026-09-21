package cn.waveflow.luckycat.domain.ask

import cn.waveflow.luckycat.contract.QuestionItem
import cn.waveflow.luckycat.contract.QuestionSet
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 一道题上用户正在编辑的答复。 */
data class QuestionDraft(
    val selected: List<String> = emptyList(),
    val custom: String = "",
)

/**
 * 提问卡片的答复规则。
 *
 * **逐条照抄网页版** `app/src/components/agent/QuestionCard.tsx`：
 * 那里的 `isAnswered` 与 `submit` 就是这个模块。放 `:domain` 是因为
 * "每题都要答""单选只能选一个"是**后端会校验的硬规则**，违反了会拿到 400，
 * 而用户看到的只是"点了没反应"。
 *
 * 桥接侧的校验见 `bridge/demo-server.mjs` 的 `/agent-api/questions/:id/answer`：
 * `selected` 必须是字符串数组、单选超过一个直接 400、每题都得有答复。
 */
object QuestionAnswers {

    /** 这道题算不算答了：选了选项，或者自己写了非空白的字。 */
    fun isAnswered(draft: QuestionDraft?): Boolean {
        if (draft == null) return false
        return draft.selected.isNotEmpty() || draft.custom.trim().isNotEmpty()
    }

    /**
     * 能不能提交。**每一道题都要答完**——桥接会检查，缺一道回 400，
     * 所以按钮在这里就该是灰的，而不是等用户点了才报错。
     */
    fun canSubmit(set: QuestionSet, drafts: Map<String, QuestionDraft>): Boolean =
        set.items.all { isAnswered(drafts[it.id]) }

    /**
     * 点一个选项。
     *
     * 单选时**替换**（不是追加）：追加会让 `selected` 有多个元素，
     * 而单选超过一个桥接直接 400。再点一次已选中的选项在单选下保持选中
     * （取消选中会让"已答"变成"未答"，用户会莫名其妙点不动提交按钮）。
     */
    fun toggle(item: QuestionItem, draft: QuestionDraft, label: String): QuestionDraft =
        if (item.multiSelect) {
            if (draft.selected.contains(label)) draft.copy(selected = draft.selected - label)
            else draft.copy(selected = draft.selected + label)
        } else {
            draft.copy(selected = listOf(label))
        }

    /** 改自写文字。 */
    fun withCustom(draft: QuestionDraft, text: String): QuestionDraft = draft.copy(custom = text)

    /**
     * 组答复体：`{ answers: [{ id, selected, custom? }] }`。
     *
     * [custom] **只在非空白时才带上**（与网页版一致）：带一个空串过去，
     * 插件侧的 `parseAnswer` 会把它当成"用户写了空答案"。
     */
    fun toJson(set: QuestionSet, drafts: Map<String, QuestionDraft>): JsonElement =
        buildJsonObject {
            put(
                "answers",
                buildJsonArray {
                    set.items.forEach { item ->
                        val draft = drafts[item.id] ?: QuestionDraft()
                        add(
                            buildJsonObject {
                                put("id", item.id)
                                put(
                                    "selected",
                                    buildJsonArray { draft.selected.forEach { add(JsonPrimitive(it)) } },
                                )
                                val custom = draft.custom.trim()
                                if (custom.isNotEmpty()) put("custom", custom)
                            },
                        )
                    }
                },
            )
        }

    /** 超时。服务端到点会自己回空答复，所以这里只用于界面收起卡片。 */
    fun isExpired(set: QuestionSet, now: Long): Boolean {
        // 先取到局部变量：跨模块的 public 属性不能直接智能转换
        val expiresAt = set.expiresAt ?: return false
        return now > expiresAt
    }

    /** 卡片标题：「需要你确认 N 件事」/「需要你确认 1 件事」。 */
    fun title(set: QuestionSet): String = "需要你确认 ${set.items.size} 件事"
}

/** 仅用于测试与调试：把答复体读回来。 */
internal fun JsonElement.answersOf(): List<Triple<String, List<String>, String?>> {
    val arr = (this as JsonObject)["answers"] as? JsonArray ?: return emptyList()
    return arr.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val id = (row["id"] as? JsonPrimitive)?.content ?: return@mapNotNull null
        val selected = (row["selected"] as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
        val custom = (row["custom"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        Triple(id, selected, custom)
    }
}
