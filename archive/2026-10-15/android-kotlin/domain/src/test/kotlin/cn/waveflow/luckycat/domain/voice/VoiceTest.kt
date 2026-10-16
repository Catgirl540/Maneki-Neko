package cn.waveflow.luckycat.domain.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 波形：分桶、峰值、归一化、静音。 */
class WaveformTest {

    @Test
    fun `空采样返回空`() {
        assertEquals(emptyList<Float>(), Waveform.peaks(FloatArray(0)))
    }

    @Test
    fun `段数不能超过采样数`() {
        // 否则后面会出现一堆空段，画出来是一条断掉的线
        val peaks = Waveform.peaks(floatArrayOf(0.5f, 0.8f), buckets = 56)
        assertEquals(2, peaks.size)
    }

    @Test
    fun `取的是每段峰值不是平均值`() {
        // 平均值会把短促的重音抹平，而包络图看的正是"这一段的响度上限"
        val samples = FloatArray(100) { 0f }
        samples[10] = 1.0f          // 第一段里有一个尖峰
        samples[90] = 0.2f          // 最后一段里有一个小峰
        val peaks = Waveform.peaks(samples, buckets = 2)
        assertEquals(2, peaks.size)
        assertEquals(1.0f, peaks[0], 0.001f)   // 归一化后最大的是 1
        assertEquals(0.2f, peaks[1], 0.001f)
    }

    @Test
    fun `按全局最大值归一化`() {
        // 不归一化的话，整段音量偏小的语音看起来是一条平线，形状全丢了
        // 前两段峰值 0.1、后两段 0.05 —— 归一化之后应该是 1.0 与 0.5
        val quiet = floatArrayOf(0.1f, 0.1f, 0.05f, 0.05f)
        val peaks = Waveform.peaks(quiet, buckets = 2)
        assertEquals(1.0f, peaks[0], 0.001f)
        assertEquals(0.5f, peaks[1], 0.001f)
    }

    @Test
    fun `全静音给最低柱而不是零`() {
        // 画成 0 高的柱子看起来像界面缺了一块，而不是"这里没有声音"
        val peaks = Waveform.peaks(FloatArray(20), buckets = 4)
        assertEquals(4, peaks.size)
        assertTrue("最低柱应该 > 0", peaks.all { it > 0f })
        assertTrue("而且比正常柱矮得多", peaks.all { it < 0.1f })
    }

    @Test
    fun `负数取绝对值`() {
        // PCM 是有符号的，只看绝对值才知道响度
        val peaks = Waveform.peaks(floatArrayOf(-1.0f, 0.0f), buckets = 2)
        assertEquals(1.0f, peaks[0], 0.001f)
    }

    @Test
    fun `默认 56 根柱子`() {
        val peaks = Waveform.peaks(FloatArray(1000) { 0.5f })
        assertEquals(56, peaks.size)
    }

    @Test
    fun `没有一个柱子超过 1`() {
        val samples = FloatArray(500) { if (it % 7 == 0) 1.2f else 0.3f }
        val peaks = Waveform.peaks(samples, buckets = 40)
        assertTrue("归一化之后不该有超过 1 的柱", peaks.all { it <= 1.0001f })
    }
}

/** 可朗读文本：Markdown 不该被念出来。 */
class SpeechTextTest {

    @Test
    fun `粗体标记被去掉`() {
        assertEquals("转账 800 元", SpeechText.of("**转账** 800 元"))
    }

    @Test
    fun `行内代码标记被去掉`() {
        assertEquals("用 0000 即可", SpeechText.of("用 `0000` 即可"))
    }

    @Test
    fun `链接只留文字`() {
        // 把一条 URL 逐字符念出来对谁都没用
        val spoken = SpeechText.of("详见[帮助中心](https://example.com/very/long/path)")
        assertEquals("详见帮助中心", spoken)
    }

    @Test
    fun `图片整段丢掉`() {
        assertEquals("见图", SpeechText.of("见图![转账截图](https://example.com/a.png)"))
    }

    @Test
    fun `代码块整段丢掉`() {
        // 念代码没有意义
        val spoken = SpeechText.of("结果如下：\n```json\n{\"a\":1}\n```\n以上")
        assertTrue("不该念出花括号：$spoken", !spoken.contains("{"))
        assertTrue(spoken.contains("结果如下"))
    }

    @Test
    fun `表格念成表头加值`() {
        // 确认卡片那种两列表格，念出来正好是"收款人，梁乐怡。"
        val spoken = SpeechText.of("| 收款人 | 梁乐怡 |\n| --- | --- |\n| 金额 | 800.00 元 |")
        assertTrue(spoken.contains("收款人，梁乐怡。"))
        assertTrue(spoken.contains("金额，800.00 元。"))
        assertTrue("分隔行不该被念：$spoken", !spoken.contains("---"))
    }

    @Test
    fun `标题与列表标记被去掉`() {
        assertEquals("小标题，第一项，第二项", SpeechText.of("## 小标题\n- 第一项\n- 第二项"))
    }

    @Test
    fun `公式只去定界符`() {
        // 念 LaTeX 不理想，但比丢掉信息好
        assertEquals("利率是 x + y", SpeechText.of("利率是 \$x + y\$"))
    }

    @Test
    fun `换行两侧不是标点时补逗号`() {
        // 中文不能拿空格当标点：语音合成靠标点决定在哪停。
        // 直接抹掉换行会连成"手续费 0.00到账时间：实时"这样一口气的长句。
        assertEquals("手续费 0.00，到账时间：实时", SpeechText.of("手续费 0.00\n到账时间：实时"))
    }

    @Test
    fun `换行前已有标点就不补`() {
        assertEquals("第一句。第二句", SpeechText.of("第一句。\n第二句"))
    }

    @Test
    fun `超长在句子边界截断`() {
        val long = "第一句话。".repeat(200)
        val spoken = SpeechText.of(long, maxChars = 200)
        assertTrue("应该以省略号结尾：${spoken.takeLast(10)}", spoken.endsWith("……"))
        assertTrue("不该把一句话念一半", spoken.removeSuffix("……").endsWith("。"))
    }

    @Test
    fun `没有可念内容时返回空串`() {
        // 全是图片的回复没什么可念的
        assertEquals("", SpeechText.of("![图](https://a.png)"))
    }

    @Test
    fun `纯文本原样通过`() {
        assertEquals("您好，请问办理什么业务？", SpeechText.of("您好，请问办理什么业务？"))
    }
}

/** PCM16 小端解码。字节序写反了听到的是噪声，界面上却什么错都不报。 */
class PcmTest {

    @Test
    fun `小端低字节在前`() {
        // 0x0100 = 256 → 256/32768
        val floats = Pcm.toFloats(byteArrayOf(0x00, 0x01))
        assertEquals(1, floats.size)
        assertEquals(256f / 32768f, floats[0], 0.0001f)
    }

    @Test
    fun `负数按二补码解`() {
        // 0xFFFF = -1
        val floats = Pcm.toFloats(byteArrayOf(0xFF.toByte(), 0xFF.toByte()))
        assertEquals(-1f / 32768f, floats[0], 0.0001f)
    }

    @Test
    fun `正满量程`() {
        // 0x7FFF = 32767
        val floats = Pcm.toFloats(byteArrayOf(0xFF.toByte(), 0x7F))
        assertEquals(32767f / 32768f, floats[0], 0.0001f)
    }

    @Test
    fun `负满量程`() {
        // 0x8000 = -32768
        val floats = Pcm.toFloats(byteArrayOf(0x00, 0x80.toByte()))
        assertEquals(-1f, floats[0], 0.0001f)
    }

    @Test
    fun `末尾落单的字节被丢掉`() {
        // 补零会在末尾凭空多出一个静音采样，波形上多一根柱子
        val floats = Pcm.toFloats(byteArrayOf(0x00, 0x01, 0x7F))
        assertEquals(1, floats.size)
    }

    @Test
    fun `空字节返回空`() {
        assertEquals(0, Pcm.toFloats(ByteArray(0)).size)
    }

    @Test
    fun `多个采样按顺序解`() {
        val floats = Pcm.toFloats(byteArrayOf(0x00, 0x00, 0xFF.toByte(), 0x7F, 0x00, 0x80.toByte()))
        assertEquals(3, floats.size)
        assertEquals(0f, floats[0], 0.0001f)
        assertEquals(32767f / 32768f, floats[1], 0.0001f)
        assertEquals(-1f, floats[2], 0.0001f)
    }
}
