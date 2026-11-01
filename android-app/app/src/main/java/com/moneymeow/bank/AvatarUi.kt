package com.moneymeow.bank

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 用户头像：头像池里的图裁成圆形；未知/缺失 id 退回品牌猫，不显示空白。
 *
 * 网页端等价实现是 `app/src/components/ui/Avatar.tsx`，两端口径一致。
 */
@Composable
fun UserAvatar(avatarId: String?, size: Dp = 54.dp, modifier: Modifier = Modifier) {
    val drawable = AvatarPool.drawableOf(avatarId)
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Tokens.SurfaceWarm)
            .border(1.dp, Tokens.Border, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (drawable != 0) {
            Image(
                painter = painterResource(drawable),
                contentDescription = "用户头像",
                modifier = Modifier.fillMaxSize().clip(CircleShape),
                contentScale = ContentScale.Crop,
            )
        } else {
            Image(
                painter = painterResource(R.drawable.brand_cat),
                contentDescription = null,
                modifier = Modifier.size(size * 0.8f),
                contentScale = ContentScale.Fit,
            )
        }
    }
}
