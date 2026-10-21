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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
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
) {
    Column(Modifier.background(Tokens.Surface)) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                // Icons.Chevron 是右箭头；返回键与设计稿一致旋转 180° 变左箭头
                Icon(
                    Icons.Chevron,
                    contentDescription = "返回",
                    tint = Tokens.Ink2,
                    modifier = Modifier
                        .size(20.dp)
                        .rotate(180f)
                        .clickable { onBack() },
                )
                Spacer(Modifier.size(8.dp))
            }
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            if (action != null && onAction != null) {
                Spacer(Modifier.weight(1f))
                Text(
                    action,
                    fontSize = 12.5.sp,
                    color = Tokens.Ink2,
                    modifier = Modifier.clickable { onAction() },
                )
            }
        }
        Hairline()
    }
}

/** 一级 tab 页的标题栏（无返回）。 */
@Composable
fun TabBar(title: String) {
    Column(Modifier.background(Tokens.Surface)) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
        }
        Hairline()
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(Tokens.CardRadius.dp))
            .background(Tokens.Primary)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .height(40.dp)
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

/** 分段控件：等宽，选中项白底加粗。 */
@Composable
fun SegTabs(items: List<String>, selected: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Tokens.FieldRadius.dp))
            .background(Tokens.Surface)
            .border(1.dp, Tokens.Border, RoundedCornerShape(Tokens.FieldRadius.dp))
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        items.forEachIndexed { index, label ->
            Box(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (index == selected) Tokens.SurfaceWarm else Color.Transparent)
                    .clickable { onSelect(index) }
                    .padding(vertical = 8.dp),
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
        Text(label, fontSize = 12.5.sp, color = Tokens.Muted)
        Text(value, fontSize = 12.5.sp, color = valueColor, fontWeight = FontWeight.Medium)
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
            Text(label, fontSize = 13.sp, color = Tokens.Ink)
            if (subtitle != null) {
                Spacer(Modifier.height(3.dp))
                Text(subtitle, fontSize = 10.5.sp, color = Tokens.Muted)
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
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Tokens.SurfaceWarm),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(16.dp))
        }
        Spacer(Modifier.size(12.dp))
        Text(
            label,
            fontSize = 13.5.sp,
            color = if (danger) Tokens.Coral else Tokens.Ink,
            modifier = Modifier.weight(1f),
        )
        if (value != null) Text(value, fontSize = 12.sp, color = Tokens.Muted)
        Spacer(Modifier.size(6.dp))
        Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(13.dp))
    }
}

/** 二级页骨架：顶部栏 + 可滚动内容。 */
@Composable
fun PushScreen(
    title: String,
    onBack: () -> Unit,
    action: String? = null,
    onAction: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Tokens.Page)) {
        TopBar(title, onBack, action, onAction)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 16.dp),
            content = content,
        )
    }
}

/** 表单页骨架：顶部返回栏 + 可滚动字段 + **贴底**主按钮（截图里 11/12/13 都是这样）。 */
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
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 14.dp, vertical = 12.dp),
            content = content,
        )
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
        ) {
            PrimaryButton(actionLabel, onAction)
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
        Text(label, fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 6.dp, start = 2.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .weight(1f)
                    .height(46.dp)
                    .clip(CircleShape)
                    .background(Tokens.Surface)
                    .border(1.dp, Tokens.Border, CircleShape)
                    .padding(horizontal = 16.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                androidx.compose.foundation.text.BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(
                        fontSize = 14.sp,
                        color = Tokens.Ink,
                    ),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(Tokens.Accent),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                        keyboardType = keyboardType,
                        imeAction = androidx.compose.ui.text.input.ImeAction.Next,
                    ),
                    visualTransformation = if (password) {
                        androidx.compose.ui.text.input.PasswordVisualTransformation()
                    } else {
                        androidx.compose.ui.text.input.VisualTransformation.None
                    },
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        if (value.isEmpty() && placeholder.isNotEmpty()) {
                            Text(placeholder, fontSize = 14.sp, color = Tokens.Muted)
                        }
                        inner()
                    },
                )
            }
            if (trailing != null) {
                Spacer(Modifier.size(8.dp))
                trailing()
            }
        }
    }
}
