package com.moneymeow.bank

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * 应用内更新：清单在 `assets/update.json`（发布脚本写入，含 R2 预签名地址），
 * 拉取 `latest.json` 比对 versionCode，下载 APK 校验 sha256 后走系统安装器。
 */
object UpdateApi {
    data class Info(
        val versionCode: Int,
        val versionName: String,
        val notes: String,
        val size: Long,
        val sha256: String,
        val downloadUrl: String,
    )

    /** 读取随包内置的更新配置。 */
    private fun bundledConfig(context: Context): JSONObject? = runCatching {
        val text = context.assets.open("update.json").bufferedReader().use { it.readText() }
        JSONObject(text)
    }.getOrNull()

    /** 查询是否有新版本；没有更新时返回 null。 */
    suspend fun check(context: Context, currentVersionCode: Int): Info? = withContext(Dispatchers.IO) {
        val config = bundledConfig(context) ?: return@withContext null
        val manifestUrl = config.optString("manifestUrl")
        android.util.Log.i("UpdateApi", "check: manifestUrl=" + manifestUrl.take(60))
        if (manifestUrl.isEmpty()) return@withContext null

        val connection = (URL(manifestUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 12000
        }
        val text = try {
            if (connection.responseCode !in 200..299) return@withContext null
            connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
        val manifest = JSONObject(text)
        val remoteCode = manifest.optInt("versionCode")
        android.util.Log.i("UpdateApi", "check: remote=$remoteCode current=$currentVersionCode")
        if (remoteCode <= currentVersionCode) return@withContext null

        // 清单里带最新 APK 的预签名地址；老版本应用也能据此拿到新包
        val apkUrl = manifest.optString("apkUrl").ifEmpty { config.optString("apkUrl") }
        Info(
            versionCode = remoteCode,
            versionName = manifest.optString("versionName"),
            notes = manifest.optString("notes"),
            size = manifest.optLong("size"),
            sha256 = manifest.optString("sha256"),
            downloadUrl = apkUrl,
        )
    }

    /** 下载 APK 到缓存目录，回调进度（0..1）。 */
    suspend fun download(
        context: Context,
        info: Info,
        onProgress: (Float) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        require(info.downloadUrl.isNotEmpty()) { "更新地址缺失，请重新发布" }
        val target = File(context.cacheDir, "update-${info.versionCode}.apk")
        if (target.exists()) target.delete()

        val connection = (URL(info.downloadUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 60_000
        }
        try {
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("下载失败（${connection.responseCode}）")
            }
            val total = connection.contentLengthLong.takeIf { it > 0 } ?: info.size
            var written = 0L
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        written += read
                        if (total > 0) onProgress((written.toFloat() / total).coerceIn(0f, 1f))
                    }
                }
            }
            if (info.sha256.isNotEmpty() && sha256(target) != info.sha256) {
                target.delete()
                throw IllegalStateException("安装包校验失败，请重试")
            }
            target
        } finally {
            connection.disconnect()
        }
    }

    /** 调起系统安装器。 */
    fun install(context: Context, apk: File) {
        android.util.Log.i("UpdateApi", "install: " + apk.absolutePath + " exists=" + apk.exists())
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
        android.util.Log.i("UpdateApi", "install uri=" + uri)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
