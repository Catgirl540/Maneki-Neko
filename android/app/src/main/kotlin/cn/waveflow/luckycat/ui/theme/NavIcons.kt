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

/** Business icons use tintable Android vector resources; brand artwork is separate. */
enum class NavIcon(@DrawableRes val res: Int) {
    Home(R.drawable.ic_home),
    Transfer(R.drawable.ic_transfer),
    Support(R.drawable.ic_support),
    Wealth(R.drawable.ic_wealth),
    Profile(R.drawable.ic_profile),
    Card(R.drawable.ic_card),
    Add(R.drawable.ic_add),
    Lock(R.drawable.ic_lock),
    Globe(R.drawable.ic_globe),

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
