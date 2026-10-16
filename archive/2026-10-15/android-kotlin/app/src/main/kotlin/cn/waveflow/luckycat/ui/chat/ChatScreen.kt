package cn.waveflow.luckycat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.contract.QuestionSet
import cn.waveflow.luckycat.domain.ask.QuestionDraft
import cn.waveflow.luckycat.domain.consent.ConsentView
import cn.waveflow.luckycat.domain.conversation.ChatItem
import cn.waveflow.luckycat.ui.theme.NavGlyph
import cn.waveflow.luckycat.ui.theme.NavIcon
import cn.waveflow.luckycat.ui.theme.Palette
import cn.waveflow.luckycat.image.ImagePreparer
import cn.waveflow.luckycat.image.PreparedImage
import cn.waveflow.luckycat.voice.VoiceController
import androidx.compose.ui.text.AnnotatedString
import cn.waveflow.luckycat.domain.conversation.Conversations

/**
 * 客服聊天。
 *
 * 消息、工具轨迹、确认卡片、提问卡片**在同一个列表里按发生顺序排**——
 * 这与网页版一致，也是唯一说得通的排法：确认卡片是某一轮里的一个步骤，
 * 抽出来固定贴在底部会让人不知道它对应哪句话。
 */
@Composable
fun ChatScreen(
    state: ChatUiState,
    voice: VoiceController.State = VoiceController.State(),
    onSpeak: (String) -> Unit = {},
    onCopy: (String) -> Unit = {},
    onRegenerate: (String) -> Unit = {},
    onEditResend: (String, String) -> Unit = { _, _ -> },
    onStopSpeaking: () -> Unit = {},
    onStartRecording: () -> Boolean = { false },
    onStopRecording: () -> Unit = {},
    onDismissVoiceError: () -> Unit = {},
    onSend: (String, PreparedImage?) -> Unit,
    onNewConversation: () -> Unit,
    onOpenConversation: (String) -> Unit,
    onAnswerConsent: (approve: Boolean, password: String, onResult: (Boolean, String?) -> Unit) -> Unit,
    onAnswerQuestion: (Map<String, QuestionDraft>) -> Unit,
    onDismissError: () -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    var historyOpen by remember { mutableStateOf(false) }
    // 选好但还没发出去的图
    var pending by remember { mutableStateOf<PreparedImage?>(null) }
    var picking by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<ChatItem.User?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    // **系统相册选择器**（Photo Picker）：不需要读存储权限，用户只交出选中的那一张
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri != null) {
            // 解码 + 压缩在 IO 线程上做：一张大图能卡住界面好几百毫秒
            pending = runCatching { ImagePreparer.prepare(context, uri) }.getOrNull()
            if (pending == null) picking = false
        }
    }
    val listState = rememberLazyListState()
    val items = state.conversation?.items ?: emptyList()

    // 新内容进来就滚到底。
    //
    // **必须把卡片算进"最后一个下标"里**：LazyColumn 的下标是数**所有** item 的，
    // 而确认卡片/提问卡片也是 item。只滚到 `items.lastIndex` 的话，
    // 卡片出现时会停在屏幕下方看不见的地方——用户根本不知道自己被要求确认什么。
    // （这条是 instrumented 测试抓出来的：节点存在，但 assertIsDisplayed 失败。）
    val tailIndex = items.size +
        (if (state.consent != null) 1 else 0) +
        (if (state.question != null) 1 else 0) +
        (if (state.running) 1 else 0) - 1
    LaunchedEffect(tailIndex) {
        if (tailIndex >= 0) listState.animateScrollToItem(tailIndex)
    }

    // `imePadding()`：输入法弹起时让**这一屏自己收缩**，而不是让系统去平移整个窗口。
    //
    // 不写的话，输入框一获得焦点系统就把窗口整体上推（实测 851px），
    // 于是上方新出现的确认卡片被推到屏幕外——用户看不到要核对的信息。
    // 这是 instrumented 测试抓出来的（节点存在，但 assertIsDisplayed 失败）。
    Box(modifier = Modifier.fillMaxSize().imePadding()) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("小招", style = MaterialTheme.typography.titleMedium)
                // 空态下副标题就是「新对话」，和右上角按钮文字重复——不显示。
                // 有会话标题（比如历史对话里点进来的）才显示，给用户上下文。
                val subtitle = state.conversation?.title
                if (!subtitle.isNullOrBlank() && subtitle != "新对话") {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = Palette.inkMute,
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(
                    onClick = { historyOpen = true },
                    modifier = Modifier.testTag("chat-history"),
                ) {
                    Text("历史")
                }
                TextButton(onClick = onNewConversation, modifier = Modifier.testTag("chat-new")) { Text("新对话") }
            }
        }

        state.error?.let {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f).testTag("chat-error"),
                )
                TextButton(onClick = onDismissError, modifier = Modifier.testTag("chat-error-dismiss")) { Text("知道了") }
            }
        }

        Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
            if (items.isEmpty() && state.consent == null && state.question == null) {
                Column(
                    modifier = Modifier.fillMaxSize().testTag("chat-empty"),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("有问题问小招", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "查余额、看流水、转账、理财——涉及资金的操作会先让你核对再执行。",
                        style = MaterialTheme.typography.bodySmall,
                        color = Palette.inkSoft,
                        modifier = Modifier.padding(horizontal = 32.dp, vertical = 6.dp),
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().testTag("chat-list"),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    // 「重新生成」**只挂在最后一条助手回复上**：挂到中间那条，
                    // 重新生成就得把后面几轮全丢掉，而用户点的只是"重说这一句"。
                    val lastAssistant = Conversations.lastAssistantId(items)
                    items(items, key = { it.id }) { item ->
                        ChatRow(
                            item = item,
                            onSpeak = onSpeak,
                            onCopy = onCopy,
                            canRegenerate = item.id == lastAssistant,
                            onRegenerate = onRegenerate,
                            onEdit = { editing = it },
                        )
                    }

                    state.consent?.let { view ->
                        item(key = "consent-${view.challengeId}") {
                            ConsentCardView(view = view, onSubmit = onAnswerConsent)
                        }
                    }
                    state.question?.let { set ->
                        item(key = "question-${set.questionId}") {
                            QuestionCardView(set = set, onSubmit = onAnswerQuestion)
                        }
                    }
                    if (state.running) {
                        item(key = "running") {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                CircularProgressIndicator(modifier = Modifier.widthIn(max = 16.dp))
                                Text("正在处理…", style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
                            }
                        }
                    }
                }
            }
        }

        // 已选图片的预览。**发出去之前用户要能看到自己选了哪张**。
        pending?.let { image ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "已选：${image.name}",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkSoft,
                    modifier = Modifier.weight(1f).testTag("pending-image"),
                )
                TextButton(onClick = { pending = null }, modifier = Modifier.testTag("pending-clear")) {
                    Text("移除")
                }
            }
        }

        // 语音状态条：录音中 / 转写中 / 朗读中。
        // **波形在整段合成完之后才出现**，所以它一开始是空的——这不是坏了。
        if (voice.recording || voice.transcribing || voice.speaking) {
            VoiceBar(voice = voice, onStopSpeaking = onStopSpeaking)
        }
        voice.error?.let {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f).testTag("voice-error"),
                )
                TextButton(onClick = onDismissVoiceError, modifier = Modifier.testTag("voice-error-dismiss")) {
                    Text("知道了")
                }
            }
        }

        // 输入栏：和底栏**同一套药丸**（shadow 10dp / 50%圆角 / 白底 / 8dp 内边距语义），
        // 三个控件全部 44dp 居中对齐。
        //
        // 上一版三个按钮各自画一个浅米黄圆形底——在米黄页面上根本看不见，像图标直接
        // 贴在背景上；而且输入框 56dp 比按钮高 12dp，底部齐平顶部就冒一截。现在药丸
        // 把所有东西**装成一块**，与底栏上下呼应。
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .padding(bottom = 20.dp)
                .shadow(10.dp, RoundedCornerShape(50))
                .clip(RoundedCornerShape(50))
                .background(Palette.navPill)
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            // 选图 / 语音：**非状态按钮**，去掉各自的圆形底——整个药丸已经是白底了，
            // 图标用品牌深棕即可，不需要再垫一层浅米黄（那层和页面底色差太小，看不见）。
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clickable {
                        picking = true
                        picker.launch(
                            androidx.activity.result.PickVisualMediaRequest(
                                androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly,
                            ),
                        )
                    }
                    .semantics { contentDescription = "选择图片" }
                    .testTag("chat-attach"),
                contentAlignment = Alignment.Center,
            ) {
                NavGlyph(icon = NavIcon.Image, color = Palette.accentDeep, size = 22.dp)
            }
            TextField(
                value = draft,
                onValueChange = { draft = it },
                placeholder = { Text("描述你的需求") },
                modifier = Modifier.weight(1f).testTag("chat-input"),
                maxLines = 4,
                shape = RoundedCornerShape(50),
                // 药丸已经是白底，容器色用透明即可；描边/指示器全关，
                // 让输入框看起来像药丸里"挖出来的输入区"，不是一块独立的块。
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    disabledContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    disabledIndicatorColor = Color.Transparent,
                    cursorColor = Palette.accentDeep,
                ),
            )
            // 语音：录音中保留实心主色圆——这是**状态高亮**，需要一眼看出"正在录"。
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .then(
                        if (voice.recording) Modifier.clip(RoundedCornerShape(50)).background(Palette.accent) else Modifier,
                    )
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onPress = {
                                if (!onStartRecording()) return@detectTapGestures
                                tryAwaitRelease()
                                onStopRecording()
                            },
                        )
                    }
                    .semantics { contentDescription = "按住说话" }
                    .testTag("chat-mic"),
                contentAlignment = Alignment.Center,
            ) {
                NavGlyph(
                    icon = NavIcon.Mic,
                    color = if (voice.recording) Palette.onAccent else Palette.accentDeep,
                    size = 22.dp,
                )
            }
            // 发送：可发时实心主色（行动按钮必须最显眼），禁用时直接灰图标
            // （不画灰底——灰底在白药丸上显脏）。
            val canSend = (draft.isNotBlank() || pending != null) && state.canSend
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .then(
                        if (canSend) Modifier.clip(RoundedCornerShape(50)).background(Palette.accent) else Modifier,
                    )
                    .clickable(enabled = canSend) {
                        val text = draft
                        val image = pending
                        draft = ""
                        pending = null
                        onSend(text, image)
                    }
                    .semantics { contentDescription = "发送" }
                    .testTag("chat-send"),
                contentAlignment = Alignment.Center,
            ) {
                NavGlyph(
                    icon = NavIcon.Send,
                    color = if (canSend) Palette.onAccent else Palette.inkMute,
                    size = 20.dp,
                )
            }
        }
    }

    // 编辑重发。**必须说清"服务端退不了"**：助手那边仍然记得被丢掉的那些话，
    // 所以这是"在同一个上下文里再问一遍"，不是"回到当初那个状态"。
    editing?.let { target ->
        EditDialog(
            initial = target.text,
            onDismiss = { editing = null },
            onConfirm = { text ->
                editing = null
                onEditResend(target.id, text)
            },
        )
    }

    // 历史对话盖在整屏之上；关掉之后回到聊天
    if (historyOpen) {
        Box(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0x66000000))
                    .clickable(onClick = { historyOpen = false }),
            )
            HistoryOverlay(
                conversations = state.conversations,
                currentId = state.conversation?.id,
                onPick = {
                    historyOpen = false
                    onOpenConversation(it)
                },
                onClose = { historyOpen = false },
            )
        }
    }
    }
}

@Composable
private fun ChatRow(
    item: ChatItem,
    onSpeak: (String) -> Unit,
    onCopy: (String) -> Unit,
    canRegenerate: Boolean,
    onRegenerate: (String) -> Unit,
    onEdit: (ChatItem.User) -> Unit,
) {
    when (item) {
        is ChatItem.User -> UserRow(item, onEdit)
        is ChatItem.Assistant -> AssistantRow(item, onSpeak, onCopy, canRegenerate, onRegenerate)
        is ChatItem.Tool -> ToolRow(item)
        is ChatItem.Notice -> Text(
            item.text,
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.fillMaxWidth().testTag("msg-notice-${item.id}"),
        )
    }
}

/**
 * 助手回复 + 一个「朗读」入口。
 *
 * 朗读传的是**原文**：Markdown 的清洗在 `:domain` 的 `SpeechText` 里做，
 * 界面不该关心"哪些符号不该念出来"。
 */
/**
 * 用户气泡：文字 + 已发图片的**缩略图**。
 *
 * 显式带 `contentDescription` 与一个 `testTag`：图片本身没有可读文本，
 * 无损测试与读屏都只能靠这两样认出"这里有一张图"。
 */
@Composable
private fun UserRow(item: ChatItem.User, onEdit: (ChatItem.User) -> Unit) {
    val image = rememberThumb(item.thumb)
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (image != null) {
            androidx.compose.foundation.Image(
                bitmap = image,
                contentDescription = item.imageName ?: "已发送的图片",
                modifier = Modifier
                    .widthIn(max = 200.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .testTag("msg-image-${item.id}"),
            )
        }
        if (item.text.isNotEmpty()) Bubble(item.text, mine = true, tag = "msg-user-${item.id}")
        // 纯图片消息没有文字可改，不给编辑入口
        if (item.text.isNotEmpty()) {
            TextButton(
                onClick = { onEdit(item) },
                modifier = Modifier.testTag("edit-${item.id}"),
            ) {
                Text("编辑", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** base64 缩略图 → ImageBitmap。解不出来就当没有（不让一张坏图把整条对话搞崩）。 */
@Composable
private fun rememberThumb(base64: String?): androidx.compose.ui.graphics.ImageBitmap? = remember(base64) {
    if (base64.isNullOrEmpty()) null
    else runCatching {
        val bytes = android.util.Base64.decode(base64, android.util.Base64.NO_WRAP)
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size).asImageBitmap()
    }.getOrNull()
}

@Composable
private fun AssistantRow(
    item: ChatItem.Assistant,
    onSpeak: (String) -> Unit,
    onCopy: (String) -> Unit,
    canRegenerate: Boolean,
    onRegenerate: (String) -> Unit,
) {
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
            // 助手回复按 Markdown 渲染：原样显示的话客户读到的是 `**` 和 `|---|`
            androidx.compose.foundation.layout.Box(
                modifier = Modifier
                    .widthIn(max = 320.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Palette.surface)
                    .padding(horizontal = 14.dp, vertical = 10.dp)
                    .testTag("msg-assistant-${item.id}"),
            ) {
                MarkdownText(item.text)
            }
        }
        Row(modifier = Modifier.padding(start = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(
                onClick = { onSpeak(item.text) },
                modifier = Modifier.testTag("speak-${item.id}"),
            ) {
                Text("朗读", style = MaterialTheme.typography.bodySmall)
            }
            TextButton(
                onClick = {
                    // 复制的是**原文**（Markdown），不是渲染后的纯文本：
                    // 贴到别处还要保持格式
                    clipboard.setText(AnnotatedString(item.text))
                    onCopy(item.text)
                },
                modifier = Modifier.testTag("copy-${item.id}"),
            ) {
                Text("复制", style = MaterialTheme.typography.bodySmall)
            }
            if (canRegenerate) {
                TextButton(
                    onClick = { onRegenerate(item.id) },
                    modifier = Modifier.testTag("regenerate-${item.id}"),
                ) {
                    Text("重新生成", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

/** 语音状态条。波形只在朗读时、而且只在整段合成完之后才有。 */
@Composable
private fun VoiceBar(voice: VoiceController.State, onStopSpeaking: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .testTag("voice-bar"),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            when {
                voice.recording -> "正在录音…松开发送"
                voice.transcribing -> "正在识别…"
                else -> "正在朗读…"
            },
            style = MaterialTheme.typography.bodySmall,
            color = Palette.accentDeep,
            modifier = Modifier.testTag("voice-status"),
        )
        if (voice.speaking && voice.waveform.isNotEmpty()) {
            Row(
                modifier = Modifier.weight(1f).height(24.dp).testTag("voice-waveform"),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                voice.waveform.take(28).forEach { peak ->
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height((peak * 22).dp.coerceAtLeast(2.dp))
                            .clip(RoundedCornerShape(1.dp))
                            .background(Palette.accent),
                    )
                }
            }
        } else {
            Box(modifier = Modifier.weight(1f))
        }
        if (voice.speaking) {
            TextButton(onClick = onStopSpeaking, modifier = Modifier.testTag("voice-stop")) { Text("停止") }
        }
    }
}

/** 改一句再问一遍。 */
@Composable
private fun EditDialog(initial: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("修改这条消息") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                androidx.compose.material3.OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.fillMaxWidth().testTag("edit-input"),
                )
                Text(
                    "注意：助手那边的会话记录退不回去。它还记得原来的那句，" +
                        "所以这是「在同一个上下文里再问一遍」，不是回到当初那个状态。",
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.inkSoft,
                    modifier = Modifier.testTag("edit-caveat"),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(text) },
                enabled = text.isNotBlank(),
                modifier = Modifier.testTag("edit-confirm"),
            ) {
                Text("保存并重发")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("edit-cancel")) { Text("取消") }
        },
    )
}

@Composable
private fun Bubble(text: String, mine: Boolean, tag: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(if (mine) Palette.accentSoft else Palette.surface)
                .padding(horizontal = 14.dp, vertical = 10.dp)
                .testTag(tag),
        )
    }
}

/** 工具轨迹。执行中/已完成/未执行 + 一行摘要。 */
@Composable
private fun ToolRow(item: ChatItem.Tool) {
    val (mark, color) = when (item.state) {
        "running" -> "执行中…" to Palette.inkMute
        "error" -> "未执行" to MaterialTheme.colorScheme.error
        else -> "已完成" to Palette.inkSoft
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 4.dp).testTag("msg-tool-${item.id}"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("· $mark", style = MaterialTheme.typography.bodySmall, color = color)
        Text(
            item.text?.takeIf { it.isNotEmpty() } ?: toolDisplayName(item.name),
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkMute,
        )
    }
}

/**
 * 工具名 → 中文。**认不出的原样显示**：这是给用户看的轨迹，
 * 显示 `bank_new_thing` 也比显示"某个工具"有用（至少能报给客服）。
 */
private fun toolDisplayName(name: String): String = when (name) {
    "bank_get_balance" -> "查询余额"
    "bank_list_transactions" -> "查询流水"
    "bank_get_transaction_detail" -> "查询交易详情"
    "bank_transfer" -> "转账"
    "bank_wealth_quote" -> "理财报价"
    "bank_reveal_card_secret" -> "查看卡密"
    "knowledge_lookup" -> "查知识库"
    else -> name
}
