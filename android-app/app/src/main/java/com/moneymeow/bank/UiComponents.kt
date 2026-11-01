package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Shared 48dp action target; a busy action remains discoverable to accessibility. */
@Composable
fun ActionIcon(
    icon: ImageVector,
    label: String,
    enabled: Boolean = true,
    busy: Boolean = false,
    onClick: () -> Unit,
) {
    IconButton(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = Modifier.size(48.dp).semantics { contentDescription = label },
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Tokens.Ink2, strokeWidth = 2.dp)
        else Icon(icon, contentDescription = null, tint = if (enabled) Tokens.Ink2 else Tokens.Muted, modifier = Modifier.size(21.dp))
    }
}

@Composable
fun FormCard(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    HairlineCard(modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                if (!subtitle.isNullOrBlank()) Text(subtitle, fontSize = 12.sp, lineHeight = 18.sp, color = Tokens.Muted)
            }
            content()
        }
    }
}

/**
 * 卡片里的入口行：图标 + 标题（可选说明）+ 可选右箭头。
 *
 * 转出页、预算/储蓄/更多等二级入口都用它，图标直接放在卡面上、不加底色方块。
 */
@Composable
fun EntryRow(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit,
    summary: String? = null,
    /** 右侧附带的值（如手机号、张数）；为空则不占位。 */
    value: String? = null,
    chevron: Boolean = true,
    enabled: Boolean = true,
) {
    HairlineCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = 14.dp, vertical = if (summary == null) 16.dp else 15.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(icon, null, tint = Tokens.Ink2, modifier = Modifier.size(22.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Tokens.Ink)
                if (summary != null) {
                    Text(summary, fontSize = 11.sp, lineHeight = 16.sp, color = Tokens.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            if (value != null) Text(value, style = Tokens.Text.note)
            if (chevron) Icon(Icons.Chevron, null, tint = Tokens.Muted, modifier = Modifier.size(18.dp))
        }
    }
}

/** 页面内容列：统一左右 14dp 留白与 10dp 行距，二级页正文都用它。 */
@Composable
fun PageColumn(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

/** 页面里的错误提示行：统一的珊瑚色与字号，避免各页自己写 Text 样式。 */
@Composable
fun ErrorNote(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier, color = Tokens.Coral, fontSize = 12.sp, lineHeight = 17.sp)
}

@Composable
@Suppress("ModifierParameter")
fun BankEmptyState(
    title: String,
    description: String,
    icon: ImageVector = Icons.Receipt,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 30.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(18.dp)).background(Tokens.SurfaceWarm), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Tokens.Muted, modifier = Modifier.size(27.dp))
        }
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
        Text(description, fontSize = 12.sp, lineHeight = 18.sp, color = Tokens.Muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (actionLabel != null && onAction != null) TextButton(onClick = onAction) { Text(actionLabel, color = Tokens.AccentDeep) }
    }
}
