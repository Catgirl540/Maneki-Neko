package cn.waveflow.luckycat.domain.voice

/**
 * 裸 PCM16 **小端**字节 → 浮点采样。
 *
 * 语音流里每个 `audio` 帧给的就是这个——**不是 JSON、不是音频容器**。
 * 拿 JSON 去解会得到一段乱码错误（网页版实测踩过）。
 *
 * 放在 `:domain` 是因为字节序最容易写反，而写反之后听到的是噪声、
 * 界面上却什么错都不报——这种错必须能离线测。
 */
object Pcm {

    /** 16 位有符号的取值范围，用来归一化到 -1 ~ 1。 */
    private const val FULL_SCALE = 32768f

    /**
     * @param bytes - 裸 PCM16 LE。
     * @returns `-1 ~ 1` 的单声道采样；**末尾落单的那个字节会被丢掉**。
     */
    fun toFloats(bytes: ByteArray): FloatArray {
        // 长度为奇数时最后一个字节不构成一个采样。丢掉而不是补零：
        // 补零会在末尾凭空多出一个静音采样，波形上多一根柱子。
        val count = bytes.size / 2
        val out = FloatArray(count)
        for (i in 0 until count) {
            // 小端：低字节在前
            val lo = bytes[i * 2].toInt() and 0xFF
            val hi = bytes[i * 2 + 1].toInt()
            val sample = ((hi shl 8) or lo).toShort().toInt()
            out[i] = sample / FULL_SCALE
        }
        return out
    }
}
