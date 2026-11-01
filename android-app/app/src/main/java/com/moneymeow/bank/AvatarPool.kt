package com.moneymeow.bank

import androidx.annotation.DrawableRes

/**
 * 头像池（与 `shared/avatars.mjs` 一一对应，改这里要同步跑 `tools/check-avatar-pool.mjs`）。
 *
 * 头像只从这 10 张里选，不做上传；服务端存的是 `avatar-01` 这类字符串 id。
 */
object AvatarPool {

    /** 展示顺序与服务端、网页端一致。 */
    val ids: List<String> = listOf(
        "avatar-01",
        "avatar-02",
        "avatar-03",
        "avatar-04",
        "avatar-05",
        "avatar-06",
        "avatar-07",
        "avatar-08",
        "avatar-09",
        "avatar-10",
    )

    /** 未知 id 时返回 0，界面回退到品牌猫图标。 */
    @DrawableRes
    fun drawableOf(id: String?): Int = when (id) {
        "avatar-01" -> R.drawable.avatar_01
        "avatar-02" -> R.drawable.avatar_02
        "avatar-03" -> R.drawable.avatar_03
        "avatar-04" -> R.drawable.avatar_04
        "avatar-05" -> R.drawable.avatar_05
        "avatar-06" -> R.drawable.avatar_06
        "avatar-07" -> R.drawable.avatar_07
        "avatar-08" -> R.drawable.avatar_08
        "avatar-09" -> R.drawable.avatar_09
        "avatar-10" -> R.drawable.avatar_10
        else -> 0
    }
}
