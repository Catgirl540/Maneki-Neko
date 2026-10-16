package cn.waveflow.luckycat.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Log

/**
 * 流式播放裸 PCM16。
 *
 * ## 为什么不先把整段合成完再播
 *
 * 网页版最初就是"整段合成完再播"，用户要盯着静默等。这里从一开始就走流式：
 * **每收到一帧就写进 AudioTrack**，首帧到达就出声。
 *
 * 安卓这边比网页简单得多：没有浏览器那套自动播放策略
 * （`playBlocked`、用户手势解锁），创建出来就能放。
 *
 * ## 生命周期
 *
 * `start()` → `write()`×N → `finish()`。`finish()` **不立刻 release**：
 * AudioTrack 的缓冲区里还有没放完的音频，直接 release 会把尾巴切掉。
 * `stop()` 是"用户按了停止"，那种情况下切掉尾巴是对的。
 */
class PcmPlayer(private val sampleRate: Int = DEFAULT_SAMPLE_RATE) {

    private var track: AudioTrack? = null

    /** 已经写进去多少个采样（用于算进度）。 */
    var writtenSamples: Long = 0
        private set

    /** 播放器是否已经释放。重复操作要能安全地什么都不做。 */
    var released: Boolean = false
        private set

    fun start() {
        if (track != null || released) return
        val minBuffer = AudioTrack.getMinBufferSize(sampleRate, CHANNEL, ENCODING)
        // 缓冲区取"最小值的两倍"与"半秒音频"里更大的那个：
        // 太小会卡顿（每一帧都要等硬件取走），太大则首帧延迟明显。
        val bufferBytes = maxOf(minBuffer * 2, sampleRate / 2 * BYTES_PER_SAMPLE)
        track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(ENCODING)
                    .setSampleRate(sampleRate)
                    .setChannelMask(CHANNEL)
                    .build(),
            )
            .setBufferSizeInBytes(bufferBytes)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
            .also { it.play() }
    }

    /**
     * 写一帧。**阻塞写**——写不进去时等硬件取走，而不是丢帧。
     * 丢帧在语音上就是"漏字"。
     */
    fun write(pcm16: ByteArray): Int {
        val target = track ?: return 0
        val written = target.write(pcm16, 0, pcm16.size, AudioTrack.WRITE_BLOCKING)
        if (written > 0) writtenSamples += written / BYTES_PER_SAMPLE
        return written
    }

    /**
     * 没有更多帧了。**不 release**：缓冲区里还有没放完的音频，
     * `stop()` 会把剩下的放完再停（流模式下的既定行为）。
     */
    fun finish() {
        runCatching { track?.stop() }
            .onFailure { Log.w(TAG, "结束播放时出错（多半是已经被释放）", it) }
    }

    /** 用户按了停止：立刻停下并释放，**尾巴不要了**。 */
    fun stop() {
        runCatching { track?.pause(); track?.flush() }
        release()
    }

    /** 已经播出去多少个采样（`playbackHeadPosition` 会回绕，所以按 Int 差值累计）。 */
    fun playedSamples(): Long {
        val target = track ?: return 0
        val head = runCatching { target.playbackHeadPosition }.getOrDefault(0)
        return head.toLong() and 0xFFFFFFFFL
    }

    fun release() {
        if (released) return
        released = true
        runCatching { track?.release() }
        track = null
    }

    companion object {
        const val DEFAULT_SAMPLE_RATE = 24_000
        private const val TAG = "LuckyCatPcm"
        private const val BYTES_PER_SAMPLE = 2
        private const val CHANNEL = AudioFormat.CHANNEL_OUT_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
    }
}
