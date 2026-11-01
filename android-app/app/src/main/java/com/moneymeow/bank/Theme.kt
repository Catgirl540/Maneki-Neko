package com.moneymeow.bank

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * 设计 token 与 `docs/design/drafts/2026-10-20-mobile-framework.html` 同一套：
 * 浅色纸面、发丝线、低圆角，紫色只作强调。
 */
object Tokens {
    val Page = Color(0xFFF5F6FA)
    val Surface = Color(0xFFFFFFFF)
    val SurfaceWarm = Color(0xFFF6F9FC)
    val Border = Color(0xFFE5EDF5)
    val BorderStrong = Color(0xFFCDD8E5)
    val Ink = Color(0xFF061B31)
    val Ink2 = Color(0xFF4E6078)
    val Muted = Color(0xFF64748D)
    val Accent = Color(0xFF533AFD)
    val AccentDeep = Color(0xFF4434D4)
    val AccentWash = Color(0xFFEAE7FF)
    val Primary = Color(0xFF101826)
    val Coral = Color(0xFFD92159)

    val CardRadius = 16
    val FieldRadius = 12

    /**
     * 常用文字样式：字号 + 颜色成对出现的地方不再逐处重写。
     *
     * 只收高频且含义固定的组合；标题、金额、按钮文字各有专门组件或样式，
     * 需要单独字重时仍可另传 `fontWeight`（会覆盖样式里的值）。
     */
    object Text {
        /** 卡片/字段的补充说明（11sp 灰）。 */
        val hint = TextStyle(fontSize = 11.sp, color = Muted)

        /** 列表次级说明（12sp 灰）。 */
        val note = TextStyle(fontSize = 12.sp, color = Muted)

        /** 最小号说明（10.5sp 灰）。 */
        val caption = TextStyle(fontSize = 10.5.sp, color = Muted)

        /** 正文（13sp 主色）。 */
        val body = TextStyle(fontSize = 13.sp, color = Ink)

        /** 正文次级色（13sp）。 */
        val bodyMuted = TextStyle(fontSize = 13.sp, color = Ink2)

        /** 错误/风险文字（12sp 珊瑚）。 */
        val error = TextStyle(fontSize = 12.sp, color = Coral)
    }

    /** 间距刻度：页面与卡片内部留白只从这里取整数 dp。 */
    object Space {
        const val xs = 4
        const val sm = 8
        const val md = 12
        const val lg = 16
        const val xl = 24
    }
}

private val scheme = lightColorScheme(
    primary = Tokens.Primary,
    onPrimary = Color.White,
    secondary = Tokens.Accent,
    background = Tokens.Page,
    onBackground = Tokens.Ink,
    surface = Tokens.Surface,
    onSurface = Tokens.Ink,
    outline = Tokens.Border,
)

private val typography = Typography(
    bodyLarge = TextStyle(fontSize = 14.sp, color = Tokens.Ink),
    bodyMedium = TextStyle(fontSize = 13.sp, color = Tokens.Ink2),
    bodySmall = TextStyle(fontSize = 11.sp, color = Tokens.Muted),
    titleLarge = TextStyle(fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink),
    labelSmall = TextStyle(fontSize = 10.sp, color = Tokens.Muted),
)

@Composable
fun MoneyMeowTheme(content: @Composable () -> Unit) {
    // 目前只有浅色稿；深色留到后续设计确认后再做。
    isSystemInDarkTheme()
    MaterialTheme(colorScheme = scheme, typography = typography, content = content)
}
