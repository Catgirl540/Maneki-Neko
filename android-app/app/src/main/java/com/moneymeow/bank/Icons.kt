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
    val Pig = icon("pig", "M5 12a6 6 0 0 1 12-2.5c1.8.3 3 1.6 3 3.5a3.4 3.4 0 0 1-2 3.1V19h-2.5l-.6-1h-3.8l-.6 1H8v-2.6A6 6 0 0 1 5 12z", "M14.5 6.5c1 0 2-.3 2.5-1 .5 1.2 0 2.5-1 3")
    val Globe = icon("globe", "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M3.5 12h17", "M12 3.5c2.8 2.4 4.2 5.2 4.2 8.5s-1.4 6.1-4.2 8.5c-2.8-2.4-4.2-5.2-4.2-8.5S9.2 5.9 12 3.5z")
    val Transfer = icon("transfer", "M7.5 9.5h9M14 7l2.5 2.5L14 12", "M16.5 14.5h-9M10 12.5 7.5 15l2.5 2.5")
    val Filter = icon("filter", "M4 5.5h16l-6.2 7.3v5.4L10.2 20v-7.2z")
    val Dots = icon("dots", "M6 12h.01M12 12h.01M18 12h.01")
}
