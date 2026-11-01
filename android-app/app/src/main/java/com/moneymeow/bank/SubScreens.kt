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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/* ─────────────────────────── 存款 ─────────────────────────── */

@Composable
fun DepositsScreen(onBack: () -> Unit, onTransferIn: () -> Unit, onTransferOut: () -> Unit) {
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
        KvCard(
            buildList {
                balances.forEach { add(currencyName(it.currency) to formatCurrency(it.currency, it.balance)) }
                balances.firstOrNull { it.currency == "CNY" }?.let { add("人民币活期年利率" to "1.55%") }
                balances.firstOrNull { it.currency == "HKD" }?.let { add("港币活期年利率" to "1.25%") }
                if (balances.isEmpty()) {
                    add("账户余额" to when {
                        loading -> "加载中…"
                        error != null -> "加载失败"
                        else -> "暂无账户"
                    })
                }
            },
            Modifier.padding(horizontal = 14.dp),
        )
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
            SmallAction("利息流水", Icons.Receipt, Modifier.weight(1f)) { }
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
        Text(text, fontSize = 12.sp, color = Tokens.Muted, lineHeight = 20.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
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
                Text("卖出币种", fontSize = 11.sp, color = Tokens.Muted)
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
                        Text(fromBalance?.currency ?: "", fontSize = 12.sp, color = Tokens.Muted)
                    },
                )
                Spacer(Modifier.height(14.dp))
                Text("买入币种", fontSize = 11.sp, color = Tokens.Muted)
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
                    Text(it, fontSize = 12.sp, color = Tokens.Coral, lineHeight = 19.sp)
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
        BigDecimal(text).movePointRight(2).toBigIntegerExact().longValueExact()
    }.getOrNull()
}

private fun formatFxRate(rate: Double): String = String.format(Locale.US, "%.4f", rate)

/* ─────────────────────────── 交易详情 ─────────────────────────── */

@Composable
fun TxDetailScreen(onBack: () -> Unit, transactionId: String?) {
    var detail by remember { mutableStateOf<TransactionDetailDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(transactionId) {
        val id = transactionId ?: return@LaunchedEffect
        if (!BankApi.hasToken()) return@LaunchedEffect
        runCatching { BankApi.transaction(id) }
            .onSuccess { detail = it }
            .onFailure { error = it.message }
    }
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
                Icon(Icons.Food, contentDescription = null, tint = Color.White, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.height(12.dp))
            Text(
                detail?.let { (if (it.direction == "in") "+" else "-") + formatCents(it.amount) } ?: "—",
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Ink,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                detail?.let { it.counterparty + " · " + (if (it.status == "success") "交易成功" else it.status) }
                    ?: (error ?: "—"),
                fontSize = 12.5.sp,
                color = Tokens.Muted,
            )
        }
        KvCard(
            listOf(
                "交易时间" to (detail?.createdAt?.replace('T', ' ')?.take(19) ?: "—"),
                "交易类型" to (detail?.let { if (it.direction == "in") "收入" else "支出" } ?: "—"),
                "分类" to (detail?.let { BankApi.categoryLabel(it.category) } ?: "—"),
                "付款卡片" to (detail?.cardLast4?.let { "尾号 $it" } ?: "—"),
                "资金账户" to (detail?.accountLabel?.ifEmpty { "—" } ?: "—"),
                "交易号" to (detail?.referenceNo?.ifEmpty { detail?.id } ?: "—"),
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
                "收件人" to SessionStore.name().ifEmpty { "—" },
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
    var membership by remember { mutableStateOf<MembershipDto?>(null) }
    LaunchedEffect(Unit) {
        if (BankApi.hasToken()) runCatching { BankApi.membership() }.onSuccess { membership = it }
    }
    val tierIndex = when (membership?.tier) {
        "gold" -> 1
        "platinum" -> 2
        "diamond" -> 3
        else -> 0
    }
    PushScreen(title = "会员等级", onBack = onBack) {
        SectionHeader("会员卡", (membership?.tierLabel ?: "普通会员") + " · 使用中")
        LazyRow(
            Modifier.fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val cards = listOf(
                R.drawable.member_standard to 0,
                R.drawable.member_gold to 1,
                R.drawable.member_platinum to 2,
                R.drawable.member_diamond to 3,
            )
            cards.forEach { (res, index) ->
                item { MemberCard(res, dimmed = index != tierIndex, current = index == tierIndex) }
            }
        }
        Spacer(Modifier.height(12.dp))
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("当前等级", fontSize = 11.sp, color = Tokens.Muted)
                Spacer(Modifier.height(5.dp))
                Text(
                    membership?.tierLabel ?: "普通会员",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Tokens.Ink,
                )
                Spacer(Modifier.height(12.dp))
                Hairline()
                Spacer(Modifier.height(10.dp))
                KvInline("上月日均资产", membership?.let { formatCents(it.aum) } ?: "—")
                KvInline(
                    "距下一档还差",
                    membership?.let { formatCents((it.nextThreshold - it.aum).coerceAtLeast(0)) } ?: "—",
                )
            }
        }
        SectionHeader("权益")
        KvCard(
            (membership?.benefits?.take(4)?.map { it to "已开通" } ?: listOf(
                "制卡费减免" to "每年 0 张",
                "换汇点差" to "标准价",
                "机场贵宾厅" to "—",
                "专属顾问" to "—",
            )),
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
private fun MemberCard(drawable: Int, dimmed: Boolean, current: Boolean = false) {
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
        if (current) {
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
    var savings by remember { mutableStateOf<SavingsDto?>(null) }
    LaunchedEffect(Unit) {
        if (BankApi.hasToken()) runCatching { BankApi.savingsOverview() }.onSuccess { savings = it }
    }
    PushScreen(title = "储蓄与计划", onBack = onBack) {
        Box(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
            SegTabs(listOf("存钱目标", "定投计划"), tab) { tab = it }
        }
        if (tab == 0) {
            Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val goals = savings?.goals.orEmpty()
                if (goals.isEmpty()) {
                    Text("暂无存钱目标", fontSize = 12.sp, color = Tokens.Muted)
                } else {
                    goals.forEach { goal ->
                        GoalCard(
                            name = goal.name,
                            deadline = if (goal.deadline.isNotEmpty()) "目标日 ${goal.deadline.take(10)}" else "无固定期限",
                            saved = formatCents(goal.savedAmount),
                            target = formatCents(goal.targetAmount),
                            ratio = if (goal.targetAmount > 0) {
                                (goal.savedAmount.toFloat() / goal.targetAmount).coerceIn(0f, 1f)
                            } else 0f,
                            sweep = if (goal.sweepText.isNotEmpty()) "归集设置 · ${goal.sweepText}" else "暂无归集设置",
                        )
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                SwitchRow(
                    "消费凑整",
                    savings?.roundupEnabled ?: false,
                    subtitle = savings?.let {
                        "凑整到 ${formatCents(it.roundupTo)} · 单日上限 ${formatCents(it.roundupDailyCap)}"
                    } ?: "—",
                ) { }
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
internal fun GoalCard(name: String, deadline: String, saved: String, target: String, ratio: Float, sweep: String) {
    HairlineCard {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(3.dp))
                    Text(deadline, fontSize = 11.sp, color = Tokens.Muted)
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
internal fun Metric(label: String, value: String) {
    Column {
        Text(label, fontSize = 10.5.sp, color = Tokens.Muted)
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
        action = "刷新",
        onAction = { refresh() },
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
                        Text("安全评分", fontSize = 11.sp, color = Tokens.Muted)
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
                SmallAction("修改支付密码", Icons.Check, Modifier.weight(1f)) {
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
            Text(rule.label.ifBlank { rule.id }, fontSize = 13.sp, color = Tokens.Ink)
            if (rule.description.isNotBlank()) {
                Spacer(Modifier.height(3.dp))
                Text(rule.description, fontSize = 10.5.sp, color = Tokens.Muted)
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
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(Tokens.SurfaceWarm),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Phone, contentDescription = null, tint = Tokens.Ink2, modifier = Modifier.size(16.dp))
        }
        Spacer(Modifier.width(10.dp))
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
                Text(log.detail, fontSize = 10.5.sp, color = Tokens.Muted, lineHeight = 16.sp)
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
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val newValid = Regex("^\\d{6}$").matches(newPassword)
    val canSubmit = !frozen && !busy && !verifying && newValid &&
        newPassword == confirmation &&
        (if (resetMode) faceTicket != null else Regex("^\\d{6}$").matches(oldPassword))

    fun verifyFace() {
        if (verifying || busy || frozen) return
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
        if (busy || !canSubmit) return
        busy = true
        error = null
        scope.launch {
            try {
                SubScreensApi.changePaymentPassword(
                    oldPassword = if (resetMode) null else oldPassword,
                    newPassword = newPassword,
                    faceTicket = if (resetMode) faceTicket else null,
                )
                onDone()
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                error = failure.message ?: "修改失败，请稍后重试"
                // 服务端会在提交时消费人脸票据；失败后票据可能已失效，必须重新核身。
                if (resetMode) faceTicket = null
                onOverviewChanged()
            } finally {
                busy = false
            }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
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
                        if (!busy && !verifying) {
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
                        Text("支付密码须为 6 位数字", fontSize = 12.sp, color = Tokens.Coral)
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
                        Text("两次输入的新支付密码不一致", fontSize = 12.sp, color = Tokens.Coral)
                    }
                    Text(
                        "连续输错 5 次原支付密码会冻结账号，重新登录或人脸核身均不能解除冻结。",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        lineHeight = 18.sp,
                    )
                }
                error?.let {
                    Text(it, fontSize = 12.sp, color = Tokens.Coral, lineHeight = 19.sp)
                }
            }
        },
        confirmButton = {
            TextButton(enabled = canSubmit, onClick = { submit() }) {
                Text(if (busy) "提交中…" else if (resetMode) "确认重置" else "确认修改")
            }
        },
        dismissButton = {
            TextButton(enabled = !busy && !verifying, onClick = onDismiss) {
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
                Text("输入当前密码，再设置新的登录密码。", fontSize = 12.sp, color = Tokens.Muted)
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
                    Text("两次输入的新密码不一致", fontSize = 12.sp, color = Tokens.Coral)
                }
                error?.let { Text(it, fontSize = 12.sp, color = Tokens.Coral) }
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
fun ProfileScreen(onBack: () -> Unit) {
    var profile by remember { mutableStateOf<ProfileDto?>(null) }
    LaunchedEffect(Unit) {
        if (BankApi.hasToken()) runCatching { BankApi.profile() }.onSuccess { profile = it }
    }
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
                Text(profile?.name?.ifEmpty { "—" } ?: "—", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                Spacer(Modifier.height(3.dp))
                Text(profile?.phone ?: "—", fontSize = 12.sp, color = Tokens.Muted)
            }
        }
        KvCard(
            listOf(
                "姓名" to (profile?.name?.ifEmpty { "—" } ?: "—"),
                "手机号" to (profile?.phone ?: "—"),
                "身份证号" to (profile?.idNumberMasked?.ifEmpty { "—" } ?: "—"),
                "开户日期" to (profile?.openedAt?.take(10)?.ifEmpty { "—" } ?: "—"),
                "联系地址" to (profile?.address?.ifEmpty { "—" } ?: "—"),
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
                        .clip(CircleShape)
                        .background(Tokens.Surface)
                        .border(1.dp, Tokens.Border, CircleShape)
                        .padding(horizontal = 16.dp),
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
                SwitchRow("账户变动提醒", true, subtitle = "入账、转出、扣款成功时推送") { }
                Hairline()
                SwitchRow("提醒尚未启用", false, subtitle = "桥接服务未开启时不推送") { }
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
                SwitchRow("交易通知", true, subtitle = "入账、转出、消费") { }
                Hairline()
                SwitchRow("安全提醒", true, subtitle = "新设备登录、密码变更") { }
                Hairline()
                SwitchRow("产品与活动", false, subtitle = "理财上新、会员权益") { }
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
                        Text(question, fontSize = 13.sp, color = Tokens.Ink)
                        Icon(Icons.Chevron, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(13.dp))
                    }
                }
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
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                UpdateRow()
                Hairline()
                IconRow(Icons.Receipt, "服务条款") { }
                Hairline()
                IconRow(Icons.Receipt, "隐私政策") { }
                Hairline()
                IconRow(Icons.Receipt, "开源许可") { }
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
