package com.moneymeow.bank

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun MembershipScreen(onBack: () -> Unit) {
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var redeem by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(reload) {
        try { data = BankApi.membershipData(); error = null } catch (failure: Exception) { data = null; error = failure.message ?: "会员信息加载失败" }
        refreshing = false
    }
    PushScreen(
        "会员等级",
        onBack = { if (!busy) onBack() },
        refreshing = refreshing,
        onRefresh = { if (!refreshing) { refreshing = true; BankApi.invalidateReads(); reload++ } },
    ) {
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { ErrorNote(it) }
            val row = data
            if (row == null) {
                if (error == null) {
                    SkeletonBox(Modifier.fillMaxWidth().height(168.dp), RoundedCornerShape(16.dp))
                    SkeletonCardLines(2)
                }
            } else {
                val aum = row.optLong("aum")
                val nextThreshold = if (row.isNull("nextThreshold")) null else row.optLong("nextThreshold")
                val gap = nextThreshold?.let { (it - aum).coerceAtLeast(0) }
                val progress = nextThreshold?.let { (aum.toFloat() / it).coerceIn(0f, 1f) } ?: 1f

                // 卡面直接复用网页端会员卡素材（app/src/assets/membership）。
                Image(
                    painter = painterResource(tierCard(row.optString("tier"))),
                    contentDescription = "${row.optString("tierLabel")}卡面",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1.585f)
                        .clip(RoundedCornerShape(16.dp)),
                )

                HairlineCard {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                row.optString("tierLabel").ifEmpty { "会员" },
                                fontSize = 17.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Tokens.Ink,
                            )
                            Spacer(Modifier.weight(1f))
                            Text("上月日均资产", style = Tokens.Text.hint)
                            Spacer(Modifier.width(6.dp))
                            Text(
                                formatCents(aum),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                color = Tokens.Ink,
                            )
                        }
                        Spacer(Modifier.height(14.dp))
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(Tokens.SurfaceWarm),
                        ) {
                            Box(
                                Modifier
                                    .fillMaxWidth(progress)
                                    .fillMaxHeight()
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(Tokens.Primary),
                            )
                        }
                        Spacer(Modifier.height(9.dp))
                        Text(
                            if (gap != null) "距 ${tierName(row.optString("nextTier"))} 还差 ${formatCents(gap)}" else "已是最高等级",
                            fontSize = 11.5.sp,
                            color = Tokens.Muted,
                        )
                    }
                }

                row.optString("downgradeWarning").takeUnless { it.isBlank() || it == "null" }?.let {
                    Text(it, color = Tokens.Coral, fontSize = 12.sp)
                }

                val benefits = row.optJSONArray("benefits") ?: org.json.JSONArray()
                if (benefits.length() > 0) {
                    val labels = (0 until benefits.length()).map { benefits.getString(it) }
                    SectionHeader("专属权益", "${labels.size} 项")
                    // 权益清单收进卡片，和下面的贵宾厅权益保持同一层级的容器
                    HairlineCard {
                        Column(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            labels.chunked(2).forEach { pair ->
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    pair.forEach { BenefitChip(it, Modifier.weight(1f)) }
                                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                                }
                            }
                        }
                    }
                }

                val lounge = row.optJSONObject("lounge")
                if (lounge != null) {
                    HairlineCard {
                        Column(Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("贵宾厅权益", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                                Spacer(Modifier.weight(1f))
                                Text("${lounge.optInt("year")} 年", style = Tokens.Text.hint)
                            }
                            Spacer(Modifier.height(12.dp))
                            Row(verticalAlignment = Alignment.Bottom) {
                                Text(
                                    "${lounge.optInt("remaining")}",
                                    fontSize = 28.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Tokens.Ink,
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    "/ ${lounge.optInt("perYear")} 次",
                                    fontSize = 12.sp,
                                    color = Tokens.Muted,
                                    modifier = Modifier.padding(bottom = 5.dp),
                                )
                                Spacer(Modifier.weight(1f))
                                if (lounge.optInt("remaining") > 0) {
                                    GhostButton("核销一次", onClick = { if (!busy) redeem = true })
                                }
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "已用 ${lounge.optInt("used")} 次，额度当年有效，核销后不可撤销。",
                                fontSize = 11.sp,
                                color = Tokens.Muted,
                            )
                        }
                    }
                }

                SectionHeader("等级一览")
                HairlineCard {
                    Column {
                        tierRules.forEachIndexed { index, rule ->
                            if (index > 0) Hairline()
                            Row(
                                Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Image(
                                    painter = painterResource(rule.drawable),
                                    contentDescription = "${rule.label}卡面",
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .width(56.dp)
                                        .aspectRatio(1.585f)
                                        .clip(RoundedCornerShape(6.dp)),
                                )
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        rule.label,
                                        fontSize = 13.sp,
                                        fontWeight = if (rule.code == row.optString("tier")) FontWeight.SemiBold else FontWeight.Normal,
                                        color = Tokens.Ink,
                                    )
                                    Spacer(Modifier.height(2.dp))
                                    Text(
                                        if (rule.threshold == 0L) "无资产门槛" else "月均资产 ≥ ${formatCents(rule.threshold)}",
                                        fontSize = 11.sp,
                                        color = Tokens.Muted,
                                    )
                                }
                                if (rule.code == row.optString("tier")) {
                                    Box(
                                        Modifier
                                            .clip(RoundedCornerShape(6.dp))
                                            .background(Tokens.AccentWash)
                                            .padding(horizontal = 8.dp, vertical = 3.dp),
                                    ) {
                                        Text("当前", fontSize = 10.5.sp, color = Tokens.Accent, fontWeight = FontWeight.Medium)
                                    }
                                }
                            }
                        }
                    }
                }

                Text(
                    "等级按上月日均资产评定；升级即时，降级有连续两个评定周期缓冲。会员等级不创建资金账户。",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                )
            }
        }
    }
    if (redeem) AlertDialog(onDismissRequest = { if (!busy) redeem = false }, title = { Text("核销一次贵宾厅额度") }, text = { Text("确认使用本年度一次权益？请在实际需要时确认。") }, confirmButton = { TextButton(enabled = !busy, onClick = {
        busy = true
        scope.launch { try { data = BankApi.membershipData(true); error = null } catch (failure: Exception) { error = failure.message ?: "核销结果未知，请刷新核对"; data = null; reload++ } finally { busy = false; redeem = false } }
    }) { Text("确认核销") } }, dismissButton = { TextButton(enabled = !busy, onClick = { redeem = false }) { Text("取消") } })
}

@Composable
fun DeliveryScreen(onBack: () -> Unit) {
    var cards by remember { mutableStateOf<List<BankCard>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) { runCatching { CardApi.cards() }.onSuccess { cards = it; error = null }.onFailure { cards = null; error = it.message ?: "寄送信息加载失败" } }
    PushScreen("寄送信息", onBack, actionContent = { ActionIcon(Icons.Refresh, "刷新寄送信息") { BankApi.invalidateReads(); reload++ } }) {
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { ErrorNote(it) }
            cards?.let { rows ->
                val shippable = rows.filter { it.shippingAddress != null }
                if (shippable.isEmpty()) Text("暂无银行卡寄送地址记录", color = Tokens.Muted)
                shippable.forEach { card ->
                    val address = card.shippingAddress!!
                    KvCard(buildList {
                        add("银行卡" to "${card.productName} ··${card.last4}")
                        add("收件人" to address.recipient); add("联系电话" to address.phone); add("寄送地址" to CardApi.formatAddress(address))
                        card.issuingFee?.let { add("服务端记录制卡费" to formatCents(it)) }
                    })
                }
                Text("后端尚未提供物流单号及承运状态，请通过人工客服核对配送进度。", style = Tokens.Text.hint)
            }
        }
    }
}

/** 权益宫格条目：勾选图标 + 文案。 */
@Composable
private fun BenefitChip(text: String, modifier: Modifier = Modifier) {
    Row(
        modifier.padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.material3.Icon(
            Icons.Check,
            contentDescription = null,
            tint = Tokens.Accent,
            modifier = Modifier.size(13.dp),
        )
        Spacer(Modifier.width(7.dp))
        Text(text, fontSize = 11.5.sp, color = Tokens.Ink2, lineHeight = 15.sp)
    }
}

/** 会员档位中文名，与 `shared/membership.mjs` 一致。 */
private fun tierName(code: String): String = when (code) {
    "standard" -> "普通会员"
    "gold" -> "金卡会员"
    "platinum" -> "白金会员"
    "diamond" -> "钻石会员"
    else -> code
}

private data class TierRule(val code: String, val label: String, val threshold: Long, val drawable: Int)

/** 档位门槛与 shared/membership.mjs 的 MEMBER_TIER_RULES 保持一致。 */
private val tierRules = listOf(
    TierRule("standard", "普通会员", 0L, R.drawable.member_standard),
    TierRule("gold", "金卡会员", 10_000_000L, R.drawable.member_gold),
    TierRule("platinum", "白金会员", 50_000_000L, R.drawable.member_platinum),
    TierRule("diamond", "钻石会员", 300_000_000L, R.drawable.member_diamond),
)

private fun tierCard(code: String): Int = when (code) {
    "gold" -> R.drawable.member_gold
    "platinum" -> R.drawable.member_platinum
    "diamond" -> R.drawable.member_diamond
    else -> R.drawable.member_standard
}
