package cn.waveflow.luckycat.ui.theme

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.R

/**
 * 全站图标。**矢量资源（`res/drawable/ic_*.xml`），不引图标库。**
 *
 * ## 为什么从 Canvas 改成矢量资源
 *
 * 原来这 6 个图标是 `Canvas` + `drawPath` 画的。改的起因是客服输入栏那两个
 * **彩色 emoji**（U+1F5BC、U+1F3A4）：它们由系统 emoji 字体渲染，彩色、
 * 字面体量比 22–24dp 的图形大一档、还不吃品牌色，夹在金色/奶油这一套里非常突兀。
 * 把 emoji 换成图标时顺带把整套统一到一种实现上——否则会同时存在
 * "Canvas 画的导航图标"和"矢量资源画的输入栏图标"两套东西。
 *
 * 矢量资源就是安卓的 SVG 等价物：`pathData` 用的就是 SVG 的路径语法，
 * Android Studio 的「Vector Asset」导入 SVG 也是转成这个格式。
 * 真 `.svg` 文件需要 `coil-svg` / `androidsvg` 之类的运行时解析，多一个依赖、
 * 多一份运行时代价，换不来什么。
 *
 * ## 形状没变
 *
 * 6 个老图标是**逐点平移**：原来的坐标是 `w * 0.10f` 这类比例，乘 24 就是
 * 24 格里的绝对值。线宽原来写 `size * 0.11f`（22dp 下 2.42dp），
 * 所以资源里写 `strokeWidth="2.64"`（`2.64 * 22 / 24 = 2.42`），粗细一致。
 *
 * ## 上色靠 tint，所以资源里不能写死颜色
 *
 * `ColorFilter.tint` 是 SRC_IN：它把**所有非透明像素**替换成传入的颜色。
 * 因此资源里 `fillColor` 必须是透明（`#00000000`）——写了实色的话，
 * 整个图形会被填成实心色块，描边图标就变成一个圆点。
 *
 * 每个图标都画在**自己那个正方形里**，尺寸由 [size] 定，与外圈那个圆/方底无关
 * （底由调用方画）。
 */
enum class NavIcon(@DrawableRes val res: Int) {
    Home(R.drawable.ic_home),
    Transfer(R.drawable.ic_transfer),
    Support(R.drawable.ic_support),
    Wealth(R.drawable.ic_wealth),
    Profile(R.drawable.ic_profile),
    Card(R.drawable.ic_card),

    /** 输入栏：选图。 */
    Image(R.drawable.ic_image),

    /** 输入栏：按住说话。 */
    Mic(R.drawable.ic_mic),

    /** 输入栏：发送。 */
    Send(R.drawable.ic_send),
}

/**
 * 画一个图标。
 *
 * `contentDescription` 一律为 null：这些图标全都画在**带 `testTag` 的可点区域**里，
 * 它们的语义由那边的 `Modifier.semantics { contentDescription = … }` 提供。
 * 在这里再给一份会让读屏把同一个按钮念两遍。
 */
@Composable
fun NavGlyph(icon: NavIcon, color: Color, size: Dp = 22.dp, modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(icon.res),
        contentDescription = null,
        colorFilter = ColorFilter.tint(color),
        modifier = modifier.size(size),
    )
}
