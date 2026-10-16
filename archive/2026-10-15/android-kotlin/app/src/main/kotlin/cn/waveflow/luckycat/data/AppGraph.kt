package cn.waveflow.luckycat.data

import cn.waveflow.luckycat.BuildConfig
import cn.waveflow.luckycat.contract.AgentApi
import cn.waveflow.luckycat.contract.bank.BankApi
import cn.waveflow.luckycat.contract.bank.BankUser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** 登录态。 */
data class Session(val token: String, val user: BankUser)

/**
 * 手写的依赖容器。
 *
 * 只有银行客户端与登录态两个东西，用 Hilt 引一整套注解处理器换不来什么。
 * 真到需要按屏注入的时候再换——那时候替换点也就是这一处。
 *
 * 关于**登录态只放内存**：这正是网页版 `sessionStorage` 的对应物——
 * 切后台、转屏、进程被系统回收前都还在，**杀掉 App 就要重登**（见
 * `app/src/lib/authToken.ts` 里那段"为什么是 sessionStorage"）。
 * 落盘的只有业务数据，那是另一回事。
 */
class AppGraph(val baseUrl: String = BuildConfig.AGENT_BASE) {

    private val _session = MutableStateFlow<Session?>(null)
    val session: StateFlow<Session?> = _session.asStateFlow()

    /**
     * 整个 App **只建一个** [BankApi]：连接池与线程池都挂在它身上。
     * 令牌用 provider 注入（登录之后才有），而不是每登录一次重建一个客户端。
     */
    val bank: BankApi = BankApi(baseUrl, tokenProvider = { _session.value?.token })

    /**
     * agent 桥接的客户端。与银行后端**是两个不同的接口面**：
     * 银行数据走 `/api/…`（将来换真后端），对话走 `/agent-api/…`（agent 运行时）。
     * 两者共用同一个主机名，所以 [baseUrl] 是同一个。
     */
    val agent: AgentApi = AgentApi(baseUrl)

    fun signIn(token: String, user: BankUser) {
        _session.value = Session(token, user)
    }

    fun signOut() {
        _session.value = null
    }

    suspend fun close() {
        bank.close()
    }
}
