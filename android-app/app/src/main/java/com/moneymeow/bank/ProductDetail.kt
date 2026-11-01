package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch

/** 47 产品详情：真实披露字段、真实适当性门禁、逐字抄录风险确认与真实申购回执。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductDetailScreen(onBack: () -> Unit, productCode: String?) {
    var product by remember { mutableStateOf<WealthProductDto?>(null) }
    var overview by remember { mutableStateOf<WealthOverviewDto?>(null) }
    var accounts by remember { mutableStateOf<List<AccountDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var loadKey by remember { mutableIntStateOf(0) }
    var showRisk by remember { mutableStateOf(false) }
    var showOpen by remember { mutableStateOf(false) }
    var subscribing by remember { mutableStateOf(false) }
    var subscribeResult by remember { mutableStateOf<WealthSubscribeResultDto?>(null) }
    var gateMessage by remember { mutableStateOf<String?>(null) }
    val sheetState = rememberModalBottomSheetState()

    LaunchedEffect(loadKey) {
        loading = true
        loadError = null
        runCatching {
            val loadedProduct = if (productCode.isNullOrBlank()) {
                BankApi.wealthProducts().firstOrNull()
            } else {
                BankApi.wealthProduct(productCode)
            }
            Triple(loadedProduct, BankApi.wealthOverview(), BankApi.accounts())
        }.onSuccess { (loadedProduct, loadedOverview, loadedAccounts) ->
            product = loadedProduct
            overview = loadedOverview
            accounts = loadedAccounts
        }.onFailure { loadError = it.message ?: "产品加载失败" }
        loading = false
    }

    val opened = overview?.opened == true
    val riskValid = overview?.riskValid == true
    val tolerance = overview?.riskLevel
    val matched = product != null && canBuyRisk(tolerance, product!!.risk)
    val settlementAccount = accounts.firstOrNull { it.id == overview?.settlementAccountId }
        ?: accounts.firstOrNull { it.currency == "CNY" }
        ?: accounts.firstOrNull()

    PushScreen(title = "产品详情", onBack = onBack) {
        when {
            loading -> {
                Text("产品加载中…", fontSize = 12.5.sp, color = Tokens.Muted, modifier = Modifier.padding(20.dp))
            }
            product == null -> {
                Text(
                    "产品加载失败：${loadError ?: "未找到产品"}",
                    fontSize = 12.sp,
                    color = Tokens.Coral,
                    modifier = Modifier.padding(20.dp),
                )
                GhostButton("重新加载", { loadKey++ }, Modifier.padding(horizontal = 20.dp))
            }
            else -> {
                val item = product!!
                HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                item.name,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Tokens.Ink,
                                modifier = Modifier.weight(1f),
                            )
                            RiskBadge(item.risk)
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            (item.issuer.ifEmpty { "招财猫理财有限责任公司" }) + " · " + item.code,
                            fontSize = 11.sp,
                            color = Tokens.Muted,
                        )
                        Spacer(Modifier.height(13.dp))
                        Hairline()
                        Spacer(Modifier.height(12.dp))
                        Text("单位净值", fontSize = 11.sp, color = Tokens.Muted)
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                formatNav(item.nav),
                                fontSize = 24.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Tokens.Ink,
                            )
                            Spacer(Modifier.size(6.dp))
                            Text(
                                when {
                                    item.sevenDayYield != null -> "七日年化 " + formatRate(item.sevenDayYield)
                                    item.navDate.isNotBlank() -> "净值日期 " + formatDate(item.navDate)
                                    else -> ""
                                },
                                fontSize = 11.sp,
                                color = Tokens.Muted,
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(
                            WEALTH_DEPOSIT_WARNING,
                            fontSize = 12.sp,
                            color = Tokens.Coral,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))
                KvCard(
                    listOf(
                        "风险等级" to riskText(item.risk),
                        "产品类型" to wealthCategoryName(item.category),
                        "起购 / 递增" to (formatCents(item.minAmount) + " / " + formatCents(item.stepAmount)),
                        "期限与开放性" to item.term.ifEmpty { if (item.openEnded) "开放式 · 随时赎回" else "封闭期" },
                        "业绩比较基准" to item.benchmark.ifEmpty { "—" },
                    ),
                    Modifier.padding(horizontal = 14.dp),
                )
                if (item.benchmark.isNotBlank()) {
                    Text(
                        item.benchmarkBasis.ifBlank { BENCHMARK_DISCLAIMER },
                        fontSize = 10.5.sp,
                        color = Tokens.Muted,
                        lineHeight = 16.sp,
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 6.dp),
                    )
                }

                Spacer(Modifier.height(12.dp))
                HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                    Column(Modifier.padding(14.dp)) {
                        Text("费用", fontSize = 11.sp, color = Tokens.Muted)
                        Spacer(Modifier.height(8.dp))
                        if (item.ongoingFees.isNotEmpty()) {
                            item.ongoingFees.forEach { fee ->
                                KvRow(fee.label, formatRate(fee.rate) + "/年")
                            }
                        }
                        if (item.transactionFees.isNotEmpty()) {
                            if (item.ongoingFees.isNotEmpty()) Hairline()
                            Spacer(Modifier.height(6.dp))
                            item.transactionFees.forEach { fee ->
                                val condition = fee.holdingDaysLessThan?.let { "（持有 < $it 天）" }.orEmpty()
                                KvRow(fee.label + condition, if (fee.rate > 0) formatRate(fee.rate) else "免费")
                            }
                        }
                        if (item.ongoingFees.isEmpty() && item.transactionFees.isEmpty()) {
                            Text("费率以产品说明书为准", fontSize = 12.sp, color = Tokens.Muted)
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))
                GateCard(
                    opened = opened,
                    riskValid = riskValid,
                    tolerance = tolerance,
                    productRisk = item.risk,
                    matched = matched,
                    wealthAccountNo = overview?.wealthAccountNo.orEmpty(),
                    settlementAccountNo = settlementAccount?.accountNo.orEmpty(),
                    onOpenAccount = { showOpen = true },
                    onRisk = { showRisk = true },
                )

                if (item.priorityRestricted) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "该产品当前处于会员优先购窗口，你的会员等级暂不可申购。",
                        fontSize = 11.5.sp,
                        color = Tokens.Coral,
                        modifier = Modifier.padding(horizontal = 18.dp),
                        lineHeight = 18.sp,
                    )
                }

                val result = subscribeResult
                if (result != null) {
                    Spacer(Modifier.height(12.dp))
                    SubscriptionResult(item, result)
                }

                if (gateMessage != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        gateMessage!!,
                        fontSize = 11.5.sp,
                        color = Tokens.Coral,
                        modifier = Modifier.padding(horizontal = 18.dp),
                        lineHeight = 18.sp,
                    )
                }

                Spacer(Modifier.height(14.dp))
                PrimaryButton(
                    when {
                        !opened -> "开立理财账户后申购"
                        !riskValid -> "完成风险测评后申购"
                        !matched -> "风险等级不匹配 · 重新测评"
                        item.priorityRestricted -> "暂不可申购"
                        else -> "立即申购"
                    },
                    onClick = {
                        gateMessage = null
                        when {
                            !opened -> showOpen = true
                            !riskValid -> showRisk = true
                            !matched -> showRisk = true
                            item.priorityRestricted -> {
                                gateMessage = "该产品当前处于会员优先购窗口，你的会员等级暂不可申购。"
                            }
                            else -> subscribing = true
                        }
                    },
                    modifier = Modifier.padding(horizontal = 14.dp),
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "适当性匹配、风险确认、金额与支付密码均由服务端校验；客户端不自行计算风险等级。",
                    fontSize = 10.5.sp,
                    color = Tokens.Muted,
                    modifier = Modifier.padding(horizontal = 18.dp),
                    lineHeight = 16.sp,
                )
            }
        }
    }

    if (subscribing && product != null) {
        val item = product!!
        var amountText by remember(item.code) { mutableStateOf("") }
        var password by remember(item.code) { mutableStateOf("") }
        var ackText by remember(item.code) { mutableStateOf("") }
        var submitError by remember(item.code) { mutableStateOf<String?>(null) }
        var submitting by remember(item.code) { mutableStateOf(false) }
        val scope = rememberCoroutineScope()
        val amountCents = remember(amountText) {
            if (!Regex("^[0-9]+(\\.[0-9]{1,2})?$").matches(amountText)) 0L
            else runCatching { java.math.BigDecimal(amountText).movePointRight(2).longValueExact() }.getOrDefault(0L)
        }
        val fee = purchaseFee(item, amountCents)
        val shares = estimatedShares(item, amountCents)
        val ackMatches = ackText.trim() == RISK_ACKNOWLEDGEMENT

        ModalBottomSheet(
            onDismissRequest = { if (!submitting) subscribing = false },
            sheetState = sheetState,
            containerColor = Tokens.Surface,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Text(
                    "申购 · ${item.name}",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Tokens.Ink,
                )
                Spacer(Modifier.height(12.dp))
                KvRow("起购 / 递增", formatCents(item.minAmount) + " / " + formatCents(item.stepAmount))
                KvRow("风险等级", riskText(item.risk))
                KvRow(
                    "结算资金账户",
                    settlementAccount?.let { it.label + " · " + maskAccountNo(it.accountNo) } ?: "—",
                )
                KvRow("可用余额", settlementAccount?.let { formatCents(it.available, it.currency) } ?: "—")
                KvRow("申购费率", purchaseFeeLabel(item))
                Spacer(Modifier.height(10.dp))

                Text("申购金额（元）", fontSize = 11.sp, color = Tokens.Muted)
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
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.CenterStart) {
                                if (amountText.isEmpty()) {
                                    Text(
                                        "最低 " + formatCents(item.minAmount),
                                        fontSize = 13.sp,
                                        color = Tokens.Muted,
                                    )
                                }
                                inner()
                            }
                        },
                    )
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    if (amountCents > 0) {
                        "预计申购费 " + formatCents(fee) + "（内扣） · 预计确认份额 " + formatShares(shares)
                    } else {
                        "最终份额、净值与费用以服务端确认结果为准。"
                    },
                    fontSize = 10.5.sp,
                    color = Tokens.Muted,
                    lineHeight = 16.sp,
                )
                Spacer(Modifier.height(14.dp))

                Text("风险确认语句", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(6.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Tokens.SurfaceWarm)
                        .padding(12.dp),
                ) {
                    Text(RISK_ACKNOWLEDGEMENT, fontSize = 12.sp, color = Tokens.Ink, lineHeight = 18.sp)
                }
                Spacer(Modifier.height(8.dp))
                Text("请逐字抄录上方语句（不是勾选）", fontSize = 10.5.sp, color = Tokens.Muted)
                Spacer(Modifier.height(6.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(74.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Tokens.Surface)
                        .border(
                            1.dp,
                            when {
                                ackText.isEmpty() -> Tokens.Border
                                ackMatches -> Tokens.Primary
                                else -> Tokens.Coral
                            },
                            RoundedCornerShape(10.dp),
                        )
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                ) {
                    BasicTextField(
                        value = ackText,
                        onValueChange = { ackText = it.take(64) },
                        textStyle = TextStyle(fontSize = 12.5.sp, color = Tokens.Ink, lineHeight = 18.sp),
                        cursorBrush = SolidColor(Tokens.Accent),
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 2,
                        maxLines = 3,
                        decorationBox = { inner ->
                            Box {
                                if (ackText.isEmpty()) {
                                    Text(
                                        "逐字输入风险确认语句",
                                        fontSize = 12.5.sp,
                                        color = Tokens.Muted,
                                    )
                                }
                                inner()
                            }
                        },
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    when {
                        ackText.isEmpty() -> " "
                        ackMatches -> "已完整抄录"
                        else -> "尚未与要求语句完全一致"
                    },
                    fontSize = 10.5.sp,
                    color = if (ackMatches) Tokens.Ink2 else Tokens.Coral,
                )
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
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
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
                    Text(submitError!!, fontSize = 11.5.sp, color = Tokens.Coral, lineHeight = 18.sp)
                }
                Spacer(Modifier.height(16.dp))
                PrimaryButton(
                    if (submitting) "提交中…" else "确认申购",
                    onClick = {
                        if (submitting) return@PrimaryButton
                        val account = settlementAccount
                        submitError = when {
                            account == null -> "未找到可用的结算资金账户"
                            amountCents <= 0 -> "请输入有效金额，最多两位小数"
                            amountCents < item.minAmount -> "低于起购金额 " + formatCents(item.minAmount)
                            item.stepAmount > 0 && amountCents % item.stepAmount != 0L ->
                                "追加金额需为 " + formatCents(item.stepAmount) + " 的整数倍"
                            amountCents > account.available -> account.label + "可用余额不足"
                            !ackMatches -> "请完整抄录风险确认语句"
                            password.length != 6 -> "请输入 6 位支付密码"
                            else -> null
                        }
                        if (submitError != null) return@PrimaryButton
                        submitting = true
                        submitError = null
                        scope.launch {
                            runCatching {
                                BankApi.subscribeWealthDetailed(
                                    productCode = item.code,
                                    amount = amountCents,
                                    paymentPassword = password,
                                    acknowledgement = ackText.trim(),
                                )
                            }.onSuccess { confirmation ->
                                subscribeResult = confirmation
                                subscribing = false
                            }.onFailure { throwable ->
                                val code = (throwable as? BankApiException)?.code
                                submitError = throwable.message ?: "申购失败"
                                if (code == "WEALTH_ACCOUNT_REQUIRED") {
                                    subscribing = false
                                    showOpen = true
                                } else if (code == "RISK_ASSESSMENT_REQUIRED" || code == "RISK_MISMATCH") {
                                    subscribing = false
                                    showRisk = true
                                } else if (code == "BAD_PAY_PASSWORD") {
                                    password = ""
                                }
                            }
                            submitting = false
                        }
                    },
                )
                Spacer(Modifier.height(14.dp))
            }
        }
    }

    if (showOpen) {
        Dialog(
            onDismissRequest = { showOpen = false },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Tokens.Page)
                    .statusBarsPadding()
                    .navigationBarsPadding(),
            ) {
                WealthAccountOpeningScreen(
                    onBack = { showOpen = false },
                    onOpened = {
                        showOpen = false
                        loadKey++
                    },
                )
            }
        }
    }

    if (showRisk) {
        Dialog(
            onDismissRequest = { showRisk = false },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Tokens.Page)
                    .statusBarsPadding()
                    .navigationBarsPadding(),
            ) {
                RiskAssessmentScreen(
                    onBack = { showRisk = false },
                    onCompleted = {
                        showRisk = false
                        loadKey++
                    },
                )
            }
        }
    }
}

@Composable
private fun GateCard(
    opened: Boolean,
    riskValid: Boolean,
    tolerance: String?,
    productRisk: String,
    matched: Boolean,
    wealthAccountNo: String,
    settlementAccountNo: String,
    onOpenAccount: () -> Unit,
    onRisk: () -> Unit,
) {
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("申购条件", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.weight(1f))
                Text(
                    if (opened && riskValid && matched) "已满足" else "未满足",
                    fontSize = 11.sp,
                    color = if (opened && riskValid && matched) Tokens.Ink2 else Tokens.Coral,
                )
            }
            Spacer(Modifier.height(9.dp))
            Hairline()
            Spacer(Modifier.height(9.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("理财账户", fontSize = 12.5.sp, color = Tokens.Ink)
                    Text(
                        if (opened) "已开立 · " + maskAccountNo(wealthAccountNo) else "尚未开立理财账户",
                        fontSize = 10.5.sp,
                        color = Tokens.Muted,
                    )
                }
                if (!opened) GhostButton("去开立", onOpenAccount)
            }
            Spacer(Modifier.height(9.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("风险测评", fontSize = 12.5.sp, color = Tokens.Ink)
                    Text(
                        when {
                            !riskValid -> "未完成或已过期，需重新测评"
                            matched -> toleranceText(tolerance) + " · 可购买 " + productRisk
                            else -> toleranceText(tolerance) + " · 不可购买 " + productRisk
                        },
                        fontSize = 10.5.sp,
                        color = if (riskValid && matched) Tokens.Muted else Tokens.Coral,
                    )
                }
                if (!riskValid || !matched) GhostButton(if (riskValid) "重新测评" else "去测评", onRisk)
            }
            if (opened && riskValid && !matched) {
                Spacer(Modifier.height(8.dp))
                Text(
                    suitabilityMessage(tolerance, productRisk),
                    fontSize = 11.sp,
                    color = Tokens.Coral,
                    lineHeight = 17.sp,
                )
            }
            if (opened && settlementAccountNo.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "申购扣款与赎回到账：结算资金账户 " + maskAccountNo(settlementAccountNo),
                    fontSize = 10.5.sp,
                    color = Tokens.Muted,
                )
            }
        }
    }
}

@Composable
private fun SubscriptionResult(product: WealthProductDto, result: WealthSubscribeResultDto) {
    HairlineCard(Modifier.padding(horizontal = 14.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text("申购确认", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(4.dp))
            Text(
                result.productName.ifEmpty { product.name } + " · 已按服务端确认结果记账",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
            )
            Spacer(Modifier.height(10.dp))
            Hairline()
            Spacer(Modifier.height(10.dp))
            KvRow("确认份额", formatShares(result.shares))
            KvRow("确认净值", formatNav(result.nav))
            KvRow("申购费用", formatCents(result.fees))
            KvRow("确认时间", formatDateTime(result.confirmedAt))
            KvRow("持仓市值", formatCents(result.holdingMarketValue))
            KvRow("持仓本金", formatCents(result.holdingPrincipal))
            Spacer(Modifier.height(6.dp))
            Text(
                "份额、净值与费用均来自本次申购确认，不再使用「已受理」等模糊表述。",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
                lineHeight = 16.sp,
            )
        }
    }
}
