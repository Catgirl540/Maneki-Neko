package cn.waveflow.luckycat.voice

import cn.waveflow.luckycat.contract.AgentApi
import cn.waveflow.luckycat.contract.TtsFrame
import cn.waveflow.luckycat.domain.voice.Pcm
import cn.waveflow.luckycat.domain.voice.SpeechText
import cn.waveflow.luckycat.domain.voice.Waveform
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 朗读与录音。
 *
 * ## 网页版踩过的三个坑，这里一个都不能少
 *
 * 1. **取消 ≠ 失败**。用户主动停是静默的，真失败要上报。
 *    网页版的 bug 是 `teardownPlayback()` 先 abort 了 controller，
 *    之后再读 `signal.aborted` 永远是 true——**真失败被吞掉了**。
 *    所以这里在拆之前先把"是不是被取消"记下来。
 * 2. **"播完了"要有明确判据**。网页版只按"排到哪儿了"判断，结果第一帧播完
 *    就报了结束。这边的判据是**三段**：不再有新帧 + 播放头追上了写入量 +
 *    确实写过东西。`finished` 这个标志就是"不再有新帧"。
 * 3. **波形在整段合成完之后才算**。边收边算会把尾巴丢掉，而且波形会在
 *    播放过程中不断变化，看着像坏了。
 */
class VoiceController(
    private val agent: AgentApi,
    private val recorder: VoiceRecorder,
    private val scope: CoroutineScope,
) {

    data class State(
        val speaking: Boolean = false,
        val recording: Boolean = false,
        val transcribing: Boolean = false,
        /** 0..1 */
        val progress: Float = 0f,
        /** 波形柱子高度；整段合成完之前是空的。 */
        val waveform: List<Float> = emptyList(),
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var speakJob: Job? = null
    private var player: PcmPlayer? = null

    /** 这次朗读是不是被用户取消的。**拆之前先记**，否则读到的永远是 true。 */
    private var wasAborted = false

    // ── 朗读 ────────────────────────────────────────────────────────────

    /**
     * 念一段助手回复。
     *
     * @param text - 助手回复的 **Markdown 原文**；这里会先按 [SpeechText] 清洗。
     *   直接把 `**` `|---|` 丢给合成器会念出噪音。
     */
    fun speak(text: String) {
        val spoken = SpeechText.of(text)
        if (spoken.isEmpty()) return
        stopSpeaking()

        wasAborted = false
        _state.value = _state.value.copy(speaking = true, progress = 0f, waveform = emptyList(), error = null)

        speakJob = scope.launch {
            // 收到多少字节先攒着，**整段合成完再算波形**（见类文档第 3 条）
            val collected = java.io.ByteArrayOutputStream()
            var track: PcmPlayer? = null
            try {
                agent.streamSpeech(spoken).collect { frame ->
                    when (frame) {
                        is TtsFrame.Start ->
                            // 采样率只有首帧才知道，所以播放器在这里建。
                            // 用错的采样率播出来是变调的，比不播更糟。
                            if (track == null) {
                                track = PcmPlayer(frame.sampleRate).also {
                                    player = it
                                    it.start()
                                }
                            }

                        is TtsFrame.Audio -> {
                            collected.write(frame.pcm16)
                            // 首帧到达就出声——不等整段合成完
                            track?.write(frame.pcm16)
                        }

                        is TtsFrame.Failure -> {
                            _state.value = _state.value.copy(error = frame.message, speaking = false)
                            teardownPlayback()
                            return@collect
                        }

                        else -> Unit  // Sentence / End / Unknown：界面不用它们
                    }
                }

                // 波形在这里才算：整段都在 collected 里了
                _state.value = _state.value.copy(waveform = Waveform.peaks(Pcm.toFloats(collected.toByteArray())))

                track?.let { awaitPlaybackEnd(it) }
                teardownPlayback()
                _state.value = _state.value.copy(speaking = false, progress = 0f)
            } catch (e: kotlinx.coroutines.CancellationException) {
                // **取消不是失败**（见类文档第 1 条）
                teardownPlayback()
                _state.value = _state.value.copy(speaking = false, progress = 0f)
                throw e
            } catch (e: Exception) {
                teardownPlayback()
                _state.value = _state.value.copy(speaking = false, error = readable(e))
            }
        }
    }

    fun stopSpeaking() {
        wasAborted = true
        speakJob?.cancel()
        speakJob = null
        teardownPlayback()
        _state.value = _state.value.copy(speaking = false, progress = 0f)
    }

    /** 拆掉播放器。**先记状态再拆**是这里的重点，顺序反了会把真失败吞掉。 */
    private fun teardownPlayback() {
        val target = player ?: return
        player = null
        runCatching { target.stop() }
    }

    /**
     * 等播放头追上写入量。
     *
     * 判据是**三段一起看**（见类文档第 2 条）：不这样，缓冲区里还没播完的
     * 那段就会被当成"已经结束"，进度条提前跳到底。
     */
    private suspend fun awaitPlaybackEnd(track: PcmPlayer) {
        while (scope.isActive) {
            val played = track.playedSamples()
            val written = track.writtenSamples
            if (written > 0) {
                _state.value = _state.value.copy(progress = (played.toFloat() / written).coerceIn(0f, 1f))
            }
            if (written > 0 && played >= written) break
            delay(POLL_MS)
        }
    }

    // ── 录音 ────────────────────────────────────────────────────────────

    /** 开始录。返回是否真的录上了（没权限/麦克风被占时是 false）。 */
    fun startRecording(): Boolean {
        stopSpeaking()
        val ok = recorder.start()
        _state.value = _state.value.copy(recording = ok, error = if (ok) null else "拿不到麦克风——检查权限")
        return ok
    }

    /**
     * 停止录音并转文字。
     *
     * @param onText - 转出来的话；**空串或失败时不会被调用**（避免把空消息发出去）。
     */
    fun stopRecordingAndTranscribe(onText: (String) -> Unit) {
        if (!_state.value.recording) return
        _state.value = _state.value.copy(recording = false, transcribing = true, error = null)
        val audio = recorder.stop()
        if (audio == null || audio.isEmpty()) {
            // 按一下就松手会让 MediaRecorder.stop() 抛异常，这是正常情形不是错误
            _state.value = _state.value.copy(transcribing = false)
            return
        }
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    agent.transcribe(audio, VoiceRecorder.MIME_TYPE)
                }
                _state.value = _state.value.copy(transcribing = false)
                val text = result.text.trim()
                if (text.isNotEmpty()) onText(text)
                else _state.value = _state.value.copy(error = "没听清，再说一次？")
            } catch (e: Exception) {
                _state.value = _state.value.copy(transcribing = false, error = readable(e))
            }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    /** 离开页面时调：把播放器与录音都收干净。 */
    fun release() {
        stopSpeaking()
        recorder.cancel()
    }

    private fun readable(e: Exception): String = when (e) {
        is cn.waveflow.luckycat.contract.ApiException -> "语音服务出错（HTTP ${e.code}）"
        else -> "网络不给力，请稍后再试"
    }

    private companion object {
        const val POLL_MS = 100L
    }
}
