package com.moneymeow.bank

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 用系统 Keystore 保管的 AES-GCM 密钥加密本地敏感字符串。
 *
 * 为什么不直接用 `EncryptedSharedPreferences`：那需要引入 androidx.security，
 * 而本工程刻意保持依赖最少（离线构建也少一个变量）。这里用平台 API 做同样的事：
 *
 * - 密钥由 Android Keystore 生成并保管，**不出安全硬件/系统边界**，
 *   App 只能通过别名请求加解密，取不到裸密钥；
 * - 每个值单独随机 IV，密文与 IV 一起 Base64 存盘；
 * - 密钥不可用（清除数据、重装、部分机型的密钥失效）时返回 null，
 *   调用方按「没有令牌」处理，用户重新登录即可，不会崩溃。
 *
 * 只用来加密**会话令牌**这类凭据；姓名、昵称等展示数据仍按普通偏好保存。
 */
internal object TokenVault {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "money_meow_session_key_v1"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    /** 加密为 `Base64(iv + 密文)`；失败返回 null，调用方降级为不保存。 */
    fun encrypt(plain: String): String? = runCatching {
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, secretKey()) }
        val cipherText = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        Base64.encodeToString(cipher.iv + cipherText, Base64.NO_WRAP)
    }.getOrNull()

    /** 解密；密钥失效、数据被替换或格式不对都返回 null。 */
    fun decrypt(blob: String?): String? {
        if (blob.isNullOrEmpty()) return null
        return runCatching {
            val raw = Base64.decode(blob, Base64.NO_WRAP)
            if (raw.size <= IV_BYTES) return null
            val cipher = Cipher.getInstance(TRANSFORM).apply {
                init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, raw, 0, IV_BYTES))
            }
            String(cipher.doFinal(raw, IV_BYTES, raw.size - IV_BYTES), Charsets.UTF_8)
        }.getOrNull()
    }
}
