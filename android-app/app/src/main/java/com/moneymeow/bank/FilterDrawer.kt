package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class FilterGroup(val title: String, val options: List<String>)

/** 右侧筛选抽屉（设计稿 33 / 43）：分组单选，底部重置与应用。 */
@Composable
fun FilterDrawer(
    title: String,
    groups: List<FilterGroup>,
    visible: Boolean,
    onClose: () -> Unit,
    onApply: (Map<String, String>) -> Unit,
) {
    val selection = remember { mutableStateMapOf<String, String>() }
    androidx.compose.animation.AnimatedVisibility(
        visible = visible,
        enter = androidx.compose.animation.slideInHorizontally(
            initialOffsetX = { it },
            animationSpec = androidx.compose.animation.core.tween(280, easing = StandardOutSlowIn),
        ) + androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(220)),
        exit = androidx.compose.animation.slideOutHorizontally(
            targetOffsetX = { it },
            animationSpec = androidx.compose.animation.core.tween(280, easing = StandardOutSlowIn),
        ) + androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(220)),
    ) {
        Box(Modifier.fillMaxSize()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.28f))
                    .clickable { onClose() }
            )
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .fillMaxWidth(0.8f)
                    .background(Tokens.Surface)
            ) {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    Spacer(Modifier.height(14.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                        Text(
                            "›",
                            fontSize = 20.sp,
                            color = Tokens.Ink2,
                            modifier = Modifier.clickable { onClose() },
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .verticalScroll(rememberScrollState()),
                    ) {
                        groups.forEach { group ->
                            Text(group.title, fontSize = 11.sp, color = Tokens.Muted)
                            Spacer(Modifier.height(8.dp))
                            group.options.chunked(4).forEach { row ->
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    row.forEach { option ->
                                        val current = selection[group.title] ?: group.options.first()
                                        val on = current == option
                                        Box(
                                            Modifier
                                                .clip(RoundedCornerShape(14.dp))
                                                .background(if (on) Tokens.Primary else Tokens.Surface)
                                                .border(
                                                    1.dp,
                                                    if (on) Tokens.Primary else Tokens.Border,
                                                    RoundedCornerShape(14.dp),
                                                )
                                                .clickable { selection[group.title] = option }
                                                .padding(horizontal = 12.dp, vertical = 6.dp),
                                        ) {
                                            Text(
                                                option,
                                                fontSize = 11.5.sp,
                                                color = if (on) Color.White else Tokens.Ink2,
                                            )
                                        }
                                    }
                                    repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                                }
                                Spacer(Modifier.height(8.dp))
                            }
                            Spacer(Modifier.height(10.dp))
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Box(
                            Modifier
                                .weight(1f)
                                .height(44.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Tokens.Surface)
                                .border(1.dp, Tokens.Border, RoundedCornerShape(8.dp))
                                .clickable {
                                    groups.forEach { selection.remove(it.title) }
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("重置", fontSize = 14.sp, color = Tokens.Ink)
                        }
                        Box(
                            Modifier
                                .weight(1f)
                                .height(44.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Tokens.Primary)
                                .clickable { onApply(selection.toMap()) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("应用", fontSize = 14.sp, color = Color.White, fontWeight = FontWeight.Medium)
                        }
                    }
                    Spacer(Modifier.height(18.dp))
                }
            }
        }
    }
}


