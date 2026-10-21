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
    private fun icon(name: String, vararg paths: String): ImageVector =
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
                    strokeLineWidth = 1.6f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

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
}
