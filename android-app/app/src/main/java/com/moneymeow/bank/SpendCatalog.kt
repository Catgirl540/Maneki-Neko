// Generated from shared/spend-platforms.mjs by tools/check-android-catalog.mjs --write.
package com.moneymeow.bank

internal data class SpendPlatform(val id: String, val name: String, val subscriptionAmount: Long = 0, val custom: Boolean = false)
internal val spendPlatforms = listOf(
    SpendPlatform("meituan", "美团外卖", 0L, false),
    SpendPlatform("taobao", "淘宝", 0L, false),
    SpendPlatform("jd", "京东", 0L, false),
    SpendPlatform("pinduoduo", "拼多多", 0L, false),
    SpendPlatform("didi", "滴滴出行", 0L, false),
    SpendPlatform("luckin", "瑞幸咖啡", 0L, false),
    SpendPlatform("starbucks", "星巴克", 0L, false),
    SpendPlatform("hema", "盒马鲜生", 0L, false),
    SpendPlatform("iqiyi", "爱奇艺会员", 2500L, false),
    SpendPlatform("netease-music", "网易云音乐", 2500L, false),
    SpendPlatform("tencent-video", "腾讯视频", 3000L, false),
    SpendPlatform("baidu-drive", "百度网盘", 3000L, false),
    SpendPlatform("china-mobile", "中国移动话费", 0L, false),
    SpendPlatform("ziroom", "自如房租", 0L, false),
    SpendPlatform("maoyan", "猫眼电影", 0L, false),
    SpendPlatform("custom", "自定义商家", 0L, true),
    SpendPlatform("stripe", "Stripe", 0L, true),
)
