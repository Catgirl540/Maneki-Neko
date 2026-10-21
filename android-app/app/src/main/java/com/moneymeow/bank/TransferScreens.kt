package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class Method(val label: String, val desc: String, val icon: ImageVector, val route: String)

private val methods = listOf(
    Method("手机号转账", "本行与他行账户，凭手机号直达", Icons.Person, "手机号转账"),
    Method("银行卡号转账", "支持本行与他行储蓄卡", Icons.Card, "银行卡号转账"),
    Method("跨境支付通", "转数快（FPS）· 港币 / 离岸人民币", Icons.Globe, "跨境支付通"),
)

private data class Payee(val initial: String, val name: String, val meta: String, val time: String)

private val payees = listOf(
    Payee("陈", "陈嘉禾", "招财猫银行 ··8821", "10月12日"),
    Payee("王", "王思远", "招商银行 ··6633", "10月8日"),
    Payee("L", "LAM HO**", "转数快 FPS", "9月30日"),
)

@Composable
fun TransferSelectScreen(onBack: () -> Unit, onPick: (String) -> Unit) {
    PushScreen(title = "转出", onBack = onBack) {
        // 搜索框
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp)
                .height(42.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Tokens.Surface)
                .border(1.dp, Tokens.Border, RoundedCornerShape(8.dp))
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Search, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(16.dp))
                Spacer(Modifier.size(8.dp))
                Text("手机号 / 银行卡号 / 收款人", fontSize = 12.5.sp, color = Tokens.Muted)
            }
        }

        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            methods.forEach { method ->
                HairlineCard {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onPick(method.route) }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Tokens.SurfaceWarm),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(method.icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(20.dp))
                        }
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(method.label, fontSize = 13.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                            Spacer(Modifier.height(3.dp))
                            Text(method.desc, fontSize = 11.sp, color = Tokens.Muted)
                        }
                        Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(14.dp))
                    }
                }
            }
        }

        SectionHeader("历史收款人")
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            payees.forEach { payee ->
                HairlineCard {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onPick("填写金额") }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(38.dp)
                                .clip(CircleShape)
                                .background(Tokens.SurfaceWarm),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(payee.initial, fontSize = 14.sp, color = Tokens.Ink2, fontWeight = FontWeight.SemiBold)
                        }
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(payee.name, fontSize = 13.5.sp, color = Tokens.Ink)
                            Spacer(Modifier.height(3.dp))
                            Text(payee.meta, fontSize = 11.sp, color = Tokens.Muted)
                        }
                        Text(payee.time, fontSize = 11.sp, color = Tokens.Muted)
                    }
                }
            }
        }
    }
}

/** 三个渠道表单：字段不同，样式一致。 */
@Composable
fun TransferFormScreen(title: String, onBack: () -> Unit, onNext: () -> Unit) {
    PushScreen(title = title, onBack = onBack) {
        Column(
            Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when (title) {
                "手机号转账" -> {
                    Field("手机号", "138 0013 8000")
                    Field("收款人姓名（选填）", "陈嘉禾")
                }
                "银行卡号转账" -> {
                    Field("银行卡号", "6214 8300 0000 6633", hint = "招商银行 储蓄卡")
                    Field("收款人姓名", "王思远")
                    Field("收款银行", "招商银行")
                }
                else -> {
                    Text("标识类型", fontSize = 11.sp, color = Tokens.Muted)
                    var seg by remember { mutableStateOf(0) }
                    SegTabs(listOf("手机号", "电邮", "FPS ID", "账户"), seg) { seg = it }
                    Field("收款标识", "852 9123 4321", hint = "已登记 FPS 收款人 LAM HO**")
                    Text("入账币种", fontSize = 11.sp, color = Tokens.Muted)
                    var cur by remember { mutableStateOf(0) }
                    SegTabs(listOf("港币 HKD", "离岸人民币", "澳门元 MOP"), cur) { cur = it }
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        PrimaryButton("下一步", onNext, Modifier.padding(horizontal = 14.dp))
    }
}

@Composable
private fun Field(label: String, value: String, hint: String? = null) {
    Column {
        Text(label, fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 6.dp, start = 2.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(46.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Tokens.Surface)
                .border(1.dp, Tokens.Border, RoundedCornerShape(8.dp))
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(value, fontSize = 14.sp, color = Tokens.Ink)
        }
        if (hint != null) {
            Text(hint, fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.padding(top = 6.dp, start = 2.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AmountScreen(onBack: () -> Unit, onDone: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState()

    PushScreen(title = "填写金额", onBack = onBack) {
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(Tokens.SurfaceWarm),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("陈", fontSize = 14.sp, color = Tokens.Ink2, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.size(12.dp))
                Column {
                    Text("陈嘉禾", fontSize = 14.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                    Text("招财猫银行 ··8821", fontSize = 11.5.sp, color = Tokens.Muted)
                }
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 18.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text("¥", fontSize = 24.sp, color = Tokens.Ink, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.size(6.dp))
            Text("500.00", fontSize = 34.sp, color = Tokens.Ink, fontWeight = FontWeight.SemiBold)
        }
        KvCard(
            listOf(
                "手续费" to "¥0.00",
                "到账时间" to "实时到账",
                "单笔限额" to "¥1,000,000.00",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(12.dp))
        Field("附言", "房租分摊")
        Spacer(Modifier.height(18.dp))
        PrimaryButton("确认转出", { confirm = true }, Modifier.padding(horizontal = 14.dp))
    }

    if (confirm) {
        ModalBottomSheet(
            onDismissRequest = { confirm = false },
            sheetState = sheetState,
            containerColor = Tokens.Surface,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text("确认转账", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                KvRow("收款人", "陈嘉禾 ··8821")
                KvRow("转账金额", "¥500.00")
                KvRow("手续费", "¥0.00")
                KvRow("付款账户", "人民币活期 ··8821")
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(6) { index ->
                        Box(
                            Modifier
                                .weight(1f)
                                .height(46.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Tokens.Surface)
                                .border(1.dp, Tokens.Border, RoundedCornerShape(8.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (index < 5) {
                                Box(
                                    Modifier
                                        .size(7.dp)
                                        .clip(CircleShape)
                                        .background(Tokens.Ink)
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text("请输入 6 位支付密码", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(16.dp))
                PrimaryButton("确认支付", {
                    confirm = false
                    onDone()
                })
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

@Composable
fun TransferResultScreen(onBack: () -> Unit, onHome: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
    ) {
        PushScreen(title = "转账结果", onBack = onBack) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier
                        .size(62.dp)
                        .clip(CircleShape)
                        .background(Tokens.Primary),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Chevron, contentDescription = null, tint = Color.White, modifier = Modifier.size(28.dp))
                }
                Spacer(Modifier.height(14.dp))
                Text("转账成功", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(6.dp))
                Text("¥500.00 已转给 陈嘉禾", fontSize = 12.5.sp, color = Tokens.Muted)
            }
            KvCard(
                listOf(
                    "收款人" to "陈嘉禾 ··8821",
                    "转账金额" to "¥500.00",
                    "手续费" to "¥0.00",
                    "付款账户" to "人民币活期 ··8821",
                ),
                Modifier.padding(horizontal = 14.dp),
            )
            Spacer(Modifier.height(18.dp))
            PrimaryButton("完成", onHome, Modifier.padding(horizontal = 14.dp))
        }
    }
}
