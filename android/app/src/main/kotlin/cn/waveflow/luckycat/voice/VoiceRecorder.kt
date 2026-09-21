package cn.waveflow.luckycat.voice

import android.content.Context
import android.media.MediaRecorder
import android.util.Log
import java.io.File

/**
 * 按住说话用的录音。
 *
 * ## 两条与隐私有关的硬规矩
 *
 * 1. **只有按着的时候才录**。不做"一直听着"：银行页面上常开麦克风，
 *    系统会一直亮着录音标识，而且会把旁边人的谈话一起送去转录。
 * 2. **松手立刻 `stop()` 并释放**。不停轨道的话"正在使用麦克风"的提示会一直亮着。
 *
 * ## 格式
 *
 * MPEG_4 容器 + AAC 编码 → mimeType `audio/mp4`。桥接按 MIME 映射格式
 * （`audio/mp4` → `m4a`），**所以这里给的 mimeType 必须与真实容器一致**——
 * 写错会得到一段能上传但转不出字的音频。
 */
class VoiceRecorder(private val context: Context) {

    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null

    val isRecording: Boolean get() = recorder != null

    /** 开始录。已经在录时什么都不做（而不是抛异常）。 */
    fun start(): Boolean {
        if (recorder != null) return true
        val file = File.createTempFile("luckycat-voice-", ".m4a", context.cacheDir)
        outputFile = file
        val created = runCatching {
            @Suppress("DEPRECATION") // 无参构造在 API 31 起废弃，但它在所有版本上都能用
            val r = MediaRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            // 16kHz 是语音识别的常用采样率；单声道足够，还能省一半体积
            r.setAudioSamplingRate(16_000)
            r.setAudioChannels(1)
            r.setAudioEncodingBitRate(64_000)
            r.setOutputFile(file.absolutePath)
            r.prepare()
            r.start()
            r
        }.getOrElse {
            // 没给录音权限、麦克风被别的应用占着——都不该让 App 崩
            Log.w(TAG, "开始录音失败", it)
            file.delete()
            outputFile = null
            return false
        }
        recorder = created
        return true
    }

    /**
     * 停止并返回录音字节。
     *
     * @returns PCM/AAC 字节；没在录、或录音太短（`stop` 抛异常）时返回 `null`。
     */
    fun stop(): ByteArray? {
        val current = recorder ?: return null
        recorder = null
        val file = outputFile
        outputFile = null

        // `stop()` 在**录得太短**时会抛 RuntimeException（底层没写出有效头）。
        // 这是用户"按了一下就松手"的正常情形，不该当成错误上报。
        val ok = runCatching { current.stop() }.isSuccess
        runCatching { current.release() }
        if (!ok) {
            file?.delete()
            return null
        }
        return file?.let { f ->
            runCatching { f.readBytes() }.getOrNull().also { f.delete() }
        }
    }

    /** 放弃这次录音（用户划走取消）。 */
    fun cancel() {
        val current = recorder ?: return
        recorder = null
        runCatching { current.stop() }
        runCatching { current.release() }
        outputFile?.delete()
        outputFile = null
    }

    companion object {
        private const val TAG = "LuckyCatRecorder"

        /** 与 [stop] 返回的字节对应的容器类型。**必须与真实容器一致**。 */
        const val MIME_TYPE = "audio/mp4"
    }
}
