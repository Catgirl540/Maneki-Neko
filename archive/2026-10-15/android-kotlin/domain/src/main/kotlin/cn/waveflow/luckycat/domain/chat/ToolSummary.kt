package cn.waveflow.luckycat.domain.chat

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 工具结果的一行摘要。
 *
 * **逐条照抄网页版** `app/src/lib/useAgentChat.ts` 的 `summarize`。
 * 界面上工具行只占一行，塞整段返回会把对话撑爆；但"失败了"这件事
 * **必须如实显示**——客户需要知道哪一步没成。
 *
 * 放 `:domain` 是因为它有一堆分支（每个工具一种说法），而每个分支都只影响
 * 一行文字，靠肉眼看界面很难发现某一条退化成"已完成"了。
 */
object ToolSummary {

    private val json = Json { ignoreUnknownKeys = true }

    fun summarize(name: String, text: String): String {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return ""

        val parsed = runCatching { json.parseToJsonElement(trimmed) as? JsonObject }.getOrNull()
            ?: return fallback(trimmed)

        // 失败信息始终如实显示——那是客户需要知道的
        parsed.str("error")?.let { return it }
        parsed.str("reference")?.let { return "回执号 $it" }

        return when (name) {
            "knowledge_lookup" -> {
                val hits = parsed["hits"] as? JsonArray ?: return "已完成"
                if (hits.isEmpty()) "知识库里没有相关资料"
                else {
                    val mode = if (parsed.str("mode") == "hybrid") "向量 + 关键词" else "关键词"
                    "找到 ${hits.size} 段资料（$mode）"
                }
            }

            "bank_get_balance" -> parsed.str("balance")?.let { "余额 $it" } ?: "已完成"

            "bank_list_transactions" -> {
                val rows = parsed["transactions"] as? JsonArray
                if (rows != null) "${rows.size} 条流水" else "已完成"
            }

            "bank_get_transaction_detail" -> {
                val amount = parsed.str("amount")
                val counterparty = parsed.str("counterparty")
                if (amount != null && counterparty != null) "$counterparty · $amount" else "已完成"
            }

            "bank_wealth_quote" -> parsed.str("riskLevel")?.let { "风险等级 $it" } ?: "已完成"

            "bank_reveal_card_secret" -> "已返回占位值（非真实卡信息）"

            else -> "已完成"
        }
    }

    /** 不是 JSON：只取第一行、限长，避免把一大段原文塞进标签。 */
    private fun fallback(text: String): String {
        val firstLine = text.lineSequence().firstOrNull() ?: ""
        return if (firstLine.length > 60) "${firstLine.take(60)}…" else firstLine
    }

    private fun JsonObject.str(name: String): String? =
        (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content
}
