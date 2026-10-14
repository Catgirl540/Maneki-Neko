package cn.waveflow.luckycat

import io.flutter.embedding.android.FlutterActivity
import android.os.Bundle
import android.view.WindowManager
import android.content.pm.ApplicationInfo
import android.content.Intent
import android.content.ClipData
import android.net.Uri
import androidx.core.content.FileProvider
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    private var updater: AndroidUpdater? = null
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        updater = AndroidUpdater(this, flutterEngine.dartExecutor.binaryMessenger)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "luckycat/files").setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "protectCard" -> {
                        val protect = call.arguments as? Boolean ?: false
                        if (protect || applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) {
                            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                        } else {
                            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                        }
                        result.success(null)
                    }
                    "shareBytes" -> {
                        val data = requireNotNull(call.argument<ByteArray>("data"))
                        require(data.size <= 16 * 1024 * 1024)
                        val name = (call.argument<String>("name") ?: "statement.csv").replace(Regex("[^\\p{L}\\p{N}._-]"), "_").take(100)
                        val dir = File(cacheDir, "exports").apply { mkdirs() }
                        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3600000 }?.forEach { it.delete() }
                        val file = File(dir, name).apply { writeBytes(data) }
                        val uri = FileProvider.getUriForFile(this, "$packageName.exports", file)
                        val intent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/csv"
                            putExtra(Intent.EXTRA_STREAM, uri)
                            clipData = ClipData.newUri(contentResolver, name, uri)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        startActivity(Intent.createChooser(intent, "导出账户明细"))
                        result.success(null)
                    }
                    "openUrl" -> {
                        val uri = Uri.parse(requireNotNull(call.argument<String>("url")))
                        require(uri.scheme in listOf("https", "http") && !uri.host.isNullOrEmpty())
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("FILE_ACTION_FAILED", "无法打开文件", null)
            }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
    override fun onDestroy() {
        updater?.close()
        super.onDestroy()
    }
}
