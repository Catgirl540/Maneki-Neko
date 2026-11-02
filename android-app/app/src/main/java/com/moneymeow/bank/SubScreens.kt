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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import java.math.BigDecimal
import java.util.Locale
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/* ─────────────────────────── 存款 ─────────────────────────── */

@Composable
fun DepositsScreen(onBack: () -> Unit, onTransferIn: () -> Unit, onTransferOut: () -> Unit, onTransactions: () -> Unit) {
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        runCatching { BankApi.accounts() }
            .onSuccess { account = it.firstOrNull() }
            .onFailure { error = it.message }
        loading = false
    }
    val balances = account?.currencyBalances.orEmpty()
    PushScreen(title = "存款", onBack = onBack) {
        SectionHeader("活期存款", account?.let { "储蓄账户 ··${it.accountNo.takeLast(4)}" } ?: "储蓄账户")
        if (loading && balances.isEmpty()) {
            HairlineCard(Modifier.padding(horizontal = 14.dp)) { SkeletonCardLines(2) }
        } else {
            KvCard(
                buildList {
                    balances.forEach { add(currencyName(it.currency) to formatCurrency(it.currency, it.balance)) }
                    if (balances.isEmpty()) add("账户余额" to if (error != null) "加载失败" else "暂无账户")
                },
                Modifier.padding(horizontal = 14.dp),
            )
        }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(
                error!!,
                fontSize = 11.sp,
                color = Tokens.Coral,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SmallAction("转入", Icons.DownIn, Modifier.weight(1f), onTransferIn)
            SmallAction("转出", Icons.UpOut, Modifier.weight(1f), onTransferOut)
            SmallAction("交易流水", Icons.Receipt, Modifier.weight(1f), onTransactions)
        }
        SectionHeader("定期存款")
        EmptyNote("暂无可用的定期存款产品\n当前仅提供活期存款")
    }
}

/** 币种中文名，与网页 `lib/format.ts` 的显示口径一致。 */
private fun currencyName(code: String): String = when (code) {
    "CNY" -> "人民币 CNY"
    "HKD" -> "港币 HKD"
    "USD" -> "美元 USD"
    "EUR" -> "欧元 EUR"
    "JPY" -> "日元 JPY"
    "GBP" -> "英镑 GBP"
    else -> code
}

private fun formatCurrency(code: String, cents: Long): String = when (code) {
    "CNY" -> formatCents(cents)
    else -> {
        val symbol = when (code) {
            "HKD" -> "HK$"
            "USD" -> "$"
            "EUR" -> "€"
            "JPY" -> "¥"
            "GBP" -> "£"
            else -> ""
        }
        symbol + formatCents(cents).removePrefix("¥")
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
internal fun EmptyNote(text: String) {
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
        Text(text, style = Tokens.Text.note, lineHeight = 20.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/* ─────────────────────────── 换汇 ─────────────────────────── */

/** 与网页 `ExchangePage` 一致：只允许这三种币种作为买入方向。 */
private val FX_CURRENCIES = listOf("CNY", "USD", "HKD")

private data class ExchangeQuoteSnapshot(
    val quote: SubScreensApi.ExchangeQuoteDetailDto,
    /** 客户端收到报价的时刻；有效期只能由它 + 服务端 TTL 推导。 */
    val receivedAt: Long,
)

@Composable
fun ExchangeScreen(onBack: () -> Unit) {
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var fromId by remember { mutableStateOf<String?>(null) }
    var toCurrency by remember { mutableStateOf("USD") }
    var amountText by remember { mutableStateOf("") }
    var snapshot by remember { mutableStateOf<ExchangeQuoteSnapshot?>(null) }
    var quoting by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf<String?>(null) }
    var confirmOpen by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var passwordError by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<ExchangeQuoteSnapshot?>(null) }
    var tick by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var quoteVersion by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        if (!BankApi.hasToken()) {
            loadError = "请先登录后再换汇"
            loading = false
            return@LaunchedEffect
        }
        runCatching { BankApi.accounts().firstOrNull() }
            .onSuccess { loaded ->
                account = loaded
                val rows = balancesOf(loaded)
                val primary = rows.firstOrNull { it.currency == "CNY" } ?: rows.firstOrNull()
                fromId = primary?.id
                if (primary != null) {
                    toCurrency = FX_CURRENCIES.firstOrNull { it != primary.currency } ?: "USD"
                }
            }
            .onFailure { loadError = it.message ?: "账户信息加载失败" }
        loading = false
    }

    val balances = balancesOf(account)
    val fromBalance = balances.firstOrNull { it.id == fromId }
    val amountCents = amountToCents(amountText)
    val remainingMs = snapshot?.let {
        it.receivedAt + it.quote.quoteTtlSeconds * 1000L - tick
    } ?: 0L
    val ttlLeft = if (remainingMs > 0L) (remainingMs + 999L) / 1000L else 0L
    val quoteMatches = snapshot?.let { current ->
        current.quote.fromCurrency == fromBalance?.currency &&
            current.quote.toCurrency == toCurrency &&
            current.quote.fromAmount == amountCents
    } == true
    val liveSnapshot = snapshot?.takeIf { quoteMatches && ttlLeft > 0L }

    LaunchedEffect(snapshot?.quote?.quoteId) {
        val active = snapshot ?: return@LaunchedEffect
        while (true) {
            val now = System.currentTimeMillis()
            tick = now
            if (active.receivedAt + active.quote.quoteTtlSeconds * 1000L <= now) break
            delay(500)
        }
    }

    fun invalidateQuote() {
        quoteVersion += 1
        snapshot = null
        quoting = false
        formError = null
    }

    fun pickFrom(id: String) {
        if (id == fromId) return
        fromId = id
        val currency = balances.firstOrNull { it.id == id }?.currency
        if (currency != null && currency == toCurrency) {
            toCurrency = FX_CURRENCIES.firstOrNull { it != currency } ?: "USD"
        }
        invalidateQuote()
    }

    fun pickTo(currency: String) {
        if (currency == toCurrency) return
        toCurrency = currency
        invalidateQuote()
    }

    fun requestQuote() {
        if (quoting || submitting) return
        val balance = fromBalance
        if (balance == null) {
            formError = "请选择卖出币种"
            return
        }
        val cents = amountCents
        if (cents == null || cents <= 0L) {
            formError = "请输入有效金额，最多两位小数"
            return
        }
        if (cents > balance.available) {
            formError = "金额超过该币种可用余额"
            return
        }
        if (toCurrency == balance.currency) {
            formError = "买入币种不能与卖出币种相同"
            return
        }
        quoteVersion += 1
        val version = quoteVersion
        snapshot = null
        quoting = true
        formError = null
        scope.launch {
            try {
                val quote = SubScreensApi.quoteExchange(balance.id, toCurrency, cents)
                if (version != quoteVersion) return@launch
                if (quote.fromCurrency != balance.currency) {
                    formError = "报价币种与卖出币种不一致，请重新获取"
                    return@launch
                }
                snapshot = ExchangeQuoteSnapshot(quote, System.currentTimeMillis())
                tick = System.currentTimeMillis()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (version == quoteVersion) {
                    formError = error.message ?: "获取报价失败，请稍后重试"
                }
            } finally {
                if (version == quoteVersion) quoting = false
            }
        }
    }

    fun submitExchange() {
        if (submitting) return
        val current = snapshot ?: return
        val balance = fromBalance ?: return
        if (ttlLeft <= 0L) {
            passwordError = "参考报价已过期，请重新获取"
            return
        }
        if (!Regex("^\\d{6}$").matches(password)) {
            passwordError = "请输入 6 位支付密码"
            return
        }
        val version = quoteVersion
        submitting = true
        passwordError = null
        scope.launch {
            try {
                // 服务端报价不锁价：提交前复核一次，汇率或到账金额变化必须重新确认。
                val latest = SubScreensApi.quoteExchange(balance.id, toCurrency, current.quote.fromAmount)
                if (version != quoteVersion) return@launch
                if (latest.rate != current.quote.rate || latest.toAmount != current.quote.toAmount) {
                    snapshot = ExchangeQuoteSnapshot(latest, System.currentTimeMillis())
                    tick = System.currentTimeMillis()
                    password = ""
                    passwordError = "参考报价已更新，请核对后重新确认"
                    return@launch
                }
                BankApi.exchange(latest.quoteId, balance.id, toCurrency, current.quote.fromAmount, password)
                result = ExchangeQuoteSnapshot(latest, System.currentTimeMillis())
                confirmOpen = false
                password = ""
                snapshot = null
                formError = null
            } catch (error: CancellationException) {
                throw error
            } catch (error: BankApiException) {
                if (error.code == "BAD_PAY_PASSWORD") password = ""
                if (error.code == "QUOTE_EXPIRED" || error.code == "QUOTE_CHANGED") {
                    snapshot = null
                    confirmOpen = false
                    formError = "参考报价已失效，请重新获取"
                    passwordError = error.message
                } else {
                    passwordError = error.message
                }
            } catch (error: Exception) {
                passwordError = error.message ?: "换汇失败，请稍后重试"
            } finally {
                submitting = false
            }
        }
    }

    val finished = result
    if (finished != null) {
        DoneScreen(
            title = "换汇",
            headline = "换汇已完成",
            note = "资金已在同一储蓄账户内完成币种划转",
            rows = listOf(
                "卖出" to formatCurrency(finished.quote.fromCurrency, finished.quote.fromAmount),
                "买入" to formatCurrency(finished.quote.toCurrency, finished.quote.toAmount),
                "成交汇率" to "1 ${finished.quote.fromCurrency} ≈ ${formatFxRate(finished.quote.rate)} ${finished.quote.toCurrency}",
                "资金账户" to (account?.let { "储蓄账户 ··${it.accountNo.takeLast(4)}" } ?: "储蓄账户"),
            ),
            actionLabel = "完成",
            onBack = onBack,
            onAction = onBack,
        )
        return
    }

    PushScreen(title = "换汇", onBack = onBack) {
        if (loading) {
            Spacer(Modifier.height(8.dp))
            EmptyNote("正在加载账户余额…")
            return@PushScreen
        }
        if (account == null) {
            Spacer(Modifier.height(8.dp))
            EmptyNote(loadError ?: "暂无可用账户")
            return@PushScreen
        }
        SectionHeader("账户内换汇", account?.let { "储蓄账户 ··${it.accountNo.takeLast(4)}" })
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(14.dp)) {
                Text("卖出币种", style = Tokens.Text.hint)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    balances.forEach { balance ->
                        CurrencyChip(
                            currency = balance.currency,
                            selected = balance.id == fromId,
                            enabled = !submitting && !confirmOpen,
                        ) { pickFrom(balance.id) }
                    }
                }
                Spacer(Modifier.height(10.dp))
                Text(
                    fromBalance?.let { "可用 ${formatCurrency(it.currency, it.available)}" } ?: "可用 —",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                )
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "卖出金额",
                    value = amountText,
                    onValueChange = {
                        amountText = sanitizeAmountInput(it)
                        invalidateQuote()
                    },
                    placeholder = "0.00",
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal,
                    trailing = {
                        Text(fromBalance?.currency ?: "", style = Tokens.Text.note)
                    },
                )
                Spacer(Modifier.height(14.dp))
                Text("买入币种", style = Tokens.Text.hint)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FX_CURRENCIES.filter { it != fromBalance?.currency }.forEach { currency ->
                        CurrencyChip(
                            currency = currency,
                            selected = currency == toCurrency,
                            enabled = !submitting && !confirmOpen,
                        ) { pickTo(currency) }
                    }
                }
                Spacer(Modifier.height(14.dp))
                Hairline()
                Spacer(Modifier.height(10.dp))
                when {
                    liveSnapshot != null -> {
                        val quote = liveSnapshot.quote
                        QuoteLine(
                            "参考汇率",
                            "1 ${quote.fromCurrency} ≈ ${formatFxRate(quote.rate)} ${quote.toCurrency}",
                        )
                        quote.spread?.let { spread ->
                            QuoteLine("点差", String.format(Locale.US, "%.2f%%", spread * 100))
                        }
                        QuoteLine(
                            "预计到账",
                            formatCurrency(quote.toCurrency, quote.toAmount),
                            emphasize = true,
                        )
                        QuoteLine("报价有效期", "剩余 ${ttlLeft} 秒")
                    }
                    snapshot != null -> Text(
                        "参考报价已过期，请重新获取。",
                        fontSize = 11.sp,
                        color = Tokens.Coral,
                        lineHeight = 18.sp,
                    )
                    else -> Text(
                        "选择卖出币种、买入币种和金额，获取服务端参考报价。",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        lineHeight = 18.sp,
                    )
                }
                formError?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, fontSize = 11.sp, color = Tokens.Coral, lineHeight = 18.sp)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(
            Modifier.padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (liveSnapshot != null) {
                GhostButton(
                    "重新获取报价",
                    { if (!submitting) requestQuote() },
                    Modifier.weight(1f),
                )
            }
            ActionButton(
                text = when {
                    quoting -> "获取报价中…"
                    liveSnapshot != null -> "确认换汇"
                    else -> "获取报价"
                },
                enabled = !submitting && !quoting && fromBalance != null,
                modifier = Modifier.weight(1f),
            ) {
                if (liveSnapshot != null) {
                    password = ""
                    passwordError = null
                    confirmOpen = true
                } else {
                    requestQuote()
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "参考报价不锁价，实际到账金额以成交结果为准。",
            fontSize = 11.sp,
            color = Tokens.Muted,
            lineHeight = 18.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }

    if (confirmOpen) {
        ExchangeConfirmDialog(
            live = liveSnapshot != null,
            ttlLeft = ttlLeft,
            quote = snapshot?.quote,
            password = password,
            onPasswordChange = {
                password = it.filter(Char::isDigit).take(6)
                passwordError = null
            },
            error = passwordError,
            busy = submitting,
            onDismiss = {
                if (!submitting) {
                    confirmOpen = false
                    password = ""
                    passwordError = null
                }
            },
            onRefresh = {
                confirmOpen = false
                password = ""
                passwordError = null
                requestQuote()
            },
            onConfirm = { submitExchange() },
        )
    }
}

@Composable
private fun CurrencyChip(
    currency: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .clip(CircleShape)
            .background(if (selected) Tokens.Primary else Tokens.SurfaceWarm)
            .border(1.dp, if (selected) Tokens.Primary else Tokens.Border, CircleShape)
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(
            currency,
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = when {
                selected -> Color.White
                enabled -> Tokens.Ink2
                else -> Tokens.Muted
            },
        )
    }
}

@Composable
private fun QuoteLine(label: String, value: String, emphasize: Boolean = false) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 11.5.sp, color = Tokens.Muted)
        Spacer(Modifier.width(12.dp))
        Text(
            value,
            fontSize = if (emphasize) 14.sp else 11.5.sp,
            fontWeight = if (emphasize) FontWeight.SemiBold else FontWeight.Medium,
            color = if (emphasize) Tokens.Ink else Tokens.Ink2,
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun ActionButton(
    text: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .height(48.dp)
            .clip(RoundedCornerShape(Tokens.CardRadius.dp))
            .background(if (enabled) Tokens.Primary else Tokens.Border)
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = if (enabled) Color.White else Tokens.Muted,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun ExchangeConfirmDialog(
    live: Boolean,
    ttlLeft: Long,
    quote: SubScreensApi.ExchangeQuoteDetailDto?,
    password: String,
    onPasswordChange: (String) -> Unit,
    error: String?,
    busy: Boolean,
    onDismiss: () -> Unit,
    onRefresh: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        containerColor = Tokens.Surface,
        title = { Text("确认换汇", fontSize = 18.sp, color = Tokens.Ink) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (quote != null) {
                    QuoteLine("卖出", formatCurrency(quote.fromCurrency, quote.fromAmount))
                    QuoteLine("买入", formatCurrency(quote.toCurrency, quote.toAmount), emphasize = true)
                    QuoteLine(
                        "参考汇率",
                        "1 ${quote.fromCurrency} ≈ ${formatFxRate(quote.rate)} ${quote.toCurrency}",
                    )
                    quote.spread?.let { spread ->
                        QuoteLine("点差", String.format(Locale.US, "%.2f%%", spread * 100))
                    }
                }
                if (live) {
                    QuoteLine("报价有效期", "剩余 ${ttlLeft} 秒")
                    Spacer(Modifier.height(4.dp))
                    TextFieldRow(
                        label = "支付密码",
                        value = password,
                        onValueChange = onPasswordChange,
                        placeholder = "6 位支付密码",
                        password = true,
                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                    )
                    Text(
                        "提交前会重新获取一次报价；若汇率或到账金额变化，需要重新确认。",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        lineHeight = 18.sp,
                    )
                } else {
                    Text(
                        "参考报价已过期，请重新获取后再提交。",
                        fontSize = 12.sp,
                        color = Tokens.Coral,
                        lineHeight = 19.sp,
                    )
                }
                error?.let {
                    Text(it, style = Tokens.Text.error, lineHeight = 19.sp)
                }
            }
        },
        confirmButton = {
            if (live) {
                TextButton(
                    enabled = !busy && password.length == 6,
                    onClick = onConfirm,
                ) { Text(if (busy) "提交中…" else "确认换汇") }
            } else {
                TextButton(enabled = !busy, onClick = onRefresh) { Text("重新获取") }
            }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = onDismiss) { Text("取消", color = Tokens.Ink2) }
        },
    )
}

/** 账户只有唯一资金账户；卖出币种必须落到 `currencyBalances` 的分区 id。 */
private fun balancesOf(account: AccountDto?): List<CurrencyBalanceDto> {
    if (account == null) return emptyList()
    if (account.currencyBalances.isNotEmpty()) return account.currencyBalances
    return listOf(
        CurrencyBalanceDto(
            id = account.id,
            currency = account.currency,
            label = account.label,
            balance = account.balance,
            available = account.available,
        ),
    )
}

/** 只允许数字和一个小数点，最多两位小数；避免在输入阶段就产生四舍五入。 */
private fun sanitizeAmountInput(raw: String): String {
    val filtered = raw.filter { it.isDigit() || it == '.' }
    val dot = filtered.indexOf('.')
    if (dot < 0) return filtered.take(12)
    val whole = filtered.substring(0, dot).take(12)
    val fraction = filtered.substring(dot + 1).filter(Char::isDigit).take(2)
    return "$whole.$fraction"
}

private fun amountToCents(text: String): Long? {
    if (text.isBlank() || text == ".") return null
    return runCatching {
        BigDecimal(text).movePointRight(2).longValueExact()
    }.getOrNull()
}

private fun formatFxRate(rate: Double): String = String.format(Locale.US, "%.4f", rate)

/* ─────────────────────────── 交易详情 ─────────────────────────── */

/* ─────────────────────────── 寄送信息 ─────────────────────────── */

@Composable
internal fun GoalCard(name: String, deadline: String, saved: String, target: String, ratio: Float, sweep: String) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(3.dp))
                    Text(deadline, style = Tokens.Text.hint)
                }
                Icon(Icons.Pig, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(16.dp))
            }
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
                Text(sweep, style = Tokens.Text.hint)
                Text("${(ratio * 100).toInt()}%", style = Tokens.Text.hint)
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
                Text("定投计划 · $status", style = Tokens.Text.hint)
                Text(action, fontSize = 11.5.sp, color = Tokens.Ink, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
internal fun Metric(label: String, value: String) {
    Column {
        Text(label, style = Tokens.Text.caption)
        Spacer(Modifier.height(2.dp))
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
    }
}

/* ─────────────────────────── 我的 · 设置类二级页 ─────────────────────────── */

@Composable
fun SecurityScreen(onBack: () -> Unit) {
    var overview by remember { mutableStateOf<SubScreensApi.SecurityOverviewDto?>(null) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var loginPasswordOpen by remember { mutableStateOf(false) }
    var paymentPasswordOpen by remember { mutableStateOf(false) }
    var busyRuleId by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var reloadTick by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(reloadTick) {
        if (!BankApi.hasToken()) {
            loadError = "请先登录后查看安全中心"
            loading = false
            return@LaunchedEffect
        }
        if (overview == null) loading = true
        loadError = null
        try {
            overview = SubScreensApi.securityOverview()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            loadError = error.message ?: "安全信息加载失败"
        }
        loading = false
    }

    fun refresh() {
        reloadTick += 1
    }

    fun toggleRule(rule: SubScreensApi.SecurityRuleDto, enabled: Boolean) {
        val current = overview ?: return
        if (current.accountSecurity.frozen) {
            actionError = "账号已冻结，暂不能调整风控规则"
            return
        }
        if (busyRuleId != null) return
        // 先乐观更新，失败时再以服务端总览为准回滚。
        overview = current.copy(
            riskRules = current.riskRules.map {
                if (it.id == rule.id) it.copy(enabled = enabled) else it
            },
        )
        busyRuleId = rule.id
        actionError = null
        scope.launch {
            try {
                val updated = SubScreensApi.setSecurityRule(rule.id, enabled)
                // PATCH 响应来自业务域，不含登录会话/审计表；设备与日志沿用当前 GET 结果。
                overview = updated.copy(devices = current.devices, logs = current.logs)
                notice = "已${if (enabled) "开启" else "关闭"}「${rule.label}」"
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                actionError = error.message ?: "风控规则更新失败"
                // 先回滚乐观更新；再尝试用服务端总览校正，避免把失败显示成已生效。
                overview = current
                runCatching { SubScreensApi.securityOverview() }
                    .onSuccess { overview = it }
            } finally {
                busyRuleId = null
            }
        }
    }

    PushScreen(
        title = "安全中心",
        onBack = onBack,
        actionContent = { ActionIcon(Icons.Refresh, "刷新安全信息", busy = loading, onClick = { BankApi.invalidateReads(); refresh() }) },
    ) {
        if (loading && overview == null) {
            Spacer(Modifier.height(8.dp))
            EmptyNote("正在加载安全信息…")
            return@PushScreen
        }
        val security = overview
        if (security == null) {
            Spacer(Modifier.height(8.dp))
            EmptyNote(loadError ?: "安全信息暂不可用")
            Spacer(Modifier.height(12.dp))
            Box(Modifier.padding(horizontal = 14.dp)) {
                GhostButton("重新加载", { refresh() }, Modifier.fillMaxWidth())
            }
            return@PushScreen
        }
        val accountSecurity = security.accountSecurity

        if (accountSecurity.frozen) {
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                    Icon(
                        Icons.Info,
                        contentDescription = null,
                        tint = Tokens.Coral,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(
                            "账号已冻结",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Tokens.Coral,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            accountSecurity.reason.ifBlank {
                                "支付密码连续错误已达上限，请联系工作人员核验身份后解冻。"
                            },
                            fontSize = 11.sp,
                            color = Tokens.Ink2,
                            lineHeight = 18.sp,
                        )
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top,
                ) {
                    Column {
                        Text("安全评分", style = Tokens.Text.hint)
                        Spacer(Modifier.height(4.dp))
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                "${security.score}",
                                fontSize = 30.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Tokens.Ink,
                            )
                            Text(
                                " / 100",
                                fontSize = 11.sp,
                                color = Tokens.Muted,
                                modifier = Modifier.padding(bottom = 5.dp),
                            )
                        }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Tag(security.level.ifBlank { "—" })
                        Spacer(Modifier.height(8.dp))
                        Text(
                            if (security.identityVerified) "实名已核验" else "实名未核验",
                            fontSize = 10.5.sp,
                            color = if (security.identityVerified) Tokens.Muted else Tokens.Coral,
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(CircleShape)
                        .background(Tokens.SurfaceWarm),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(security.score.coerceIn(0, 100) / 100f)
                            .height(6.dp)
                            .clip(CircleShape)
                            .background(Tokens.Primary),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "评分随实名核验和已开启的风控规则实时计算",
                    fontSize = 10.5.sp,
                    color = Tokens.Muted,
                )
            }
        }

        SectionHeader("支付安全")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                SecurityLine(
                    "支付状态",
                    if (accountSecurity.frozen) "已冻结" else "正常",
                    danger = accountSecurity.frozen,
                )
                Hairline()
                SecurityLine(
                    "支付密码错误次数",
                    "${accountSecurity.failedAttempts} / ${accountSecurity.maxAttempts} 次",
                    warn = accountSecurity.failedAttempts > 0,
                )
            }
        }

        SectionHeader("风控规则", if (busyRuleId != null) "保存中…" else "实时生效")
        if (security.riskRules.isEmpty()) {
            EmptyNote("服务端暂未下发可配置的风控规则")
        } else {
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column {
                    security.riskRules.forEachIndexed { index, rule ->
                        if (index > 0) Hairline()
                        if (accountSecurity.frozen) {
                            RuleReadOnly(rule)
                        } else {
                            SwitchRow(
                                rule.label.ifBlank { rule.id },
                                rule.enabled,
                                subtitle = rule.description.takeIf { it.isNotBlank() },
                            ) { enabled -> toggleRule(rule, enabled) }
                        }
                    }
                }
            }
        }

        SectionHeader("安全操作")
        if (accountSecurity.frozen) {
            EmptyNote("账号冻结期间仅保留登录、只读查询和客服能力；解冻后即可修改密码。")
        } else {
            Row(
                Modifier.padding(horizontal = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SmallAction("修改登录密码", Icons.Lock, Modifier.weight(1f)) {
                    loginPasswordOpen = true
                }
                SmallAction("修改支付密码", Icons.Lock, Modifier.weight(1f)) {
                    paymentPasswordOpen = true
                }
            }
        }

        SectionHeader("登录设备", "${security.devices.size} 台")
        if (security.devices.isEmpty()) {
            EmptyNote("暂无登录设备记录")
        } else {
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column {
                    security.devices.forEachIndexed { index, device ->
                        if (index > 0) Hairline()
                        DeviceRow(device)
                    }
                }
            }
        }

        val logs = security.logs.take(8)
        SectionHeader(
            "安全日志",
            if (security.logs.size > logs.size) "最近 ${logs.size} 条" else null,
        )
        if (logs.isEmpty()) {
            EmptyNote("暂无安全日志")
        } else {
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column {
                    logs.forEachIndexed { index, log ->
                        if (index > 0) Hairline()
                        LogRow(log)
                    }
                }
            }
        }

        Text(
            "支付密码连续输错 ${accountSecurity.maxAttempts} 次会冻结账号，需联系工作人员解冻；重新登录、重启或人脸核身均不能解除冻结。",
            fontSize = 12.sp,
            color = Tokens.Muted,
            lineHeight = 20.sp,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
        )
        notice?.let {
            Text(
                it,
                fontSize = 12.sp,
                color = Tokens.Ink,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        actionError?.let {
            Spacer(Modifier.height(8.dp))
            Text(
                it,
                fontSize = 11.sp,
                color = Tokens.Coral,
                lineHeight = 18.sp,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        loadError?.let {
            Spacer(Modifier.height(8.dp))
            Text(
                "刷新失败：$it",
                fontSize = 11.sp,
                color = Tokens.Coral,
                lineHeight = 18.sp,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
    }

    if (loginPasswordOpen) {
        LoginPasswordDialog(
            onDismiss = { loginPasswordOpen = false },
            onDone = {
                loginPasswordOpen = false
                notice = "登录密码已更新，请在其他设备重新登录"
                refresh()
            },
        )
    }
    if (paymentPasswordOpen) {
        PaymentPasswordDialog(
            frozen = overview?.accountSecurity?.frozen == true,
            onOverviewChanged = { refresh() },
            onDismiss = { paymentPasswordOpen = false },
            onDone = {
                paymentPasswordOpen = false
                notice = "支付密码已更新"
                refresh()
            },
        )
    }
}

@Composable
private fun SecurityLine(
    label: String,
    value: String,
    danger: Boolean = false,
    warn: Boolean = false,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 13.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 12.5.sp, color = Tokens.Muted)
        Text(
            value,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Medium,
            color = if (danger || warn) Tokens.Coral else Tokens.Ink,
        )
    }
}

/** 冻结期间规则只读展示，避免出现点了没反应的开关。 */
@Composable
private fun RuleReadOnly(rule: SubScreensApi.SecurityRuleDto) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 13.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(rule.label.ifBlank { rule.id }, style = Tokens.Text.body)
            if (rule.description.isNotBlank()) {
                Spacer(Modifier.height(3.dp))
                Text(rule.description, style = Tokens.Text.caption)
            }
        }
        Spacer(Modifier.width(10.dp))
        Text(
            if (rule.enabled) "已开启" else "已关闭",
            fontSize = 11.sp,
            color = if (rule.enabled) Tokens.Ink2 else Tokens.Muted,
        )
    }
}

@Composable
private fun DeviceRow(device: SubScreensApi.SecurityDeviceDto) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.bolder(Icons.Phone),
            contentDescription = null,
            tint = Tokens.Ink2,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    device.name.ifBlank { "未知设备" },
                    fontSize = 12.5.sp,
                    color = Tokens.Ink,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (device.current) {
                    Spacer(Modifier.width(6.dp))
                    Tag("本机")
                }
                if (device.active == false) {
                    Spacer(Modifier.width(6.dp))
                    Tag("已失效")
                }
            }
            Spacer(Modifier.height(3.dp))
            Text(
                "${device.location.ifBlank { "位置未知" }} · ${formatDateTime(device.lastActiveAt)}",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
            )
        }
    }
}

@Composable
private fun LogRow(log: SubScreensApi.SecurityLogDto) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .padding(top = 5.dp)
                .size(6.dp)
                .clip(CircleShape)
                .background(if (log.level == "warn") Tokens.Coral else Tokens.Border),
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(log.action.ifBlank { "安全事件" }, fontSize = 12.5.sp, color = Tokens.Ink)
            if (log.detail.isNotBlank()) {
                Spacer(Modifier.height(3.dp))
                Text(log.detail, style = Tokens.Text.caption, lineHeight = 16.sp)
            }
            Spacer(Modifier.height(3.dp))
            Text(formatDateTime(log.createdAt), fontSize = 10.sp, color = Tokens.Muted)
        }
    }
}

@Composable
private fun PaymentPasswordDialog(
    frozen: Boolean,
    onOverviewChanged: () -> Unit,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
) {
    var resetMode by remember { mutableStateOf(false) }
    var oldPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var faceTicket by remember { mutableStateOf<String?>(null) }
    var verifying by remember { mutableStateOf(false) }
    val submitter = rememberSubmitter()
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val newValid = Regex("^\\d{6}$").matches(newPassword)
    val canSubmit = !frozen && !submitter.busy && !verifying && newValid &&
        newPassword == confirmation &&
        (if (resetMode) faceTicket != null else Regex("^\\d{6}$").matches(oldPassword))

    fun verifyFace() {
        if (verifying || submitter.busy || frozen) return
        verifying = true
        error = null
        scope.launch {
            try {
                faceTicket = BankApi.verifyIdentity("face")
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                error = failure.message ?: "人脸核身失败，请稍后重试"
            } finally {
                verifying = false
            }
        }
    }

    fun submit() {
        // `canSubmit` 是本次组合算出的值；重复点击时还要读取实时的 busy 状态。
        if (!canSubmit) return
        submitter.submit(
            fallback = "修改失败，请稍后重试",
            onStart = { error = null },
            onError = { error = it },
            onSuccess = { onDone() },
            onFailure = {
                // 服务端会在提交时消费人脸票据；失败后票据可能已失效，必须重新核身。
                if (resetMode) faceTicket = null
                onOverviewChanged()
            },
        ) {
            SubScreensApi.changePaymentPassword(
                oldPassword = if (resetMode) null else oldPassword,
                newPassword = newPassword,
                faceTicket = if (resetMode) faceTicket else null,
            )
        }
    }

    AlertDialog(
        onDismissRequest = { if (!submitter.busy) onDismiss() },
        containerColor = Tokens.Surface,
        title = {
            Text(
                if (resetMode) "重置支付密码" else "修改支付密码",
                fontSize = 18.sp,
                color = Tokens.Ink,
            )
        },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (frozen) {
                    Text(
                        "账号已冻结，支付密码相关操作需工作人员核验解冻后才能进行。",
                        fontSize = 12.sp,
                        color = Tokens.Coral,
                        lineHeight = 19.sp,
                    )
                } else {
                    SegTabs(
                        listOf("记得原密码", "忘记原密码"),
                        selected = if (resetMode) 1 else 0,
                    ) { index ->
                        if (!submitter.busy && !verifying) {
                            resetMode = index == 1
                            oldPassword = ""
                            faceTicket = null
                            error = null
                        }
                    }
                    if (resetMode) {
                        Text(
                            "忘记原密码时，可先完成人脸核身，再设置新的 6 位数字支付密码。",
                            fontSize = 12.sp,
                            color = Tokens.Muted,
                            lineHeight = 19.sp,
                        )
                        if (faceTicket == null) {
                            GhostButton(
                                if (verifying) "核身中…" else "人脸核身",
                                { verifyFace() },
                                Modifier.fillMaxWidth(),
                            )
                        } else {
                            Text(
                                "已取得人脸核身凭证（5 分钟内有效），可设置新支付密码。",
                                fontSize = 12.sp,
                                color = Tokens.Ink2,
                                lineHeight = 19.sp,
                            )
                        }
                    } else {
                        TextFieldRow(
                            label = "原支付密码",
                            value = oldPassword,
                            onValueChange = {
                                oldPassword = it.filter(Char::isDigit).take(6)
                                error = null
                            },
                            placeholder = "6 位支付密码",
                            password = true,
                            keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                        )
                    }
                    TextFieldRow(
                        label = "新支付密码",
                        value = newPassword,
                        onValueChange = {
                            newPassword = it.filter(Char::isDigit).take(6)
                            error = null
                        },
                        placeholder = "6 位数字",
                        password = true,
                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                    )
                    if (newPassword.isNotEmpty() && !newValid) {
                        Text("支付密码须为 6 位数字", style = Tokens.Text.error)
                    }
                    TextFieldRow(
                        label = "确认新支付密码",
                        value = confirmation,
                        onValueChange = {
                            confirmation = it.filter(Char::isDigit).take(6)
                            error = null
                        },
                        placeholder = "再次输入",
                        password = true,
                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                    )
                    if (confirmation.isNotEmpty() && confirmation != newPassword) {
                        Text("两次输入的新支付密码不一致", style = Tokens.Text.error)
                    }
                    Text(
                        "连续输错 5 次原支付密码会冻结账号，重新登录或人脸核身均不能解除冻结。",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        lineHeight = 18.sp,
                    )
                }
                error?.let {
                    Text(it, style = Tokens.Text.error, lineHeight = 19.sp)
                }
            }
        },
        confirmButton = {
            TextButton(enabled = canSubmit, onClick = { submit() }) {
                Text(if (submitter.busy) "提交中…" else if (resetMode) "确认重置" else "确认修改")
            }
        },
        dismissButton = {
            TextButton(enabled = !submitter.busy && !verifying, onClick = onDismiss) {
                Text("取消", color = Tokens.Ink2)
            }
        },
    )
}

@Composable
private fun LoginPasswordDialog(onDismiss: () -> Unit, onDone: () -> Unit) {
    var oldPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val validPassword = PasswordPolicy.isValid(newPassword)
    val canSubmit = !busy && oldPassword.isNotEmpty() && validPassword && newPassword == confirmation

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        containerColor = Tokens.Surface,
        title = { Text("修改登录密码", fontSize = 18.sp, color = Tokens.Ink) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("输入当前密码，再设置新的登录密码。", style = Tokens.Text.note)
                TextFieldRow(
                    label = "原密码", value = oldPassword,
                    onValueChange = { if (!busy) { oldPassword = it; error = null } },
                    placeholder = "请输入原密码", password = true,
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Password,
                )
                TextFieldRow(
                    label = "新密码", value = newPassword,
                    onValueChange = { if (!busy) { newPassword = it; error = null } },
                    placeholder = "至少 8 位", password = true,
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Password,
                )
                Text(
                    PasswordPolicy.requirements,
                    fontSize = 12.sp, lineHeight = 19.sp,
                    color = if (newPassword.isNotEmpty() && !validPassword) Tokens.Coral else Tokens.Muted,
                )
                TextFieldRow(
                    label = "确认新密码", value = confirmation,
                    onValueChange = { if (!busy) { confirmation = it; error = null } },
                    placeholder = "再次输入新密码", password = true,
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Password,
                )
                if (confirmation.isNotEmpty() && confirmation != newPassword) {
                    Text("两次输入的新密码不一致", style = Tokens.Text.error)
                }
                error?.let { Text(it, style = Tokens.Text.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = canSubmit,
                onClick = {
                    // 读取实时 busy，避免同一帧内重复点击发出两次改密请求。
                    if (canSubmit && !busy) {
                        busy = true
                        error = null
                        scope.launch {
                            runCatching { BankApi.changeLoginPassword(oldPassword, newPassword) }
                                .onSuccess { onDone() }
                                .onFailure { error = it.message ?: "修改失败，请稍后重试" }
                            busy = false
                        }
                    }
                },
            ) { Text(if (busy) "修改中…" else "确认修改") }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = onDismiss) { Text("取消", color = Tokens.Ink2) }
        },
    )
}

@Composable
fun ProfileScreen(onBack: () -> Unit, onChangePhone: () -> Unit) {
    var profile by remember { mutableStateOf<ProfileDto?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var avatarOpen by remember { mutableStateOf(false) }
    var nicknameEditing by remember { mutableStateOf(false) }
    var nicknameInput by remember { mutableStateOf("") }
    var nicknameError by remember { mutableStateOf<String?>(null) }
    val submitter = rememberSubmitter()
    LaunchedEffect(Unit) {
        if (BankApi.hasToken()) runCatching { BankApi.profile() }.onSuccess { profile = it }.onFailure { loadError = it.message }
    }
    val fallbackNickname = profile?.displayName?.ifEmpty { NameDisplay.of(profile?.name) }.orEmpty()
    val nickname = NameDisplay.nicknameOf(profile?.customNickname, fallbackNickname)
    PushScreen(title = "个人资料", onBack = onBack) {
        Spacer(Modifier.height(8.dp))
        // 头像居中、称呼在下：一眼看清「是谁」，手机号不在这里露出来。
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 换头像入口直接做在头像上：右下角一个铅笔角标，不再单独占一行文字。
            Box(Modifier.padding(end = 6.dp, bottom = 6.dp)) {
                Box(
                    Modifier
                        .clip(CircleShape)
                        .clickable(enabled = !submitter.busy) { avatarOpen = true },
                ) {
                    UserAvatar(avatarId = profile?.avatarId, size = 84.dp)
                }
                // 铅笔只画图标本身：不加底色圆块，落在头像圆外的页面底色上。
                Icon(
                    Icons.Edit,
                    contentDescription = if (submitter.busy) "正在更新头像" else "更换头像",
                    tint = Tokens.Ink2,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .offset(x = 2.dp, y = 2.dp)
                        .clip(CircleShape)
                        .clickable(enabled = !submitter.busy) { avatarOpen = true }
                        .padding(4.dp)
                        .size(16.dp),
                )
            }
            Spacer(Modifier.height(10.dp))
            // 昵称 + 小铅笔：昵称只用于展示，不是实名（实名在下面的「姓名」行，始终脱敏）。
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    nickname.ifEmpty { "—" },
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Tokens.Ink,
                )
                Icon(
                    Icons.Edit,
                    contentDescription = "修改昵称",
                    tint = Tokens.Ink2,
                    modifier = Modifier
                        .clip(CircleShape)
                        .clickable(enabled = !submitter.busy) { nicknameInput = profile?.customNickname.orEmpty(); nicknameEditing = true }
                        .padding(4.dp)
                        .size(15.dp),
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        KvCard(
            buildList {
                add("姓名" to (profile?.maskedName?.ifEmpty { NameDisplay.masked(profile?.name) } ?: "—"))
                profile?.idNumberMasked?.takeIf { it.isNotBlank() }?.let { add("身份证号" to it) }
                profile?.openedAt?.takeIf { it.isNotBlank() }?.let { add("开户日期" to it.take(10)) }
                profile?.address?.takeIf { it.isNotBlank() }?.let { add("联系地址" to it) }
            },
            Modifier.padding(horizontal = 14.dp),
        )
        Spacer(Modifier.height(10.dp))
        loadError?.let { Text(it, color = Tokens.Coral, fontSize = 12.sp, modifier = Modifier.padding(16.dp)) }
        // 手机号并入这一行：标题就是「手机号」，右侧是脱敏号码，点进去才是改号流程。
        Box(Modifier.padding(horizontal = 14.dp)) {
            EntryRow(
                icon = Icons.Phone,
                title = "手机号",
                value = maskPhoneDisplay(profile?.phone.orEmpty()).ifBlank { null },
                onClick = onChangePhone,
            )
        }
    }
    if (nicknameEditing) {
        AlertDialog(
            onDismissRequest = { if (!submitter.busy) nicknameEditing = false },
            title = { Text("修改昵称") },
            text = {
                Column {
                    TextFieldRow("昵称", nicknameInput, { if (!submitter.busy) { nicknameInput = it.take(NameDisplay.NICKNAME_MAX); nicknameError = null } }, placeholder = fallbackNickname)
                    nicknameError?.let { ErrorNote(it) }
                }
            },
            confirmButton = {
                TextButton(enabled = !submitter.busy, onClick = {
                    val problem = NameDisplay.validateNickname(nicknameInput)
                    if (problem != null) { nicknameError = problem; return@TextButton }
                    submitter.submit(
                        fallback = "昵称保存失败，请稍后重试",
                        onError = { nicknameError = it },
                        onSuccess = { nicknameEditing = false },
                    ) {
                        profile = BankApi.updateNickname(nicknameInput)
                        SessionStore.updateNickname(profile?.nickname.orEmpty())
                    }
                }) { Text("保存") }
            },
            dismissButton = {
                if ((profile?.customNickname ?: "").isNotEmpty()) {
                    TextButton(enabled = !submitter.busy, onClick = {
                        submitter.submit(
                            fallback = "昵称保存失败，请稍后重试",
                            onError = { nicknameError = it },
                            onSuccess = { nicknameEditing = false },
                        ) {
                            profile = BankApi.updateNickname("")
                            SessionStore.updateNickname(profile?.nickname.orEmpty())
                        }
                    }) { Text("恢复默认") }
                } else {
                    TextButton(onClick = { nicknameEditing = false }) { Text("取消", color = Tokens.Ink2) }
                }
            },
        )
    }
    if (avatarOpen) {
        AvatarPickerSheet(
            current = profile?.avatarId.orEmpty(),
            saving = submitter.busy,
            onDismiss = { if (!submitter.busy) avatarOpen = false },
            onPick = { avatarId ->
                submitter.submit(
                    fallback = "头像更新失败，请稍后重试",
                    onError = { loadError = it },
                    onSuccess = { loadError = null; avatarOpen = false },
                ) {
                    val next = BankApi.updateAvatar(avatarId)
                    profile = next
                }
            },
        )
    }
}

/** 头像选择面板：只列头像池里的 10 张，点一张即保存。 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun AvatarPickerSheet(
    current: String,
    saving: Boolean,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = androidx.compose.material3.rememberModalBottomSheetState(),
        containerColor = Tokens.Page,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("选择头像", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Text("从默认头像里挑一个，选中后立即保存。", style = Tokens.Text.note)
            // 每行 5 个、两端对齐铺满内容宽度：首尾与标题左对齐，不会在右侧留出一段空白。
            AvatarPool.ids.chunked(5).forEach { row ->
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    row.forEach { id ->
                        val active = id == current
                        Box(
                            Modifier
                                .size(56.dp)
                                .clip(CircleShape)
                                .border(if (active) 2.dp else 1.dp, if (active) Tokens.AccentDeep else Tokens.Border, CircleShape)
                                .padding(2.dp)
                                .clip(CircleShape)
                                .clickable(enabled = !saving) { onPick(id) },
                        ) {
                            Image(
                                painterResource(AvatarPool.drawableOf(id)),
                                contentDescription = "头像 ${id.takeLast(2)}",
                                modifier = Modifier.fillMaxSize().clip(CircleShape),
                                contentScale = ContentScale.Crop,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ImScreen(onBack: () -> Unit, onReminders: () -> Unit) {
    var bindings by remember { mutableStateOf<List<org.json.JSONObject>>(emptyList()) }
    var qr by remember { mutableStateOf<org.json.JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var code by remember { mutableStateOf("") }
    var remove by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun perform(work: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        scope.launch {
            try { work() } catch (failure: Exception) { error = failure.message ?: "IM 连接服务不可用" }
            finally { busy = false }
        }
    }
    LaunchedEffect(refresh) {
        runCatching { AgentApi.imRequest("GET", "/im/bindings") as org.json.JSONArray }
            .onSuccess { data -> bindings = (0 until data.length()).map { data.getJSONObject(it) }; error = null }
            .onFailure { error = it.message ?: "连接状态加载失败" }
    }
    val attemptId = qr?.optString("attemptId").orEmpty()
    val status = qr?.optString("status").orEmpty()
    LaunchedEffect(attemptId, status) {
        while (attemptId.isNotBlank() && qr?.optString("status") in setOf("pending", "scanned", "waiting")) {
            kotlinx.coroutines.delay(2000)
            try { qr = AgentApi.imRequest("GET", "/im/weixin/qr/$attemptId") as org.json.JSONObject }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: "扫码状态加载失败"; if ((failure as? BankApiException)?.status == 410) qr = null; break }
        }
    }
    PushScreen(title = "IM 连接", onBack = onBack,
        actionContent = { ActionIcon(Icons.Refresh, "刷新连接状态", enabled = !busy, onClick = { refresh++ }) },
    ) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (bindings.isEmpty() && qr == null) {
                FormCard("微信连接") {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Phone, null, tint = Tokens.AccentDeep, modifier = Modifier.size(30.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(if (error == null) "尚未连接微信" else "连接状态暂不可用", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                            Text(if (error == null) "扫码后核对并确认绑定本人微信" else "请稍后刷新，再核对微信连接。", style = Tokens.Text.note)
                        }
                    }
                }
            }
            bindings.forEach { binding ->
                HairlineCard {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(binding.optString("label"))
                        Text(if (binding.optBoolean("connected")) "已连接" else "连接已失效", color = Tokens.Muted, fontSize = 11.sp)
                        androidx.compose.material3.TextButton(enabled = !busy, onClick = { remove = binding.optString("id") }) { Text("解除绑定") }
                    }
                }
            }
            if (error != null && (bindings.isNotEmpty() || qr != null)) Text(error!!, color = Tokens.Coral, fontSize = 12.sp)
            if (qr == null) PrimaryButton(if (busy) "请求中…" else "生成微信连接二维码", onClick = {
                perform { qr = AgentApi.imRequest("POST", "/im/weixin/qr", org.json.JSONObject()) as org.json.JSONObject }
            })
            qr?.let { current ->
                FormCard("连接微信", subtitle = "使用本人微信扫码，完成后确认绑定") {
                val image = current.optString("qrImage")
                val bitmap = remember(image) { runCatching {
                    require(image.startsWith("data:image/png;base64,") && image.length <= 500000)
                    val bytes = android.util.Base64.decode(image.substringAfter(','), android.util.Base64.DEFAULT)
                    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                }.getOrNull() }
                if (bitmap != null && status != "connected") Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    androidx.compose.foundation.Image(bitmap, "微信连接二维码", Modifier.size(200.dp))
                }
                val statusLabel = when(status) {
                    "pending", "waiting" -> "等待扫码"
                    "scanned" -> "已扫码，请在微信确认"
                    "needs_verification" -> "需要验证码"
                    "connected" -> if (current.optJSONObject("binding") == null) "已扫码，等待确认绑定" else "已连接"
                    "expired" -> "二维码已过期"
                    "cancelled" -> "已取消"
                    "failed" -> "连接失败，请重试"
                    else -> status
                }
                Text(statusLabel, style = Tokens.Text.bodyMuted)
                if (status == "needs_verification") {
                    TextFieldRow("微信验证码", code, { code = it.take(20) })
                    GhostButton("提交验证码", onClick = { perform { qr = AgentApi.imRequest("POST", "/im/weixin/qr/$attemptId/verify", org.json.JSONObject().put("code", code)) as org.json.JSONObject; code = "" } })
                }
                if (status == "connected" && current.optJSONObject("binding") == null) PrimaryButton("确认绑定本人微信", onClick = {
                    perform { AgentApi.imRequest("POST", "/im/weixin/qr/$attemptId/confirm", org.json.JSONObject().put("confirmed", true)); qr = null; refresh++ }
                })
                if (status in setOf("expired", "cancelled", "failed") || current.optJSONObject("binding") != null) {
                    GhostButton("关闭二维码", onClick = { qr = null; code = "" })
                } else GhostButton("取消扫码", onClick = { perform { AgentApi.imRequest("POST", "/im/weixin/qr/$attemptId/cancel", org.json.JSONObject()); qr = null; code = "" } })
                }
            }
            EntryRow(Icons.Clock, "微信日程提醒", onClick = onReminders)
        }
    }
    remove?.let { id -> androidx.compose.material3.AlertDialog(onDismissRequest = { remove = null }, title = { Text("解除微信绑定") }, text = { Text("确认解除当前微信连接？") }, confirmButton = {
        androidx.compose.material3.TextButton(enabled = !busy, onClick = { perform { AgentApi.imRequest("DELETE", "/im/bindings/$id"); remove = null; refresh++ } }) { Text("确认解除") }
    }, dismissButton = { androidx.compose.material3.TextButton(onClick = { remove = null }) { Text("取消") } }) }
}

@Composable
fun LanguageScreen(onBack: () -> Unit) {
    PushScreen(title = "语言与地区", onBack = onBack) {
        FormCard("显示语言", Modifier.padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("简体中文", color = Tokens.Ink, fontSize = 15.sp)
                Icon(Icons.Check, "当前语言", tint = Tokens.Accent, modifier = Modifier.size(22.dp))
            }
        }
        SectionHeader("地区信息")
        KvCard(
            listOf("地区" to "中国大陆", "时区" to "北京时间 UTC+8", "支持币种" to "CNY / USD / HKD"),
            Modifier.padding(horizontal = 14.dp),
        )
    }
}

@Composable
fun HelpScreen(onBack: () -> Unit, onAssistant: () -> Unit) {
    var expanded by remember { mutableStateOf<String?>(null) }
    val answers = mapOf(
        "转账多久到账" to "以服务端回执为准。在途或待审核表示已受理，请在交易详情查询状态。外部银行未接入时不承诺实际到账。",
        "如何提高单日限额" to "在银行卡详情查看和调整允许修改的限额；超出服务端允许范围时请联系人工客服。",
        "忘记支付密码怎么办" to "前往安全中心重置支付密码并完成身份核验。支付冻结需人工客服核验，重置密码不会自动解冻。",
        "理财赎回什么时候到账" to "以赎回回执的结算方式和到账说明为准。沙箱即时结算不代表真实市场产品的到账时间。",
    )
    PushScreen(title = "帮助与客服", onBack = onBack) {
        SectionHeader("常见问题")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                listOf(
                    "转账多久到账",
                    "如何提高单日限额",
                    "忘记支付密码怎么办",
                    "理财赎回什么时候到账",
                ).forEachIndexed { index, question ->
                    if (index > 0) Hairline()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(question, style = Tokens.Text.body, modifier = Modifier.weight(1f).clickable { expanded = if (expanded == question) null else question })
                        Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(20.dp).clickable { expanded = if (expanded == question) null else question })
                    }
                    if (expanded == question) Text(answers.getValue(question), fontSize = 12.sp, color = Tokens.Ink2, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton("前往助手与客服", onAssistant, Modifier.padding(horizontal = 14.dp))
    }
}

@Composable
fun AboutScreen(onBack: () -> Unit) {
    PushScreen(title = "关于招财猫银行", onBack = onBack) {
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
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                UpdateRow()
                Hairline()
                Text("服务条款与隐私政策尚未提供正式文本。", style = Tokens.Text.note, modifier = Modifier.padding(14.dp))
            }
        }
    }
}

/** 通用「已受理」结果页（申请 / 赎回等）：黑底白勾 + 结果卡 + 贴底按钮。 */
@Composable
fun DoneScreen(
    title: String,
    headline: String,
    note: String,
    rows: List<Pair<String, String>>,
    actionLabel: String,
    onBack: () -> Unit,
    onAction: () -> Unit,
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
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 26.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier
                        .size(62.dp)
                        .clip(CircleShape)
                        .background(Tokens.Primary),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(28.dp))
                }
                Spacer(Modifier.height(14.dp))
                Text(headline, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(6.dp))
                Text(note, fontSize = 12.5.sp, color = Tokens.Muted)
            }
            KvCard(rows, Modifier.padding(horizontal = 14.dp))
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
        ) {
            PrimaryButton(actionLabel, onAction)
        }
    }
}

/** 币种小标签。 */
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
