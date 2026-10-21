package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * 应用内更新：
 *  - [UpdatePromptHost] 启动时自动检查一次，有新版本弹窗
 *  - [UpdateRow] 供「关于」页显示当前版本并手动检查
 *  - [UpdateDialog] 两处共用的下载/安装弹窗
 */
@Composable
fun UpdatePromptHost() {
    val context = LocalContext.current
    var info by remember { mutableStateOf<UpdateApi.Info?>(null) }

    LaunchedEffect(Unit) {
        runCatching { UpdateApi.check(context, BuildConfig.VERSION_CODE) }
            .onSuccess { info = it }
    }

    info?.let { current ->
        UpdateDialog(current) { info = null }
    }
}

/** 手动检查入口（「关于」页一行）。 */
@Composable
fun UpdateRow() {
    val context = LocalContext.current
    var info by remember { mutableStateOf<UpdateApi.Info?>(null) }
    var checking by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("当前版本", fontSize = 12.5.sp, color = Tokens.Muted, modifier = Modifier.weight(1f))
            Text(
                "${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）",
                fontSize = 12.5.sp,
                color = Tokens.Ink,
            )
        }
        Hairline()
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(enabled = !checking) {
                    checking = true
                    message = null
                    scope.launch {
                        runCatching { UpdateApi.check(context, BuildConfig.VERSION_CODE) }
                            .onSuccess {
                                info = it
                                message = if (it == null) "已是最新版本" else null
                            }
                            .onFailure { message = it.message }
                        checking = false
                    }
                }
                .padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("检查更新", fontSize = 12.5.sp, color = Tokens.Muted, modifier = Modifier.weight(1f))
            Text(
                when {
                    checking -> "检查中…"
                    message != null -> message!!
                    info != null -> "有新版本"
                    else -> "›"
                },
                fontSize = 12.5.sp,
                color = if (info != null) Tokens.Primary else Tokens.Ink,
            )
        }
    }

    info?.let { current ->
        UpdateDialog(current) { info = null }
    }
}

@Composable
fun UpdateDialog(info: UpdateApi.Info, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var progress by remember { mutableFloatStateOf(0f) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        containerColor = Tokens.Surface,
        title = {
            Text(
                "发现新版本 ${info.versionName}",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Ink,
            )
        },
        text = {
            Column {
                Text(
                    info.notes.ifEmpty { "例行更新" },
                    fontSize = 13.sp,
                    color = Tokens.Ink2,
                    lineHeight = 20.sp,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "当前 ${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）· 最新 ${info.versionCode}",
                    fontSize = 11.5.sp,
                    color = Tokens.Muted,
                )
                if (busy) {
                    Spacer(Modifier.height(12.dp))
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(Tokens.Border)
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(progress.coerceIn(0f, 1f))
                                .height(4.dp)
                                .background(Tokens.Primary)
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Text("正在下载 ${(progress * 100).toInt()}%", fontSize = 11.sp, color = Tokens.Muted)
                }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error!!, fontSize = 11.5.sp, color = Tokens.Coral)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy,
                onClick = {
                    error = null
                    busy = true
                    progress = 0f
                    scope.launch {
                        runCatching { UpdateApi.download(context, info) { progress = it } }
                            .onSuccess { apk ->
                                busy = false
                                onDismiss()
                                UpdateApi.install(context, apk)
                            }
                            .onFailure {
                                error = it.message ?: "下载失败"
                                busy = false
                            }
                    }
                },
            ) {
                Text(if (busy) "下载中…" else "下载并安装", color = Tokens.Primary)
            }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = onDismiss) {
                Text("稍后", color = Tokens.Ink2)
            }
        },
    )
}
