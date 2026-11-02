package com.moneymeow.bank

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * 线性图标：路径直接取自网页端 `app/src/components/ui/icons.tsx` 与移动端设计稿，
 * 24 viewBox、1.6 描边、圆角端点，靠 `Icon(tint = …)` 上色。
 */
object Icons {
    private val pathsByName = HashMap<String, Array<out String>>()
    private val boldCache = java.util.concurrent.ConcurrentHashMap<ImageVector, ImageVector>()

    private fun build(name: String, stroke: Float, paths: Array<out String>): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            paths.forEach { d ->
                addPath(
                    pathData = addPathNodes(d),
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = stroke,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    private fun icon(name: String, vararg paths: String): ImageVector {
        pathsByName[name] = paths
        return build(name, 1.6f, paths)
    }

    /**
     * 同一路径加粗重建：列表行不再放背景填充，改用更粗的描边保持识别度。
     * 结果按图标缓存，避免每次重组都重建矢量。
     */
    fun bolder(icon: ImageVector, stroke: Float = 2.1f): ImageVector =
        boldCache.getOrPut(icon) {
            val paths = pathsByName[icon.name] ?: return@getOrPut icon
            build(icon.name + "-bold", stroke, paths)
        }

    val Home = icon("home", "M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z", "M9.5 20.5v-6h5v6")
    val Wealth = icon("wealth", "M4 19.5V10", "M9.5 19.5V5.5", "M15 19.5v-8", "M20 19.5V8", "m4 8 5-3.5L14 8l6-4")
    val Bell = icon("bell", "M18 9.5a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6", "M10 19.5a2.2 2.2 0 0 0 4 0")
    val Person = icon("person", "M12 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z", "M5.5 20a6.5 6.5 0 0 1 13 0")
    val Plus = icon("plus", "M12 5v14M5 12h14")
    val Chevron = icon("chevron", "m9.5 6 6 6-6 6")
    val Eye = icon("eye", "M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z", "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z")
    val Search = icon("search", "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", "m20 20-4.2-4.2")
    val DownIn = icon("down-in", "M12 4v11", "m7 11 5 5 5-5", "M5 20h14")
    val UpOut = icon("up-out", "M12 20V9", "m7 13 5-5 5 5", "M5 4h14")
    val Card = icon("card", "M5 5h14a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 19H5a2.5 2.5 0 0 1-2.5-2.5v-9A2.5 2.5 0 0 1 5 5z", "M2.5 9.5h19", "M6.5 15h3")
    val Receipt = icon("receipt", "M6 4h12a1 1 0 0 1 1 1v15l-2.5-1.6L14 20l-2-1.4L10 20l-2.5-1.6L5 20V5a1 1 0 0 1 1-1z", "M9 9.5h6M9 13h4")
    val Pig = icon(
        "pig",
        "M4.6 13.2c0-4 3.3-7.2 7.4-7.2s7.4 3.2 7.4 7.2c0 2-.8 3.8-2.1 5.1V21h-2.5v-1.3h-4.2V21H8.1v-2.6c-2.1-1.3-3.5-3.2-3.5-5.2z",
        "M8.6 7.6 10.4 9.9",
        "M10.6 7.4h3.2",
        "M9.5 12.4h.01",
    )
    val Globe = icon("globe", "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M3.5 12h17", "M12 3.5c2.8 2.4 4.2 5.2 4.2 8.5s-1.4 6.1-4.2 8.5c-2.8-2.4-4.2-5.2-4.2-8.5S9.2 5.9 12 3.5z")
    val Transfer = icon("transfer", "M7.5 9.5h9M14 7l2.5 2.5L14 12", "M16.5 14.5h-9M10 12.5 7.5 15l2.5 2.5")
    val Filter = icon("filter", "M4 5.5h16l-6.2 7.3v5.4L10.2 20v-7.2z")
    val Check = icon("check", "M5 12.5L9.5 17L19 7.5")
    val Play = icon("play", "M8 5.5L18.5 12L8 18.5z")
    val Refresh = icon("refresh", "M20 12a8 8 0 1 1-2.3-5.6", "M20 4v4.5h-4.5")
    val Edit = icon("edit", "M14.5 5.5L18.5 9.5L9 19H5v-4z", "M13 7L17 11")
    val Copy = icon("copy", "M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z", "M5 15V6a2 2 0 0 1 2-2h9")
    val Send = icon("send", "M4.5 12L20 4.5L15.5 12L20 19.5L4.5 12z", "M15.5 12H4.5")
    val Compose = icon("compose", "M14.5 5.5L18.5 9.5L9 19H5v-4z", "M13 7L17 11")
    val Hist = icon("hist", "M4 6.5h16", "M4 12h16", "M4 17.5h10")
    val Mic = icon("mic", "M12 3.5a3 3 0 0 1 3 3v4.5a3 3 0 0 1-6 0V6.5a3 3 0 0 1 3-3z", "M5.5 11.5a6.5 6.5 0 0 0 13 0", "M12 18v2.5")
    val Lock = icon("lock", "M7 10.5h10c1.4 0 2.5 1.1 2.5 2.5v4.5c0 1.4-1.1 2.5-2.5 2.5H7c-1.4 0-2.5-1.1-2.5-2.5V13c0-1.4 1.1-2.5 2.5-2.5z", "M8 10.5V8c0-2.2 1.8-4 4-4s4 1.8 4 4v2.5")
    val Shield = icon("shield", "M12 3.5L19 6v6c0 4-3 6.8-7 8.5-4-1.7-7-4.5-7-8.5V6z", "M9 12l2.2 2.2L15.5 10")
    val Phone = icon("phone", "M9.5 3h5c1.4 0 2.5 1.1 2.5 2.5v13c0 1.4-1.1 2.5-2.5 2.5h-5C8.1 21 7 19.9 7 18.5v-13C7 4.1 8.1 3 9.5 3z", "M10.5 17.5h3")
    val ImageIcon = icon("image", "M6 4.5h12c1.4 0 2.5 1.1 2.5 2.5v10c0 1.4-1.1 2.5-2.5 2.5H6c-1.4 0-2.5-1.1-2.5-2.5V7c0-1.4 1.1-2.5 2.5-2.5z", "M9 8.4c.9 0 1.6.7 1.6 1.6s-.7 1.6-1.6 1.6-1.6-.7-1.6-1.6.7-1.6 1.6-1.6z", "M5 17.5l4.5-4.5 3 3 2.5-2.5 4 4")
    val Help = icon("help", "M12 3.5c4.7 0 8.5 3.8 8.5 8.5s-3.8 8.5-8.5 8.5S3.5 16.7 3.5 12 7.3 3.5 12 3.5z", "M9.6 9.4c.4-1.2 1.7-1.9 3-1.5 1.3.4 2 1.6 1.8 2.8-.2 1.3-2.4 1.6-2.4 2.9", "M12 16.8h.01")
    val Info = icon("info", "M12 3.5c4.7 0 8.5 3.8 8.5 8.5s-3.8 8.5-8.5 8.5S3.5 16.7 3.5 12 7.3 3.5 12 3.5z", "M12 11v5.5", "M12 8h.01")
    val Food = icon("food", "M6.5 4v7", "M10 4v7", "M6.5 11H10v9", "M6.5 20v-9", "M15.5 4c-1.8 2-2.5 4.5-2.5 7v9", "M15.5 4v16")
    val Shop = icon("shop", "M4.5 8L6 4.5h12L19.5 8v11c0 .8-.7 1.5-1.5 1.5H6c-.8 0-1.5-.7-1.5-1.5z", "M4.5 8h15", "M9.5 12h5")
    val Dots = icon("dots", "M6 12h.01M12 12h.01M18 12h.01")
    val Trash = icon("trash", "M4.5 6.5h15", "M9.5 6.5V4.8h5v1.7", "M6.8 6.5l.8 13h8.8l.8-13", "M10.2 10.5v6M13.8 10.5v6")
    val Wallet = icon("wallet", "M4 7V5.5A2 2 0 0 1 6 3.5h12V7", "M4 7h15a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 19 20H5a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1z", "M20 11h-5v5h5", "M17 13.5h.01")
    val Clock = icon("clock", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3.5 2")
    val Chart = icon("chart", "M4 4v16h16", "M8 15v-4M12 15V7M16 15V9")
    val Budget = icon("budget", "M5 4h14v16H5z", "M8 8h8M8 12h3M8 16h3M15 12v4M13 14h4")
    val Portfolio = icon("portfolio", "M8 7V4h8v3", "M4 7h16v13H4z", "M4 12a22 22 0 0 0 16 0", "M10 12v3h4v-3")
    val Crown = icon("crown", "M4 7l4 4 4-6 4 6 4-4-2 11H6z", "M7 21h10")
    val Gift = icon("gift", "M3 8h18v4H3z", "M5 12v9h14v-9M12 8v13", "M12 8C5 8 5 2 8.5 3 11 3.5 12 8 12 8z", "M12 8s1-4.5 3.5-5C19 2 19 8 12 8z")

    /** 扫码：四个取景角 + 中间一道扫描线。 */
    val Scan = icon(
        "scan",
        "M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9",
        "M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9",
        "M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15",
        "M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15",
        "M4 12h16",
    )

    /** 二维码：三个定位角 + 右下三个点。 */
    val Qr = icon(
        "qr",
        "M4 4h6v6H4z",
        "M14 4h6v6h-6z",
        "M4 14h6v6H4z",
        "M14 14.5h2.2v2.2H14z",
        "M17.8 14.5H20v2.2h-2.2z",
        "M14 17.8h2.2V20H14z",
    )
}
