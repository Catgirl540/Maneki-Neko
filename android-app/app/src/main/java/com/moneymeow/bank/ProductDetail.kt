package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private const val RISK_ACK = "本人已阅读产品说明书与风险揭示，理解「理财非存款、产品有风险、投资须谨慎」，确认本次申购为本人意愿。"

/** 47 产品详情：真实产品参数 + 真实申购。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductDetailScreen(onBack: () -> Unit, productCode: String?) {
    var product by remember { mutableStateOf<WealthProductDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var subscribing by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState()

    LaunchedEffect(productCode) {
        if (!BankApi.hasToken()) return@LaunchedEffect
        runCatching { BankApi.wealthProducts() }
            .onSuccess { list ->
                product = list.firstOrNull { it.code == productCode } ?: list.firstOrNull()
            }
            .onFailure { error = it.message }
    }

    PushScreen(title = "产品详情", onBack = onBack) {
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        product?.name ?: "加载中…",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Ink,
                    )
                    Spacer(Modifier.size(8.dp))
                    product?.let { RiskBadge(it.risk) }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    (product?.code ?: "—") + " · 招财猫理财有限责任公司",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                )
                Spacer(Modifier.height(13.dp))
                Hairline()
                Spacer(Modifier.height(12.dp))
                Text("单位净值", fontSize = 11.sp, color = Tokens.Muted)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        product?.let { String.format("%.4f", it.nav) } ?: "—",
                        fontSize = 24.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Ink,
                    )
                    Spacer(Modifier.size(4.dp))
                    Text(
                        product?.sevenDayYield?.let { "七日年化 " + String.format("%.2f%%", it * 100) } ?: "",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        KvCard(
            listOf(
                "风险等级" to (product?.risk ?: "—"),
                "起购 / 递增" to (product?.let { formatCents(it.minAmount) + " / " + formatCents(it.stepAmount) } ?: "—"),
                "期限与开放性" to (product?.let { it.term.ifEmpty { if (it.openEnded) "随时赎回 · 开放式" else "封闭期" } } ?: "—"),
                "产品类型" to (product?.category?.ifEmpty { "—" } ?: "—"),
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        if (error != null) {
            Text(
                "加载失败：$error",
                fontSize = 11.5.sp,
                color = Tokens.Coral,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton("立即申购", { subscribing = true }, Modifier.padding(horizontal = 14.dp))
        if (done) {
            Spacer(Modifier.height(10.dp))
            Text(
                "申购已受理，可在「持仓」查看",
                fontSize = 12.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
    }

    if (subscribing) {
        var amountText by remember { mutableStateOf("20000") }
        var password by remember { mutableStateOf("") }
        var ack by remember { mutableStateOf(false) }
        var submitError by remember { mutableStateOf<String?>(null) }
        var submitting by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()
        val amountCents = remember(amountText) { amountText.toDoubleOrNull()?.let { Math.round(it * 100) } ?: 0L }

        ModalBottomSheet(
            onDismissRequest = { subscribing = false },
            sheetState = sheetState,
            containerColor = Tokens.Surface,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text(
                    "申购 · " + (product?.name ?: ""),
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Tokens.Ink,
                )
                Spacer(Modifier.height(12.dp))
                KvRow("起购 / 递增", product?.let { formatCents(it.minAmount) + " / " + formatCents(it.stepAmount) } ?: "—")
                KvRow("风险等级", (product?.risk ?: "—") + " · 需与测评匹配")
                Spacer(Modifier.height(8.dp))
                Text("申购金额", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(6.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(46.dp)
                        .clip(CircleShape)
                        .background(Tokens.Surface)
                        .border(1.dp, Tokens.Border, CircleShape)
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    BasicTextField(
                        value = amountText,
                        onValueChange = { amountText = it.filter { ch -> ch.isDigit() || ch == '.' }.take(12) },
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Ink),
                        cursorBrush = SolidColor(Tokens.Accent),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Tokens.SurfaceWarm)
                        .padding(12.dp),
                ) {
                    Text(RISK_ACK, fontSize = 11.5.sp, color = Tokens.Ink2, lineHeight = 18.sp)
                }
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickableNoRipple { ack = !ack },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(20.dp)
                            .clip(CircleShape)
                            .background(if (ack) Tokens.Primary else Tokens.Surface)
                            .border(1.dp, if (ack) Tokens.Primary else Tokens.Border, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (ack) Text("✓", fontSize = 11.sp, color = Color.White)
                    }
                    Spacer(Modifier.size(8.dp))
                    Text("本人已抄录并确认上述语句", fontSize = 12.sp, color = Tokens.Ink2)
                }
                Spacer(Modifier.height(12.dp))
                Text("支付密码", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(6.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(46.dp)
                        .clip(CircleShape)
                        .background(Tokens.Surface)
                        .border(1.dp, Tokens.Border, CircleShape)
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    BasicTextField(
                        value = password,
                        onValueChange = { password = it.filter(Char::isDigit).take(6) },
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Ink),
                        cursorBrush = SolidColor(Tokens.Accent),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.CenterStart) {
                                if (password.isEmpty()) Text("6 位支付密码", fontSize = 13.sp, color = Tokens.Muted)
                                inner()
                            }
                        },
                    )
                }
                if (submitError != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(submitError!!, fontSize = 11.5.sp, color = Tokens.Coral)
                }
                Spacer(Modifier.height(16.dp))
                PrimaryButton(
                    if (submitting) "提交中…" else "确认申购",
                    onClick = {
                        val code = product?.code ?: return@PrimaryButton
                        if (submitting) return@PrimaryButton
                        if (!ack) {
                            submitError = "请先抄录并确认风险语句"
                            return@PrimaryButton
                        }
                        if (password.length != 6) {
                            submitError = "请输入 6 位支付密码"
                            return@PrimaryButton
                        }
                        if (amountCents <= 0) {
                            submitError = "请输入申购金额"
                            return@PrimaryButton
                        }
                        submitting = true
                        submitError = null
                        scope.launch {
                            runCatching { BankApi.subscribeWealth(code, amountCents, password, RISK_ACK) }
                                .onSuccess {
                                    submitting = false
                                    subscribing = false
                                    done = true
                                }
                                .onFailure {
                                    submitError = it.message
                                    submitting = false
                                }
                        }
                    },
                )
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}
