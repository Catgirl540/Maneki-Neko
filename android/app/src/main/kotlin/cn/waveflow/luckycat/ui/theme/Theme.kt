package cn.waveflow.luckycat.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape

/**
 * 品牌色。**取值逐个照抄 `app/src/styles/tokens.css`**——
 * 同一个品牌在两个客户端上是两种颜色，一眼就能看出来不对。
 *
 * 参考的那套 ZA 风格只借了**结构与排版**（悬浮药丸底栏、圆形图标宫格、
 * 超粗大标题、大圆角），**颜色仍用我们自己的金 + 米白**。
 *
 * ## 为什么 `accent` 与 `accentDeep` 是两个色
 *
 * `tokens.css` 上写得很清楚：`--color-gold-deep` 的用途是"文字与 hover，
 * 保证 AA 对比度"。浅底上的正文用 `#C8973C` 是过不了对比度的，
 * 所以**实心填充用 `accent`、文字用 `accentDeep`**，两者不能混。
 */
private val Canvas = Color(0xFFF7F5F0)
private val Surface = Color(0xFFFFFFFF)
private val Sunk = Color(0xFFFBFAF6)
private val Line = Color(0xFFEAE6DC)
private val LineStrong = Color(0xFFDDD7C9)
private val Ink = Color(0xFF0E1B26)
private val InkSoft = Color(0xFF5C6B77)
private val InkMute = Color(0xFF93A0A9)

/** 主色（金）。**实心填充**用它。 */
private val Accent = Color(0xFFC8973C)

/** 深金。**浅底上的文字**用它——tokens.css 里写明"保证 AA 对比度"。 */
private val AccentDeep = Color(0xFF9C7226)

/** 选中底 / 导航 active。 */
private val AccentSoft = Color(0xFFF0E4CB)

/** 图标底 / 极浅填充。 */
private val AccentTint = Color(0xFFFAF5EA)

/** 金够深，白字压得住。 */
private val OnAccent = Color(0xFFFFFFFF)

private val Income = Color(0xFF3C6DC8)
private val Coral = Color(0xFFD65B45)

/** 促销底：品牌色板里没有独立的黄，用最浅的那档金。 */
private val Promo = Color(0xFFF0E4CB)

/**
 * 界面里要用的、Material 配色方案里没有对应位的颜色。
 *
 * 命名按**用途**而不是按颜色（`accent` 而不是 `green`）——
 * 换配色的时候调用点不用动。
 */
object Palette {
    val canvas = Canvas
    val surface = Surface
    val sunk = Sunk
    val line = Line

    val ink = Ink
    val inkSoft = InkSoft
    val inkMute = InkMute

    val accent = Accent
    val accentDeep = AccentDeep
    val accentSoft = AccentSoft
    val accentTint = AccentTint
    val onAccent = OnAccent
    val lineStrong = LineStrong

    /** 进账用蓝、出账用珊瑚红。与网页版的涨跌口径一致。 */
    val income = Income
    val expense = Coral

    val promo = Promo

    /** 悬浮底栏：白药丸 + 灰图标，选中态是实心金圆。 */
    val navPill = Surface
    val navInactive = InkMute
    val navShadow = Color(0x1A11161B)
}

private val LuckyColorScheme = lightColorScheme(
    primary = Accent,
    onPrimary = OnAccent,
    primaryContainer = AccentTint,
    onPrimaryContainer = AccentDeep,
    secondary = AccentDeep,
    onSecondary = OnAccent,
    background = Canvas,
    onBackground = Ink,
    surface = Surface,
    onSurface = Ink,
    surfaceVariant = Sunk,
    onSurfaceVariant = InkSoft,
    outline = Line,
    outlineVariant = Line,
    error = Coral,
    onError = Color.White,
)

/**
 * 字重**整体比 Material 默认重一档、字号大一号**。
 * 截图里「买卖股票帮你省更多」那种超粗大标题是这套风格的骨架，
 * 不把标题压上去，光换颜色只会像"换了个主题色"。
 */
private val LuckyTypography = Typography(
    headlineMedium = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.Bold, lineHeight = 36.sp),
    headlineSmall = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp),
    titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold, lineHeight = 28.sp),
    titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold, lineHeight = 24.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
)

/**
 * 圆角整体放大：卡片 24、按钮**全圆**（药丸）。
 * 参考的那套风格里按钮是整条药丸，不是圆角矩形——写成 16dp 会立刻不像。
 */
private val LuckyShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/**
 * 应用主题。
 *
 * **只做浅色，而且是有意的**：深色下金额层级、涨跌红绿、卡片阴影都要重新
 * 设计一遍，随手反色出来的深色比没有更糟。
 */
@Composable
fun LuckyCatTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LuckyColorScheme,
        typography = LuckyTypography,
        shapes = LuckyShapes,
        content = content,
    )
}
