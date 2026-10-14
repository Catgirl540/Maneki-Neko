package cn.waveflow.luckycat

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

/** 所有路径限定在私有 updates 缓存中；安装前独立验证签名和当前应用身份。 */
class AndroidUpdater(private val activity: Activity, messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "luckycat/updates")
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var closed = false
    private val directory get() = File(activity.cacheDir, "updates").apply { mkdirs() }
    private val flags get() = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    private fun installed() = activity.packageManager.getPackageInfo(activity.packageName, flags)
    private fun version(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    private fun debug(info: PackageInfo) = (info.applicationInfo?.flags ?: 0) and ApplicationInfo.FLAG_DEBUGGABLE != 0

    init {
        channel.setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "info" -> {
                        val current = installed()
                        result.success(mapOf("packageName" to activity.packageName, "versionName" to current.versionName,
                            "versionCode" to version(current), "sdk" to Build.VERSION.SDK_INT,
                            "abis" to Build.SUPPORTED_ABIS.toList(), "debuggable" to debug(current)))
                    }
                    "downloadTarget" -> {
                        val file = target(call)
                        directory.listFiles()?.filter { it.name != file.name }?.forEach { it.delete() }
                        result.success(file.absolutePath + ".part")
                    }
                    "verify", "install" -> worker.execute {
                        try {
                            val file = verify(call)
                            main.post {
                                if (!closed && !activity.isDestroyed) {
                                    try {
                                        if (call.method == "verify") result.success(null)
                                        else result.success(install(file))
                                    } catch (_: Exception) { result.error("INSTALL_FAILED", "无法打开系统安装界面，请重试", null) }
                                }
                            }
                        } catch (e: Exception) {
                            main.post { if (!closed) result.error("UPDATE_REJECTED", e.message ?: "安装包校验失败", null) }
                        }
                    }
                    else -> result.notImplemented()
                }
            } catch (_: Exception) { result.error("UPDATE_FAILED", "无法读取应用更新信息", null) }
        }
    }

    private fun target(call: MethodCall): File {
        val name = requireNotNull(call.argument<String>("fileName"))
        require(Regex("luckycat-android-[a-f0-9]{12}\\.apk").matches(name)) { "安装包文件名无效" }
        return File(directory, name)
    }

    private fun verify(call: MethodCall): File {
        val file = target(call)
        val hash = requireNotNull(call.argument<String>("sha256"))
        val bytes = requireNotNull(call.argument<Number>("bytes")).toLong()
        val expectedVersion = requireNotNull(call.argument<Number>("versionCode")).toLong()
        require(Regex("[a-f0-9]{64}").matches(hash) && file.name.contains(hash.take(12))) { "安装包校验信息无效" }
        val current = installed()
        val installedSigners = if (Build.VERSION.SDK_INT >= 28) current.signingInfo?.apkContentsSigners else current.signatures
        val trusted = installedSigners?.map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).toList() }?.toSet() ?: emptySet()
        ApkIntegrity.verify(file, hash, bytes, trusted, Build.VERSION.SDK_INT)
        val candidate = requireNotNull(activity.packageManager.getPackageArchiveInfo(file.absolutePath, flags)) { "无法读取安装包" }
        require(candidate.packageName == activity.packageName) { "安装包不属于招财猫银行" }
        require(version(candidate) == expectedVersion && expectedVersion > version(current)) { "安装包版本不符，请重新检查更新" }
        require((candidate.applicationInfo?.minSdkVersion ?: Int.MAX_VALUE) <= Build.VERSION.SDK_INT) { "此更新不支持当前系统" }
        require(debug(current) || !debug(candidate)) { "正式版不能更新为调试版" }
        return file
    }

    private fun install(file: File): String {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return "permissionRequired"
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.exports", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            clipData = ClipData.newUri(activity.contentResolver, file.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(intent)
        return "installerOpened"
    }

    fun close() { closed = true; channel.setMethodCallHandler(null); worker.shutdownNow() }
}
