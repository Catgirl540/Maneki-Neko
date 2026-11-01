package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/* ───────────────── 合规文案（与服务端逐字一致） ───────────────── */

const val RISK_ACKNOWLEDGEMENT = "本人已经阅读风险揭示，愿意承担投资风险"
const val WEALTH_INVESTMENT_AGREEMENT =
    "本人已阅读并同意《理财产品投资协议》《风险揭示书》及《投资者权益须知》，自愿开立理财账户并独立承担投资风险"
const val WEALTH_DEPOSIT_WARNING = "理财非存款、产品有风险、投资须谨慎"
const val BENCHMARK_DISCLAIMER = "业绩比较基准不是预期收益率，不代表未来表现和实际收益，不构成收益承诺"
const val ACCOUNT_OPENING_PLEDGE =
    "本人充分了解并清楚知晓出租、出借、出售、购买账户的相关法律责任和惩戒措施，承诺依法依规开立和使用本人账户"
const val ACCOUNT_MISUSE_PENALTY =
    "出租、出借、出售、购买银行账户的单位和个人，5 年内暂停其银行账户非柜面业务、支付账户所有业务，并不得为其新开立账户"

private val RISK_LEVELS = listOf("R1", "R2", "R3", "R4", "R5")
private val TOLERANCE_LEVELS = listOf("C1", "C2", "C3", "C4", "C5")

fun riskPlainLabel(risk: String?): String = when (risk) {
    "R1" -> "低风险"
    "R2" -> "中低风险"
    "R3" -> "中风险"
    "R4" -> "中高风险"
    "R5" -> "高风险"
    else -> risk.orEmpty().ifEmpty { "—" }
}

fun toleranceLabel(level: String?): String = when (level) {
    "C1" -> "保守型"
    "C2" -> "谨慎型"
    "C3" -> "稳健型"
    "C4" -> "积极型"
    "C5" -> "激进型"
    else -> level.orEmpty().ifEmpty { "未测评" }
}

fun toleranceText(level: String?): String =
    if (level.isNullOrBlank()) "未测评" else "$level ${toleranceLabel(level)}"

fun riskText(risk: String?): String =
    if (risk.isNullOrBlank()) "—" else "$risk ${riskPlainLabel(risk)}"

/** C1 只能买 R1，C2 能买 R2 及以下，依此类推。 */
fun maxRiskFor(tolerance: String?): String? {
    if (tolerance == null) return null
    val index = TOLERANCE_LEVELS.indexOf(tolerance)
    if (index < 0) return null
    return RISK_LEVELS[index.coerceIn(0, RISK_LEVELS.size - 1)]
}

fun canBuyRisk(tolerance: String?, productRisk: String): Boolean {
    val max = maxRiskFor(tolerance) ?: return false
    val maxIndex = RISK_LEVELS.indexOf(max)
    val productIndex = RISK_LEVELS.indexOf(productRisk)
    return productIndex >= 0 && productIndex <= maxIndex
}

fun suitabilityMessage(tolerance: String?, productRisk: String): String {
    if (tolerance == null) return "请先完成风险测评"
    return "该产品风险等级为 $productRisk（${riskPlainLabel(productRisk)}），超过你的风险承受能力 " +
        "$tolerance（${toleranceLabel(tolerance)}）。按投资者适当性管理要求，无法购买。如风险承受能力已变化，请重新测评。"
}

fun wealthCategoryName(code: String): String = when (code) {
    "cash" -> "现金管理类"
    "fixed" -> "固定收益类"
    "mixed" -> "混合类"
    "equity" -> "权益类"
    "derivative" -> "商品及金融衍生品类"
    else -> code.ifEmpty { "理财" }
}

/* ───────────────── 展示格式 ───────────────── */

fun formatShares(shares: Double): String {
    if (!shares.isFinite()) return "—"
    val symbols = DecimalFormatSymbols(Locale.US)
    return DecimalFormat("#,##0.##", symbols).format(shares)
}

fun formatNav(nav: Double): String = String.format(Locale.US, "%.4f", nav)

fun formatRate(rate: Double): String = String.format(Locale.US, "%.2f%%", rate * 100)

fun formatDateTime(raw: String): String {
    if (raw.isBlank()) return "—"
    val value = raw.trim()
    return runCatching {
        OffsetDateTime.parse(value)
            .atZoneSameInstant(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
    }.recoverCatching {
        LocalDateTime.parse(value).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
    }.recoverCatching {
        LocalDate.parse(value).format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))
    }.getOrDefault(value)
}

fun formatDate(raw: String): String {
    if (raw.isBlank()) return "—"
    return runCatching {
        OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.systemDefault()).toLocalDate().toString()
    }.recoverCatching {
        LocalDateTime.parse(raw).toLocalDate().toString()
    }.recoverCatching {
        LocalDate.parse(raw).toString()
    }.getOrDefault(raw.take(10))
}

fun maskPhoneDisplay(phone: String): String =
    if (phone.length >= 7) phone.take(3) + "****" + phone.takeLast(4) else phone

fun maskAccountNo(accountNo: String): String =
    if (accountNo.length <= 4) accountNo else "尾号 " + accountNo.takeLast(4)

/** 申购费：服务端按 `label` 以「申购」开头的一条费率内扣。 */
fun purchaseFee(product: WealthProductDto?, amount: Long): Long {
    val item = product?.transactionFees?.firstOrNull { it.label.startsWith("申购") && it.rate > 0 } ?: return 0
    return Math.round(amount * item.rate)
}

fun purchaseFeeLabel(product: WealthProductDto?): String {
    val item = product?.transactionFees?.firstOrNull { it.label.startsWith("申购") } ?: return "免费"
    return if (item.rate > 0) "${item.label} ${formatRate(item.rate)}" else "免费"
}

/** 仅用于申购前展示，最终份额以服务端确认结果为准。 */
fun estimatedShares(product: WealthProductDto?, amount: Long): Double {
    val nav = product?.nav ?: 0.0
    if (nav <= 0) return 0.0
    return Math.round((amount - purchaseFee(product, amount)) / nav * 100.0) / 100.0
}

/* ───────────────── 风险测评 ───────────────── */

/**
 * 风险承受能力测评：一次显示一题，提交全部答案，展示服务端返回的 C1–C5、
 * 有效期与可购买的最高风险等级。不能在本机自行算分。
 */
@Composable
fun RiskAssessmentScreen(
    onBack: () -> Unit,
    onCompleted: (RiskAssessmentDto) -> Unit,
) {
    var questions by remember { mutableStateOf<List<RiskQuestionDto>?>(null) }
    var answers by remember { mutableStateOf<List<Int>>(emptyList()) }
    var index by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<RiskAssessmentDto?>(null) }
    var loadKey by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(loadKey) {
        loading = true
        error = null
        runCatching { BankApi.riskQuestions() }
            .onSuccess { list ->
                questions = list
                answers = List(list.size) { -1 }
                index = 0
            }
            .onFailure { error = it.message ?: "风险测评题目加载失败" }
        loading = false
    }

    val finished = result
    if (finished != null) {
        FlowScaffold(
            title = "测评结果",
            onBack = onBack,
            content = { RiskResult(finished) },
            footer = {
                PrimaryButton("完成", { onCompleted(finished) })
                Spacer(Modifier.height(8.dp))
                GhostButton("重新测评", {
                    result = null
                    answers = List(questions?.size ?: 0) { -1 }
                    index = 0
                }, Modifier.fillMaxWidth())
            },
        )
        return
    }

    val list = questions
    val current = list?.getOrNull(index)
    FlowScaffold(
        title = "风险承受能力测评",
        onBack = onBack,
        content = {
            when {
                loading -> {
                    Spacer(Modifier.height(20.dp))
                    Text("正在加载测评题目…", fontSize = 12.5.sp, color = Tokens.Muted, modifier = Modifier.padding(horizontal = 20.dp))
                }
                error != null -> {
                    Spacer(Modifier.height(20.dp))
                    Text(error!!, fontSize = 12.sp, color = Tokens.Coral, modifier = Modifier.padding(horizontal = 20.dp))
                    Spacer(Modifier.height(12.dp))
                    GhostButton("重新加载", { loadKey++ }, Modifier.padding(horizontal = 20.dp))
                }
                list.isNullOrEmpty() -> {
                    Spacer(Modifier.height(20.dp))
                    Text("暂无测评题目", fontSize = 12.5.sp, color = Tokens.Muted, modifier = Modifier.padding(horizontal = 20.dp))
                }
                current != null -> {
                    Column(Modifier.padding(horizontal = 20.dp)) {
                        Text(
                            "第 ${index + 1} / ${list.size} 题",
                            fontSize = 11.sp,
                            color = Tokens.Muted,
                        )
                        Spacer(Modifier.height(8.dp))
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(3.dp)
                                .clip(RoundedCornerShape(2.dp))
                                .background(Tokens.Border),
                        ) {
                            Box(
                                Modifier
                                    .fillMaxWidth((index + 1f) / list.size)
                                    .height(3.dp)
                                    .background(Tokens.Primary),
                            )
                        }
                        Spacer(Modifier.height(18.dp))
                        Text(
                            current.question,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Tokens.Ink,
                            lineHeight = 24.sp,
                        )
                        Spacer(Modifier.height(16.dp))
                        current.options.forEachIndexed { optionIndex, option ->
                            val selected = answers.getOrNull(index) == optionIndex
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(bottom = 9.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(if (selected) Tokens.SurfaceWarm else Tokens.Surface)
                                    .border(
                                        1.dp,
                                        if (selected) Tokens.Primary else Tokens.Border,
                                        RoundedCornerShape(10.dp),
                                    )
                                    .clickable {
                                        answers = answers.toMutableList().also {
                                            if (index in it.indices) it[index] = optionIndex
                                        }
                                    }
                                    .padding(horizontal = 14.dp, vertical = 13.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    Modifier
                                        .size(18.dp)
                                        .clip(CircleShape)
                                        .background(if (selected) Tokens.Primary else Tokens.Surface)
                                        .border(1.dp, if (selected) Tokens.Primary else Tokens.Border, CircleShape),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    if (selected) {
                                        Box(Modifier.size(7.dp).clip(CircleShape).background(Color.White))
                                    }
                                }
                                Spacer(Modifier.size(10.dp))
                                Text(option.label, fontSize = 13.sp, color = Tokens.Ink, lineHeight = 20.sp)
                            }
                        }
                        if (error != null) {
                            Spacer(Modifier.height(4.dp))
                            Text(error!!, fontSize = 11.5.sp, color = Tokens.Coral)
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "测评结果有效期 1 年；请按真实情况作答，适当性匹配是硬性要求。",
                            fontSize = 11.sp,
                            color = Tokens.Muted,
                            lineHeight = 17.sp,
                        )
                    }
                }
            }
        },
        footer = {
            if (!list.isNullOrEmpty() && current != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (index > 0) {
                        GhostButton("上一题", { index -= 1 }, Modifier.weight(1f))
                    }
                    PrimaryButton(
                        when {
                            submitting -> "提交中…"
                            index == list.lastIndex -> "提交测评"
                            else -> "下一题"
                        },
                        onClick = {
                            if (submitting) return@PrimaryButton
                            error = null
                            if ((answers.getOrNull(index) ?: -1) < 0) {
                                error = "请选择一个答案"
                                return@PrimaryButton
                            }
                            if (index < list.lastIndex) {
                                index += 1
                                return@PrimaryButton
                            }
                            val unanswered = answers.indexOfFirst { it < 0 }
                            if (unanswered >= 0) {
                                index = unanswered
                                error = "还有题目未作答，请补齐后再提交"
                                return@PrimaryButton
                            }
                            submitting = true
                            scope.launch {
                                runCatching { BankApi.submitRiskAssessment(answers) }
                                    .onSuccess { result = it }
                                    .onFailure { error = it.message ?: "提交失败，请重试" }
                                submitting = false
                            }
                        },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        },
    )
}

@Composable
private fun RiskResult(risk: RiskAssessmentDto) {
    Column(Modifier.padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(10.dp))
        HairlineCard {
            Column(Modifier.padding(18.dp)) {
                Text("你的风险承受能力", fontSize = 12.sp, color = Tokens.Muted)
                Spacer(Modifier.height(6.dp))
                Text(
                    toleranceText(risk.level),
                    fontSize = 26.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Tokens.Ink,
                )
                Spacer(Modifier.height(10.dp))
                Hairline()
                Spacer(Modifier.height(10.dp))
                KvRow("测评得分", risk.score?.let { "$it 分" } ?: "—")
                KvRow("有效期至", formatDate(risk.expiresAt))
                KvRow("可购买等级", maxRiskFor(risk.level)?.let { "$it 及以下" } ?: "—")
                KvRow("状态", if (risk.valid) "有效" else if (risk.expired) "已过期" else "未完成")
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "风险测评结果仅作为适当性匹配依据，不构成收益承诺。产品风险等级高于你的承受能力时无法申购。",
            fontSize = 11.sp,
            color = Tokens.Muted,
            lineHeight = 17.sp,
        )
    }
}

/* ───────────────── 理财账户开户 ───────────────── */

private enum class WealthOpenStep { Risk, Identity, Agreement, Done }

/**
 * 开立理财账户（投资资格账户，不装钱）。
 *
 * 顺序与网页一致：风险测评 → 短信 + 人脸核验 → 绑定资金账户并签署协议 → 完成。
 * 申购扣款、赎回到账都走这里绑定的唯一储蓄账户。
 */
@Composable
fun WealthAccountOpeningScreen(
    onBack: () -> Unit,
    onOpened: () -> Unit,
) {
    var step by remember { mutableStateOf(WealthOpenStep.Risk) }
    var overview by remember { mutableStateOf<WealthOverviewDto?>(null) }
    var accounts by remember { mutableStateOf<List<AccountDto>>(emptyList()) }
    var riskOverride by remember { mutableStateOf<RiskAssessmentDto?>(null) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var loadKey by remember { mutableIntStateOf(0) }
    var showRisk by remember { mutableStateOf(false) }

    var smsCode by remember { mutableStateOf("") }
    var faceTicket by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var verifying by remember { mutableStateOf(false) }
    var smsHint by remember { mutableStateOf<String?>(null) }

    var selectedAccountId by remember { mutableStateOf("") }
    var accepted by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf<String?>(null) }
    var opened by remember { mutableStateOf<WealthAccountDto?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(loadKey) {
        loading = true
        loadError = null
        runCatching {
            val ov = BankApi.wealthOverview()
            val accs = BankApi.accounts()
            ov to accs
        }.onSuccess { (ov, accs) ->
            overview = ov
            accounts = accs
            if (selectedAccountId.isBlank()) {
                selectedAccountId = ov.settlementAccountId.ifBlank {
                    accs.firstOrNull { it.currency == "CNY" }?.id.orEmpty()
                }
            }
            if (ov.opened) {
                opened = WealthAccountDto(
                    opened = true,
                    accountNo = ov.wealthAccountNo,
                    openedAt = ov.wealthOpenedAt,
                    settlementAccountId = ov.settlementAccountId,
                    agreementSignedAt = "",
                    riskLevelAtOpening = ov.riskLevel.orEmpty(),
                )
                step = WealthOpenStep.Done
            } else {
                step = if (ov.riskValid || riskOverride?.valid == true) {
                    WealthOpenStep.Identity
                } else {
                    WealthOpenStep.Risk
                }
            }
        }.onFailure { loadError = it.message ?: "加载理财账户信息失败" }
        loading = false
    }

    if (showRisk) {
        RiskAssessmentScreen(
            onBack = { showRisk = false },
            onCompleted = { risk ->
                riskOverride = risk
                showRisk = false
                step = WealthOpenStep.Identity
            },
        )
        return
    }

    val phone = SessionStore.phone()
    val riskValid = riskOverride?.valid == true || overview?.riskValid == true
    val riskLevel = riskOverride?.level ?: overview?.riskLevel
    val riskExpires = riskOverride?.expiresAt ?: overview?.riskExpiresAt.orEmpty()

    FlowScaffold(
        title = when (step) {
            WealthOpenStep.Risk -> "开立理财账户"
            WealthOpenStep.Identity -> "身份核验"
            WealthOpenStep.Agreement -> "签署协议"
            WealthOpenStep.Done -> "理财账户已开立"
        },
        onBack = when (step) {
            WealthOpenStep.Risk -> onBack
            WealthOpenStep.Identity -> ({ step = WealthOpenStep.Risk })
            WealthOpenStep.Agreement -> ({ step = WealthOpenStep.Identity })
            WealthOpenStep.Done -> onOpened
        },
        content = {
            when {
                loading -> {
                    Spacer(Modifier.height(24.dp))
                    Text("正在加载…", fontSize = 12.5.sp, color = Tokens.Muted, modifier = Modifier.padding(horizontal = 20.dp))
                }
                loadError != null -> {
                    Spacer(Modifier.height(24.dp))
                    Text(loadError!!, fontSize = 12.sp, color = Tokens.Coral, modifier = Modifier.padding(horizontal = 20.dp))
                    Spacer(Modifier.height(12.dp))
                    GhostButton("重新加载", { loadKey++ }, Modifier.padding(horizontal = 20.dp))
                }
                step == WealthOpenStep.Risk -> {
                    Column(Modifier.padding(horizontal = 20.dp)) {
                        StepCaption(1, "先确认风险承受能力")
                        Text(
                            "开立理财账户前必须完成风险测评；测评结果有效期 1 年，过期需重新测评。",
                            fontSize = 12.5.sp,
                            color = Tokens.Ink2,
                            lineHeight = 20.sp,
                        )
                        Spacer(Modifier.height(14.dp))
                        HairlineCard {
                            Column(Modifier.padding(16.dp)) {
                                Text("当前测评", fontSize = 11.sp, color = Tokens.Muted)
                                Spacer(Modifier.height(5.dp))
                                Text(
                                    if (riskValid) toleranceText(riskLevel) else "未完成 / 已过期",
                                    fontSize = 20.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Tokens.Ink,
                                )
                                Spacer(Modifier.height(8.dp))
                                KvRow("可购买等级", if (riskValid) (maxRiskFor(riskLevel)?.let { "$it 及以下" } ?: "—") else "—")
                                KvRow("有效期至", if (riskValid) formatDate(riskExpires) else "—")
                            }
                        }
                        Spacer(Modifier.height(14.dp))
                        Text(
                            WEALTH_DEPOSIT_WARNING,
                            fontSize = 12.sp,
                            color = Tokens.Coral,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
                step == WealthOpenStep.Identity -> {
                    Column(Modifier.padding(horizontal = 20.dp)) {
                        StepCaption(2, "验证手机号与本人身份")
                        Text(
                            "验证码发送至 ${maskPhoneDisplay(phone).ifBlank { "当前手机号" }}；人脸核验票据 5 分钟内有效。",
                            fontSize = 12.sp,
                            color = Tokens.Ink2,
                            lineHeight = 19.sp,
                        )
                        Spacer(Modifier.height(14.dp))
                        TextFieldRow(
                            label = "短信验证码",
                            value = smsCode,
                            onValueChange = { smsCode = it.filter(Char::isDigit).take(6) },
                            placeholder = "6 位验证码",
                            keyboardType = KeyboardType.Number,
                            trailing = {
                                Box(
                                    Modifier
                                        .height(46.dp)
                                        .clip(CircleShape)
                                        .background(Tokens.Surface)
                                        .border(1.dp, Tokens.Border, CircleShape)
                                        .clickable(enabled = !sending) {
                                            if (phone.isBlank()) {
                                                formError = "当前登录信息缺少手机号，请重新登录"
                                                return@clickable
                                            }
                                            if (sending) return@clickable
                                            sending = true
                                            formError = null
                                            scope.launch {
                                                runCatching { BankApi.sendSmsCode(phone) }
                                                    .onSuccess { demo ->
                                                        smsHint = if (demo != null) "演示验证码：$demo" else "验证码已发送"
                                                    }
                                                    .onFailure { formError = it.message }
                                                sending = false
                                            }
                                        }
                                        .padding(horizontal = 15.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(if (sending) "发送中…" else "获取验证码", fontSize = 12.5.sp, color = Tokens.Ink2)
                                }
                            },
                        )
                        if (smsHint != null) {
                            Spacer(Modifier.height(7.dp))
                            Text(smsHint!!, fontSize = 11.sp, color = Tokens.Ink2)
                        }
                        Spacer(Modifier.height(16.dp))
                        HairlineCard {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    Modifier
                                        .size(36.dp)
                                        .clip(CircleShape)
                                        .background(if (faceTicket.isNotEmpty()) Tokens.SurfaceWarm else Tokens.Page),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    androidx.compose.material3.Icon(
                                        if (faceTicket.isNotEmpty()) Icons.Check else Icons.Person,
                                        contentDescription = null,
                                        tint = if (faceTicket.isNotEmpty()) Tokens.Primary else Tokens.Muted,
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                                Spacer(Modifier.size(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("人脸核验", fontSize = 13.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
                                    Text(
                                        if (faceTicket.isNotEmpty()) "已通过，票据 5 分钟内有效" else "演示环境通过银行核身接口签发票据",
                                        fontSize = 11.sp,
                                        color = Tokens.Muted,
                                    )
                                }
                                GhostButton(
                                    if (verifying) "核验中…" else if (faceTicket.isNotEmpty()) "重新核验" else "开始核验",
                                    {
                                        if (verifying) return@GhostButton
                                        verifying = true
                                        formError = null
                                        scope.launch {
                                            runCatching { BankApi.verifyIdentity("face") }
                                                .onSuccess { faceTicket = it }
                                                .onFailure { formError = it.message ?: "人脸核验失败" }
                                            verifying = false
                                        }
                                    },
                                )
                            }
                        }
                        if (formError != null) {
                            Spacer(Modifier.height(9.dp))
                            Text(formError!!, fontSize = 11.5.sp, color = Tokens.Coral, lineHeight = 18.sp)
                        }
                    }
                }
                step == WealthOpenStep.Agreement -> {
                    Column(Modifier.padding(horizontal = 20.dp)) {
                        StepCaption(3, "绑定资金账户并签署协议")
                        Text(
                            "申购扣款与赎回到账都走同一储蓄资金账户；理财账户只记录投资资格，不是第二个存款账户。",
                            fontSize = 12.sp,
                            color = Tokens.Ink2,
                            lineHeight = 19.sp,
                        )
                        Spacer(Modifier.height(14.dp))
                        Text("结算资金账户", fontSize = 11.sp, color = Tokens.Muted)
                        Spacer(Modifier.height(6.dp))
                        accounts.filter { it.currency == "CNY" }.forEach { account ->
                            val selected = selectedAccountId == account.id
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(bottom = 8.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(if (selected) Tokens.SurfaceWarm else Tokens.Surface)
                                    .border(
                                        1.dp,
                                        if (selected) Tokens.Primary else Tokens.Border,
                                        RoundedCornerShape(10.dp),
                                    )
                                    .clickable { selectedAccountId = account.id }
                                    .padding(13.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    Modifier
                                        .size(18.dp)
                                        .clip(CircleShape)
                                        .background(if (selected) Tokens.Primary else Tokens.Surface)
                                        .border(1.dp, if (selected) Tokens.Primary else Tokens.Border, CircleShape),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    if (selected) {
                                        Box(Modifier.size(7.dp).clip(CircleShape).background(Color.White))
                                    }
                                }
                                Spacer(Modifier.size(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        account.label.ifEmpty { "人民币储蓄账户" },
                                        fontSize = 13.sp,
                                        color = Tokens.Ink,
                                        fontWeight = FontWeight.Medium,
                                    )
                                    Text(maskAccountNo(account.accountNo), fontSize = 11.sp, color = Tokens.Muted)
                                }
                                Text(
                                    "可用 " + formatCents(account.available, account.currency),
                                    fontSize = 11.sp,
                                    color = Tokens.Ink2,
                                )
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            WEALTH_INVESTMENT_AGREEMENT,
                            fontSize = 11.5.sp,
                            color = Tokens.Ink2,
                            lineHeight = 18.sp,
                        )
                        Spacer(Modifier.height(10.dp))
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickableNoRipple { accepted = !accepted },
                            verticalAlignment = Alignment.Top,
                        ) {
                            Box(
                                Modifier
                                    .padding(top = 1.dp)
                                    .size(20.dp)
                                    .clip(CircleShape)
                                    .background(if (accepted) Tokens.Primary else Tokens.Surface)
                                    .border(1.dp, if (accepted) Tokens.Primary else Tokens.Border, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (accepted) Text("✓", fontSize = 11.sp, color = Color.White)
                            }
                            Spacer(Modifier.size(8.dp))
                            Text(
                                "我已阅读并同意上述投资协议、风险揭示书及投资者权益须知",
                                fontSize = 11.5.sp,
                                color = Tokens.Ink2,
                                lineHeight = 18.sp,
                            )
                        }
                        if (formError != null) {
                            Spacer(Modifier.height(9.dp))
                            Text(formError!!, fontSize = 11.5.sp, color = Tokens.Coral, lineHeight = 18.sp)
                        }
                    }
                }
                step == WealthOpenStep.Done -> {
                    Column(Modifier.padding(horizontal = 20.dp)) {
                        Spacer(Modifier.height(12.dp))
                        Box(
                            Modifier
                                .size(54.dp)
                                .clip(CircleShape)
                                .background(Tokens.Primary),
                            contentAlignment = Alignment.Center,
                        ) {
                            androidx.compose.material3.Icon(
                                Icons.Check,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(26.dp),
                            )
                        }
                        Spacer(Modifier.height(12.dp))
                        Text("理财账户已开立", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                        Spacer(Modifier.height(5.dp))
                        Text("仅代表已具备投资资格，不代表资金已存入理财账户。", fontSize = 12.sp, color = Tokens.Muted)
                        Spacer(Modifier.height(14.dp))
                        HairlineCard {
                            Column(Modifier.padding(14.dp)) {
                                KvRow("理财账户", opened?.accountNo.orEmpty().ifEmpty { "—" })
                                KvRow("开户时间", formatDateTime(opened?.openedAt.orEmpty()))
                                KvRow("开户时风险等级", toleranceText(opened?.riskLevelAtOpening.orEmpty().ifEmpty { riskLevel }))
                                KvRow(
                                    "结算资金账户",
                                    accounts.firstOrNull { it.id == (opened?.settlementAccountId ?: selectedAccountId) }
                                        ?.let { maskAccountNo(it.accountNo) }
                                        ?: maskAccountNo(opened?.settlementAccountId.orEmpty()),
                                )
                            }
                        }
                    }
                }
            }
        },
        footer = {
            when {
                loading || loadError != null -> Unit
                step == WealthOpenStep.Risk -> {
                    PrimaryButton(
                        if (riskValid) "下一步" else "开始风险测评",
                        onClick = {
                            if (riskValid) step = WealthOpenStep.Identity else showRisk = true
                        },
                    )
                    if (riskValid) {
                        Spacer(Modifier.height(8.dp))
                        GhostButton("重新测评", { showRisk = true }, Modifier.fillMaxWidth())
                    }
                }
                step == WealthOpenStep.Identity -> {
                    PrimaryButton(
                        "下一步",
                        onClick = {
                            formError = when {
                                smsCode.length != 6 -> "请输入 6 位短信验证码"
                                faceTicket.isBlank() -> "请先完成人脸核验"
                                else -> null
                            }
                            if (formError == null) step = WealthOpenStep.Agreement
                        },
                    )
                }
                step == WealthOpenStep.Agreement -> {
                    PrimaryButton(
                        if (submitting) "开立中…" else "确认开立理财账户",
                        onClick = {
                            if (submitting) return@PrimaryButton
                            formError = when {
                                selectedAccountId.isBlank() -> "请选择结算资金账户"
                                !accepted -> "请先阅读并同意投资协议"
                                else -> null
                            }
                            if (formError != null) return@PrimaryButton
                            submitting = true
                            formError = null
                            scope.launch {
                                runCatching {
                                    BankApi.openWealthAccount(
                                        smsCode = smsCode,
                                        faceTicket = faceTicket,
                                        settlementAccountId = selectedAccountId,
                                        agreement = WEALTH_INVESTMENT_AGREEMENT,
                                    )
                                }.onSuccess {
                                    opened = it
                                    step = WealthOpenStep.Done
                                }.onFailure { throwable ->
                                    val code = (throwable as? BankApiException)?.code
                                    formError = throwable.message ?: "开立理财账户失败"
                                    if (code == "IDENTITY_REQUIRED" || code == "FACE_REQUIRED") {
                                        smsCode = ""
                                        faceTicket = ""
                                        step = WealthOpenStep.Identity
                                    } else if (code == "RISK_ASSESSMENT_REQUIRED" || code == "RISK_EXPIRED") {
                                        riskOverride = null
                                        step = WealthOpenStep.Risk
                                    }
                                }
                                submitting = false
                            }
                        },
                    )
                }
                step == WealthOpenStep.Done -> {
                    PrimaryButton("完成", onOpened)
                }
            }
        },
    )
}

@Composable
private fun StepCaption(step: Int, title: String) {
    Text("第 $step 步 / 共 3 步", fontSize = 11.sp, color = Tokens.Muted)
    Spacer(Modifier.height(4.dp))
    Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun FlowScaffold(
    title: String,
    onBack: (() -> Unit)?,
    content: @Composable ColumnScope.() -> Unit,
    footer: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Page),
    ) {
        TopBar(title, onBack)
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            content = content,
        )
        Column(
            Modifier
                .fillMaxWidth()
                .background(Tokens.Page)
                .padding(horizontal = 20.dp, vertical = 12.dp),
            content = footer,
        )
    }
}
