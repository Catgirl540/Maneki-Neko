package cn.waveflow.luckycat.contract

/** 语音流的一帧。形状见 `framework/design/P8-VOICE.md`。 */
sealed interface TtsFrame {
    /** 首帧：`format` 目前恒为 `pcm`（裸 PCM16 LE），`sampleRate` 用于建 AudioTrack。 */
    data class Start(val format: String, val sampleRate: Int) : TtsFrame

    /** 音频帧：**裸 PCM16 LE 小端**，不是 JSON、不是音频容器。 */
    class Audio(val pcm16: ByteArray) : TtsFrame {
        val size: Int get() = pcm16.size
        override fun equals(other: Any?): Boolean = other is Audio && pcm16.contentEquals(other.pcm16)
        override fun hashCode(): Int = pcm16.contentHashCode()
        override fun toString(): String = "Audio(${pcm16.size} bytes)"
    }

    /** 上游切句的提示（`kind` = start / end）。界面可以据此做字幕，非必需。 */
    data class Sentence(val kind: String, val text: String) : TtsFrame

    /** 正常结束。[truncated] 表示念的不是完整文本（被上游截断了）。 */
    data class End(val frames: Int, val bytes: Int, val truncated: Boolean) : TtsFrame

    /** 上游失败。**这不是"用户取消"**——取消走 Flow 的取消，不产生这一帧。 */
    data class Failure(val message: String) : TtsFrame

    data class Unknown(val event: String?, val data: String) : TtsFrame
}
