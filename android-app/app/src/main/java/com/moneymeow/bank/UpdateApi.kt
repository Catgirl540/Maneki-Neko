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
 * 应用内更新：清单在 `assets/update.json`（发布脚本写入），
 * 拉取清单比对 versionCode，下载 APK 校验 sha256 后走系统安装器。
 *
 * 清单与安装包都由**网站自己的域名**提供（`/downloads/…`）。
 * 以前用 R2 的 `pub-*.r2.dev`，但那个域名在部分网络下解析不了，
 * 更新检查会静默失败、用户以为「没有新版本」。只要 App 能登录银行，
 * 同一个站点的下载地址就一定可达，所以统一走站点。
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

    /**
     * 读取随包内置的更新配置。
     *
     * `BuildConfig.UPDATE_MANIFEST_URL` 非空时优先用它：本地联调可以让 dev 包
     * 指向测试站点，不必为了验证一次更新检查重新打包线上地址。
     */
    private fun bundledConfig(context: Context): JSONObject? = runCatching {
        val text = context.assets.open("update.json").bufferedReader().use { it.readText() }
        val config = JSONObject(text)
        val override = BuildConfig.UPDATE_MANIFEST_URL
        if (override.isNotEmpty()) config.put("manifestUrl", override)
        config
    }.getOrNull()

    /** 查询是否有新版本；没有更新时返回 null。 */
    suspend fun check(context: Context, currentVersionCode: Int): Info? = withContext(Dispatchers.IO) {
        val config = bundledConfig(context) ?: return@withContext null
        val manifestUrl = config.optString("manifestUrl")
        android.util.Log.i("UpdateApi", "check: manifestUrl=" + manifestUrl.take(60))
        if (manifestUrl.isEmpty()) return@withContext null
        // 清单是更新的信任根：正式包只允许 https，避免明文被替换后连 sha256 一起换掉。
        if (!manifestUrl.startsWith("https://") && !(BuildConfig.DEBUG && manifestUrl.startsWith("http://"))) {
            android.util.Log.w("UpdateApi", "check: 已拒绝非 HTTPS 的更新清单")
            return@withContext null
        }

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

        // 清单可以给相对地址（/downloads/xxx.apk），以清单自身为基准补全成绝对地址。
        val rawUrl = manifest.optString("apkUrl").ifEmpty { config.optString("apkUrl") }
        val apkUrl = if (rawUrl.startsWith("https://") || (BuildConfig.DEBUG && rawUrl.startsWith("http://"))) {
            rawUrl
        } else {
            URL(URL(manifestUrl), rawUrl).toString()
        }
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
            // sha256 只对齐清单声明；清单本身也可能是被换掉的。
            // 再比一次签名证书：下载包必须由与当前安装包相同的证书签名，
            // 否则删除并拒绝安装（系统安装器也会拦，但这里先把错误说清楚）。
            if (!sameSigner(context, target)) {
                target.delete()
                throw IllegalStateException("安装包签名与当前应用不一致，已拒绝安装")
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

    /**
     * 下载到的 APK 是否由与当前应用相同的证书签名。
     *
     * 比对的是第一个签名证书的 SHA-256 摘要；当前包取不到签名信息时保守返回 false，
     * 宁可让用户重新下载，也不安装来源不明的包。
     */
    private fun sameSigner(context: Context, apk: File): Boolean = runCatching {
        val flags = android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES
        fun firstSigner(info: android.content.pm.SigningInfo?): ByteArray? =
            info?.apkContentsSigners?.firstOrNull()?.toByteArray()

        val current = context.packageManager.getPackageInfo(context.packageName, flags)
        val downloaded = context.packageManager.getPackageArchiveInfo(apk.absolutePath, flags)
        val expected = firstSigner(current.signingInfo) ?: return@runCatching false
        val actual = firstSigner(downloaded?.signingInfo) ?: return@runCatching false
        MessageDigest.getInstance("SHA-256").digest(expected)
            .contentEquals(MessageDigest.getInstance("SHA-256").digest(actual))
    }.getOrDefault(false)

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
