package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.FocusManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.window.DialogProperties

/**
 * 自绘数字键盘（不调系统输入法）。
 *
 * 依据用户给的参考样式：顶部标题 + 右侧「完成」，下方 3×4 数字九宫格，
 * 左下角功能键、右下角退格。所有按键都是 Compose 自绘，全程不经过系统 IME，
 * 因此不受第三方输入法（搜狗/百度/荣耀）皮肤、联想、云同步和数字键盘版本差异影响。
 *
 * 键位：
 * - `shuffle = true`：数字键每次打开重新洗牌，用于支付密码（防肩窥/录屏）；
 * - `shuffle = false`：金额、账号等按标准 1-9 排列，降低误按。
 */
@Composable
fun SecureNumberPadDialog(
    title: String,
    value: String,
    onValueChange: (String) -> Unit,
    onDismiss: () -> Unit,
    subtitle: String? = null,
    maxLength: Int = 6,
    masked: Boolean = true,
    allowDecimal: Boolean = false,
    decimalPlaces: Int = 2,
    shuffle: Boolean = true,
) {
    var digits by remember { mutableStateOf(value.take(maxLength)) }

    // 金额类输入统一在键盘内部规整（小数点、两位小数、前导零），
    // 调用方拿到的一定是合法值，不会因为漏调 decimalInput 而出现 1.8899。
    fun emit(raw: String) {
        val next = if (allowDecimal) decimalInput(digits, raw, maxLength, decimalPlaces) else raw.take(maxLength)
        digits = next
        onValueChange(next)
    }

    // 支付密码每次重新洗牌；金额/账号按标准布局。
    val layout = remember(shuffle) { if (shuffle) (1..9).toList().shuffled() else (1..9).toList() }

    // 不要系统默认的暗色蒙层：普通输入法弹出时页面也不变暗。
    // 用 dimAmount = 0 保住"点上方空白收起键盘"的行为，但视觉上仍是原页面。
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        // 关掉弹窗的暗色蒙层：Dialog 默认会把背后的页面压暗，
        // 普通输入法不会这样，这里按输入法的观感处理。
        val view = LocalView.current
        DisposableEffect(view) {
            val dialogWindow = (view.parent as? DialogWindowProvider)?.window
            dialogWindow?.setDimAmount(0f)
            if (dialogWindow != null) {
                dialogWindow.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            }
            onDispose {}
        }
        // 铺满整屏：上方透明区域接收点击（点在空白处等于取消），下方是键盘面板。
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Transparent)
                .secureWindow()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss,
                ),
        ) {
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
                    .background(Tokens.Surface)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                    .navigationBarsPadding()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                PadHeader(title, subtitle, onDone = onDismiss)
                Spacer(Modifier.height(12.dp))
                if (masked) {
                    PinDots(digits.length, maxLength)
                    Spacer(Modifier.height(14.dp))
                }
                NumberPad(
                    layout = layout,
                    allowDecimal = allowDecimal,
                    onDigit = { digit -> if (digits.length < maxLength) emit(digits + digit) },
                    onDot = { emit("$digits.") },
                    onBackspace = { if (digits.isNotEmpty()) emit(digits.dropLast(1)) },
                    onClear = { emit("") },
                )
            }
        }
    }
}

/**
 * 金额类输入的规整：只保留数字与一个小数点，前导零不堆积，小数位不超过 `places`。
 *
 * 调用方把自己的「新值」交进来（例如 `current + digit` 或 `current + "."`），
 * 这里统一清理后再回写，避免各处各写一套正则。
 */
fun decimalInput(
    current: String,
    next: String,
    maxLength: Int = 16,
    places: Int = 2,
): String {
    val filtered = next.filter { it.isDigit() || it == '.' }
    if (filtered.isEmpty()) return ""
    // 多个小数点：无效输入，保持原值。
    if (filtered.count { it == '.' } > 1) return current
    val hasDot = filtered.contains('.')
    val head = filtered.substringBefore('.').trimStart('0')
    val rest = if (hasDot) filtered.substringAfter('.').take(places) else ""
    val normalized = when {
        hasDot && head.isEmpty() -> "0.$rest"
        hasDot -> "$head.$rest"
        head.isEmpty() -> "0"
        else -> head
    }
    return normalized.take(maxLength)
}

/** 「安全输入」标题栏：左侧盾牌图标 + 文案，右侧蓝色「完成」。 */
@Composable
private fun PadHeader(title: String, subtitle: String?, onDone: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(20.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Tokens.AccentWash),
            contentAlignment = Alignment.Center,
        ) {
            Text("✓", fontSize = 11.sp, color = Tokens.Accent, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(7.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            if (subtitle != null) {
                Text(subtitle, fontSize = 10.5.sp, color = Tokens.Muted, lineHeight = 14.sp)
            }
        }
        Text(
            "完成",
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            color = Tokens.Accent,
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable { onDone() }
                .padding(horizontal = 10.dp, vertical = 6.dp)
                .semantics { contentDescription = "完成" },
        )
    }
}

/** 密码输入进度：不足位数显示空心占位，已输入显示实心圆点。 */
@Composable
private fun PinDots(count: Int, maxLength: Int) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(maxLength) { index ->
            val filled = index < count
            Box(
                Modifier
                    .padding(horizontal = 5.dp)
                    .size(11.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (filled) Tokens.Ink else Color.Transparent)
                    .border(1.dp, if (filled) Tokens.Ink else Tokens.BorderStrong, RoundedCornerShape(6.dp)),
            )
        }
    }
}

/** 3×4 九宫格：1-9 按 `layout` 铺三行，末行 清空 / 0 或小数点 / 退格。 */
@Composable
private fun NumberPad(
    layout: List<Int>,
    allowDecimal: Boolean,
    onDigit: (Int) -> Unit,
    onDot: () -> Unit,
    onBackspace: () -> Unit,
    onClear: () -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        layout.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                row.forEach { digit ->
                    PadKey(label = digit.toString(), modifier = Modifier.weight(1f), onClick = { onDigit(digit) })
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            PadKey(label = "清空", modifier = Modifier.weight(1f), muted = true, onClick = onClear)
            if (allowDecimal) {
                PadKey(label = ".", modifier = Modifier.weight(1f), onClick = onDot)
            } else {
                PadKey(label = "0", modifier = Modifier.weight(1f), onClick = { onDigit(0) })
            }
            PadKey(label = "⌫", modifier = Modifier.weight(1f), muted = true, onClick = onBackspace)
        }
    }
}

/** 单个按键：暖白底、发丝边、低圆角；功能键用小号字。 */
@Composable
private fun PadKey(
    label: String,
    modifier: Modifier = Modifier,
    muted: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .height(54.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFFF2F4F7))
            .clickable { onClick() }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontSize = when {
                muted -> 15.sp
                label == "." -> 24.sp
                else -> 26.sp
            },
            fontWeight = if (muted) FontWeight.Normal else FontWeight.Medium,
            color = if (muted) Tokens.Ink2 else Tokens.Ink,
            textAlign = TextAlign.Center,
        )
    }
}

/** 数字输入框的统一外观：暖白底 + 发丝边，与设计稿字段一致。 */
@Composable
private fun PadFieldBox(
    enabled: Boolean,
    onClick: () -> Unit,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(Tokens.FieldRadius.dp))
            .background(Tokens.SurfaceWarm)
            .border(1.dp, Tokens.Border, RoundedCornerShape(Tokens.FieldRadius.dp))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/**
 * 支付密码输入框：掩码展示，点击弹自绘键盘，**不**唤起系统输入法。
 */
@Composable
fun SecurePinField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "请输入 6 位数字密码",
    enabled: Boolean = true,
) {
    var open by remember { mutableStateOf(false) }
    val focus: FocusManager = LocalFocusManager.current
    Column {
        Text(label, fontSize = 12.sp, color = Tokens.Ink2)
        Spacer(Modifier.height(6.dp))
        PadFieldBox(enabled, onClick = { focus.clearFocus(); open = true }) {
            Text(
                if (value.isEmpty()) placeholder else value.map { "●" }.joinToString(""),
                fontSize = 14.sp,
                color = if (value.isEmpty()) Tokens.Muted else Tokens.Ink,
                modifier = Modifier.weight(1f),
            )
            Text("安全键盘", fontSize = 11.sp, color = Tokens.Ink2)
        }
        if (open && enabled) {
            SecureNumberPadDialog(
                title = label,
                subtitle = "安全输入",
                value = value,
                maxLength = 6,
                masked = true,
                allowDecimal = false,
                shuffle = true,
                onValueChange = onValueChange,
                onDismiss = { open = false },
            )
        }
    }
}

/**
 * 数字输入框（金额、账号、验证码、日期等）：点击弹自绘数字键盘。
 *
 * - `allowDecimal = true` 时末行放小数点，按 `decimalPlaces` 限制小数位；
 * - 值一律先经 [decimalInput] 规整，调用方不用再自己写过滤正则。
 */
@Composable
fun SecureNumberField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "",
    maxLength: Int = 16,
    allowDecimal: Boolean = false,
    decimalPlaces: Int = 2,
    enabled: Boolean = true,
    suffix: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    var open by remember { mutableStateOf(false) }
    // 点开数字键盘前先让别的输入框失焦：否则系统焦点环会停在上一处，看起来像没切换。
    val focus: FocusManager = LocalFocusManager.current
    Column {
        Text(label, fontSize = 12.sp, color = Tokens.Ink2)
        Spacer(Modifier.height(6.dp))
        PadFieldBox(enabled, onClick = { focus.clearFocus(); open = true }) {
            Text(
                value.ifEmpty { placeholder },
                fontSize = 14.sp,
                color = if (value.isEmpty()) Tokens.Muted else Tokens.Ink,
                modifier = Modifier.weight(1f),
            )
            if (suffix != null) Text(suffix, fontSize = 11.sp, color = Tokens.Ink2)
            if (trailing != null) trailing()
        }
        if (open && enabled) {
            SecureNumberPadDialog(
                title = label,
                value = value,
                maxLength = maxLength,
                masked = false,
                allowDecimal = allowDecimal,
                decimalPlaces = decimalPlaces,
                shuffle = false,
                onValueChange = onValueChange,
                onDismiss = { open = false },
            )
        }
    }
}
