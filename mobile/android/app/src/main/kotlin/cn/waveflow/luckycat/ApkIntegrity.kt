package cn.waveflow.luckycat

import com.android.apksig.ApkVerifier
import java.io.File
import java.security.MessageDigest

/** 不依赖 Activity 的校验部分，也能在 JVM 上用真实 APK 回归。 */
object ApkIntegrity {
    fun verify(file: File, hash: String, bytes: Long, trusted: Set<List<Byte>>, sdk: Int) {
        require(bytes in 1024..(500L * 1024 * 1024) && file.isFile && file.length() == bytes) { "安装包不完整，请重新下载" }
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                check(!Thread.currentThread().isInterrupted)
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
        require(actual == hash) { "安装包校验失败，请重新下载" }
        val verified = ApkVerifier.Builder(file).setMinCheckedPlatformVersion(sdk)
            .setMaxCheckedPlatformVersion(sdk).build().verify()
        require(verified.isVerified) { "安装包签名无效，请重新下载" }
        val actualSigners = verified.signerCertificates.map { MessageDigest.getInstance("SHA-256").digest(it.encoded).toList() }.toSet()
        require(trusted.isNotEmpty() && trusted == actualSigners) { "更新包签名与当前应用不一致，无法覆盖安装" }
    }
}
