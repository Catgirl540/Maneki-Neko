package com.moneymeow.bank

import android.app.Activity
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView

/**
 * 把承载当前组合的窗口设为安全窗口（`FLAG_SECURE`）：禁止截屏与录屏。
 *
 * 用于密码类页面/弹层：`Dialog` 与 `DialogFragment` 走的是自己独立的 Window，
 * 所以必须按「所在窗口」加，而不是按 Activity 加。
 */
@Composable
fun Modifier.secureWindow(): Modifier {
    val view = LocalView.current
    DisposableEffect(view) {
        val window: Window? = (view.parent as? Window) ?: view.context.findActivity()?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
    return this
}

private tailrec fun android.content.Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is android.content.ContextWrapper -> baseContext.findActivity()
    else -> null
}

/**
 * 在密码类页面开启 `FLAG_SECURE`：禁止截屏与录屏，密码页不该被截屏工具或录屏拿到明文。
 *
 * 只在密码相关页面调用，离开即撤销，不会影响其他页面截屏。
 */
@Composable
fun SecureWindow() {
    val context = LocalContext.current
    DisposableEffect(context) {
        val window = context.findActivity()?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose {
            window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
