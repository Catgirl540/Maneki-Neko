package com.moneymeow.bank

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/* ─────────────────────────── 数据 ─────────────────────────── */

/**
 * 能力入口的**表现层**映射：只把服务端 id 映射成图标。
 *
 * 清单本身（有哪些入口、叫什么、什么顺序）由 `GET /agent-api/services` 下发，
 * 唯一来源是 `framework/agent-services.json`；客户端不再维护条目和文案。
 * 服务端新增未登记的 id 时用通用图标兜底，入口仍然可选。
 */
private fun serviceIcon(id: String): androidx.compose.ui.graphics.vector.ImageVector = when (id) {
    "transfer" -> Icons.Transfer
    "wealth" -> Icons.Wealth
    "analysis" -> Icons.Receipt
    "cards" -> Icons.Card
    "exchange" -> Icons.Globe
    "credit" -> Icons.UpOut
    "insurance" -> Icons.Shield
    "security" -> Icons.Lock
    else -> Icons.Dots
}

/** 一次助手回合：文本 + 可选的处理步骤。 */
private data class Turn(
    val fromUser: Boolean,
    val text: String,
    val steps: List<String> = emptyList(),
)

private val welcomeSuggestions = listOf("查余额", "转账", "换汇报价", "本月支出")

/* ─────────────────────────── 页面 ─────────────────────────── */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssistantScreen(onBack: () -> Unit, onSupport: () -> Unit) {
    var capsOpen by remember { mutableStateOf(false) }
    var historyOpen by remember { mutableStateOf(false) }
    // 已选智能服务：存服务端 id，标签从清单里查（与网页行为一致）
    val picked = remember { mutableStateListOf<String>() }
    // 能力清单来自服务端；取不到就隐藏入口，不在客户端留第二份副本
    var services by remember { mutableStateOf<List<AgentApi.AgentService>>(emptyList()) }
    var servicesLoaded by remember { mutableStateOf(false) }
    var servicesRetry by remember { mutableStateOf(0) }
    val sheetState = rememberModalBottomSheetState()

    val turns = remember { mutableStateListOf<Turn>() }
    var input by remember { mutableStateOf("") }
    var thinking by remember { mutableStateOf(false) }
    // 真实的待确认事项（网页 ConsentCard 对应）
    var challenge by remember { mutableStateOf<org.json.JSONObject?>(null) }
    var consentBusy by remember { mutableStateOf(false) }
    var consentError by remember { mutableStateOf<String?>(null) }
    // 真实 Agent：会话 id、流式回复、桥接可用性
    var sessionId by remember { mutableStateOf<String?>(null) }
    var streamingText by remember { mutableStateOf("") }
    // 每发一条消息重新订阅事件流（桥接每轮结束会关流）
    var streamTick by remember { mutableStateOf(0) }
    // 连续相同报错只记一次（两条订阅可能同时收到）
    var lastErrorText by remember { mutableStateOf<String?>(null) }
    val streamingSteps = remember { mutableStateListOf<String>() }
    var agentOnline by remember { mutableStateOf<Boolean?>(null) }
    var agentError by remember { mutableStateOf<String?>(null) }
    // 本机会话列表（桥接没有列表接口，按会话 id + 首句标题本地记录）
    val localSessions = remember { mutableStateListOf<Pair<String, String>>() }

    LaunchedEffect(Unit) {
        agentOnline = AgentApi.health()
    }

    // 能力清单：失败按 3s / 8s / 20s 重试，仍失败就按空清单处理（入口隐藏）
    LaunchedEffect(servicesRetry) {
        val waits = listOf(3_000L, 8_000L, 20_000L)
        var wait = 0L
        for (attempt in 0..waits.size) {
            if (wait > 0L) delay(wait)
            val loaded = runCatching { AgentApi.listServices() }.getOrNull()
            if (loaded != null) {
                services = loaded
                // 服务端已下线的入口不能在下次发送时带上
                val live = loaded.map { it.id }.toSet()
                picked.removeAll { it !in live }
                servicesLoaded = true
                return@LaunchedEffect
            }
            wait = waits.getOrElse(attempt) { 0L }
        }
        servicesLoaded = true
    }

    // 订阅会话事件：assistant-update 累加、assistant 定稿、tool 事件进步骤
    LaunchedEffect(sessionId, streamTick) {
        val id = sessionId ?: return@LaunchedEffect
        runCatching {
            AgentApi.stream(id) { event ->
                when (event.optString("type")) {
                    "assistant-update" -> streamingText = event.optString("text")
                    "assistant" -> {
                        val finalText = event.optString("text")
                        if (finalText.isNotBlank()) {
                            // 同一条回复可能因重订阅被重放：用「更长的版本」覆盖上一条，避免重复气泡
                            val last = turns.lastOrNull()
                            // 忽略空白差异后再判断是否是同一条回复的重放/续写
                            fun norm(t: String) = t.filterNot { it.isWhitespace() }
                            val sameReply = last != null && !last.fromUser && run {
                                val a = norm(last.text)
                                val b = norm(finalText)
                                a == b || b.startsWith(a.take(24)) || a.startsWith(b.take(24))
                            }
                            if (sameReply) {
                                turns[turns.lastIndex] = last!!.copy(
                                    text = if (finalText.length >= last.text.length) finalText else last.text,
                                    steps = if (streamingSteps.isEmpty()) last.steps else streamingSteps.toList(),
                                )
                            } else {
                                turns.add(
                                    Turn(
                                        fromUser = false,
                                        text = finalText,
                                        steps = streamingSteps.toList(),
                                    )
                                )
                            }
                        }
                        streamingText = ""
                        streamingSteps.clear()
                        thinking = false
                    }
                    "assistant-reset" -> {
                        streamingText = ""
                        thinking = false
                    }
                    "tool-call", "tool-result", "assistant-step" -> {
                        val label = event.optString("name").ifEmpty { event.optString("title") }
                        if (label.isNotEmpty()) streamingSteps.add(label)
                    }
                    "consent" -> {
                        challenge = event.optJSONObject("challenge")
                        thinking = false
                    }
                    "error" -> {
                        // 模型/桥接报错：把服务端给的原因显示成一条助手消息，可重试
                        val message = event.optString("message").ifEmpty { "助手本轮没有返回结果" }
                        turns.add(Turn(fromUser = false, text = message))
                        streamingText = ""
                        thinking = false
                    }
                    "status" -> {
                        if (event.optString("status") == "idle" && streamingText.isBlank()) {
                            thinking = false
                        }
                    }
                    "consent-resolved" -> {
                        challenge = null
                        consentBusy = false
                    }
                }
            }
        }.onFailure { agentError = it.message }
    }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    fun reply() {
        turns.add(Turn(fromUser = false, text = "助手暂时无法连接，无法确认请求是否执行。请先查看交易记录，再决定是否重试。"))
        thinking = false
    }

    fun send(text: String) {
        if (text.isBlank() || thinking) return
        val labels = picked.map { id -> services.firstOrNull { it.id == id }?.label ?: id }
        val prefix = if (labels.isEmpty()) "" else labels.joinToString(" ") { "【$it】" } + " "
        turns.add(Turn(fromUser = true, text = prefix + text.trim()))
        val question = text.trim()
        val serviceIds = picked.toList()
        input = ""
        picked.clear()
        thinking = true
        streamingText = ""
        streamingSteps.clear()

        scope.launch {
            val online = agentOnline ?: AgentApi.health().also { agentOnline = it }
            if (!online) {
                thinking = false
                reply()
                return@launch
            }
            runCatching {
                val id = sessionId ?: AgentApi.createSession().also {
                    sessionId = it
                    localSessions.add(it to question.take(18))
                }
                AgentApi.sendMessage(id, question, serviceIds)
                // 消息入队后重新订阅本轮事件流
                streamTick += 1
            }.onFailure {
                agentError = it.message
                thinking = false
                reply()
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Page)
            .imePadding(),
    ) {
        AssistantHeader(
            onBack = onBack,
            onNewChat = { turns.clear(); picked.clear() },
            onHistory = { historyOpen = true },
        )
        GhostButton("人工客服工单", onClick = onSupport, modifier = Modifier.padding(horizontal = 14.dp))

        if (agentOnline == false || agentError != null) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Tokens.SurfaceWarm)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    agentError?.let { "助手暂不可用：$it。以下为固定帮助，也可提交人工工单。" }
                        ?: "智能助手暂不可用；可查看固定帮助或提交人工工单。",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                )
            }
        }

        Box(Modifier.weight(1f)) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (turns.isEmpty() && !thinking) {
                    item {
                        Column(
                            Modifier
                                .fillParentMaxHeight(0.86f)
                                .fillMaxWidth()
                                .padding(horizontal = 8.dp),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Box(
                                Modifier
                                    .size(76.dp)
                                    .clip(CircleShape)
                                    .background(Tokens.Surface)
                                    .border(1.dp, Tokens.Border, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                Image(
                                    painter = painterResource(R.drawable.support_cat),
                                    contentDescription = null,
                                    modifier = Modifier.size(56.dp),
                                )
                            }
                            Spacer(Modifier.height(18.dp))
                            Text(
                                "今天想处理什么？",
                                fontSize = 21.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Tokens.Ink,
                            )
                            Spacer(Modifier.height(7.dp))
                            Text(
                                "账户、转账、账单、换汇、理财都能在对话里办",
                                fontSize = 12.5.sp,
                                color = Tokens.Muted,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                            Spacer(Modifier.height(22.dp))
                            // 快捷能力：一行一个，不带说明；前三项 + 更多（打开完整面板）。
                            // 清单来自服务端，取不到时整块不渲染。
                            val quick = services.take(3)
                            if (quick.isNotEmpty()) {
                                HairlineCard(Modifier.fillMaxWidth()) {
                                    Column {
                                        quick.forEachIndexed { index, service ->
                                            if (index > 0) Hairline()
                                            Row(
                                                Modifier
                                                    .fillMaxWidth()
                                                    .clickable {
                                                        if (picked.contains(service.id)) {
                                                            picked.remove(service.id)
                                                        } else {
                                                            picked.add(service.id)
                                                        }
                                                    }
                                                    .padding(horizontal = 16.dp, vertical = 15.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                Icon(
                                                    Icons.bolder(serviceIcon(service.id)),
                                                    contentDescription = null,
                                                    tint = Tokens.Ink2,
                                                    modifier = Modifier.size(22.dp),
                                                )
                                                Spacer(Modifier.size(12.dp))
                                                Text(
                                                    service.label,
                                                    fontSize = 13.5.sp,
                                                    color = Tokens.Ink,
                                                    modifier = Modifier.weight(1f),
                                                )
                                                if (picked.contains(service.id)) {
                                                    Icon(
                                                        Icons.Check,
                                                        contentDescription = "已选中",
                                                        tint = Tokens.Accent,
                                                        modifier = Modifier.size(15.dp),
                                                    )
                                                } else {
                                                    Icon(
                                                        Icons.Chevron,
                                                        contentDescription = null,
                                                        tint = Tokens.Muted,
                                                        modifier = Modifier.size(13.dp),
                                                    )
                                                }
                                            }
                                        }
                                        if (services.size > 3) {
                                            Hairline()
                                            Row(
                                                Modifier
                                                    .fillMaxWidth()
                                                    .clickable { capsOpen = true }
                                                    .padding(horizontal = 16.dp, vertical = 15.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                Icon(
                                                    Icons.bolder(Icons.Dots),
                                                    contentDescription = null,
                                                    tint = Tokens.Ink2,
                                                    modifier = Modifier.size(22.dp),
                                                )
                                                Spacer(Modifier.size(12.dp))
                                                Text(
                                                    "更多",
                                                    fontSize = 13.5.sp,
                                                    color = Tokens.Ink,
                                                    modifier = Modifier.weight(1f),
                                                )
                                                Icon(
                                                    Icons.Chevron,
                                                    contentDescription = null,
                                                    tint = Tokens.Muted,
                                                    modifier = Modifier.size(13.dp),
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                itemsIndexed(turns) { index, turn ->
                    if (turn.fromUser) {
                        UserBubble(turn.text)
                    } else {
                        AssistantTurn(
                            turn = turn,
                            isLast = index == turns.lastIndex,
                            onRegenerate = {
                                val question = turns.getOrNull(index - 1)?.text ?: ""
                                turns.removeAt(index)
                                reply()
                            },
                            onEdit = { input = turn.text },
                        )
                        // 欢迎语后跟建议 chips（设计稿 50）
                        if (index == 0) {
                            Row(
                                Modifier.padding(start = 36.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                welcomeSuggestions.forEach { chip ->
                                    SuggestionChip(chip) { send(chip) }
                                }
                            }
                        }
                    }
                }

                if (thinking) {
                    item {
                        if (streamingText.isNotBlank()) {
                            AssistantTurn(
                                Turn(fromUser = false, text = streamingText, steps = streamingSteps.toList()),
                                isLast = false,
                            )
                        } else {
                            TypingIndicator()
                        }
                    }
                }

                challenge?.let { c ->
                    item {
                        RealConsentCard(
                            challenge = c,
                            busy = consentBusy,
                            error = consentError,
                            onDecide = { approve, password, ack ->
                                val id = c.optString("challengeId").ifEmpty { c.optString("id") }
                                consentBusy = true
                                consentError = null
                                scope.launch {
                                    runCatching { AgentApi.decideConsent(id, approve, password, ack) }
                                        .onSuccess {
                                            consentBusy = false
                                            if (!approve) challenge = null
                                        }
                                        .onFailure {
                                            consentError = it.message
                                            consentBusy = false
                                        }
                                }
                            },
                        )
                    }
                }

                item { Spacer(Modifier.height(8.dp)) }
            }
        }

        Composer(
            value = input,
            onValueChange = { input = it },
            onSend = { send(input) },
            onPlus = { capsOpen = true },
            tags = picked.map { id -> services.firstOrNull { it.id == id }?.label ?: id },
            onRemoveTag = { label ->
                val id = services.firstOrNull { it.label == label }?.id ?: label
                picked.remove(id)
            },
        )
    }

    if (capsOpen) {
        ModalBottomSheet(onDismissRequest = { capsOpen = false }, sheetState = sheetState, containerColor = Tokens.Surface) {
            CapabilitySheet(
                picked = picked,
                services = services,
                loaded = servicesLoaded,
                onRetry = {
                    servicesLoaded = false
                    servicesRetry += 1
                },
                onDone = { capsOpen = false },
            )
        }
    }

    if (historyOpen) {
        HistoryDrawer(
            sessions = localSessions.toList(),
            current = sessionId,
            onPick = { id ->
                if (id != sessionId) {
                    sessionId = id
                    turns.clear()
                    challenge = null
                    streamingText = ""
                    thinking = false
                }
                historyOpen = false
            },
            onClose = { historyOpen = false },
        )
    }
}

/* ─────────────────────────── 头部 ─────────────────────────── */

@Composable
private fun AssistantHeader(onBack: () -> Unit, onNewChat: () -> Unit, onHistory: () -> Unit) {
    Column(Modifier.background(Tokens.Surface)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .padding(horizontal = 12.dp),
        ) {
            Box(
                Modifier
                    .size(36.dp)
                    .align(Alignment.CenterStart)
                    .clickable { onBack() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Chevron,
                    contentDescription = "返回",
                    tint = Tokens.Ink2,
                    modifier = Modifier
                        .size(20.dp)
                        .rotate(180f),
                )
            }
            Box(
                Modifier
                    .size(36.dp)
                    .align(Alignment.Center)
                    .clip(CircleShape)
                    .background(Tokens.Surface)
                    .border(1.dp, Tokens.Border, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    painter = painterResource(R.drawable.support_cat),
                    contentDescription = null,
                    modifier = Modifier.size(28.dp),
                )
            }
            Row(
                Modifier.align(Alignment.CenterEnd),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(36.dp)
                        .clickable { onNewChat() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Compose, contentDescription = "新会话", tint = Tokens.Ink2, modifier = Modifier.size(20.dp))
                }
                Box(
                    Modifier
                        .size(36.dp)
                        .clickable { onHistory() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Hist, contentDescription = "历史会话", tint = Tokens.Ink2, modifier = Modifier.size(20.dp))
                }
            }
        }
        Hairline()
    }
}

/* ─────────────────────────── 气泡 ─────────────────────────── */

@Composable
private fun UserBubble(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Box(
            Modifier
                .widthIn(max = 280.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Tokens.Primary)
                .padding(12.dp),
        ) {
            Text(text, fontSize = 12.5.sp, color = Color.White, lineHeight = 19.sp)
        }
    }
}

@Composable
private fun AssistantTurn(
    turn: Turn,
    isLast: Boolean = false,
    onRegenerate: () -> Unit = {},
    onEdit: () -> Unit = {},
) {
    var expanded by remember { mutableStateOf(false) }
    var speaking by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    Row(Modifier.fillMaxWidth()) {
        Box(
            Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(Tokens.Surface)
                .border(1.dp, Tokens.Border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(R.drawable.support_cat),
                contentDescription = null,
                modifier = Modifier.size(22.dp),
            )
        }
        Spacer(Modifier.size(8.dp))
        Column(Modifier.weight(1f)) {
            // 状态行 + 步骤折叠（对应网页 assistant-turn-root / toggle）
            if (turn.steps.isNotEmpty()) {
                Row(
                    Modifier
                        .clip(RoundedCornerShape(5.dp))
                        .clickable { expanded = !expanded }
                        .padding(vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(Tokens.Accent)
                    )
                    Spacer(Modifier.size(6.dp))
                    Text(
                        if (expanded) "已处理 ${turn.steps.size} 步" else "已处理 ${turn.steps.size} 步 · 查看过程",
                        fontSize = 11.5.sp,
                        color = Tokens.Muted,
                    )
                    Spacer(Modifier.size(4.dp))
                    Icon(
                        Icons.Chevron,
                        contentDescription = null,
                        tint = Tokens.Muted,
                        modifier = Modifier
                            .size(12.dp)
                            .rotate(if (expanded) 270f else 90f),
                    )
                }
                if (expanded) {
                    Column(
                        Modifier
                            .padding(start = 10.dp, top = 4.dp, bottom = 4.dp)
                            .border(0.dp, Color.Transparent)
                    ) {
                        turn.steps.forEachIndexed { index, step ->
                            Row(verticalAlignment = Alignment.Top) {
                                Text(
                                    "${index + 1}.",
                                    fontSize = 11.5.sp,
                                    color = Tokens.Muted,
                                    modifier = Modifier.width(18.dp),
                                )
                                Text(step, fontSize = 12.sp, color = Tokens.Ink2, lineHeight = 18.sp)
                            }
                        }
                    }
                }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Tokens.Surface)
                    .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
                    .padding(12.dp),
            ) {
                MarkdownMessage(turn.text)
            }
            // 消息下的动作：复制 / 朗读 / 重新生成（最后一条可编辑），与网页 MessageActions 对应
            Row(
                Modifier.padding(top = 6.dp, start = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MessageAction(
                    icon = Icons.Copy,
                    label = if (copied) "已复制" else "复制",
                    active = copied,
                ) {
                    clipboard.setText(androidx.compose.ui.text.AnnotatedString(turn.text))
                    copied = true
                }
                MessageAction(
                    icon = Icons.Play,
                    label = if (speaking) "停止朗读" else "朗读",
                    active = speaking,
                ) { speaking = !speaking }
                if (isLast) {
                    MessageAction(icon = Icons.Refresh, label = "重新生成") { onRegenerate() }
                    MessageAction(icon = Icons.Edit, label = "编辑") { onEdit() }
                }
            }
        }
    }
}

/** 消息下的一个小动作：图标 + 文案，克制不抢眼。 */
@Composable
private fun MessageAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .clip(RoundedCornerShape(5.dp))
            .clickable { onClick() }
            .padding(horizontal = 4.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = if (active) Tokens.Accent else Tokens.Muted,
            modifier = Modifier.size(13.dp),
        )
        Spacer(Modifier.size(4.dp))
        Text(label, fontSize = 11.sp, color = if (active) Tokens.Accent else Tokens.Muted)
    }
}

@Composable
private fun TypingIndicator() {
    val transition = rememberInfiniteTransition(label = "typing")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 3f,
        animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing)),
        label = "typing-phase",
    )
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(Tokens.Surface)
                .border(1.dp, Tokens.Border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(R.drawable.support_cat),
                contentDescription = null,
                modifier = Modifier.size(22.dp),
            )
        }
        Spacer(Modifier.size(8.dp))
        Row(
            Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(Tokens.SurfaceWarm)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            repeat(3) { index ->
                val active = phase.toInt() % 3 == index
                Box(
                    Modifier
                        .size(if (active) 6.dp else 5.dp)
                        .clip(CircleShape)
                        .background(if (active) Tokens.Ink2 else Tokens.Border)
                )
            }
        }
    }
}

@Composable
private fun SuggestionChip(text: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Tokens.Surface)
            .border(1.dp, Tokens.Border, RoundedCornerShape(14.dp))
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(text, fontSize = 12.sp, color = Tokens.Ink2)
    }
}

/* ─────────────────────────── 输入栏 ─────────────────────────── */

@Composable
private fun Composer(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    onPlus: () -> Unit,
    tags: List<String> = emptyList(),
    onRemoveTag: (String) -> Unit = {},
) {
    var focused by remember { mutableStateOf(false) }
    val fieldHeight by androidx.compose.animation.core.animateDpAsState(
        targetValue = if (focused) 88.dp else 40.dp,
        animationSpec = androidx.compose.animation.core.tween(180, easing = StandardOutSlowIn),
        label = "composer-height",
    )
    Row(
        Modifier
            .fillMaxWidth()
            .background(Tokens.Surface)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Plus,
            contentDescription = "选择智能服务",
            tint = Tokens.Ink2,
            modifier = Modifier
                .size(21.dp)
                .clickable { onPlus() },
        )
        Spacer(Modifier.size(8.dp))
        Box(
            Modifier
                .weight(1f)
                .height(fieldHeight)
                .clip(RoundedCornerShape(if (focused) 16.dp else 20.dp))
                .background(Tokens.SurfaceWarm)
                .padding(horizontal = 12.dp, vertical = if (focused) 10.dp else 6.dp),
            contentAlignment = if (focused) Alignment.TopStart else Alignment.CenterStart,
        ) {
            Row(verticalAlignment = if (focused) Alignment.Top else Alignment.CenterVertically) {
                // 已选能力标签（网页行为：选中后在输入框里出现标签，可点 × 取消）
                tags.forEach { tag ->
                    Row(
                        Modifier
                            .padding(end = 6.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Tokens.Surface)
                            .border(1.dp, Tokens.Border, RoundedCornerShape(12.dp))
                            .padding(start = 9.dp, end = 6.dp, top = 3.dp, bottom = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(tag, fontSize = 11.5.sp, color = Tokens.Ink2)
                        Spacer(Modifier.size(4.dp))
                        Text(
                            "×",
                            fontSize = 13.sp,
                            color = Tokens.Muted,
                            modifier = Modifier.clickable { onRemoveTag(tag) },
                        )
                    }
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = !focused,
                    maxLines = if (focused) 4 else 1,
                    textStyle = TextStyle(fontSize = 13.sp, color = Tokens.Ink),
                    cursorBrush = SolidColor(Tokens.Accent),
                    modifier = Modifier
                        .weight(1f)
                        .onFocusChanged { focused = it.isFocused },
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (value.isEmpty() && tags.isEmpty()) {
                                Text("问点什么…", fontSize = 13.sp, color = Tokens.Muted)
                            }
                            inner()
                        }
                    },
                )
            }
        }
        Spacer(Modifier.size(8.dp))
        Icon(Icons.Mic, contentDescription = "语音", tint = Tokens.Ink2, modifier = Modifier.size(21.dp))
        Spacer(Modifier.size(8.dp))
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(Tokens.Primary)
                .clickable { onSend() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Send, contentDescription = "发送", tint = Color.White, modifier = Modifier.size(16.dp))
        }
    }
}

/* ─────────────────────────── 能力弹层 ─────────────────────────── */

@Composable
private fun CapabilitySheet(
    picked: MutableList<String>,
    services: List<AgentApi.AgentService>,
    loaded: Boolean,
    onRetry: () -> Unit,
    onDone: () -> Unit,
) {
    Column(Modifier.padding(horizontal = 18.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(Tokens.Surface)
                .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.ImageIcon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(18.dp))
            Spacer(Modifier.size(10.dp))
            Text("上传图片", style = Tokens.Text.body, modifier = Modifier.weight(1f))
            Text("截图 / 账单 / 回单", style = Tokens.Text.caption)
        }
        Spacer(Modifier.height(14.dp))
        Text("选择智能服务", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
        Spacer(Modifier.height(6.dp))
        Box(Modifier.height(360.dp)) {
            if (services.isEmpty()) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .padding(top = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        if (loaded) "能力列表暂时取不到" else "正在读取能力列表…",
                        fontSize = 12.5.sp,
                        color = Tokens.Muted,
                    )
                    if (loaded) {
                        Spacer(Modifier.height(12.dp))
                        GhostButton("重试", onClick = onRetry)
                    }
                }
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                services.forEach { service ->
                    val on = picked.contains(service.id)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                if (on) picked.remove(service.id) else picked.add(service.id)
                            }
                            .padding(vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.bolder(serviceIcon(service.id)),
                            contentDescription = null,
                            tint = Tokens.Ink2,
                            modifier = Modifier.size(22.dp),
                        )
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(service.label, fontSize = 13.5.sp, color = Tokens.Ink)
                            if (service.description.isNotEmpty()) {
                                Spacer(Modifier.height(2.dp))
                                Text(service.description, style = Tokens.Text.caption)
                            }
                        }
                        Box(
                            Modifier
                                .size(20.dp)
                                .clip(CircleShape)
                                .background(if (on) Tokens.Primary else Tokens.Surface)
                                .border(1.dp, if (on) Tokens.Primary else Tokens.Border, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (on) Text("✓", fontSize = 11.sp, color = Color.White)
                        }
                    }
                    Hairline()
                }
            }
            Box(
                Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .height(22.dp)
                    .background(Brush.verticalGradient(listOf(Tokens.Surface, Tokens.Surface.copy(alpha = 0f))))
            )
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(26.dp)
                    .background(Brush.verticalGradient(listOf(Tokens.Surface.copy(alpha = 0f), Tokens.Surface)))
            )
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton("完成", onDone)
        Spacer(Modifier.height(12.dp))
    }
}

/* ─────────────────────────── 历史会话抽屉 ─────────────────────────── */

@Composable
private fun HistoryDrawer(
    sessions: List<Pair<String, String>>,
    current: String?,
    onPick: (String) -> Unit,
    onClose: () -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.28f))
                .clickable { onClose() }
        )
        Box(
            Modifier
                .align(Alignment.CenterEnd)
                .fillMaxHeight()
                .width(300.dp)
                .background(Tokens.Surface)
        ) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Spacer(Modifier.height(16.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("历史会话", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Text(
                        "›",
                        fontSize = 20.sp,
                        color = Tokens.Ink2,
                        modifier = Modifier.clickable { onClose() },
                    )
                }
                Spacer(Modifier.height(8.dp))
                if (sessions.isEmpty()) {
                    Text(
                        "还没有会话，回去问一句就会出现在这里",
                        fontSize = 12.sp,
                        color = Tokens.Muted,
                        modifier = Modifier.padding(vertical = 16.dp),
                    )
                }
                sessions.forEach { (id, title) ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 13.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            title,
                            fontSize = 13.sp,
                            color = if (id == current) Tokens.Accent else Tokens.Ink,
                            modifier = Modifier
                                .weight(1f)
                                .clickable { onPick(id) },
                        )
                        Text(
                            if (id == current) "当前" else "打开",
                            fontSize = 11.sp,
                            color = Tokens.Muted,
                            modifier = Modifier.clickable { onPick(id) },
                        )
                    }
                    Hairline()
                }
            }
        }
    }
}

/** 真实的敏感操作确认卡：字段来自服务端 challenge，确认后提交支付密码。 */
@Composable
private fun RealConsentCard(
    challenge: org.json.JSONObject,
    busy: Boolean,
    error: String?,
    onDecide: (Boolean, String?, String?) -> Unit,
) {
    var password by remember { mutableStateOf("") }
    var ack by remember { mutableStateOf(false) }
    val fields = challenge.optJSONArray("fields")
    val verification = challenge.optString("verification")
    val ackText = challenge.optString("riskAcknowledgementText")
    val consequence = challenge.optString("consequence")

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Tokens.Surface)
            .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Lock, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(15.dp))
            Spacer(Modifier.size(6.dp))
            Text("需要你确认", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
        }
        Spacer(Modifier.height(8.dp))
        if (fields != null) {
            for (i in 0 until fields.length()) {
                val row = fields.optJSONObject(i) ?: continue
                KvRow(row.optString("label"), row.optString("value"))
            }
        }
        if (consequence.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(consequence, fontSize = 11.5.sp, color = Tokens.Muted, lineHeight = 18.sp)
        }
        if (ackText.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(Tokens.SurfaceWarm)
                    .padding(10.dp)
            ) {
                Text(ackText, fontSize = 11.sp, color = Tokens.Ink2, lineHeight = 17.sp)
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickableNoRipple { ack = !ack }
                    .padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(if (ack) Tokens.Primary else Tokens.Surface)
                        .border(1.dp, if (ack) Tokens.Primary else Tokens.Border, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    if (ack) Text("✓", fontSize = 10.sp, color = Color.White)
                }
                Spacer(Modifier.size(8.dp))
                Text("本人已抄录并确认上述语句", fontSize = 11.5.sp, color = Tokens.Ink2)
            }
        }
        if (verification == "payment-password") {
            Spacer(Modifier.height(10.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .clip(CircleShape)
                    .background(Tokens.Surface)
                    .border(1.dp, Tokens.Border, CircleShape)
                    .padding(horizontal = 16.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                BasicTextField(
                    value = password,
                    onValueChange = { password = it.filter(Char::isDigit).take(6) },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Ink),
                    cursorBrush = SolidColor(Tokens.Accent),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (password.isEmpty()) Text("6 位支付密码", fontSize = 13.sp, color = Tokens.Muted)
                            inner()
                        }
                    },
                )
            }
        }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(error, fontSize = 11.5.sp, color = Tokens.Coral)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier
                    .weight(1f)
                    .height(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Tokens.Surface)
                    .border(1.dp, Tokens.Border, RoundedCornerShape(8.dp))
                    .clickable { onDecide(false, null, null) },
                contentAlignment = Alignment.Center,
            ) {
                Text("取消", fontSize = 14.sp, color = Tokens.Ink2)
            }
            Box(
                Modifier
                    .weight(1f)
                    .height(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Tokens.Primary)
                    .clickable {
                        if (busy) return@clickable
                        if (verification == "payment-password" && password.length != 6) return@clickable
                        if (ackText.isNotEmpty() && !ack) return@clickable
                        onDecide(true, password.ifEmpty { null }, ackText.ifEmpty { null })
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(if (busy) "提交中…" else "确认", fontSize = 14.sp, color = Color.White, fontWeight = FontWeight.Medium)
            }
        }
    }
}
