package com.moneymeow.bank

import java.util.concurrent.ConcurrentHashMap

/**
 * 页面级读缓存：切页时先把上次的结果直接渲染出来，再在后台刷新。
 *
 * 和 [BankApi] 里那个按 URL 的 HTTP 短缓存不同，这里存的是**已经解析好**的界面数据，
 * 所以回到「我的」「交易记录」「通知」时不会先闪一下骨架屏。
 * 数据只在内存里，进程结束即丢；下拉刷新成功后由各页面覆盖写回，退出登录时整体清空。
 */
object ReadCache {
    private val values = ConcurrentHashMap<String, Any>()

    /** 缓存键集中在这里，避免各处手写字符串拼错。 */
    object Key {
        const val ME_AVATAR = "me.avatar"
        const val ME_MEMBERSHIP = "me.membership"
        const val ME_CARD_COUNT = "me.cards"
        const val NOTIFY_NOTICES = "notify.notices"
        const val NOTIFY_AA_COUNT = "notify.aaCount"
        const val TX_PARTITIONS = "tx.partitions"
        const val TX_ROWS = "tx.rows"
        const val TX_TOTAL = "tx.total"
    }

    fun <T : Any> get(key: String): T? {
        @Suppress("UNCHECKED_CAST")
        return values[key] as T?
    }

    fun put(key: String, value: Any?) {
        if (value == null) values.remove(key) else values[key] = value
    }

    fun clear() = values.clear()
}
