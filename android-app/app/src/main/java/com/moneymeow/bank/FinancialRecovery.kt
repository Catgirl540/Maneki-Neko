package com.moneymeow.bank

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.util.UUID

/** Only an opaque key and operation label are persisted; no request body or PIN. */
object FinancialRecovery {
    private lateinit var prefs: android.content.SharedPreferences
    private val main = Handler(Looper.getMainLooper())
    private var activeToken by mutableStateOf<String?>(null)
    var pending by mutableStateOf<PendingOperation?>(null)
        private set
    var inFlight by mutableStateOf(false)
        private set
    fun belongsToCurrentSession(): Boolean = activeToken != null && activeToken == SessionStore.credentials().second

    data class PendingOperation(val key: String, val label: String, val owner: String)

    fun init(context: Context) { prefs = context.getSharedPreferences("financial_recovery", Context.MODE_PRIVATE) }
    private fun slot(owner: String): String {
        require(owner.isNotBlank()) { "无法核验客户身份" }
        return MessageDigest.getInstance("SHA-256").digest(owner.toByteArray()).joinToString("") { "%02x".format(it) }
    }
    @Synchronized fun begin(label: String, existingKey: String? = null, owner: String, token: String): String {
        val slot = slot(owner)
        if (prefs.getString("$slot.key", null) != null) {
            main.post {
                if (SessionStore.credentials().second == token) {
                    refresh(owner, token)
                }
            }
            throw IllegalStateException("请先核查上一次操作结果，再发起新操作")
        }
        val key = existingKey ?: UUID.randomUUID().toString()
        check(prefs.edit().putString("$slot.key", key).putString("$slot.label", label).commit()) { "无法保存操作记录，请稍后重试" }
        main.post { if (SessionStore.credentials().second == token) { activeToken = token; inFlight = true; pending = PendingOperation(key, label, owner) } }
        return key
    }
    fun finished(owner: String, token: String, key: String) { main.post {
        if (SessionStore.credentials().second == token && pending?.key == key && pending?.owner == owner) {
            inFlight = false
            refresh(owner, token)
        }
    } }
    @Synchronized fun completed(owner: String, token: String, key: String) {
        val slot = slot(owner)
        if (prefs.getString("$slot.key", null) == key) {
            // On a storage failure leave the record in place for a safe lookup.
            prefs.edit().remove("$slot.key").remove("$slot.label").commit()
        }
        main.post {
            if (SessionStore.credentials().second == token) {
                inFlight = false
                refresh(owner, token)
            }
        }
    }
    fun refresh(owner: String, token: String) {
        if (activeToken != token) inFlight = false
        activeToken = token
        if (!::prefs.isInitialized || owner.isBlank()) { pending = null; return }
        val slot = slot(owner)
        val key = prefs.getString("$slot.key", null)
        pending = key?.let { PendingOperation(it, prefs.getString("$slot.label", "业务操作").orEmpty(), owner) }
    }
    @Synchronized fun acknowledge(key: String, owner: String) {
        check(belongsToCurrentSession()) { "登录状态已改变，请重新核查" }
        val slot = slot(owner)
        if (prefs.getString("$slot.key", null) == key) {
            check(prefs.edit().remove("$slot.key").remove("$slot.label").commit()) { "保存失败，请重试" }
        }
        refresh(owner, SessionStore.credentials().second.orEmpty())
    }
}

@Composable
fun FinancialRecoveryDialog(onResolved: () -> Unit) {
    val pending = FinancialRecovery.pending ?: return
    if (FinancialRecovery.inFlight || !FinancialRecovery.belongsToCurrentSession()) return
    var busy by remember(pending.key) { mutableStateOf(false) }
    var result by remember(pending.key) { mutableStateOf<String?>(null) }
    var error by remember(pending.key) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = {},
        title = { Text("核查${pending.label}结果") },
        text = { Text(result ?: error ?: "为避免重复办理，请先核查上次操作。") },
        confirmButton = {
            if (result != null) TextButton(onClick = {
                runCatching { FinancialRecovery.acknowledge(pending.key, pending.owner) }
                    .onSuccess { onResolved() }
                    .onFailure { result = null; error = "未能保存确认状态，请重新核查" }
            }) { Text("我已了解") }
            else TextButton(enabled = !busy, onClick = {
                busy = true; error = null
                scope.launch {
                    runCatching { BankApi.resolveFinancialOperation(pending.key) }
                        .onSuccess { result = it }
                        .onFailure { error = it.message ?: "核查失败，请稍后重试" }
                    busy = false
                }
            }) { Text(if (busy) "核查中…" else "核查结果") }
        },
    )
}
