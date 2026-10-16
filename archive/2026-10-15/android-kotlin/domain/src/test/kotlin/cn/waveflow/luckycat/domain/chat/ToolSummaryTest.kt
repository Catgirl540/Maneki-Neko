package cn.waveflow.luckycat.domain.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class ToolSummaryTest {

    @Test
    fun `空返回就是空摘要`() {
        assertEquals("", ToolSummary.summarize("bank_get_balance", "   "))
    }

    @Test
    fun `失败信息如实显示`() {
        // 这是最要紧的一条：哪一步没成必须让客户看到
        assertEquals("余额不足", ToolSummary.summarize("bank_transfer", """{"error":"余额不足"}"""))
    }

    @Test
    fun `有回执号就报回执号`() {
        assertEquals(
            "回执号 LCB-DEMO-123",
            ToolSummary.summarize("bank_transfer", """{"reference":"LCB-DEMO-123","ok":true}"""),
        )
    }

    @Test
    fun `查余额报余额`() {
        assertEquals("余额 ¥128,640.55", ToolSummary.summarize("bank_get_balance", """{"balance":"¥128,640.55"}"""))
    }

    @Test
    fun `查余额没有 balance 字段时退回已完成`() {
        assertEquals("已完成", ToolSummary.summarize("bank_get_balance", """{"ok":true}"""))
    }

    @Test
    fun `查流水报条数`() {
        assertEquals("3 条流水", ToolSummary.summarize("bank_list_transactions", """{"transactions":[{},{},{}]}"""))
    }

    @Test
    fun `交易详情报对方与金额`() {
        assertEquals(
            "Manner Coffee · ¥45.00",
            ToolSummary.summarize("bank_get_transaction_detail", """{"amount":"¥45.00","counterparty":"Manner Coffee"}"""),
        )
    }

    @Test
    fun `知识库混合检索的说法`() {
        assertEquals(
            "找到 2 段资料（向量 + 关键词）",
            ToolSummary.summarize("knowledge_lookup", """{"mode":"hybrid","hits":[{},{}]}"""),
        )
        assertEquals(
            "找到 1 段资料（关键词）",
            ToolSummary.summarize("knowledge_lookup", """{"mode":"keyword","hits":[{}]}"""),
        )
        assertEquals("知识库里没有相关资料", ToolSummary.summarize("knowledge_lookup", """{"hits":[]}"""))
    }

    @Test
    fun `理财报价报风险等级`() {
        assertEquals("风险等级 R2", ToolSummary.summarize("bank_wealth_quote", """{"riskLevel":"R2"}"""))
    }

    @Test
    fun `卡密工具明说返回的是占位值`() {
        // 银行场景里"返回编造的数据"比"功能没做"更糟，所以这句话必须出现
        assertEquals("已返回占位值（非真实卡信息）", ToolSummary.summarize("bank_reveal_card_secret", """{"secret":"0000"}"""))
    }

    @Test
    fun `不认识的工具就是已完成`() {
        assertEquals("已完成", ToolSummary.summarize("bank_something_new", """{"ok":true}"""))
    }

    @Test
    fun `不是 JSON 时取第一行并限长`() {
        assertEquals("第一行", ToolSummary.summarize("bank_ping", "第一行\n第二行"))
        val long = ToolSummary.summarize("bank_ping", "x".repeat(200))
        assertEquals(61, long.length)  // 60 个字符 + 一个省略号
        assertEquals(true, long.endsWith("…"))
    }

    @Test
    fun `hits 不是数组时退回已完成`() {
        assertEquals("已完成", ToolSummary.summarize("knowledge_lookup", """{"hits":"oops"}"""))
    }
}
