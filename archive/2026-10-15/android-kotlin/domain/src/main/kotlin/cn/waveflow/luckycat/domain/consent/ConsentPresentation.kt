package cn.waveflow.luckycat.domain.consent

import cn.waveflow.luckycat.contract.ConsentField
import cn.waveflow.luckycat.contract.Challenge

/**
 * 确认卡片要显示的东西。
 *
 * [expired] 是**界面必须用的**：挑战一过期就不能再点确认（点了桥接也会拒，
 * 但让用户点一个注定失败的按钮是更糟的体验）。
 */
data class ConsentView(
    val challengeId: String,
    val kind: String,
    val fields: List<ConsentField>,
    val consequence: String?,
    /** 要不要输支付密码。`false` 表示只确认（只读查询那类）。 */
    val needsPassword: Boolean,
    val secondsLeft: Long,
    val expired: Boolean,
) {
    /** 倒计时文案。过期后返回 null，界面改为显示"已超时"。 */
    val countdown: String?
        get() = if (expired) null else "${secondsLeft} 秒内有效"
}

/**
 * 把后端的挑战变成界面能直接画的东西。
 *
 * 放在 `:domain` 而不是 Composable 里，是因为**"过没过期""要不要密码"
 * 是安全判定**，而它们完全可以离线测——一个算错（比如把过期判成没过期）
 * 就是一个真实的安全问题，不该靠肉眼看界面发现。
 */
object ConsentPresentation {

    /**
     * @param challenge - 后端推过来的挑战。
     * @param now - 当前时刻（Unix 毫秒），显式传入以便测试。
     */
    fun from(challenge: Challenge, now: Long): ConsentView {
        val expiresAt = challenge.expiresAt
        val expired = expiresAt != null && now > expiresAt
        val secondsLeft = expiresAt?.let { ((it - now) / 1000).coerceAtLeast(0) } ?: 0
        return ConsentView(
            challengeId = challenge.challengeId ?: "",
            kind = challenge.kind ?: "操作",
            fields = challenge.fields,
            consequence = challenge.consequence,
            needsPassword = challenge.requiresPaymentPassword,
            secondsLeft = secondsLeft,
            expired = expired,
        )
    }

    /**
     * 现在能不能提交这次确认。
     *
     * 三条一起看，缺一不可：
     *   1. 挑战没过期（过期了桥接那边已经当拒绝处理）；
     *   2. 需要密码时**密码非空**（空密码打过去只会浪费一次 401）；
     *   3. 不需要密码时直接放行（只读查询不该被拦）。
     *
     * **注意这里没有"语音"这条路径**：语音只念提醒，绝不代答。
     * 这个函数只被界面上那两个按钮调用。
     */
    fun canSubmit(view: ConsentView, password: String): Boolean {
        if (view.expired) return false
        if (!view.needsPassword) return true
        return password.isNotEmpty()
    }

    /**
     * 密码错（桥接回 401）时该怎么办。
     *
     * 桥接在密码错时**不结算挑战**，所以用户还有机会——界面必须把卡片留着
     * 并允许重输，而不是收起来。收起卡片等于把用户唯一的机会关掉了，
     * 而 agent 那边还在等。
     *
     * @returns 是否应该清空密码框让用户重输。
     */
    fun shouldClearPasswordAfterFailure(status: Int): Boolean = status == 401
}
