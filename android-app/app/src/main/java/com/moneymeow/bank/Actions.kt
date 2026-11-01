package com.moneymeow.bank

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * 写操作（提交表单、下单、改设置）的统一执行器。
 *
 * 原来每个页面都自己写一份：
 * ```
 * if (busy) return
 * busy = true; error = null
 * scope.launch { try { … } catch (e: Exception) { error = e.message ?: "…" } finally { busy = false } }
 * ```
 * 现在只保留一次：这里负责防重入、异常映射、收尾复位，页面只关心成功/失败要做什么。
 * 取消（返回、离开页面）原样向上抛，不会写进错误提示。
 */
class Submitter(private val scope: CoroutineScope) {

    var busy by mutableStateOf(false)
        private set

    fun submit(
        fallback: String = "操作失败，请刷新核对",
        onStart: () -> Unit = {},
        onError: (String) -> Unit = {},
        onSuccess: () -> Unit = {},
        onFailure: (Exception) -> Unit = {},
        onFinally: () -> Unit = {},
        block: suspend () -> Unit,
    ) {
        if (busy) return
        busy = true
        onStart()
        scope.launch {
            try {
                block()
                onSuccess()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                onError(failure.message ?: fallback)
                onFailure(failure)
            } finally {
                onFinally()
                busy = false
            }
        }
    }
}

@Composable
fun rememberSubmitter(): Submitter {
    val scope = rememberCoroutineScope()
    return remember(scope) { Submitter(scope) }
}
