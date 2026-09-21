package cn.waveflow.luckycat

import android.app.Application
import cn.waveflow.luckycat.data.AppGraph

/**
 * 持有依赖图。
 *
 * 放 Application 而不是在 Composable 里 `remember`：转屏、进程内重建
 * Activity 时依赖图（以及它身上的连接池、登录态）都该留着，
 * 而 Composable 的 remember 会跟着 Activity 一起重建。
 */
class LuckyCatApplication : Application() {
    val graph: AppGraph by lazy { AppGraph() }
}
