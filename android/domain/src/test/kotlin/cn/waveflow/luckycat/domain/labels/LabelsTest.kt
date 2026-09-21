package cn.waveflow.luckycat.domain.labels

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 断言里那几个词都是**网页版里的原词**，不是我随手写的。
 * 两端不一致的症状是"同一笔交易在手机上叫『餐饮』、在网页上叫『吃饭』"。
 */
class LabelsTest {

    @Test
    fun `交易分类`() {
        assertEquals("工资入账", Labels.category("salary"))
        assertEquals("餐饮", Labels.category("dining"))
        assertEquals("房租", Labels.category("housing"))
        assertEquals("订阅服务", Labels.category("subscription"))
        assertEquals("其他", Labels.category("other"))
    }

    @Test
    fun `交易渠道`() {
        assertEquals("网上交易", Labels.channel("quickpay"))
        assertEquals("刷卡消费", Labels.channel("card"))
        assertEquals("转账汇款", Labels.channel("transfer"))
        assertEquals("账户划转", Labels.channel("account"))
        assertEquals("利息结算", Labels.channel("interest"))
    }

    @Test
    fun `交易状态`() {
        // 「交易成功」不是「成功」——回单上要这么写
        assertEquals("交易成功", Labels.status("success"))
        assertEquals("处理中", Labels.status("pending"))
        assertEquals("交易失败", Labels.status("failed"))
    }

    @Test
    fun `认不出的键原样返回`() {
        // 联调时一眼看出"后端加了个新分类"，而不是界面上出现空白
        assertEquals("crypto", Labels.category("crypto"))
        assertEquals("", Labels.category(""))
    }
}

/** 理财那几个文案。与网页版 `lib/wealth.ts` 一字不差是刻意的。 */
class WealthLabelsTest {

    @Test
    fun `风险等级用通俗说法`() {
        // 新规要求通俗说法优先，R 符号退到次要位置
        assertEquals("低风险", Labels.risk("R1"))
        assertEquals("中高风险", Labels.risk("R4"))
        assertEquals("高风险", Labels.risk("R5"))
    }

    @Test
    fun `理财产品分类`() {
        assertEquals("现金管理类", Labels.wealthCategory("cash"))
        assertEquals("固定收益类", Labels.wealthCategory("fixed"))
        assertEquals("商品及金融衍生品类", Labels.wealthCategory("derivative"))
    }

    @Test
    fun `投资者承受能力与产品风险不是一套`() {
        // C 是投资者、R 是产品，混起来会让适当性匹配彻底错掉
        assertEquals("保守型", Labels.tolerance("C1"))
        assertEquals("激进型", Labels.tolerance("C5"))
        assertEquals("C1", Labels.risk("C1"))  // 认不出就原样返回，不要瞎映射
    }

    @Test
    fun `业绩比较基准渲染成区间`() {
        // 它不是承诺收益，所以不能挑一个数字出来当"收益率"
        assertEquals("1.60% ~ 2.10%", WealthText.benchmark("range", 0.016, 0.021))
        assertEquals("2.00%", WealthText.benchmark("fixed", 0.02, 0.02))
        assertEquals("1.85%", WealthText.benchmark("range", 0.0185, 0.0185))
    }

    @Test
    fun `收益的正负判定`() {
        assertTrue(WealthText.isLoss(-1))
        assertFalse(WealthText.isLoss(0))
        assertFalse(WealthText.isLoss(100))
    }
}
