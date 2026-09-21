package cn.waveflow.luckycat.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.waveflow.luckycat.contract.AgentApi
import cn.waveflow.luckycat.contract.AgentEvent
import cn.waveflow.luckycat.contract.ApiException
import cn.waveflow.luckycat.contract.QuestionItem
import cn.waveflow.luckycat.contract.QuestionSet
import cn.waveflow.luckycat.contract.parseQuestionSet
import cn.waveflow.luckycat.data.ConversationStore
import cn.waveflow.luckycat.domain.ask.QuestionAnswers
import cn.waveflow.luckycat.domain.ask.QuestionDraft
import cn.waveflow.luckycat.domain.chat.ToolSummary
import cn.waveflow.luckycat.domain.consent.ConsentPresentation
import cn.waveflow.luckycat.domain.consent.ConsentView
import cn.waveflow.luckycat.domain.conversation.ChatItem
import cn.waveflow.luckycat.domain.conversation.Conversations
import cn.waveflow.luckycat.domain.conversation.StoredConversation
import cn.waveflow.luckycat.image.PreparedImage
import cn.waveflow.luckycat.voice.VoiceController
import cn.waveflow.luckycat.voice.VoiceRecorder
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class ChatUiState(
    val conversation: StoredConversation? = null,
    val conversations: List<StoredConversation> = emptyList(),
    /** agent 正在跑（`status: running`）。 */
    val running: Boolean = false,
    /** 消息已发出、还在等第一条事件。 */
    val sending: Boolean = false,
    val consent: ConsentView? = null,
    val question: QuestionSet? = null,
    val error: String? = null,
) {
    /** 有字就能发；**只有图也能发**（发截图问这是什么）。 */
    val canSend: Boolean get() = !sending
}

/**
 * 客服对话。
 *
 * ## 三件事值得单独说
 *
 * 1. **会话 id 懒创建**：没发过话的对话在服务端不留空会话。所以
 *    `agentSessionId` 是第一次发消息时才建的（与网页版一致）。
 * 2. **确认卡片不能被"收起来"**：密码错时桥接**不结算**挑战，所以卡片留着、
 *    密码框清空让用户重输。收起卡片等于把用户唯一的机会关掉，而 agent 还在等。
 * 3. **语音不能确认**：这个 ViewModel 里没有任何"用语音答确认"的入口，
 *    只有显式的 `answerConsent`，而它只被卡片上的按钮调用。
 */
class ChatViewModel(
    private val agent: AgentApi,
    private val store: ConversationStore,
    recorder: VoiceRecorder,
) : ViewModel() {

    /**
     * 朗读与录音。放在 ViewModel 里是为了拿到 [viewModelScope]——
     * 那个作用域跟着页面走，页面一销毁，正在放的音频和正在录的音都会停。
     */
    val voice = VoiceController(agent, recorder, viewModelScope)

    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    /** 当前会话的 SSE 订阅。换会话/退出时要取消——取消会真的掐掉 HTTP 连接。 */
    private var streamJob: Job? = null

    /** callId → 本地那条工具行的 id，用来把 tool-result 回填到 tool-call 上。 */
    private val toolRows = mutableMapOf<String, String>()

    private var saveJob: Job? = null

    init {
        viewModelScope.launch {
            val loaded = store.load()
            val list = Conversations.pruneEmpty(loaded)
            val current = list.firstOrNull() ?: Conversations.make(newId("c"), System.currentTimeMillis())
            // 列表为空时也要把当前这段放进去，否则它要等到第一次 `update` 才进列表
            val owned = if (list.any { it.id == current.id }) list else list + current
            _state.value = _state.value.copy(conversations = owned, conversation = current)
        }
    }

    // ── 发消息 ──────────────────────────────────────────────────────────

    /**
     * 发一条消息。
     *
     * [image] 选填，但**文字与图片不能都空**——桥接会回 400。
     * 只有图没文字是允许的：那是"发一张截图问这是什么"的正常用法。
     */
    fun send(text: String, image: PreparedImage? = null) {
        val trimmed = text.trim()
        if ((trimmed.isEmpty() && image == null) || _state.value.sending) return
        val conversation = _state.value.conversation ?: return

        _state.value = _state.value.copy(
            sending = true,
            error = null,
            conversation = append(
                conversation,
                ChatItem.User(
                    id = newId("m"),
                    text = Conversations.clampText(trimmed),
                    // 存档里放**缩略图**不是原图：一份存档只有 2MB，原图一张就吃掉大半
                    thumb = image?.thumbBase64,
                    imageName = image?.name,
                ),
                autoTitle = true,
                // 只有图时用"图片"当标题，否则标题会是空的
                fallbackTitle = if (image != null) "图片" else null,
            ),
        )
        scheduleSave()

        viewModelScope.launch {
            val sessionId = ensureSession(conversation)
            if (sessionId == null) {
                _state.value = _state.value.copy(sending = false, error = "连不上客服，请稍后再试")
                return@launch
            }
            postToAgent(sessionId, trimmed, image)
        }
    }

    // ── 消息上的小动作 ──────────────────────────────────────────────────

    /**
     * 重新生成**最后一条**助手回复。
     *
     * 只对最后一条开放（见 [Conversations.lastAssistantId]）：重新生成中间那条
     * 就得把后面几轮全丢掉，而用户点的只是"重说这一句"。
     */
    fun regenerate(assistantMessageId: String) {
        val conversation = _state.value.conversation ?: return
        // 按钮挂在助手回复上，但倒回要倒到**产生它的那句提问**——这个换算漏了
        // 就是静默失灵：点了什么都不发生
        val promptId = Conversations.promptOf(conversation.items, assistantMessageId) ?: return
        resend(promptId, newText = null)
    }

    /** 改一句再问一遍。 */
    fun editAndResend(userMessageId: String, newText: String) {
        resend(userMessageId, newText.trim())
    }

    /**
     * 倒回 + 重发。
     *
     * **不会再追加一条用户消息**：倒回之后那句已经在列表里了，再追加会变成两条。
     *
     * 注意"服务端退不了"：助手那边仍然记得被丢掉的那些话，所以这是
     * "在同一个上下文里再问一遍"，不是"回到当初那个状态"。界面上写明了这一点。
     */
    private fun resend(itemId: String, newText: String?) {
        val conversation = _state.value.conversation ?: return
        if (_state.value.sending) return
        val items = Conversations.rewindTo(conversation.items, itemId, newText) ?: return
        val prompt = (items.lastOrNull() as? ChatItem.User)?.text ?: return
        if (prompt.isBlank()) return

        _state.value = _state.value.copy(
            sending = true,
            error = null,
            consent = null,
            question = null,
            conversation = conversation.copy(items = items, updatedAt = System.currentTimeMillis()),
        )
        scheduleSave()
        viewModelScope.launch {
            val sessionId = ensureSession(_state.value.conversation ?: return@launch) ?: run {
                _state.value = _state.value.copy(sending = false, error = "连不上客服，请稍后再试")
                return@launch
            }
            postToAgent(sessionId, prompt, image = null)
        }
    }

    /** 真正发到 agent。文字与图片不能都空（桥接会回 400）。 */
    private suspend fun postToAgent(
        sessionId: String,
        text: String,
        image: cn.waveflow.luckycat.image.PreparedImage?,
    ) {
        try {
            agent.sendMessage(
                sessionId,
                text,
                image?.let { cn.waveflow.luckycat.contract.ImageAttachment(it.sendBase64, it.mimeType) },
            )
            _state.value = _state.value.copy(sending = false)
        } catch (e: Exception) {
            _state.value = _state.value.copy(sending = false, error = readable(e))
        }
    }

    /**
     * 保证这一段对话在服务端有会话，并确保 SSE 订阅已经起上。
     *
     * 顺序很重要：**先订阅再发言**，否则第一条回复可能在订阅建立之前就发完了，
     * 用户会看到"消息发出去了但没人回"。
     */
    private suspend fun ensureSession(conversation: StoredConversation): String? {
        conversation.agentSessionId?.let { existing ->
            if (streamJob?.isActive != true) subscribe(existing)
            return existing
        }
        return try {
            val created = agent.createSession()
            _state.value = _state.value.copy(conversation = _state.value.conversation?.copy(agentSessionId = created))
            scheduleSave()
            subscribe(created)
            // 给订阅一点时间建立，再让调用方去发消息
            delay(120)
            created
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = readable(e))
            null
        }
    }

    private fun subscribe(sessionId: String) {
        streamJob?.cancel()
        streamJob = viewModelScope.launch {
            try {
                agent.streamEvents(sessionId).collect { handle(it) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                // **取消不是失败，必须原样抛回去。**
                //
                // `CancellationException` 是 `Exception` 的子类，所以下面那个
                // `catch (e: Exception)` 会把它一起吞掉，于是**切标签页、
                // 换会话时界面会冒一条"网络不给力"**——而其实什么都没坏。
                // （实测踩到：发完消息切到别的标签再回来就有一条红字。）
                // 和 `:contract` 里那条"取消 ≠ 失败"是同一类错误，只是层次不同。
                throw e
            } catch (e: Exception) {
                android.util.Log.e("LuckyCatChat", "事件流中断", e)
                _state.value = _state.value.copy(error = readable(e))
            }
        }
    }

    // ── 事件处理 ────────────────────────────────────────────────────────

    private fun handle(event: AgentEvent) {
        when (event) {
            is AgentEvent.Status ->
                _state.value = _state.value.copy(running = event.status == "running")

            is AgentEvent.Assistant ->
                update { append(it, ChatItem.Assistant(newId("m"), Conversations.clampText(event.text))) }

            is AgentEvent.ToolCall -> {
                val id = newId("t")
                event.callId?.let { toolRows[it] = id }
                update { append(it, ChatItem.Tool(id, event.name ?: "工具", "running")) }
            }

            is AgentEvent.ToolResult ->
                update { conversation ->
                    val id = event.callId?.let { toolRows[it] }
                    conversation.copy(
                        updatedAt = System.currentTimeMillis(),
                        items = conversation.items.map { item ->
                            // 有 callId 就精确匹配；没有（上游偶尔不回填）就退回"最后一个还在执行的行"
                            if (item !is ChatItem.Tool) item
                            else if (id != null) {
                                if (item.id != id) item
                                else item.copy(state = if (event.isError) "error" else "done", text = ToolSummary.summarize(item.name, event.text ?: ""))
                            } else if (item.state != "running") item
                            else item.copy(state = if (event.isError) "error" else "done", text = ToolSummary.summarize(item.name, event.text ?: ""))
                        },
                    )
                }

            is AgentEvent.Consent ->
                _state.value = _state.value.copy(
                    consent = event.challenge?.let { ConsentPresentation.from(it, System.currentTimeMillis()) },
                )

            is AgentEvent.ConsentResolved -> {
                val current = _state.value.consent
                if (current != null && current.challengeId == event.challengeId) {
                    _state.value = _state.value.copy(consent = null)
                }
            }

            is AgentEvent.Question ->
                _state.value = _state.value.copy(question = event.question?.let { parseQuestionSet(it) })

            is AgentEvent.QuestionResolved -> {
                val current = _state.value.question
                if (current != null && current.questionId == event.questionId) {
                    _state.value = _state.value.copy(question = null)
                }
            }

            is AgentEvent.Error ->
                update { append(it, ChatItem.Notice(newId("n"), event.message ?: "出错了", "error")) }

            else -> Unit  // hello / tool 审计 / 未知类型：安静带过
        }
        scheduleSave()
    }

    // ── 确认卡片 ────────────────────────────────────────────────────────

    /**
     * 答复确认卡片。
     *
     * @param password - 支付密码。**只发桥接**，不进对话、不进模型上下文。
     * @returns 密码是否错误（界面据此清空密码框并提示重试）。
     */
    fun answerConsent(approve: Boolean, password: String, onResult: (passwordWrong: Boolean, message: String?) -> Unit) {
        val view = _state.value.consent ?: return
        if (!ConsentPresentation.canSubmit(view, password)) return
        viewModelScope.launch {
            try {
                agent.answerConsent(view.challengeId, approve, password.takeIf { view.needsPassword })
                onResult(false, null)
            } catch (e: ApiException) {
                // 401 = 密码不对，**挑战没被结算**，用户还能再试
                if (ConsentPresentation.shouldClearPasswordAfterFailure(e.code)) {
                    onResult(true, "支付密码不正确")
                } else {
                    _state.value = _state.value.copy(error = e.body.ifBlank { "确认失败（HTTP ${e.code}）" })
                    onResult(false, null)
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = readable(e))
                onResult(false, null)
            }
        }
    }

    // ── 提问卡片 ────────────────────────────────────────────────────────

    fun answerQuestion(drafts: Map<String, QuestionDraft>) {
        val set = _state.value.question ?: return
        if (!QuestionAnswers.canSubmit(set, drafts)) return
        viewModelScope.launch {
            try {
                agent.answerQuestion(set.questionId, QuestionAnswers.toJson(set, drafts))
                _state.value = _state.value.copy(question = null)
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = readable(e))
            }
        }
    }

    // ── 语音 ────────────────────────────────────────────────────────────

    /** 念一段助手回复。传的是 Markdown 原文，清洗在 [VoiceController] 里做。 */
    fun speak(text: String) = voice.speak(text)

    fun stopSpeaking() = voice.stopSpeaking()

    /** 按住开始录。返回是否真的录上了。 */
    fun startRecording(): Boolean = voice.startRecording()

    /**
     * 松手：停止录音 → 转文字 → **直接发出去**。
     *
     * 转出来是空串时不会发（避免把空消息发出去）；失败时错误挂在语音状态上，
     * 不混进对话流的错误里——那是两回事。
     */
    fun stopRecording() = voice.stopRecordingAndTranscribe { text -> send(text) }

    override fun onCleared() {
        voice.release()
        streamJob?.cancel()
        super.onCleared()
    }

    // ── 会话管理 ────────────────────────────────────────────────────────

    fun newConversation() {
        val current = _state.value.conversation
        // 当前已经是空对话就不许再新建（与网页版同一条规则：列表里不该躺着两张白纸）
        if (current != null && Conversations.isEmpty(current)) return
        val fresh = Conversations.make(newId("c"), System.currentTimeMillis())
        _state.value = _state.value.copy(
            conversation = fresh,
            conversations = listOf(fresh) + _state.value.conversations,
            consent = null,
            question = null,
            error = null,
        )
        scheduleSave()
    }

    fun openConversation(id: String) {
        val target = _state.value.conversations.firstOrNull { it.id == id } ?: return
        streamJob?.cancel()
        streamJob = null
        toolRows.clear()
        _state.value = _state.value.copy(conversation = target, consent = null, question = null, error = null)
        target.agentSessionId?.let { subscribe(it) }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    fun retrySubscribe() {
        _state.value.conversation?.agentSessionId?.let { subscribe(it) }
    }

    // ── 内部小工具 ──────────────────────────────────────────────────────

    private fun append(
        conversation: StoredConversation,
        item: ChatItem,
        autoTitle: Boolean = false,
        fallbackTitle: String? = null,
    ): StoredConversation {
        val title = if (autoTitle && !conversation.titleEdited && conversation.title == Conversations.NEW_TITLE) {
            val fromText = Conversations.titleFrom((item as? ChatItem.User)?.text ?: "")
            // 发的是纯图片时 titleFrom 会回「新对话」，那时用调用方给的兜底名
            if (fromText == Conversations.NEW_TITLE && fallbackTitle != null) fallbackTitle else fromText
        } else {
            conversation.title
        }
        return conversation.copy(
            title = title,
            updatedAt = System.currentTimeMillis(),
            items = conversation.items + item,
        )
    }

    private fun update(block: (StoredConversation) -> StoredConversation) {
        val current = _state.value.conversation ?: return
        val next = block(current)
        // **upsert，不是 map**：存档为空时启动出来的那段新对话一开始并不在
        // `conversations` 里（`init` 只在列表非空时取第一个）。用 map 的话
        // 空列表映射完还是空——于是这段对话**永远不会出现在历史里**，
        // 用户聊了半天却在历史中找不到它。（instrumented 测试抓到的。）
        val list = _state.value.conversations.map { if (it.id == next.id) next else it }
        val merged = if (list.any { it.id == next.id }) list else list + next
        _state.value = _state.value.copy(conversation = next, conversations = merged)
    }

    /**
     * 存档写入**防抖**：流式回复时每个事件都会改状态，每次都全量编码
     * 整个存档会明显卡顿，而且写盘次数多到没必要。
     */
    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(500)
            val list = _state.value.conversations
            store.save(list)
        }
    }

    private fun newId(prefix: String): String = "$prefix${UUID.randomUUID().toString().replace("-", "").take(12)}"

    private fun readable(e: Exception): String = when (e) {
        is ApiException -> "客服服务出错（HTTP ${e.code}）"
        else -> "网络不给力，请稍后再试"
    }
}
