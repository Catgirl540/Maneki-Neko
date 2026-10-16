package cn.waveflow.luckycat.contract

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.jsonObject

/**
 * agent 事件流里的一条事件。形状照 `framework/design/P6-WEB-BRIDGE.md` 的表。
 *
 * [raw] 保留原始 JSON：界面需要展示确认卡片 / 提问卡片时，字段很多且以后还会加，
 * 与其在类型里逐个抄一遍，不如把原始对象带下去。
 *
 * **未知类型必须能过去**（[Unknown]）。桥接以后加一种事件时，老客户端应该安静地
 * 忽略它，而不是整个流崩掉——这是这份契约里唯一"向前兼容"的硬要求。
 */
sealed interface AgentEvent {
    val raw: JsonObject

    /** 订阅已建立。前端据此确认"订阅早于发言"。 */
    data class Hello(override val raw: JsonObject) : AgentEvent {
        val sessionId: String? get() = raw.stringOrNull("sessionId")
    }

    /** `status` = `running` / `idle`，用来转圈或停下。 */
    data class Status(override val raw: JsonObject) : AgentEvent {
        val status: String? get() = raw.stringOrNull("status")
    }

    data class Assistant(override val raw: JsonObject) : AgentEvent {
        val text: String get() = raw.stringOrNull("text") ?: ""
    }

    /** 工具调用轨迹（界面上是"执行中…"）。 */
    data class ToolCall(override val raw: JsonObject) : AgentEvent {
        val callId: String? get() = raw.stringOrNull("callId")
        val name: String? get() = raw.stringOrNull("name")
    }

    /** 工具结果（"已完成 / 未执行" + 一行摘要）。 */
    data class ToolResult(override val raw: JsonObject) : AgentEvent {
        val callId: String? get() = raw.stringOrNull("callId")
        val isError: Boolean get() = raw.boolOrNull("isError") ?: false
        val text: String? get() = raw.stringOrNull("text")
    }

    /** 待确认卡片。`challenge` 里含交易信息与 [Challenge.verification]。 */
    data class Consent(override val raw: JsonObject) : AgentEvent {
        val challenge: Challenge? get() = raw["challenge"]?.let { runCatching { it.jsonObject }.getOrNull() }?.let(::Challenge)
    }

    /** 卡片收起。`decision` = approve / reject / timeout / abandoned。 */
    data class ConsentResolved(override val raw: JsonObject) : AgentEvent {
        val challengeId: String? get() = raw.stringOrNull("challengeId")
        val decision: String? get() = raw.stringOrNull("decision")
    }

    /** 审计轨迹（`consent-asked` / `consent-decided`），语言无关。 */
    data class Audit(val type: String, override val raw: JsonObject) : AgentEvent

    /** 提问卡片。 */
    data class Question(override val raw: JsonObject) : AgentEvent {
        val question: JsonObject? get() = raw["question"]?.let { runCatching { it.jsonObject }.getOrNull() }
    }

    /** 卡片收起。`answered=false` 表示超时或插件已不等了。 */
    data class QuestionResolved(override val raw: JsonObject) : AgentEvent {
        val questionId: String? get() = raw.stringOrNull("questionId")
        val answered: Boolean get() = raw.boolOrNull("answered") ?: false
    }

    /** 运行失败（含上游模型失败）。 */
    data class Error(override val raw: JsonObject) : AgentEvent {
        val message: String? get() = raw.stringOrNull("message")
    }

    /** 没见过的类型：安静带过，不崩。 */
    data class Unknown(val type: String?, override val raw: JsonObject) : AgentEvent

    /** 这一帧根本没解析成功。**不静默丢弃**——丢了就变成"界面莫名不动"。 */
    data class Malformed(val data: String, val reason: String) : AgentEvent {
        override val raw: JsonObject = JsonObject(emptyMap())
    }
}

/**
 * 确认挑战。[verification] 是**要不要输支付密码**的唯一依据：
 * 为 `null` 表示这个操作不需要验证（只读查询），否则目前只有 `payment-password`。
 */
/**
 * 待确认挑战里的一条展示信息（"收款人 / 梁乐怡"这种）。
 *
 * [emphasis] 是后端标出来的"要强调"（金额那类），界面据此加粗。
 * 形状见 `framework/packages/consent/src/types.ts` 的 `ConsentField`。
 */
data class ConsentField(val label: String, val value: String, val emphasis: Boolean)

class Challenge(private val obj: JsonObject) {
    val challengeId: String? get() = obj.stringOrNull("challengeId")
    val sessionId: String? get() = obj.stringOrNull("sessionId")
    val toolName: String? get() = obj.stringOrNull("toolName")
    val kind: String? get() = obj.stringOrNull("kind")
    val verification: String? get() = obj.stringOrNull("verification")
    val requiresPaymentPassword: Boolean get() = verification == "payment-password"

    /**
     * 展示给用户的信息。**这是"展示交易信息"那一步的全部内容**——
     * 界面上必须逐条显示出来，不能只写一句"确认执行吗"。
     */
    val fields: List<ConsentField>
        get() = (obj["fields"] as? JsonArray)
            ?.mapNotNull { element ->
                val row = (element as? JsonObject) ?: return@mapNotNull null
                val label = row.stringOrNull("label") ?: return@mapNotNull null
                ConsentField(
                    label = label,
                    value = row.stringOrNull("value") ?: "",
                    emphasis = row.boolOrNull("emphasis") ?: false,
                )
            }
            ?: emptyList()

    /** 「确认后会发生什么」的补充说明，例如「确认后立即扣款，不可撤销」。 */
    val consequence: String? get() = obj.stringOrNull("consequence")

    /** 超时时刻（Unix 毫秒）。超过即视为拒绝——界面要**禁用**确认按钮。 */
    val expiresAt: Long? get() = (obj["expiresAt"] as? JsonPrimitive)?.longOrNull

    val createdAt: Long? get() = (obj["createdAt"] as? JsonPrimitive)?.longOrNull

    /** 原样带走，界面按需取字段（交易信息各工具不同）。 */
    val raw: JsonObject get() = obj
}

/** 把 `data:` 的原文解成事件。解析失败回 [AgentEvent.Malformed]，不抛。 */
fun decodeAgentEvent(json: Json, data: String): AgentEvent {
    val obj = try {
        json.parseToJsonElement(data).jsonObject
    } catch (e: Exception) {
        return AgentEvent.Malformed(data, e.message ?: e::class.simpleName ?: "解析失败")
    }
    return when (val type = obj.stringOrNull("type")) {
        "hello" -> AgentEvent.Hello(obj)
        "status" -> AgentEvent.Status(obj)
        "assistant" -> AgentEvent.Assistant(obj)
        "tool-call" -> AgentEvent.ToolCall(obj)
        "tool-result" -> AgentEvent.ToolResult(obj)
        "consent" -> AgentEvent.Consent(obj)
        "consent-resolved" -> AgentEvent.ConsentResolved(obj)
        "consent-asked", "consent-decided" -> AgentEvent.Audit(type, obj)
        "question" -> AgentEvent.Question(obj)
        "question-resolved" -> AgentEvent.QuestionResolved(obj)
        "error" -> AgentEvent.Error(obj)
        else -> AgentEvent.Unknown(type, obj)
    }
}

internal fun JsonObject.stringOrNull(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

internal fun JsonObject.boolOrNull(name: String): Boolean? =
    (this[name] as? JsonPrimitive)?.booleanOrNull

internal fun JsonObject.intOrNull(name: String): Int? =
    (this[name] as? JsonPrimitive)?.intOrNull
