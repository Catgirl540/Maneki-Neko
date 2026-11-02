package com.moneymeow.bank

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import kotlinx.coroutines.delay
import java.io.File

/**
 * 扫一扫：把对方的「身份码」读进 AA 参与者表。
 *
 * 这里**不申请相机权限**：直接用系统的相机界面拍照（`TakePicture` 走的是相机应用自己的权限，
 * 本应用不需要 `CAMERA`），拍完拿回图片再由本机解码；也可以直接从相册选一张二维码截图。
 * 两条路都只在本机解码，不上传图片。
 */
@Composable
internal fun QrScanScreen(onBack: () -> Unit, onPicked: (SplitIdentity) -> Unit) {
    val context = LocalContext.current
    BackHandler { onBack() }

    var hint by remember { mutableStateOf<String?>(null) }
    var photo by remember { mutableStateOf<Uri?>(null) }
    var result by remember { mutableStateOf<SplitIdentity?>(null) }
    // 提示是一次性的，别让「这张图里没有二维码」一直挂在页面上。
    LaunchedEffect(hint) { if (hint != null) { delay(3600); hint = null } }

    fun accept(uri: Uri) {
        val text = runCatching { decodeFromUri(context, uri) }.getOrNull()
        if (text == null) {
            hint = "这张图里没有识别到二维码，重新拍一张或换一张截图。"
            return
        }
        result = runCatching { MemberQr.parse(text) }.getOrElse {
            hint = it.message ?: "这个二维码不是招财猫的身份码。"
            null
        }
    }

    val capture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = photo
        if (ok && uri != null) accept(uri) else if (!ok) hint = "没有拍照，可以重试或从相册选择。"
    }
    val album = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) accept(uri)
    }

    LaunchedEffect(result) { result?.let(onPicked) }

    PushScreen("扫描身份码", onBack = onBack) {
        FormCard("把对方的身份码读进来", subtitle = "只在本机识别，图片不会上传。") {
            Text(
                "对方在「发起 AA 收款 → 参与者身份 → 我的身份码」里出示二维码，拍下来或存成截图都可以。",
                fontSize = 12.sp,
                lineHeight = 19.sp,
                color = Tokens.Muted,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryButton("拍照扫码", modifier = Modifier.weight(1f), onClick = {
                    hint = null
                    val file = File(context.cacheDir, "qr-scan-${System.currentTimeMillis()}.jpg")
                    // 相机应用写到这个临时文件，我们只拿到一个 content:// 地址，不申请存储或相机权限。
                    val uri = runCatching {
                        FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                    }.getOrNull()
                    if (uri == null) {
                        hint = "这台设备上没有可用的相机，改用「从相册选择」。"
                    } else {
                        photo = uri
                        runCatching { capture.launch(uri) }.onFailure {
                            hint = "没有可用的相机应用，改用「从相册选择」。"
                        }
                    }
                })
                GhostButton("从相册选择", modifier = Modifier.weight(1f)) { hint = null; album.launch("image/*") }
            }
            hint?.let { Text(it, fontSize = 12.sp, lineHeight = 18.sp, color = Tokens.Coral) }
        }
        FormCard("识别不出来时", subtitle = "先确认扫的是身份码，不是付款码或收款码。") {
            Text(
                "身份码内容形如 {\"t\":\"luckycat.aa.v1\",\"n\":\"姓名\",\"p\":\"手机号\"}，非本应用的二维码会被拒绝。",
                fontSize = 11.sp,
                lineHeight = 17.sp,
                color = Tokens.Muted,
            )
            Text(
                "拍照时让二维码占满画面、对焦清楚；反光或太暗都容易读不出来。",
                fontSize = 11.sp,
                lineHeight = 17.sp,
                color = Tokens.Muted,
            )
        }
    }
}

/** 从相册或相机拿到的图解一次码：先按需降采样，避免整张原图进内存。 */
private fun decodeFromUri(context: Context, uri: Uri): String? {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return null
    var sample = 1
    while (longest / sample > 1600) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val bitmap = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
    return MemberQr.decodeBitmap(bitmap).also { bitmap.recycle() }
}

/** 「我的身份码」：由 AA 表单里的按钮打开，给对方扫。 */
@Composable
internal fun MemberQrDialog(member: SplitIdentity, onDismiss: () -> Unit) {
    val image = remember(member) { runCatching { MemberQr.bitmap(member) }.getOrNull() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("我的身份码") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (image != null) {
                    // 白底是二维码的一部分：深色页面里放透明底会扫不出来。
                    Box(Modifier.clip(RoundedCornerShape(12.dp)).background(Color.White).padding(8.dp)) {
                        Image(bitmap = image.asImageBitmap(), contentDescription = "我的身份码", modifier = Modifier.size(208.dp))
                    }
                } else {
                    Text("二维码生成失败，请检查姓名与手机号。", color = Tokens.Coral, fontSize = 12.sp)
                }
                Text(member.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Text(member.identity.ifBlank { "—" }, fontSize = 12.sp, color = Tokens.Muted)
                Text(
                    "让对方在「发起 AA 收款 → 参与者身份 → 扫码加成员」里拍下这个码，就能把你填进参与者表。码里只有姓名和手机号/账号，不含金额。",
                    fontSize = 11.sp,
                    lineHeight = 17.sp,
                    color = Tokens.Muted,
                    textAlign = TextAlign.Center,
                )
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } },
    )
}

/** 次要动作按钮：浅底、不加边框，与主按钮并排时不抢视线。 */
@Composable
private fun GhostButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(Tokens.FieldRadius.dp))
            .background(Tokens.SurfaceWarm)
            .clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 15.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 14.sp, color = Tokens.Ink2, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}
