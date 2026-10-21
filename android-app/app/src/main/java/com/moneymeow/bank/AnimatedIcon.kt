package com.moneymeow.bank

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathNode
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.sin

/**
 * 底栏图标的「线条画出来」动画：把每条 path 用 PathMeasure 截一段，
 * 按 460ms 逐段推进、段间隔 140ms（与设计稿一致）。
 *
 * 触发方式：`tick` 变化时重播；tick 不变则保持画完的状态。
 */
@Composable
fun DrawnIcon(
    paths: List<String>,
    color: Color,
    tick: Int,
    modifier: Modifier = Modifier,
    size: Dp = 23.dp,
) {
    val parsed = remember(paths) { paths.map { it.toPath() } }
    val lengths = remember(parsed) {
        parsed.map { path ->
            PathMeasure().apply { setPath(path, false) }.length
        }
    }
    // 与设计稿同一套时间：每段 460ms，段间延迟 140ms
    val drawMs = 460f
    val staggerMs = 140f
    val totalMs = drawMs + staggerMs * (parsed.size - 1)
    val progress = remember { Animatable(1f) }

    LaunchedEffect(tick) {
        // 首次挂载保持画完；只有点击（tick 变化）才重播
        if (tick == 0) {
            progress.snapTo(1f)
            return@LaunchedEffect
        }
        progress.snapTo(0f)
        progress.animateTo(1f, tween(durationMillis = totalMs.toInt(), easing = LinearEasing))
    }

    Canvas(modifier.then(Modifier.size(size))) {
        val scale = this.size.minDimension / 24f
        val p = progress.value * totalMs
        withTransform({ scale(scale, scale, androidx.compose.ui.geometry.Offset.Zero) }) {
            parsed.forEachIndexed { index, path ->
                val raw = ((p - index * staggerMs) / drawMs).coerceIn(0f, 1f)
                if (raw <= 0f) return@forEachIndexed
                // 设计稿每段独立走 cubic-bezier(.4, 0, .2, 1)
                val local = StandardOutSlowIn.transform(raw)
                val drawn = if (local >= 0.999f) {
                    path
                } else {
                    Path().also { dest ->
                        PathMeasure()
                            .apply { setPath(path, false) }
                            .getSegment(0f, (lengths[index] * local).coerceAtMost(lengths[index] - 0.01f), dest, true)
                    }
                }
                drawPath(
                    drawn,
                    color,
                    style = Stroke(
                        width = 1.6f,
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round,
                    ),
                )
            }
        }
    }
}

/** 设计稿里四个底栏图标的原始 path（与网页 icons.tsx 同一套）。 */
object TabIconPaths {
    val home = listOf(
        "M4 10.5 12 4l8 6.5V20.5H4z",
        "M9.5 20.5v-6h5v6",
    )
    val wealth = listOf(
        "M4 19.5L4 10",
        "M9.5 19.5L9.5 5.5",
        "M15 19.5L15 11.5",
        "M20 19.5L20 8",
        "M4 8L9 4.5L14 8L20 4",
    )
    val bell = listOf(
        "M18 9.5c0-3.3-2.7-6-6-6s-6 2.7-6 6c0 5-2 6-2 6h16s-2-1-2-6",
        "M10 19.5c0 1.1.9 2 2 2s2-.9 2-2",
    )
    val person = listOf(
        "M12 5c1.9 0 3.5 1.6 3.5 3.5S13.9 12 12 12 8.5 10.4 8.5 8.5 10.1 5 12 5z",
        "M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5",
    )
}

/* ── PathNode → Path（Compose 没暴露公开的转换器，这里手写一份） ── */

private fun String.toPath(): Path {
    val builder = PathBuilder()
    addPathNodes(this).forEach(builder::apply)
    return builder.path
}

/** 手写 PathNode → Path：H/V 与反射曲线需要维护当前点与上一控制点。 */
private class PathBuilder {
    val path = Path()
    private var cx = 0f
    private var cy = 0f
    private var lastCtrlX = 0f
    private var lastCtrlY = 0f
    private var afterCurve = false

    fun apply(node: PathNode) {
        when (node) {
            is PathNode.MoveTo -> moveTo(node.x, node.y)
            is PathNode.RelativeMoveTo -> moveTo(cx + node.dx, cy + node.dy)
            is PathNode.LineTo -> lineTo(node.x, node.y)
            is PathNode.RelativeLineTo -> lineTo(cx + node.dx, cy + node.dy)
            is PathNode.HorizontalTo -> lineTo(node.x, cy)
            is PathNode.RelativeHorizontalTo -> lineTo(cx + node.dx, cy)
            is PathNode.VerticalTo -> lineTo(cx, node.y)
            is PathNode.RelativeVerticalTo -> lineTo(cx, cy + node.dy)
            is PathNode.CurveTo -> curve(node.x1, node.y1, node.x2, node.y2, node.x3, node.y3)
            is PathNode.RelativeCurveTo -> curve(cx + node.dx1, cy + node.dy1, cx + node.dx2, cy + node.dy2, cx + node.dx3, cy + node.dy3)
            is PathNode.ReflectiveCurveTo -> reflectiveCurve(node.x1, node.y1, node.x2, node.y2)
            is PathNode.RelativeReflectiveCurveTo -> reflectiveCurve(cx + node.dx1, cy + node.dy1, cx + node.dx2, cy + node.dy2)
            is PathNode.QuadTo -> quad(node.x1, node.y1, node.x2, node.y2)
            is PathNode.RelativeQuadTo -> quad(cx + node.dx1, cy + node.dy1, cx + node.dx2, cy + node.dy2)
            is PathNode.ArcTo -> arc(node.horizontalEllipseRadius, node.verticalEllipseRadius, node.theta, node.isMoreThanHalf, node.isPositiveArc, node.arcStartX, node.arcStartY)
            is PathNode.RelativeArcTo -> arc(node.horizontalEllipseRadius, node.verticalEllipseRadius, node.theta, node.isMoreThanHalf, node.isPositiveArc, cx + node.arcStartDx, cy + node.arcStartDy)
            is PathNode.Close -> {
                path.close()
                afterCurve = false
            }
            else -> Unit
        }
    }

    private fun moveTo(x: Float, y: Float) {
        path.moveTo(x, y)
        cx = x; cy = y; afterCurve = false
    }

    private fun lineTo(x: Float, y: Float) {
        path.lineTo(x, y)
        cx = x; cy = y; afterCurve = false
    }

    private fun curve(x1: Float, y1: Float, x2: Float, y2: Float, x3: Float, y3: Float) {
        path.cubicTo(x1, y1, x2, y2, x3, y3)
        lastCtrlX = x2; lastCtrlY = y2
        cx = x3; cy = y3; afterCurve = true
    }

    private fun reflectiveCurve(x1: Float, y1: Float, x2: Float, y2: Float) {
        val rx = if (afterCurve) 2 * cx - lastCtrlX else cx
        val ry = if (afterCurve) 2 * cy - lastCtrlY else cy
        path.cubicTo(rx, ry, x1, y1, x2, y2)
        lastCtrlX = x1; lastCtrlY = y1
        cx = x2; cy = y2; afterCurve = true
    }

    private fun quad(x1: Float, y1: Float, x2: Float, y2: Float) {
        path.quadraticTo(x1, y1, x2, y2)
        lastCtrlX = x1; lastCtrlY = y1
        cx = x2; cy = y2; afterCurve = true
    }

    /** Compose 的 Path 只有 rect 版 arcTo；动画图标改用无弧线的等价路径，这里直接落到终点。 */
    private fun arc(rx: Float, ry: Float, theta: Float, large: Boolean, positive: Boolean, x: Float, y: Float) {
        lineTo(x, y)
    }
}

/** 设计稿 stroke / sheet / drawer 共用的 cubic-bezier(.4, 0, .2, 1)。 */
val StandardOutSlowIn = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)

/** 设计稿猫钮探身 cubic-bezier(.22, 1, .36, 1)。 */
val CatPeekEasing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

private fun lerp(a: Float, b: Float, t: Float): Float = a + (b - a) * t.coerceIn(0f, 1f)

/**
 * 设计稿 @keyframes cat-peek（整体时长 520ms，每段关键帧之间按 cubic-bezier(.22,1,.36,1) 插值）：
 *   0%   translateY(0)    rotate(0deg)
 *   35%  translateY(-6px) rotate(-7deg)
 *   70%  translateY(+2px) rotate(3deg)
 *   100% translateY(0)    rotate(0deg)
 */
fun peekRotation(progress: Float): Float = when {
    progress <= 0f || progress >= 1f -> 0f
    progress < 0.35f -> lerp(0f, -7f, CatPeekEasing.transform(progress / 0.35f))
    progress < 0.70f -> lerp(-7f, 3f, CatPeekEasing.transform((progress - 0.35f) / 0.35f))
    else -> lerp(3f, 0f, CatPeekEasing.transform((progress - 0.70f) / 0.30f))
}

/** 返回向上位移的 dp 值（正值表示向上，负值表示向下回摆）。 */
fun peekLiftDp(progress: Float): Float = when {
    progress <= 0f || progress >= 1f -> 0f
    progress < 0.35f -> lerp(0f, 6f, CatPeekEasing.transform(progress / 0.35f))
    progress < 0.70f -> lerp(6f, -2f, CatPeekEasing.transform((progress - 0.35f) / 0.35f))
    else -> lerp(-2f, 0f, CatPeekEasing.transform((progress - 0.70f) / 0.30f))
}

/**
 * 设计稿 @keyframes btn-pop：
 *   0%   scale(1)
 *   40%  scale(1.07)
 *   100% scale(1)
 */
fun peekBtnScale(progress: Float): Float = when {
    progress <= 0f || progress >= 1f -> 1f
    progress < 0.40f -> lerp(1f, 1.07f, CatPeekEasing.transform(progress / 0.40f))
    else -> lerp(1.07f, 1f, CatPeekEasing.transform((progress - 0.40f) / 0.60f))
}

