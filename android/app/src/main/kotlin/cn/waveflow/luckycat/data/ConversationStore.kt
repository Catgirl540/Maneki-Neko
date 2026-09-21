package cn.waveflow.luckycat.data

import android.content.Context
import cn.waveflow.luckycat.domain.conversation.Conversations
import cn.waveflow.luckycat.domain.conversation.StoredConversation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * 对话存档的落盘。
 *
 * **只负责读写文件**，所有规则（标题怎么截、超限从哪头丢、坏数据怎么办）
 * 都在 `:domain` 的 [Conversations] 里——那些是能离线测的，不该混在 I/O 里。
 *
 * 用普通文件而不是 DataStore：存档就是"一个 JSON 字符串"，而 DataStore 会
 * 再引一层 Flow/协程原语。真需要多进程或事务读写时再换。
 */
class ConversationStore(context: Context) {

    private val file = File(context.filesDir, "agent-sessions.json")

    /**
     * 读存档。读不出来（文件坏了、格式变了）一律当空——
     * 存档是本地数据，用户看不到也修不了，为此让客服页打不开是不划算的。
     */
    suspend fun load(): List<StoredConversation> = withContext(Dispatchers.IO) {
        val raw = runCatching { if (file.exists()) file.readText() else null }.getOrNull()
        Conversations.decode(raw)
    }

    /**
     * 写存档。
     *
     * **先写临时文件再改名**：直接覆写的话，写到一半掉电/被杀就是一个
     * 半截 JSON——用户下次打开整段历史都没了。改名在同一文件系统内是原子的。
     */
    suspend fun save(list: List<StoredConversation>) = withContext(Dispatchers.IO) {
        val pruned = Conversations.prune(list)
        runCatching {
            val tmp = File(file.parentFile, "${file.name}.tmp")
            tmp.writeText(Conversations.encode(pruned))
            if (!tmp.renameTo(file)) {
                // 某些文件系统上 rename 到已存在的目标会失败，退一步先删再改
                file.delete()
                tmp.renameTo(file)
            }
        }
        // 写失败（磁盘满、权限）不该把界面搞崩：这一次的对话留在内存里，
        // 用户还能继续聊，只是下次打开看不到。
    }
}
