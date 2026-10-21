package com.moneymeow.bank

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/* ─────────────────────────── 存款 ─────────────────────────── */

@Composable
fun DepositsScreen(onBack: () -> Unit, onTransferIn: () -> Unit, onTransferOut: () -> Unit) {
    PushScreen(title = "存款", onBack = onBack) {
        SectionHeader("活期存款", "人民币活期 ··8821")
        KvCard(
            listOf(
                "人民币 CNY" to "¥86,320.00",
                "港币 HKD" to "HK$8,720.00",
                "人民币活期年利率" to "1.55%",
                "港币活期年利率" to "1.25%",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(12.dp))
        Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SmallAction("转入", Icons.DownIn, Modifier.weight(1f), onTransferIn)
            SmallAction("转出", Icons.UpOut, Modifier.weight(1f), onTransferOut)
            SmallAction("利息流水", Icons.Receipt, Modifier.weight(1f)) { }
        }
        SectionHeader("定期存款")
        EmptyNote("暂无可用的定期存款产品\n当前仅提供活期存款")
    }
}

@Composable
private fun SmallAction(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, onClick: () -> Unit) {
    HairlineCard(modifier) {
        Column(
            Modifier
                .fillMaxWidth()
                .clickable { onClick() }
                .padding(vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(18.dp))
            Spacer(Modifier.height(7.dp))
            Text(label, fontSize = 11.5.sp, color = Tokens.Ink2)
        }
    }
}

@Composable
private fun EmptyNote(text: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Tokens.Surface)
            .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
            .padding(vertical = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 12.sp, color = Tokens.Muted, lineHeight = 20.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/* ─────────────────────────── 换汇 ─────────────────────────── */

@Composable
fun ExchangeScreen(onBack: () -> Unit) {
    PushScreen(title = "换汇", onBack = onBack) {
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(14.dp)) {
                Text("卖出", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(5.dp))
                Text("¥ 8,000.00", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(7.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Tag("CNY")
                    Spacer(Modifier.size(6.dp))
                    Text("人民币活期 ··8821", fontSize = 12.sp, color = Tokens.Ink2, modifier = Modifier.weight(1f))
                    Text("可用 ¥86,320.00", fontSize = 11.sp, color = Tokens.Muted)
                }
                Spacer(Modifier.height(16.dp))
                Text("买入", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(5.dp))
                Text("HK$ 8,720.00", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink2)
                Spacer(Modifier.height(7.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Tag("HKD")
                    Spacer(Modifier.size(6.dp))
                    Text("港币活期", fontSize = 12.sp, color = Tokens.Ink2)
                }
                Spacer(Modifier.height(14.dp))
                Hairline()
                Spacer(Modifier.height(10.dp))
                Text("参考汇率 1 CNY ≈ 1.0900 HKD，含点差 0.15%，以成交时为准。", fontSize = 11.sp, color = Tokens.Muted, lineHeight = 18.sp)
            }
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton("确认换汇", {}, Modifier.padding(horizontal = 14.dp))
    }
}

@Composable
private fun Tag(text: String) {
    Box(
        Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Tokens.SurfaceWarm)
            .border(1.dp, Tokens.Border, RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(text, fontSize = 11.sp, color = Tokens.Ink2)
    }
}

/* ─────────────────────────── 交易详情 ─────────────────────────── */

@Composable
fun TxDetailScreen(onBack: () -> Unit) {
    PushScreen(title = "交易详情", onBack = onBack) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(Tokens.Primary),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Pig, contentDescription = null, tint = Color.White, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.height(12.dp))
            Text("-¥38.00", fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(4.dp))
            Text("星巴克咖啡 · 交易成功", fontSize = 12.5.sp, color = Tokens.Muted)
        }
        KvCard(
            listOf(
                "交易时间" to "2026-10-20 09:12",
                "交易类型" to "消费支出",
                "分类" to "餐饮",
                "付款卡片" to "招财猫借记卡 ··8821",
                "资金账户" to "人民币活期 ··8821",
                "交易号" to "TX20261020091201",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(14.dp))
        PrimaryButton("下载电子回单", {}, Modifier.padding(horizontal = 14.dp))
    }
}

/* ─────────────────────────── 寄送信息 ─────────────────────────── */

@Composable
fun DeliveryScreen(onBack: () -> Unit) {
    PushScreen(title = "寄送信息", onBack = onBack) {
        Spacer(Modifier.height(4.dp))
        KvCard(
            listOf(
                "银行卡" to "招财猫白金卡 · 尾号 4417",
                "收件人" to "陈嘉禾",
                "联系电话" to "138 **** 8000",
                "寄送地址" to "上海市徐汇区漕溪北路 88 号",
                "已收制卡费" to "¥50.00",
                "物流状态" to "已寄出 · 待签收",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
    }
}

/* ─────────────────────────── 会员等级 ─────────────────────────── */

@Composable
fun MembershipScreen(onBack: () -> Unit) {
    PushScreen(title = "会员等级", onBack = onBack) {
        SectionHeader("会员卡", "普通会员 · 使用中")
        LazyRow(
            Modifier.fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { MemberCard(R.drawable.member_standard, false) }
            item { MemberCard(R.drawable.member_gold, true) }
            item { MemberCard(R.drawable.member_platinum, true) }
            item { MemberCard(R.drawable.member_diamond, true) }
        }
        Spacer(Modifier.height(12.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("当前等级", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(5.dp))
                Text("普通会员", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                Hairline()
                Spacer(Modifier.height(10.dp))
                KvInline("上月日均资产", "¥87,520.00")
                KvInline("距金卡会员还差", "¥12,480.00")
            }
        }
        SectionHeader("权益")
        KvCard(
            listOf(
                "制卡费减免" to "每年 0 张",
                "换汇点差" to "标准价",
                "机场贵宾厅" to "—",
                "专属顾问" to "—",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            "等级按上月日均资产每月 1 号重算，实时达标当天升级；缺快照的日子按 0 计入日均。",
            fontSize = 11.sp,
            color = Tokens.Muted,
            lineHeight = 18.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

@Composable
private fun MemberCard(drawable: Int, dimmed: Boolean) {
    Box(
        Modifier
            .width(296.dp)
            .aspectRatio(1.585f)
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
    ) {
        Image(
            painter = painterResource(drawable),
            contentDescription = null,
            modifier = Modifier.fillMaxWidth(),
            contentScale = ContentScale.Crop,
            alpha = if (dimmed) 0.55f else 1f,
        )
        if (!dimmed) {
            // 卡面右下空白区的升级进度
            Column(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 15.dp, bottom = 17.dp)
                    .width(116.dp)
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("距金卡", fontSize = 9.sp, color = Tokens.Ink.copy(alpha = 0.72f))
                    Text("88%", fontSize = 9.sp, color = Tokens.Ink.copy(alpha = 0.72f))
                }
                Spacer(Modifier.height(5.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(2.5.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Tokens.Ink.copy(alpha = 0.18f))
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(0.88f)
                            .height(2.5.dp)
                            .background(Tokens.Ink.copy(alpha = 0.6f))
                    )
                }
            }
        }
    }
}

/* ─────────────────────────── 储蓄与计划 ─────────────────────────── */

@Composable
fun PlansScreen(onBack: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    PushScreen(title = "储蓄与计划", onBack = onBack) {
        Box(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
            SegTabs(listOf("存钱目标", "定投计划"), tab) { tab = it }
        }
        if (tab == 0) {
            Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                GoalCard("旅行基金", "目标日 2027-03-01", "¥8,000.00", "¥20,000.00", 0.40f, "归集设置 · 每月 ¥1,000")
                GoalCard("换电脑", "无固定期限", "¥4,500.00", "¥12,000.00", 0.38f, "暂无归集设置")
            }
            Spacer(Modifier.height(12.dp))
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                SwitchRow("消费凑整（凑整到 ¥10 · 单日上限 ¥50）", true) { }
            }
            Spacer(Modifier.height(14.dp))
            PrimaryButton("新建存钱目标", {}, Modifier.padding(horizontal = 14.dp))
        } else {
            Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PlanCard("沪深 300 指数基金", "每月", "¥1,000", "11-01", "¥6,000", "运行中", "暂停")
                PlanCard("稳利纯债基金 A", "每月", "¥500", "11-15", "¥1,500", "已暂停", "恢复")
            }
            Spacer(Modifier.height(12.dp))
            EmptyNote("计划只保存规则\n自动扣款与执行尚未开放")
            Spacer(Modifier.height(14.dp))
            PrimaryButton("新建定投计划", {}, Modifier.padding(horizontal = 14.dp))
        }
    }
}

@Composable
private fun GoalCard(name: String, deadline: String, saved: String, target: String, ratio: Float, sweep: String) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Text(name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(3.dp))
            Text(deadline, fontSize = 11.sp, color = Tokens.Muted)
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                Text(saved, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Text("目标 $target", fontSize = 11.5.sp, color = Tokens.Muted)
            }
            Spacer(Modifier.height(9.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(7.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(Tokens.SurfaceWarm)
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(ratio)
                        .height(7.dp)
                        .background(Tokens.Primary)
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(sweep, fontSize = 11.sp, color = Tokens.Muted)
                Text("${(ratio * 100).toInt()}%", fontSize = 11.sp, color = Tokens.Muted)
            }
        }
    }
}

@Composable
private fun PlanCard(name: String, freq: String, amount: String, next: String, total: String, status: String, action: String) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                RiskBadge(freq)
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                Metric("每期金额", amount)
                Metric("下次拟定", next)
                Metric("累计投入", total)
            }
            Spacer(Modifier.height(10.dp))
            Hairline()
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("定投计划 · $status", fontSize = 11.sp, color = Tokens.Muted)
                Text(action, fontSize = 11.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Column {
        Text(label, fontSize = 10.5.sp, color = Tokens.Muted)
        Spacer(Modifier.height(2.dp))
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
    }
}

/* ─────────────────────────── 我的 · 设置类二级页 ─────────────────────────── */

@Composable
fun SecurityScreen(onBack: () -> Unit) {
    PushScreen(title = "安全中心", onBack = onBack) {
        Spacer(Modifier.height(4.dp))
        KvCard(
            listOf(
                "登录密码" to "已设置",
                "支付密码" to "已设置",
                "已登录设备" to "1 台 · Android",
                "最近登录" to "2026-10-20 08:40",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(12.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                SwitchRow("人脸识别登录", true) { }
                Hairline()
                SwitchRow("大额转账二次确认", true) { }
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SmallAction("修改登录密码", Icons.Transfer, Modifier.weight(1f)) { }
            SmallAction("修改支付密码", Icons.Transfer, Modifier.weight(1f)) { }
            SmallAction("设备管理", Icons.Person, Modifier.weight(1f)) { }
        }
    }
}

@Composable
fun ProfileScreen(onBack: () -> Unit) {
    PushScreen(title = "个人资料", onBack = onBack) {
        Spacer(Modifier.height(4.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(54.dp)
                    .clip(CircleShape)
                    .background(Tokens.SurfaceWarm)
                    .border(1.dp, Tokens.Border, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Image(painterResource(R.drawable.brand_cat), null, Modifier.size(44.dp), contentScale = ContentScale.Fit)
            }
            Spacer(Modifier.size(14.dp))
            Column {
                Text("陈嘉禾", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(3.dp))
                Text("138 **** 8000", fontSize = 12.sp, color = Tokens.Muted)
            }
        }
        KvCard(
            listOf(
                "姓名" to "陈嘉禾",
                "手机号" to "138 **** 8000",
                "身份证号" to "3101**********1234",
                "开户日期" to "2026-03-14",
                "联系地址" to "上海市徐汇区漕溪北路 88 号",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(14.dp))
        PrimaryButton("修改手机号", {}, Modifier.padding(horizontal = 14.dp))
    }
}

@Composable
fun ImScreen(onBack: () -> Unit) {
    PushScreen(title = "IM 连接", onBack = onBack) {
        SectionHeader("输入绑定码")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(14.dp)) {
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
                    Text("例如 WX-8F2K", fontSize = 13.sp, color = Tokens.Muted)
                }
                Spacer(Modifier.height(12.dp))
                PrimaryButton("确认绑定", {})
            }
        }
        Spacer(Modifier.height(4.dp))
        KvCard(
            listOf("绑定状态" to "未绑定", "支持渠道" to "微信 / 企业微信"),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(12.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                SwitchRow("账户变动提醒", true) { }
                Hairline()
                SwitchRow("提醒尚未启用", false) { }
            }
        }
    }
}

@Composable
fun NotifySettingsScreen(onBack: () -> Unit) {
    PushScreen(title = "通知设置", onBack = onBack) {
        Spacer(Modifier.height(4.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                SwitchRow("交易通知", true) { }
                Hairline()
                SwitchRow("安全提醒", true) { }
                Hairline()
                SwitchRow("产品与活动", false) { }
            }
        }
    }
}

@Composable
fun LanguageScreen(onBack: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    PushScreen(title = "语言与地区", onBack = onBack) {
        SectionHeader("语言")
        Box(Modifier.padding(horizontal = 14.dp)) {
            SegTabs(listOf("简体中文", "English"), tab) { tab = it }
        }
        Spacer(Modifier.height(4.dp))
        KvCard(
            listOf("地区" to "中国大陆", "时区" to "北京时间 UTC+8", "记账币种" to "人民币 CNY"),
            Modifier.padding(horizontal = 14.dp),
        )
    }
}

@Composable
fun HelpScreen(onBack: () -> Unit) {
    PushScreen(title = "帮助与客服", onBack = onBack) {
        SectionHeader("常见问题")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                IconRow(Icons.Receipt, "转账多久到账") { }
                Hairline()
                IconRow(Icons.Receipt, "如何提高单日限额") { }
                Hairline()
                IconRow(Icons.Receipt, "忘记支付密码怎么办") { }
                Hairline()
                IconRow(Icons.Receipt, "理财赎回什么时候到账") { }
            }
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton("联系在线客服", {}, Modifier.padding(horizontal = 14.dp))
    }
}

@Composable
fun AboutScreen(onBack: () -> Unit) {
    PushScreen(title = "关于", onBack = onBack) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(painterResource(R.drawable.brand_cat), null, Modifier.size(62.dp), contentScale = ContentScale.Fit)
            Spacer(Modifier.height(9.dp))
            Text("招财猫银行", fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
        }
        KvCard(
            listOf("版本" to "v1.0.0", "服务条款" to "›", "隐私政策" to "›", "开源许可" to "›"),
            Modifier.padding(horizontal = 14.dp),
        )
    }
}
