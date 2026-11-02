package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.IconButton
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 二级页顶部栏：返回 + 标题 + 可选右侧动作。 */
@Composable
fun TopBar(
    title: String,
    onBack: (() -> Unit)? = null,
    action: String? = null,
    onAction: (() -> Unit)? = null,
    actionContent: (@Composable () -> Unit)? = null,
) {
    Column(Modifier.background(Tokens.Surface)) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(60.dp)
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Chevron, "返回", tint = Tokens.Ink2, modifier = Modifier.size(22.dp).rotate(180f))
                }
            }
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink,
                modifier = Modifier.weight(1f).padding(start = if (onBack == null) 8.dp else 2.dp),
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (actionContent != null) {
                actionContent()
            } else if (action != null && onAction != null) {
                if (action == "刷新") ActionIcon(Icons.Refresh, action, onClick = onAction)
                else TextButton(onClick = onAction) { Text(action, style = Tokens.Text.bodyMuted) }
            }
        }
        Hairline()
    }
}

/** 一级 tab 页的标题栏（无返回）。 */
@Composable
fun TabBar(title: String, onRefresh: (() -> Unit)? = null, refreshing: Boolean = false) {
    Column(Modifier.background(Tokens.Surface)) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
            if (onRefresh != null) ActionIcon(Icons.Refresh, "刷新$title", busy = refreshing, onClick = onRefresh)
        }
        Hairline()
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(Tokens.CardRadius.dp))
            .background(Tokens.Primary)
            .alpha(if (enabled) 1f else 0.45f)
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(Tokens.FieldRadius.dp))
            .background(Tokens.Surface)
            .border(1.dp, Tokens.Border, RoundedCornerShape(Tokens.FieldRadius.dp))
            .clickable { onClick() }
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 12.5.sp, color = Tokens.Ink2)
    }
}

/** 与主按钮等宽等高的次按钮：用于并排的两个操作。 */
@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(Tokens.CardRadius.dp))
            .background(Tokens.Surface)
            .border(1.dp, Tokens.Border, RoundedCornerShape(Tokens.CardRadius.dp))
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Tokens.Ink2)
    }
}

/** 分段控件：等宽，选中项白底加粗。 */
@Composable
fun SegTabs(items: List<String>, selected: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Border.copy(alpha = 0.5f))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items.forEachIndexed { index, label ->
            Box(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (index == selected) Tokens.Surface else Color.Transparent)
                    .clickable { onSelect(index) }
                    .heightIn(min = 44.dp)
                    .padding(horizontal = 4.dp, vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    fontSize = 12.5.sp,
                    color = if (index == selected) Tokens.Ink else Tokens.Muted,
                    fontWeight = if (index == selected) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

/** 横向滚动的分类 chips，末尾可挂一个筛选按钮。 */
@Composable
fun ChipRow(
    items: List<String>,
    selected: Int,
    trailing: (@Composable () -> Unit)? = null,
    onSelect: (Int) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .weight(1f)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items.forEachIndexed { index, label ->
                Box(
                    Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (index == selected) Tokens.Primary else Tokens.Surface)
                        .border(
                            1.dp,
                            if (index == selected) Tokens.Primary else Tokens.Border,
                            RoundedCornerShape(14.dp),
                        )
                        .clickable { onSelect(index) }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Text(
                        label,
                        fontSize = 12.sp,
                        color = if (index == selected) Color.White else Tokens.Ink2,
                    )
                }
            }
        }
        if (trailing != null) {
            Spacer(Modifier.size(8.dp))
            trailing()
        }
    }
}

/** 键值行：左侧标签、右侧值。 */
@Composable
fun KvRow(label: String, value: String, valueColor: Color = Tokens.Ink) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 12.5.sp, color = Tokens.Muted, modifier = Modifier.weight(0.38f))
        Spacer(Modifier.size(12.dp))
        Text(value, fontSize = 12.5.sp, color = valueColor, fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(0.62f), textAlign = androidx.compose.ui.text.style.TextAlign.End)
    }
}

@Composable
fun KvCard(rows: List<Pair<String, String>>, modifier: Modifier = Modifier) {
    HairlineCard(modifier) {
        Column(Modifier.padding(horizontal = 14.dp)) {
            rows.forEachIndexed { index, (label, value) ->
                if (index > 0) Hairline()
                KvRow(label, value)
            }
        }
    }
}

/** 设置开关行（自绘 switch，保持近黑配色）。 */
@Composable
fun SwitchRow(
    label: String,
    checked: Boolean,
    subtitle: String? = null,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onChange(!checked) }
            .padding(horizontal = 14.dp, vertical = 13.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = Tokens.Text.body)
            if (subtitle != null) {
                Spacer(Modifier.height(3.dp))
                Text(subtitle, style = Tokens.Text.caption)
            }
        }
        val trackColor by androidx.compose.animation.animateColorAsState(
            targetValue = if (checked) Tokens.Primary else Color(0xFFDFE6EE),
            animationSpec = androidx.compose.animation.core.tween(200, easing = StandardOutSlowIn),
            label = "sw-bg",
        )
        val thumbStart by androidx.compose.animation.core.animateDpAsState(
            targetValue = if (checked) 20.dp else 2.dp,
            animationSpec = androidx.compose.animation.core.tween(200, easing = StandardOutSlowIn),
            label = "sw-thumb",
        )
        Box(
            Modifier
                .size(width = 42.dp, height = 24.dp)
                .clip(CircleShape)
                .background(trackColor),
        ) {
            Box(
                Modifier
                    .padding(top = 2.dp, start = thumbStart)
                    .size(20.dp)
                    .clip(CircleShape)
                    .background(Color.White)
            )
        }
    }
}

/** 图标 + 文案的行（我的、更多服务等列表）。 */
@Composable
fun IconRow(
    icon: ImageVector,
    label: String,
    value: String? = null,
    danger: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)
            .padding(horizontal = 14.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.bolder(icon),
            contentDescription = null,
            tint = Tokens.Ink2,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.size(14.dp))
        Text(
            label,
            fontSize = 13.5.sp,
            color = if (danger) Tokens.Coral else Tokens.Ink,
            modifier = Modifier.weight(1f),
        )
        if (value != null) Text(value, style = Tokens.Text.note)
        Spacer(Modifier.size(6.dp))
        Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(13.dp))
    }
}

/** 成功提示：像通知一样出现，2.4 秒后自动消失，不占页面版面。 */
@Composable
fun BankToast(text: String, onDismiss: () -> Unit) {
    LaunchedEffect(text) {
        kotlinx.coroutines.delay(2400)
        onDismiss()
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Tokens.Primary)
            .clickable(onClick = onDismiss)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(15.dp))
        Spacer(Modifier.size(8.dp))
        Text(text, fontSize = 12.5.sp, color = Color.White)
    }
}

/** 二级页骨架：顶部栏 + 可滚动内容。 */
@Composable
fun PushScreen(
    title: String,
    onBack: () -> Unit,
    action: String? = null,
    onAction: (() -> Unit)? = null,
    refreshing: Boolean = false,
    onRefresh: (() -> Unit)? = null,
    actionContent: (@Composable () -> Unit)? = null,
    bottomContent: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Tokens.Page).imePadding()) {
        val toolbarActions: (@Composable () -> Unit)? = actionContent ?: if (onRefresh != null && action == null) {
            { ActionIcon(Icons.Refresh, "刷新$title", busy = refreshing, onClick = onRefresh) }
        } else null
        TopBar(title, onBack, action, onAction, toolbarActions)
        val body: @Composable () -> Unit = {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(top = 12.dp, bottom = 32.dp),
                content = content,
            )
        }
        // 传入 onRefresh 才有下拉刷新；不传时保持原来的行为。
        if (onRefresh == null) Box(Modifier.weight(1f)) { body() }
        else BankPullRefresh(
            isRefreshing = refreshing,
            onRefresh = onRefresh,
            modifier = Modifier.weight(1f),
        ) { body() }
        if (bottomContent != null) Column(Modifier.fillMaxWidth().background(Tokens.Surface).padding(horizontal = 16.dp, vertical = 12.dp)) { bottomContent() }
    }
}

/** 表单页骨架：顶部返回栏 + 可滚动字段，主按钮紧跟最后一个字段，不贴屏幕底。 */
@Composable
fun FormScaffold(
    title: String,
    onBack: () -> Unit,
    actionLabel: String,
    onAction: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Page),
    ) {
        TopBar(title, onBack)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 16.dp, vertical = 16.dp),
        ) {
            content()
            Spacer(Modifier.height(22.dp))
            PrimaryButton(actionLabel, onAction)
            Spacer(Modifier.height(16.dp))
        }
    }
}

/** 可编辑的单行输入（胶囊样式，与设计稿输入框一致）。 */
@Composable
fun TextFieldRow(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "",
    keyboardType: androidx.compose.ui.text.input.KeyboardType = androidx.compose.ui.text.input.KeyboardType.Text,
    password: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // 关键：不要用外层 Box 自绘边框把输入框包起来。
            // 荣耀/小米这类 ROM 的输入法，只有见到**平台标准输入框**才会切安全键盘；
            // 套一层带 background+border 的容器后仍会被当成普通输入框。
            androidx.compose.material3.OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                modifier = Modifier.weight(1f).semantics { contentDescription = label },
                shape = RoundedCornerShape(Tokens.FieldRadius.dp),
                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp, color = Tokens.Ink),
                label = { Text(label, fontSize = 12.sp) },
                placeholder = if (placeholder.isEmpty()) null else {
                    { Text(placeholder, fontSize = 14.sp) }
                },
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Tokens.SurfaceWarm,
                    unfocusedContainerColor = Tokens.SurfaceWarm,
                    focusedBorderColor = Tokens.Accent,
                    unfocusedBorderColor = Tokens.Border,
                    focusedTextColor = Tokens.Ink,
                    unfocusedTextColor = Tokens.Ink,
                    focusedLabelColor = Tokens.Ink2,
                    unfocusedLabelColor = Tokens.Ink2,
                    cursorColor = Tokens.Accent,
                ),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    keyboardType = keyboardType,
                    imeAction = androidx.compose.ui.text.input.ImeAction.Next,
                ),
                visualTransformation = if (password) {
                    androidx.compose.ui.text.input.PasswordVisualTransformation()
                } else {
                    androidx.compose.ui.text.input.VisualTransformation.None
                },
            )
            if (trailing != null) {
                Spacer(Modifier.size(8.dp))
                trailing()
            }
        }
    }
}
