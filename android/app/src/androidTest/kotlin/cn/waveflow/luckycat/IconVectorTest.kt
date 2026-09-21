package cn.waveflow.luckycat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import androidx.core.content.ContextCompat
import androidx.test.core.app.ApplicationProvider
import cn.waveflow.luckycat.ui.theme.NavIcon
import org.junit.Assert.assertTrue
import kotlin.math.abs
import org.junit.Test

/**
 * 九个图标资源**真的画得出来**，而且**吃得上品牌色**。
 *
 * ## 为什么值得单独钉一条
 *
 * 换矢量资源（`res/drawable/ic_*.xml`）时有两个只在真机上才看得见的坑：
 *
 * 1. `pathData` 写错 → 图标是**空白**的。AAPT 不报错，编译一定能过；
 * 2. `fillColor` 写成实色 → `ColorFilter.tint` 是 SRC_IN，"所有非透明像素"
 *    会被整片染成主色，描边图标**变成一块实心方块**。
 *
 * 第 2 条**不在这里判**，它由 `gate.sh` 的静态检查负责（"每条 path 的
 * `fillColor` 必须是 `#00000000`"）。原因是量过一遍覆盖率之后发现像素阈值
 * 判别不了它：**描边**形态下最高的一个才 0.395（image），而**填实**的 home
 * 是 0.544——听着能分开，但话筒那种小形状填实之后覆盖率反而可能更低，
 * 一个全局阈值不是漏判就是误判。透明度是资源里的一个**静态事实**，
 * 用静态检查表达它比用一个凑出来的比例阈值诚实。
 *
 * 这里保留的覆盖率区间（2%–60%）只用来抓"空白"和"极端大色块"，
 * 区间取得宽是**故意的**：以后微调线宽、改一笔路径都不该让这条红。
 */
class IconVectorTest {

    private val context = ApplicationProvider.getApplicationContext<Context>()

    /** 画到 96×96 的位图上，返回 (非透明像素占比, 非透明像素的平均 RGB)。 */
    private fun render(icon: NavIcon, tint: Int? = null): Pair<Double, Int> {
        val size = 96
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val drawable = ContextCompat.getDrawable(context, icon.res)!!
        drawable.setBounds(0, 0, size, size)
        if (tint != null) {
            drawable.colorFilter = PorterDuffColorFilter(tint, PorterDuff.Mode.SRC_IN)
        }
        drawable.draw(Canvas(bitmap))

        var opaque = 0
        var sumR = 0L
        var sumG = 0L
        var sumB = 0L
        for (x in 0 until size) {
            for (y in 0 until size) {
                val p = bitmap.getPixel(x, y)
                if (p ushr 24 != 0) {
                    opaque++
                    sumR += (p shr 16) and 0xFF
                    sumG += (p shr 8) and 0xFF
                    sumB += p and 0xFF
                }
            }
        }
        val avg = if (opaque == 0) {
            0
        } else {
            ((sumR / opaque).toInt() shl 16) or ((sumG / opaque).toInt() shl 8) or (sumB / opaque).toInt()
        }
        return opaque.toDouble() / (size * size) to avg
    }

    @Test
    fun 九个图标都画得出内容且覆盖率合理() {
        NavIcon.entries.forEach { icon ->
            val ratio = render(icon).first
            assertTrue("$icon 什么都没画出来（pathData 大概写错了）：非透明占比 $ratio", ratio > 0.02)
            assertTrue("$icon 底色占了几乎整张图，大概不是描边图标：非透明占比 $ratio", ratio < 0.60)
        }
    }

    @Test
    fun 图标吃得上品牌色() {
        // #9C7226 = Palette.accentDeep / tokens.css 的 --color-gold-deep
        val want = 0x9C7226
        NavIcon.entries.forEach { icon ->
            val (ratio, avg) = render(icon, 0xFF000000.toInt() or want)
            assertTrue("$icon 覆盖率异常：$ratio", ratio > 0.02)
            val dR = abs(((avg shr 16) and 0xFF) - ((want shr 16) and 0xFF))
            val dG = abs(((avg shr 8) and 0xFF) - ((want shr 8) and 0xFF))
            val dB = abs((avg and 0xFF) - (want and 0xFF))
            // 容差 2：光栅化可能有 ±1 的取整，只有"整体不是这个色"才算失败
            assertTrue(
                "$icon 没被 tint 成品牌色（实际平均 RGB=#${"%06X".format(avg)}）：" +
                    "资源里可能写死了颜色，或 tint 没生效",
                dR <= 2 && dG <= 2 && dB <= 2,
            )
        }
    }
}
