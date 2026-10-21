package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/* ─────────────────────── 产品详情 + 申购 ─────────────────────── */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductDetailScreen(onBack: () -> Unit) {
    var subscribing by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState()

    PushScreen(title = "产品详情", onBack = onBack) {
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("招财猫现金添利 A", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.size(8.dp))
                    RiskBadge("R1")
                }
                Spacer(Modifier.height(4.dp))
                Text("LCB-CASH-A · 招财猫理财有限责任公司", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(13.dp))
                Hairline()
                Spacer(Modifier.height(12.dp))
                Text("单位净值", fontSize = 11.sp, color = Tokens.Muted)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("1.0015", fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.size(4.dp))
                    Text("2026-10-20", fontSize = 11.sp, color = Tokens.Muted)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        KvCard(
            listOf(
                "业绩比较基准" to "1.60%–2.10%（年化区间）",
                "起购 / 递增" to "¥1.00 / ¥1.00",
                "期限与开放性" to "随时赎回 · 开放式",
                "费用" to "管理 0.15% · 托管 0.02% · 销售服务 0.20%",
                "近一月年化波动率" to "0.04%",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(14.dp))
        PrimaryButton("立即申购", { subscribing = true }, Modifier.padding(horizontal = 14.dp))
        if (done) {
            Spacer(Modifier.height(10.dp))
            Text(
                "申购已受理 · 确认份额 19,985.02",
                fontSize = 12.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
    }

    if (subscribing) {
        ModalBottomSheet(onDismissRequest = { subscribing = false }, sheetState = sheetState, containerColor = Tokens.Surface) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text("申购 · 招财猫现金添利 A", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                KvRow("起购 / 递增", "¥1.00 / ¥1.00")
                KvRow("风险等级", "R1 · 与你的测评匹配")
                KvRow("申购金额", "¥20,000.00")
                Spacer(Modifier.height(12.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Tokens.SurfaceWarm)
                        .padding(12.dp)
                ) {
                    Text(
                        "本人已阅读产品说明书与风险揭示，理解「理财非存款、产品有风险、投资须谨慎」，确认本次申购为本人意愿。",
                        fontSize = 11.5.sp,
                        color = Tokens.Ink2,
                        lineHeight = 18.sp,
                    )
                }
                Spacer(Modifier.height(12.dp))
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
                            if (index < 5) Box(Modifier.size(7.dp).clip(CircleShape).background(Tokens.Ink))
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text("请输入 6 位支付密码", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(16.dp))
                PrimaryButton("确认申购", {
                    subscribing = false
                    done = true
                })
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

/* ─────────────────────────── 智能助手 ─────────────────────────── */

private data class Capability(val label: String, val desc: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val capabilities = listOf(
    Capability("智能转账", "说一句就填好收款人与金额", Icons.Transfer),
    Capability("理财顾问", "产品对比、持仓与申赎", Icons.Wealth),
    Capability("账单分析", "分类、趋势与消费异常", Icons.Receipt),
    Capability("银行卡管家", "锁卡、限额、换卡与寄送", Icons.Card),
    Capability("换汇助手", "汇率查询与换汇下单", Icons.Globe),
    Capability("储蓄规划", "存钱目标与定投计划", Icons.Pig),
    Capability("借款测算", "额度与分期测算", Icons.UpOut),
    Capability("保险咨询", "保单与保障范围", Icons.Card),
    Capability("安全助手", "密码、设备与风险提示", Icons.Transfer),
    Capability("智能客服", "常见问题与人工转接", Icons.Bell),
)

private data class Msg(val fromUser: Boolean, val text: String)

private val conversation = listOf(
    Msg(false, "上午好，陈先生。我是小招，可以帮你查账、转账、看支出，也可以直接说想做的事。"),
    Msg(true, "帮我看看这个月花了多少"),
    Msg(false, "本月支出共 ¥3,486.50，比上月少 12%。最多的是房租 ¥1,120.00，其次是餐饮 ¥1,020.50。要看分类明细吗？"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssistantScreen(onBack: () -> Unit) {
    var capsOpen by remember { mutableStateOf(false) }
    var historyOpen by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState()

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Page)
            .imePadding(),
    ) {
        TopBar(title = "小招", onBack = onBack, action = "历史", onAction = { historyOpen = true })
        LazyColumn(
            Modifier
                .weight(1f)
                .padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item { Spacer(Modifier.height(6.dp)) }
            items(conversation) { msg ->
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = if (msg.fromUser) Arrangement.End else Arrangement.Start,
                ) {
                    if (!msg.fromUser) {
                        Box(
                            Modifier
                                .size(28.dp)
                                .clip(CircleShape)
                                .background(Tokens.Surface)
                                .border(1.dp, Tokens.Border, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Person, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(15.dp))
                        }
                        Spacer(Modifier.size(8.dp))
                    }
                    Box(
                        Modifier
                            .width(260.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (msg.fromUser) Tokens.Primary else Tokens.Surface)
                            .border(
                                1.dp,
                                if (msg.fromUser) Tokens.Primary else Tokens.Border,
                                RoundedCornerShape(10.dp),
                            )
                            .padding(12.dp),
                    ) {
                        Text(
                            msg.text,
                            fontSize = 12.5.sp,
                            color = if (msg.fromUser) Color.White else Tokens.Ink,
                            lineHeight = 19.sp,
                        )
                    }
                }
            }
            item { Spacer(Modifier.height(8.dp)) }
        }
        // 输入栏：加号 / 输入框 / 麦克风 / 发送
        Row(
            Modifier
                .fillMaxWidth()
                .background(Tokens.Surface)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Plus,
                contentDescription = "选择智能服务",
                tint = Tokens.Ink2,
                modifier = Modifier
                    .size(21.dp)
                    .clickable { capsOpen = true },
            )
            Spacer(Modifier.size(8.dp))
            Box(
                Modifier
                    .weight(1f)
                    .height(40.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Tokens.SurfaceWarm)
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text("问点什么…", fontSize = 13.sp, color = Tokens.Muted)
            }
            Spacer(Modifier.size(8.dp))
            Icon(Icons.Transfer, contentDescription = "语音", tint = Tokens.Ink2, modifier = Modifier.size(21.dp))
            Spacer(Modifier.size(8.dp))
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(Tokens.Primary),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Chevron, contentDescription = "发送", tint = Color.White, modifier = Modifier.size(16.dp))
            }
        }
    }

    if (capsOpen) {
        ModalBottomSheet(onDismissRequest = { capsOpen = false }, sheetState = sheetState, containerColor = Tokens.Surface) {
            Column(Modifier.padding(horizontal = 18.dp)) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Tokens.Surface)
                        .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Card, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(10.dp))
                    Text("上传图片", fontSize = 13.sp, color = Tokens.Ink, modifier = Modifier.weight(1f))
                    Text("截图 / 账单 / 回单", fontSize = 10.5.sp, color = Tokens.Muted)
                }
                Spacer(Modifier.height(14.dp))
                Text("选择智能服务", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(6.dp))
                Column {
                    capabilities.forEach { cap ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 11.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(34.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(Tokens.SurfaceWarm),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(cap.icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(17.dp))
                            }
                            Spacer(Modifier.size(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(cap.label, fontSize = 13.5.sp, color = Tokens.Ink)
                                Spacer(Modifier.height(2.dp))
                                Text(cap.desc, fontSize = 10.5.sp, color = Tokens.Muted)
                            }
                            Box(
                                Modifier
                                    .size(20.dp)
                                    .clip(CircleShape)
                                    .border(1.dp, Tokens.Border, CircleShape)
                            )
                        }
                        Hairline()
                    }
                }
                Spacer(Modifier.height(14.dp))
                PrimaryButton("完成", { capsOpen = false })
                Spacer(Modifier.height(12.dp))
            }
        }
    }

    if (historyOpen) {
        ModalBottomSheet(onDismissRequest = { historyOpen = false }, sheetState = sheetState, containerColor = Tokens.Surface) {
            Column(Modifier.padding(horizontal = 18.dp)) {
                Text("历史会话", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(10.dp))
                listOf(
                    "本月支出明细" to "14:32",
                    "转账限额调整" to "09:18",
                    "给陈嘉禾转账" to "周二",
                    "港币换汇汇率" to "周一",
                ).forEach { (title, time) ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(title, fontSize = 13.sp, color = Tokens.Ink)
                        Text(time, fontSize = 11.sp, color = Tokens.Muted)
                    }
                    Hairline()
                }
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}
