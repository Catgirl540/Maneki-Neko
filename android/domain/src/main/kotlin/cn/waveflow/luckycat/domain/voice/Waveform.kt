package cn.waveflow.luckycat.domain.voice

import kotlin.math.abs

/**
 * 朗读时的波形：把一段音频压成**等分的峰值包络**，给界面画柱子。
 *
 * ## 为什么必须是真波形
 *
 * 画一条随机的、或者按文字长度算出来的波形，看起来一样好看——但它是**编的**：
 * 用户会以为那代表了这段语音的响度起伏，而它什么也不代表。
 * 这个项目的规矩是"界面上的每个像素都得对应真实数据"，所以这里老老实实取包络。
 *
 * ## 与网页版的区别
 *
 * 那边要先 `decodeAudioData` 把 mp3 解开；**这边不需要**——安卓拿到的本来就是
 * 裸 PCM16 采样。所以这里只有纯函数那一半，没有解码那一半。
 *
 * 网页版把"纯函数"与"解码"分开写（`peaksFromSamples` / `envelopeFromUrl`）是有意的，
 * 这里沿用了那个切法：分桶与归一化是最容易写错的地方，必须能单独验。
 */
object Waveform {

    /** 默认画多少根柱子。太少看不出形状，太多在小屏上糊成一片。 */
    const val DEFAULT_BUCKETS = 56

    /**
     * 最低柱高（占满幅的比例）。
     *
     * 不给 0 是因为：静音段画成 0 高的柱子看起来像**界面缺了一块**，
     * 而不是"这里没有声音"。留一条细线，形状才连续。
     */
    private const val MIN_BAR = 0.06f

    /**
     * 把采样压成等分峰值。
     *
     * 取每段的**最大绝对值**（峰值）而不是平均值：包络图看的是"这一段的响度上限"，
     * 平均值会把短促的重音抹平。
     *
     * 最后按全局最大值归一化——不然一段整体音量偏小的语音会看起来是一条平线，
     * 形状全丢了。归一化之后只保留**相对**起伏，这正是波形图要表达的东西。
     *
     * @param samples - 单声道采样（-1 ~ 1）。
     * @param buckets - 分成多少段（也就是画多少根柱子）。
     * @returns 每段高度（[MIN_BAR] ~ 1）。没有采样时返回空列表。
     */
    fun peaks(samples: FloatArray, buckets: Int = DEFAULT_BUCKETS): List<Float> {
        if (samples.isEmpty() || buckets <= 0) return emptyList()
        // 段数不能超过采样数，否则后面会出现一堆空段（峰值恒为 0）
        val count = minOf(buckets, samples.size)
        val size = samples.size.toDouble() / count

        val peaks = ArrayList<Float>(count)
        for (i in 0 until count) {
            val start = (i * size).toInt()
            val end = maxOf(start + 1, ((i + 1) * size).toInt())
            var peak = 0f
            var j = start
            while (j < end && j < samples.size) {
                val value = abs(samples[j])
                if (value > peak) peak = value
                j += 1
            }
            peaks.add(peak)
        }

        val max = peaks.maxOrNull() ?: 0f
        // 全是静音（max = 0）时不要除以 0：直接给一排最低柱
        if (max <= 0f) return peaks.map { MIN_BAR }
        return peaks.map { maxOf(MIN_BAR, it / max) }
    }
}
