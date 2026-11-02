package com.moneymeow.bank

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 扫一扫：把对方的「身份码」扫进 AA 参与者表。
 *
 * 相机帧用 CameraX 的 ImageAnalysis 取 Y 平面直接喂 zxing，不落地、不上传；
 * 解出来先过 [MemberQr.parse] 校验，通不过就提示「不是招财猫的身份码」继续扫。
 * 模拟器或没开相机权限时，可用「从相册选择」解一张截图，这条路和相机走同一个解码器。
 */
@Composable
internal fun QrScanScreen(onBack: () -> Unit, onPicked: (SplitIdentity) -> Unit) {
    val context = LocalContext.current
    // 硬件返回等同于左上角的返回：扫码页是全屏相机，不能让它把下面那层表单一起关掉。
    androidx.activity.compose.BackHandler { onBack() }
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var denied by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf<String?>(null) }
    var torchOn by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<SplitIdentity?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        denied = !it
    }
    LaunchedEffect(Unit) { if (!granted) permission.launch(Manifest.permission.CAMERA) }
    // 提示是一次性的，别让「不是招财猫的身份码」一直挂在屏幕下方。
    LaunchedEffect(hint) { if (hint != null) { delay(3200); hint = null } }

    val album = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            val text = runCatching { decodeFromUri(context, uri) }.getOrNull()
            when {
                text == null -> hint = "这张图里没有找到二维码，换一张试试。"
                else -> result = runCatching { MemberQr.parse(text) }.getOrElse { hint = it.message ?: "这个二维码不是招财猫的身份码。"; null }
            }
        }
    }

    // 扫到人就走人：把结果交给调用方去填表，这一页自己关掉。
    LaunchedEffect(result) { result?.let(onPicked) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (granted) {
            CameraPreview(
                context = context,
                torchOn = torchOn,
                onTorchAvailable = { available -> if (!available) torchOn = false },
                onDecoded = { text ->
                    result = runCatching { MemberQr.parse(text) }.getOrElse {
                        hint = it.message ?: "这个二维码不是招财猫的身份码。"
                        null
                    }
                },
                onFailed = { hint = it },
            )
        }
        ScannerOverlay(
            granted = granted,
            denied = denied,
            hint = hint,
            torchOn = torchOn,
            onBack = onBack,
            onTorch = { torchOn = !torchOn },
            onAlbum = { album.launch("image/*") },
            onRequestPermission = { permission.launch(Manifest.permission.CAMERA) },
        )
    }
}

/** 取景框边长：占屏宽约七成，太小对不上、太大又容易把边框外的东西框进来。 */
private val FrameFraction = 0.68f

@Composable
private fun ScannerOverlay(
    granted: Boolean,
    denied: Boolean,
    hint: String?,
    torchOn: Boolean,
    onBack: () -> Unit,
    onTorch: () -> Unit,
    onAlbum: () -> Unit,
    onRequestPermission: () -> Unit,
) {
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Chevron, "返回", tint = Color.White, modifier = Modifier.size(22.dp).rotate(180f))
            }
            Text("扫描身份码", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        Box(Modifier.weight(1f)) {
            if (granted) {
                Canvas(Modifier.fillMaxSize()) {
                    val side = size.minDimension * FrameFraction
                    val left = (size.width - side) / 2f
                    val top = (size.height - side) / 2f
                    val scrim = Color(0x99000000)
                    // 四块遮罩围出取景框，比整屏铺一层再抠洞简单，也不依赖图层混合。
                    drawRect(scrim, Offset(0f, 0f), Size(size.width, top))
                    drawRect(scrim, Offset(0f, top + side), Size(size.width, size.height - top - side))
                    drawRect(scrim, Offset(0f, top), Size(left, side))
                    drawRect(scrim, Offset(left + side, top), Size(size.width - left - side, side))
                    val arm = 26.dp.toPx()
                    val coral = Color(0xFFFF5A7A)
                    val corner = Path()
                    corner.moveTo(left, top + arm); corner.lineTo(left, top); corner.lineTo(left + arm, top)
                    corner.moveTo(left + side - arm, top); corner.lineTo(left + side, top); corner.lineTo(left + side, top + arm)
                    corner.moveTo(left + side, top + side - arm); corner.lineTo(left + side, top + side); corner.lineTo(left + side - arm, top + side)
                    corner.moveTo(left + arm, top + side); corner.lineTo(left, top + side); corner.lineTo(left, top + side - arm)
                    drawPath(corner, coral, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))
                    drawRoundRect(
                        color = Color(0x33FFFFFF),
                        topLeft = Offset(left, top),
                        size = Size(side, side),
                        cornerRadius = CornerRadius(12.dp.toPx()),
                        style = Stroke(width = 1.dp.toPx()),
                    )
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 24.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                when {
                    !granted && denied -> "没有相机权限，扫不了码。可以在系统设置里开启，或先从相册选一张二维码截图。"
                    !granted -> "正在申请相机权限…也可以先从相册选一张二维码截图。"
                    else -> hint ?: "把对方的「身份码」放进框里，自动识别。"
                },
                color = Color(0xFFE8EDF5),
                fontSize = 13.sp,
                lineHeight = 20.sp,
                textAlign = TextAlign.Center,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (granted) ScannerButton(if (torchOn) "关闭手电筒" else "手电筒", onTorch)
                else ScannerButton("去授权", onRequestPermission)
                ScannerButton("从相册选择", onAlbum)
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}

@Composable
private fun ScannerButton(text: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Color(0x33FFFFFF))
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 10.dp),
    ) {
        Text(text, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * 相机预览 + 逐帧解码。
 *
 * zxing 只在下单线程里跑，解到一帧就 `AtomicBoolean` 关门，不会把同一个码重复交给上层。
 */
@Composable
private fun CameraPreview(
    context: Context,
    torchOn: Boolean,
    onTorchAvailable: (Boolean) -> Unit,
    onDecoded: (String) -> Unit,
    onFailed: (String) -> Unit,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val executor = remember { Executors.newSingleThreadExecutor() }
    var camera by remember { mutableStateOf<Camera?>(null) }

    DisposableEffect(Unit) { onDispose { executor.shutdownNow() } }

    AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())

    LaunchedEffect(Unit) {
        val provider = runCatching {
            val future = ProcessCameraProvider.getInstance(context)
            kotlinx.coroutines.suspendCancellableCoroutine<ProcessCameraProvider> { continuation ->
                future.addListener({ continuation.resumeWith(runCatching { future.get() }) }, ContextCompat.getMainExecutor(context))
            }
        }.getOrElse {
            onFailed("相机启动失败，可以改用「从相册选择」。")
            return@LaunchedEffect
        }
        runCatching {
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            val seen = AtomicBoolean(false)
            var lastAt = 0L
            analysis.setAnalyzer(executor) { image ->
                // 一秒最多解 8 帧：再快对识别率没帮助，只是排队烧电。
                val now = System.currentTimeMillis()
                if (seen.get() || now - lastAt < 120) {
                    image.close()
                    return@setAnalyzer
                }
                lastAt = now
                val text = runCatching { decodeFrame(image) }.getOrNull()
                image.close()
                if (text != null && seen.compareAndSet(false, true)) {
                    ContextCompat.getMainExecutor(context).execute { onDecoded(text) }
                }
            }
            provider.unbindAll()
            val bound = provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            camera = bound
            onTorchAvailable(bound.cameraInfo.hasFlashUnit())
        }.onFailure { onFailed("相机启动失败，可以改用「从相册选择」。") }
    }

    // 手电筒开关在 Compose 侧，状态变化时转给相机控制；没有闪光灯的设备按钮会被隐藏。
    LaunchedEffect(torchOn, camera) { camera?.cameraControl?.enableTorch(torchOn) }
}

/** 取一帧 YUV 的 Y 平面丢给 zxing。 */
private fun decodeFrame(image: ImageProxy): String? {
    val plane = image.planes.firstOrNull() ?: return null
    val buffer = plane.buffer
    val pixelStride = plane.pixelStride
    val rowStride = plane.rowStride
    if (pixelStride == 1) {
        val data = ByteArray(buffer.remaining())
        buffer.get(data)
        return MemberQr.decodeYuv(data, image.width, image.height, rowStride)
    }
    // 少数设备 Y 平面也带像素间隔：按真实行宽逐像素取出来。
    val width = image.width
    val height = image.height
    val data = ByteArray(rowStride * height)
    val row = ByteArray(rowStride)
    for (y in 0 until height) {
        val length = minOf(rowStride, buffer.remaining())
        if (length <= 0) break
        buffer.get(row, 0, length)
        for (x in 0 until minOf(width, length)) data[y * rowStride + x] = row[x * pixelStride]
    }
    return MemberQr.decodeYuv(data, width, height, rowStride)
}

/** 从相册里选出来的图解一次码：先按需降采样，避免整张原图进内存。 */
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
                    "让对方在「发起 AA 收款 → 参与者身份 → 扫码加成员」里扫这个码，就能把你填进参与者表。码里只有姓名和手机号/账号，不含金额。",
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
