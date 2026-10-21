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
    val Page = Color(0xFFF5F7FF)
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

    val CardRadius = 10
    val FieldRadius = 8
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
