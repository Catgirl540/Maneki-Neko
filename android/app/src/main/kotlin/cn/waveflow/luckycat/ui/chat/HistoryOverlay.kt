package cn.waveflow.luckycat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.domain.conversation.Conversations
import cn.waveflow.luckycat.domain.conversation.StoredConversation
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 历史对话列表。
 *
 * 用**自己画的覆盖层**而不是 `ModalBottomSheet`：后者的 API 还带
 * `@ExperimentalMaterial3Api`，而这里要的东西（一层遮罩 + 一个列表）
 * 自己写反而更短，也不用跟着实验 API 的签名变。
 *
 * 列表里**空对话不显示**（`pruneEmpty` 已经在存档层做过一次，
 * 这里再过滤一次是因为当前这段可能就是空的——它正开着，但列进历史没有意义）。
 */
@Composable
fun HistoryOverlay(
    conversations: List<StoredConversation>,
    currentId: String?,
    onPick: (String) -> Unit,
    onClose: () -> Unit,
) {
    val visible = conversations.filter { !Conversations.isEmpty(it) }
    val now = System.currentTimeMillis()

    Column(modifier = Modifier.fillMaxSize().testTag("history-overlay")) {
        // 遮罩：点空白处关掉。用一层可点的 Box 顶住，而不是拦返回键——
        // 返回键那条路由由 AppShell 管，这里不该抢。
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0x66000000))
                .clickable(onClick = onClose)
                .padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "历史对话（${visible.size}）",
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
            )
            TextButton(onClick = onClose, modifier = Modifier.testTag("history-close")) {
                Text("关闭", color = Color.White)
            }
        }

        if (visible.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxWidth().background(Palette.canvas).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "还没有别的对话",
                    color = Palette.inkSoft,
                    modifier = Modifier.testTag("history-empty"),
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxWidth().background(Palette.canvas).testTag("history-list"),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(visible, key = { it.id }) { conversation ->
                    HistoryRow(
                        conversation = conversation,
                        isCurrent = conversation.id == currentId,
                        subtitle = "${Conversations.messageCount(conversation)} 条 · " +
                            Conversations.relativeTime(conversation.updatedAt, now, compact = true),
                        onClick = { onPick(conversation.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryRow(
    conversation: StoredConversation,
    isCurrent: Boolean,
    subtitle: String,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (isCurrent) Palette.accentSoft else Palette.surface)
            .clickable(onClick = onClick)
            .padding(14.dp)
            .testTag("history-${conversation.id}"),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(conversation.title, style = MaterialTheme.typography.bodyLarge)
        Text(
            if (isCurrent) "当前对话 · $subtitle" else subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkMute,
        )
    }
}
