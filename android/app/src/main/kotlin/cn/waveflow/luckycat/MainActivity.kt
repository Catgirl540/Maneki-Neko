package cn.waveflow.luckycat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.contract.AgentApi
import cn.waveflow.luckycat.contract.ApiException
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    BridgeCheckScreen()
                }
            }
        }
    }
}

/**
 * 第一步只做一件事：**证明这台机器的构建链和网络栈是通的**。
 *
 * 它打的是桥接的 `/agent-api/health`——真实存在的端点，不是自造的假接口。
 * 界面本身没有价值，价值在于"能连通"这件事是被跑出来的，不是推断出来的。
 */
@Composable
fun BridgeCheckScreen() {
    var baseUrl by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun check() {
        val url = baseUrl.trim()
        if (url.isEmpty()) {
            result = "先填桥接地址"
            failed = true
            return
        }
        busy = true
        result = null
        scope.launch {
            try {
                val api = AgentApi(url)
                try {
                    val health = api.health()
                    result = buildString {
                        appendLine("ok=${health.ok}  sessions=${health.sessions}")
                        append("voice.asr=${health.voice.asr}  voice.tts=${health.voice.tts}")
                        health.voice.maxSeconds?.let { append("  maxSeconds=$it") }
                    }
                    failed = false
                } finally {
                    api.close()
                }
            } catch (e: ApiException) {
                // 401 是"口令不对"，不是"服务不在"——分清楚，否则排查会往错的方向走
                result = "HTTP ${e.code}\n${e.body.take(300)}"
                failed = true
            } catch (e: Exception) {
                result = "${e::class.simpleName}: ${e.message}"
                failed = true
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("招财猫银行 · 契约自检", style = MaterialTheme.typography.headlineSmall)
        Text(
            "真机要填电脑的局域网 IP（手机上的 127.0.0.1 是手机自己）；" +
                "模拟器访问宿主机用 10.0.2.2。桥接默认只监听 127.0.0.1，联调前要改绑。",
            style = MaterialTheme.typography.bodySmall,
        )
        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = { Text("桥接地址") },
            placeholder = { Text("http://192.168.x.x:8788") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("bridge-url"),
        )
        Button(
            onClick = { check() },
            enabled = !busy,
            modifier = Modifier.testTag("bridge-check"),
        ) {
            Text(if (busy) "检查中…" else "测桥接")
        }
        result?.let {
            Text(
                it,
                color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.testTag("bridge-result"),
            )
        }
    }
}
