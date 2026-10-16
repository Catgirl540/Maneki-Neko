package cn.waveflow.luckycat.domain.conversation

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 对话里的一条内容。
 *
 * **判别字段是 `kind`**（不是 kotlinx 默认的 `type`），与网页版
 * `app/src/lib/agentSessions.ts` 一致——两边的存档形状一样，将来要迁移
 * 或者互相对照时不用做映射。
 *
 * [user] 的 `thumb` 是**缩略图**不是原图：原图只发给 agent，存档里放原图
 * 一张就吃掉 2MB 预算的大半。见网页版 `lib/image.ts` 的 `prepareImage`。
 */
@Serializable
sealed interface ChatItem {
    val id: String

    @Serializable
    @SerialName("user")
    data class User(
        override val id: String,
        val text: String,
        val thumb: String? = null,
        val imageName: String? = null,
    ) : ChatItem

    @Serializable
    @SerialName("assistant")
    data class Assistant(
        override val id: String,
        val text: String,
    ) : ChatItem

    @Serializable
    @SerialName("tool")
    data class Tool(
        override val id: String,
        val name: String,
        /** `running` / `done` / `error`。 */
        val state: String,
        val text: String? = null,
    ) : ChatItem

    @Serializable
    @SerialName("notice")
    data class Notice(
        override val id: String,
        val text: String,
        /** `info` / `error`。 */
        val tone: String,
    ) : ChatItem
}

/** 一段对话（含它的全部内容）。 */
@Serializable
data class StoredConversation(
    /** 本地 id：只在这台设备上有意义。 */
    val id: String,
    /**
     * agent 侧的会话 id。**懒创建**：还没发过话的对话没有这个字段，
     * 所以也不会在服务端留下空会话。
     */
    val agentSessionId: String? = null,
    val title: String,
    /** 用户手动改过标题之后就不再用第一句话自动起名。 */
    val titleEdited: Boolean = false,
    val createdAt: Long,
    val updatedAt: Long,
    val items: List<ChatItem> = emptyList(),
)

/**
 * 存档的编解码与裁剪。**纯函数**，不碰文件系统——落盘在 `:app` 里做，
 * 这样这一层的每条规则（标题怎么截、超限从哪头丢）都能离线测。
 */
object Conversations {

    /** 最多留多少段对话，超了从最旧的整段丢。 */
    const val MAX_CONVERSATIONS = 50

    /** 单条内容的长度上限（正常回复远达不到，纯粹防跑飞）。 */
    const val MAX_ITEM_TEXT = 20_000

    /** 存档的总体积上限，超了从最旧的整段丢。 */
    const val MAX_STORE_BYTES = 2_000_000

    /** 标题最长多少个字。 */
    const val MAX_TITLE = 18

    /**
     * JSON 配置。`classDiscriminator = "kind"` 是为了与网页版的存档同形；
     * `ignoreUnknownKeys` 让老版本存档里的多余字段不至于让整个存档读不出来。
     */
    val json: Json = Json {
        classDiscriminator = "kind"
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    /** 造一段新的空对话。 */
    fun make(
        id: String,
        now: Long,
    ): StoredConversation = StoredConversation(
        id = id,
        title = NEW_TITLE,
        createdAt = now,
        updatedAt = now,
    )

    /**
     * 从第一句话里取标题。
     *
     * 只取**第一行**、把连续空白压成一个空格；空了就叫「新对话」。
     * 用户发一段带换行的长文时，标题不该是满屏的换行。
     */
    fun titleFrom(text: String): String {
        val first = text.trim().lineSequence().firstOrNull()?.replace(WHITESPACE, " ")?.trim() ?: ""
        if (first.isEmpty()) return NEW_TITLE
        return if (first.length > MAX_TITLE) "${first.take(MAX_TITLE)}…" else first
    }

    /**
     * 把时间戳说成人话：`刚刚` / `5 分钟前` / `14:03` / `昨天` / `3 月 2 日`。
     *
     * 未来时间（设备时钟被调过）按"刚刚"处理，**不显示负数**——
     * "-3 分钟前"只会让人以为 App 坏了。
     */
    fun relativeTime(
        ts: Long,
        now: Long,
        zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
        compact: Boolean = false,
    ): String {
        val diff = now - ts
        if (diff < 60_000) return "刚刚"
        if (diff < 3_600_000) return "${diff / 60_000} 分钟前"

        val at = java.time.Instant.ofEpochMilli(ts).atZone(zone)
        val today = java.time.Instant.ofEpochMilli(now).atZone(zone)
        if (at.toLocalDate() == today.toLocalDate()) {
            return "%02d:%02d".format(at.hour, at.minute)
        }
        if (at.toLocalDate() == today.toLocalDate().minusDays(1)) {
            // 列表那一行很窄，`昨天 20:17` 会被挤到截断；那个位置"昨天"就够了
            return if (compact) "昨天" else "昨天 %02d:%02d".format(at.hour, at.minute)
        }
        if (at.year == today.year) return "${at.monthValue} 月 ${at.dayOfMonth} 日"
        return "${at.year} 年 ${at.monthValue} 月 ${at.dayOfMonth} 日"
    }

    /** 一段对话有多少条"人看得见"的内容（工具执行过程不算）。 */
    fun messageCount(conversation: StoredConversation): Int =
        conversation.items.count { it is ChatItem.User || it is ChatItem.Assistant }

    /**
     * 这段对话是不是"空"的——建出来但一次都没用过。
     *
     * **不能只看内容条数**：`agentSessionId` 是发第一句话时才建的，只要它有值
     * 就一定发过话。两个条件一起看，才不会把一段真用过的对话误判成空的丢掉。
     */
    fun isEmpty(conversation: StoredConversation): Boolean =
        conversation.items.isEmpty() && conversation.agentSessionId == null

    /** 丢掉多余的"空对话"：有非空的就一个空的不留；全是空的则只留最新那段。 */
    fun pruneEmpty(list: List<StoredConversation>): List<StoredConversation> {
        val nonEmpty = list.filter { !isEmpty(it) }
        if (nonEmpty.isNotEmpty()) return nonEmpty
        val newest = list.maxByOrNull { it.updatedAt } ?: return emptyList()
        return listOf(newest)
    }

    /**
     * 按更新时间和体积上限裁剪，返回能存下来的那部分。
     *
     * 顺序是**先丢最旧的**，直到条数与字节数都达标。字节数用编码后的实际长度算，
     * 而不是估——估错了会写出一个读不回来的存档。
     */
    fun prune(
        list: List<StoredConversation>,
        maxCount: Int = MAX_CONVERSATIONS,
        maxBytes: Int = MAX_STORE_BYTES,
    ): List<StoredConversation> {
        var kept = list.sortedByDescending { it.updatedAt }.take(maxCount)
        while (kept.isNotEmpty() && encode(kept).toByteArray().size > maxBytes) {
            kept = kept.dropLast(1)
        }
        return kept
    }


    // ── 消息上的小动作（重新生成 / 编辑重发）────────────────────────────

    /**
     * 最后一条助手回复的 id。
     *
     * 「重新生成」**只挂在这一条上**。挂到每一条上要面临一个很难解释的问题：
     * 重新生成中间那条回复，就得把它**后面**的几轮问答全丢掉——
     * 用户点的是"重说这一句"，代价却是删掉后面十分钟的对话。
     */
    fun lastAssistantId(items: List<ChatItem>): String? =
        items.lastOrNull { it is ChatItem.Assistant }?.id

    /**
     * 一条内容"对应的那次提问"是哪一句。
     *
     * 「重新生成」的按钮挂在**助手回复**上（用户点的就是那条回复），
     * 但倒回要倒到**产生它的那句提问**——这个换算很容易漏。
     * 漏了的后果是静默失灵：拿着一个助手 id 去 `rewindTo`、被规矩拒掉、
     * 于是按钮点了什么都不发生。
     */
    fun promptOf(items: List<ChatItem>, itemId: String): String? {
        val index = items.indexOfFirst { it.id == itemId }
        if (index < 0) return null
        return when (val target = items[index]) {
            is ChatItem.User -> target.id
            // 工具行与系统通知上没有这些动作，不该走到这里
            is ChatItem.Assistant ->
                items.subList(0, index).lastOrNull { it is ChatItem.User }?.id
            else -> null
        }
    }

    /**
     * 把一段对话倒回到某条用户消息：保留到它为止，丢掉它后面的全部内容。
     *
     * 「编辑重发」与「重新生成」共用这一步，只差要不要换文字：
     *   · 编辑重发 → 传 [text]，那条用户消息换成新的
     *   · 重新生成 → 不传，保留原话，丢掉助手那条回复
     *
     * **只是本地这份记录的倒退，服务端的会话日志退不了。** 助手那边仍然记得
     * 被丢掉的那些话，所以重发等于"在同一个上下文里再问一遍"，
     * 而不是"回到当初那个状态"。这件事不藏着，界面上要写出来。
     *
     * @returns 倒回之后的内容；找不到、或那条不是用户消息时返回 `null`。
     */
    fun rewindTo(items: List<ChatItem>, itemId: String, text: String? = null): List<ChatItem>? {
        val index = items.indexOfFirst { it.id == itemId }
        if (index < 0) return null
        val target = items[index] as? ChatItem.User ?: return null
        val kept = items.subList(0, index + 1).toList()
        if (text == null) return kept
        // 换文字时把最后一条也换掉。空文字是调用方的事——这里只做切片，不判断内容。
        return kept.dropLast(1) + target.copy(text = text)
    }

    /** 单条内容存下来之前截断，防止一条超长回复把整个存档撑爆。 */
    fun clampText(text: String): String =
        if (text.length > MAX_ITEM_TEXT) text.take(MAX_ITEM_TEXT) else text

    fun encode(list: List<StoredConversation>): String = json.encodeToString(list)

    /**
     * 读存档。**坏数据一律当空**，不抛异常。
     *
     * 存档是本地数据，用户看不到也修不了；读不出来就退回空列表，
     * 总比整个客服页打不开好。
     */
    fun decode(raw: String?): List<StoredConversation> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching { json.decodeFromString<List<StoredConversation>>(raw) }.getOrDefault(emptyList())
    }

    const val NEW_TITLE = "新对话"
    private val WHITESPACE = Regex("\\s+")
}
