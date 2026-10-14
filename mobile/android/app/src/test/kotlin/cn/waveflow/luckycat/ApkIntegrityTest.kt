package cn.waveflow.luckycat

import com.android.apksig.ApkVerifier
import org.junit.Assert.assertThrows
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest

class ApkIntegrityTest {
    private lateinit var apk: File
    private lateinit var hash: String
    private lateinit var signers: Set<List<Byte>>
    private fun digest(file: File): String {
        val result = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(65536)
            while (true) { val size = input.read(buffer); if (size < 0) break; result.update(buffer, 0, size) }
        }
        return result.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
    @Before fun prepare() {
        val source = System.getenv("UPDATE_TEST_APK")
        assumeTrue("设置 UPDATE_TEST_APK 为实际已签名的 Flutter APK", source != null)
        apk = File(source!!)
        hash = digest(apk)
        signers = ApkVerifier.Builder(apk).setMinCheckedPlatformVersion(26).setMaxCheckedPlatformVersion(36).build().verify()
            .signerCertificates.map { MessageDigest.getInstance("SHA-256").digest(it.encoded).toList() }.toSet()
    }
    @Test fun signedApkAcceptedOnOldAndNewAndroid() {
        for (sdk in listOf(26, 36)) ApkIntegrity.verify(apk, hash, apk.length(), signers, sdk)
    }
    @Test fun differentSignerRejected() {
        assertThrows(IllegalArgumentException::class.java) { ApkIntegrity.verify(apk, hash, apk.length(), setOf(listOf(0.toByte())), 36) }
    }
    @Test fun wrongSizeAndDigestRejected() {
        assertThrows(IllegalArgumentException::class.java) { ApkIntegrity.verify(apk, hash, apk.length() - 1, signers, 36) }
        assertThrows(IllegalArgumentException::class.java) { ApkIntegrity.verify(apk, "0".repeat(64), apk.length(), signers, 36) }
    }
    @Test fun tamperedApkRejectedEvenWhenManifestHashAlsoChanges() {
        val changed = File.createTempFile("luckycat-invalid-", ".apk")
        try {
            apk.copyTo(changed, overwrite = true)
            RandomAccessFile(changed, "rw").use { file ->
                val offset = file.length() / 2
                file.seek(offset); val value = file.readByte(); file.seek(offset); file.writeByte(value.toInt() xor 1)
            }
            assertThrows(Exception::class.java) { ApkIntegrity.verify(changed, digest(changed), changed.length(), signers, 36) }
        } finally { changed.delete() }
    }
}
