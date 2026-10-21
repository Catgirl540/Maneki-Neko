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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 02 转入弹层：收款账户 + 转数快（FPS）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransferInSheet(onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(),
        containerColor = Tokens.Surface,
    ) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            Text("转入", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(12.dp))
            Text("我的收款账户", fontSize = 11.sp, color = Tokens.Muted)
            Spacer(Modifier.height(6.dp))
            HairlineCard {
                Column(Modifier.padding(horizontal = 14.dp)) {
                    ReceiptRow("户名", "陈**", copy = true)
                    Hairline()
                    ReceiptRow("账户号码", "1024 ···· 8821", copy = true)
                    Hairline()
                    ReceiptRow("开户银行", "招财猫银行")
                    Text(
                        "把账户号码发给对方即可收款；跨行转账请同时提供开户银行名称。",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        lineHeight = 18.sp,
                        modifier = Modifier.padding(bottom = 12.dp),
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            Text("转数快收款（FPS）", fontSize = 11.sp, color = Tokens.Muted)
            Spacer(Modifier.height(6.dp))
            HairlineCard {
                Column(Modifier.padding(horizontal = 14.dp)) {
                    ReceiptRow("登记手机号", "+852 ···· 4321", copy = true)
                    Hairline()
                    ReceiptRow("FPS ID", "10248821", copy = true)
                    Hairline()
                    ReceiptRow("入账账户", "港币活期 ··8821")
                    Text(
                        "香港付款方用以上任一标识即可经转数快即时入账；未登记他行标识时可改用 FPS ID。",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        lineHeight = 18.sp,
                        modifier = Modifier.padding(bottom = 12.dp),
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
        }
    }
}

@Composable
private fun ReceiptRow(label: String, value: String, copy: Boolean = false) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 12.5.sp, color = Tokens.Muted)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(value, fontSize = 12.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
            if (copy) {
                Spacer(Modifier.size(8.dp))
                Icon(Icons.Copy, contentDescription = "复制", tint = Tokens.Muted, modifier = Modifier.size(15.dp))
            }
        }
    }
}

/* ───────────── 36a–36e 更多服务 · 二级页 ───────────── */

@Composable
fun AutoDebitScreen(onBack: () -> Unit) {
    PushScreen(title = "自动扣款", onBack = onBack) {
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            DebitCard("话费月缴", "¥98.00", "21 日", "10-21")
            DebitCard("房租", "¥4,500.00", "1 日", "11-01")
        }
        Spacer(Modifier.height(12.dp))
        EmptyNote("扣款规则由服务端调度执行\n余额不足时该次扣款会失败")
        Spacer(Modifier.height(14.dp))
        PrimaryButton("新建自动扣款", {}, Modifier.padding(horizontal = 14.dp))
    }
}

@Composable
private fun DebitCard(name: String, amount: String, day: String, next: String) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                RiskBadge("每月")
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                Metric("金额", amount)
                Metric("扣款日", day)
                Metric("下次", next)
            }
            Spacer(Modifier.height(10.dp))
            Hairline()
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("人民币活期 ··8821", fontSize = 11.sp, color = Tokens.Muted)
                Text("修改", fontSize = 11.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
fun PayrollScreen(onBack: () -> Unit) {
    PushScreen(title = "工资与备用金", onBack = onBack) {
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("工资计划", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(5.dp))
                Text("每月 10 日 ¥18,000.00", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                Hairline()
                Spacer(Modifier.height(10.dp))
                KvInline("入账账户", "人民币活期 ··8821")
                KvInline("上次入账", "2026-10-10")
            }
        }
        SectionHeader("备用金目标")
        Column(Modifier.padding(horizontal = 14.dp)) {
            GoalCard("应急备用金", "目标 ¥30,000.00", "¥12,000.00", "¥30,000.00", 0.4f, "每月自动归集 ¥1,000")
        }
        Spacer(Modifier.height(12.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Text(
                "工资计划与归集只保存规则，自动执行尚未开放；备用金目标不代表独立资金账户。",
                fontSize = 11.sp,
                color = Tokens.Muted,
                lineHeight = 18.sp,
                modifier = Modifier.padding(14.dp),
            )
        }
    }
}

@Composable
fun CreditScreen(onBack: () -> Unit) {
    PushScreen(title = "借款与分期", onBack = onBack) {
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("可用额度", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(5.dp))
                Text("¥50,000.00", fontSize = 27.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(12.dp))
                Hairline()
                Spacer(Modifier.height(10.dp))
                KvInline("已用额度", "¥0.00")
                KvInline("年化利率", "4.35% 起")
            }
        }
        SectionHeader("分期计划")
        EmptyNote("暂无分期计划")
        Spacer(Modifier.height(14.dp))
        PrimaryButton("立即借款", {}, Modifier.padding(horizontal = 14.dp))
    }
}

@Composable
fun InsuranceScreen(onBack: () -> Unit) {
    PushScreen(title = "保险保障", onBack = onBack) {
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            PolicyCard("综合意外险", "¥500,000", "¥199/年", "保障期至 2027-03-14")
            PolicyCard("百万医疗险", "¥2,000,000", "¥326/年", "保障期至 2027-01-08")
        }
        Spacer(Modifier.height(12.dp))
        EmptyNote("保单为演示数据\n保险保障不计入投资资产与收益")
    }
}

@Composable
private fun PolicyCard(name: String, coverage: String, fee: String, period: String) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, modifier = Modifier.weight(1f))
                RiskBadge("生效中")
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                Metric("保额", coverage)
                Metric("保费", fee)
            }
            Spacer(Modifier.height(10.dp))
            Hairline()
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(period, fontSize = 11.sp, color = Tokens.Muted)
                Text("查看条款", fontSize = 11.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
fun InviteScreen(onBack: () -> Unit) {
    PushScreen(title = "邀请与奖励", onBack = onBack) {
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("我的邀请码", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(5.dp))
                Text("CAT-8821", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink, letterSpacing = 2.sp)
                Spacer(Modifier.height(12.dp))
                Hairline()
                Spacer(Modifier.height(10.dp))
                KvInline("已邀请", "3 人")
                KvInline("累计奖励", "¥150.00")
            }
        }
        SectionHeader("奖励记录")
        KvCard(
            listOf(
                "沈一诺 开户成功" to "+¥50.00",
                "顾亦辰 开户成功" to "+¥50.00",
                "陆书瑶 开户成功" to "+¥50.00",
            ),
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(14.dp))
        PrimaryButton("邀请好友", {}, Modifier.padding(horizontal = 14.dp))
    }
}
