package com.moneymeow.bank

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp

/**
 * 骨架屏：加载时用轻微呼吸的灰块占位，避免"加载中…"文字造成布局跳变。
 * 颜色只用主题里的描边色，不引入新的品牌色。
 */
@Composable
fun SkeletonBox(modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(6.dp)) {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.85f,
        animationSpec = infiniteRepeatable(tween(760, easing = LinearEasing), RepeatMode.Reverse),
        label = "skeleton-alpha",
    )
    Box(modifier.clip(shape).background(Tokens.Border.copy(alpha = alpha)))
}

/** 流水/通知行：图标位置 + 两行文字。 */
@Composable
fun SkeletonRow(showCircle: Boolean = true) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SkeletonBox(
            Modifier.size(22.dp),
            if (showCircle) CircleShape else RoundedCornerShape(6.dp),
        )
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            SkeletonBox(Modifier.fillMaxWidth(0.42f).height(13.dp), RoundedCornerShape(4.dp))
            SkeletonBox(Modifier.fillMaxWidth(0.28f).height(10.dp), RoundedCornerShape(4.dp))
        }
        Spacer(Modifier.width(10.dp))
        SkeletonBox(Modifier.width(52.dp).height(13.dp), RoundedCornerShape(4.dp))
    }
}

/** 首页余额区：大号金额占位 + 一行账号说明。 */
@Composable
fun SkeletonBalance() {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SkeletonBox(Modifier.width(196.dp).height(34.dp), RoundedCornerShape(6.dp))
        SkeletonBox(Modifier.width(120.dp).height(11.dp), RoundedCornerShape(4.dp))
    }
}

/** 列表卡片骨架：一张卡片的轮廓，用于银行卡等卡片型加载态。 */
@Composable
fun SkeletonCardFace() {
    SkeletonBox(
        Modifier
            .width(296.dp)
            .aspectRatio(1.62f)
            .padding(horizontal = 14.dp),
        RoundedCornerShape(10.dp),
    )
}

/** 白卡内三行占位，用于通知/预算等卡片列表。 */
@Composable
fun SkeletonCardLines(rows: Int = 2) {
    Column(
        Modifier.fillMaxWidth().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        SkeletonBox(Modifier.fillMaxWidth(0.45f).height(13.dp), RoundedCornerShape(4.dp))
        repeat(rows) {
            SkeletonBox(Modifier.fillMaxWidth(if (it % 2 == 0) 0.9f else 0.65f).height(11.dp), RoundedCornerShape(4.dp))
        }
    }
}

/** 列表页骨架：若干张白卡，每张若干行灰条，用于二级页首次加载。 */
@Composable
fun SkeletonCardList(cards: Int = 3, rows: Int = 3) {
    repeat(cards) { HairlineCard(Modifier.fillMaxWidth()) { SkeletonCardLines(rows) } }
}

/** 统一的下拉刷新容器：白底指示器 + 近黑转圈，避免默认紫色圆盘。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BankPullRefresh(
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val state = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        modifier = modifier,
        state = state,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = state,
                isRefreshing = isRefreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                containerColor = Tokens.Surface,
                color = Tokens.Ink,
            )
        },
        content = content,
    )
}