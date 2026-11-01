package com.moneymeow.bank

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/** 网页版 `LIMIT_PRESETS`：¥2,000 / ¥5,000 / ¥10,000 / ¥50,000。 */
private val dailyLimitPresets = listOf(200_000L, 500_000L, 1_000_000L, 5_000_000L)

private data class UnlockedSecrets(val secrets: CardSecrets, val expiresAt: Long)

@Suppress("UNUSED_PARAMETER")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardsScreen(onBack: () -> Unit, onDelivery: () -> Unit, onApply: () -> Unit) {
    var cards by remember { mutableStateOf<List<BankCard>>(emptyList()) }
    var products by remember { mutableStateOf<List<CardProduct>>(emptyList()) }
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var selectedId by remember { mutableStateOf<String?>(null) }

    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var productsError by remember { mutableStateOf<String?>(null) }
    var accountError by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busyCardId by remember { mutableStateOf<String?>(null) }

    var applyOpen by remember { mutableStateOf(false) }
    var replaceFor by remember { mutableStateOf<BankCard?>(null) }
    var activateFor by remember { mutableStateOf<BankCard?>(null) }
    var lossFor by remember { mutableStateOf<Pair<BankCard, Boolean>?>(null) }
    var secretsFor by remember { mutableStateOf<BankCard?>(null) }
    var deliveryFor by remember { mutableStateOf<BankCard?>(null) }

    var balanceShown by remember { mutableStateOf(true) }
    var unlocked by remember { mutableStateOf<Map<String, UnlockedSecrets>>(emptyMap()) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }

    val scope = rememberCoroutineScope()

    fun applyFresh(fresh: BankCard) {
        cards = cards.map { if (it.id == fresh.id) fresh else it }
    }

    suspend fun reloadCards(silent: Boolean) {
        if (!silent) loading = true
        runCatching { CardApi.cards() }
            .onSuccess { fresh ->
                cards = fresh
                if (selectedId == null || fresh.none { it.id == selectedId }) {
                    selectedId = fresh.firstOrNull { it.status != "replaced" }?.id
                        ?: fresh.firstOrNull()?.id
                }
                loadError = null
            }
            .onFailure { failure ->
                val message = failure.message ?: "银行卡加载失败"
                if (cards.isEmpty()) loadError = message else error = message
            }
        if (!silent) loading = false
    }

    suspend fun reloadProducts() {
        runCatching { CardApi.products() }
            .onSuccess { products = it; productsError = null }
            .onFailure { productsError = it.message ?: "卡产品加载失败" }
    }

    fun mutateCard(card: BankCard, call: suspend () -> BankCard) {
        if (busyCardId != null) return
        busyCardId = card.id
        error = null
        notice = null
        scope.launch {
            runCatching { call() }
                .onSuccess { fresh ->
                    applyFresh(fresh)
                    notice = "操作成功"
                }
                .onFailure { failure -> error = failure.message ?: "操作失败，请稍后重试" }
            busyCardId = null
        }
    }

    LaunchedEffect(Unit) {
        if (!BankApi.hasToken()) {
            loading = false
            loadError = "登录后才能查看银行卡"
            return@LaunchedEffect
        }
        reloadCards(false)
        runCatching { CardApi.products() }
            .onSuccess { products = it; productsError = null }
            .onFailure { productsError = it.message ?: "卡产品加载失败" }
        runCatching { BankApi.accounts().firstOrNull() }
            .onSuccess { account = it; accountError = null }
            .onFailure { accountError = it.message ?: "资金账户加载失败" }
    }

    // 卡号与安全码只保留服务端给出的可见时长；到点从内存里真正清掉。
    LaunchedEffect(unlocked) {
        while (unlocked.isNotEmpty()) {
            delay(1000)
            now = System.currentTimeMillis()
            val remaining = unlocked.filterValues { it.expiresAt > now }
            if (remaining.size != unlocked.size) unlocked = remaining
        }
    }

    val selected = cards.firstOrNull { it.id == selectedId } ?: cards.firstOrNull()
    val selectedReveal = selected?.let { unlocked[it.id] }?.takeIf { it.expiresAt > now }
    val selectedUnlocked = selectedReveal?.secrets
    val editable = selected?.status == "active" || selected?.status == "locked"
    val switchesEditable = selected?.status == "active"
    val limitsEditable = selected?.status == "active" || selected?.status == "locked"

    fun requestSecrets(card: BankCard) {
        when (card.status) {
            "pending" -> error = "卡还在寄送途中，收到并激活后才能查看完整卡号与安全码。"
            "replaced" -> error = "这张卡已换发，旧卡信息不再可用。"
            "lost" -> error = "该卡已挂失，解挂后才能查看完整卡号与安全码。"
            "active", "locked" -> {
                error = null
                secretsFor = card
            }
            else -> error = "卡片状态不支持查看卡信息。"
        }
    }

    PushScreen(title = "银行卡", onBack = onBack) {
        SectionHeader("我的卡片", if (cards.isEmpty()) "—" else "${cards.size} 张")

        if (loading) {
            Text(
                "正在加载…",
                fontSize = 12.5.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            )
        }

        if (loadError != null && cards.isEmpty()) {
            HairlineCard(Modifier.padding(horizontal = 14.dp)) {
                Column(Modifier.padding(14.dp)) {
                    Text(loadError!!, fontSize = 12.5.sp, color = Tokens.Coral, lineHeight = 18.sp)
                    if (BankApi.hasToken()) {
                        Spacer(Modifier.height(10.dp))
                        GhostButton(
                            "重新加载",
                            onClick = { loadError = null; loading = true; scope.launch { reloadCards(false) } },
                        )
                    }
                }
            }
        }

        if (error != null) {
            NoticeBanner(error!!, Tokens.Coral, Color(0xFFFFF1F5)) { error = null }
        }
        if (notice != null) {
            NoticeBanner(notice!!, Tokens.Ink2, Tokens.SurfaceWarm) { notice = null }
        }

        LazyRow(
            Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(cards, key = { it.id }) { card ->
                CardFace(
                    card = card,
                    selected = card.id == selected?.id,
                    revealed = unlocked[card.id]?.takeIf { it.expiresAt > now }?.secrets,
                    onSelect = { selectedId = card.id },
                    onReveal = { requestSecrets(card) },
                    onHide = { unlocked = unlocked - card.id },
                )
            }
            item {
                ApplyCardTile {
                    when {
                        !BankApi.hasToken() -> error = "登录后才能申请银行卡"
                        products.isNotEmpty() -> applyOpen = true
                        productsError != null -> error = "卡产品暂不可用：$productsError"
                        else -> error = "暂无可申请的卡产品"
                    }
                }
            }
        }

        if (cards.isNotEmpty()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                cards.forEachIndexed { index, card ->
                    Box(
                        Modifier
                            .padding(horizontal = 3.dp)
                            .size(5.dp)
                            .clip(CircleShape)
                            .background(if (card.id == selected?.id) Tokens.Ink2 else Tokens.Border)
                    )
                }
            }
        }

        selectedReveal?.let { reveal ->
            Text(
                "卡号与安全码将在 ${((reveal.expiresAt - now).coerceAtLeast(0)) / 1000} 秒后自动隐藏。",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
            )
        }

        if (selected != null) {
            val busy = busyCardId == selected.id
            Row(
                Modifier
                    .padding(horizontal = 14.dp, vertical = 8.dp)
                    .alpha(if (busy) 0.55f else 1f),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CardActionTile(
                    label = when (selected.status) {
                        "locked" -> "解锁卡片"
                        "active" -> "立即锁卡"
                        "pending" -> "激活卡片"
                        "lost" -> "找回解挂"
                        "replaced" -> "已换卡"
                        else -> "不可操作"
                    },
                    icon = when (selected.status) {
                        "locked", "lost" -> Icons.Eye
                        "pending" -> Icons.Check
                        else -> Icons.Lock
                    },
                    enabled = editable || selected.status == "pending" || selected.status == "lost",
                    modifier = Modifier.weight(1f),
                ) {
                    if (busy) return@CardActionTile
                    when (selected.status) {
                        "active", "locked" -> mutateCard(selected) {
                            CardApi.setCardLock(selected.id, selected.status != "locked")
                        }
                        "pending" -> activateFor = selected
                        "lost" -> lossFor = selected to true
                        else -> Unit
                    }
                }
                CardActionTile(
                    label = if (selected.status == "lost") "挂失补卡" else "换卡",
                    icon = Icons.Refresh,
                    enabled = selected.status != "replaced" && !busy,
                    modifier = Modifier.weight(1f),
                ) {
                    if (selected.status != "replaced") replaceFor = selected
                }
                CardActionTile(
                    label = "寄送信息",
                    icon = Icons.Receipt,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                ) {
                    deliveryFor = selected
                }
            }

            if (selected.status == "active" || selected.status == "locked") {
                GhostButton(
                    "正式挂失（需支付密码）",
                    onClick = { if (!busy) lossFor = selected to false },
                    modifier = Modifier.padding(horizontal = 14.dp),
                )
                Spacer(Modifier.height(4.dp))
            }
        }

        SectionHeader(
            "资金账户",
            account?.let { "${it.label} ··${it.accountNo.takeLast(4)}" } ?: "—",
        )
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column(Modifier.padding(horizontal = 14.dp)) {
                if (account == null) {
                    Text(
                        accountError ?: "资金账户信息暂不可用",
                        fontSize = 12.5.sp,
                        color = Tokens.Muted,
                        modifier = Modifier.padding(vertical = 14.dp),
                    )
                } else {
                    val balances = account!!.currencyBalances
                        .ifEmpty {
                            listOf(
                                CurrencyBalanceDto(
                                    id = account!!.id,
                                    currency = account!!.currency,
                                    label = account!!.label,
                                    balance = account!!.balance,
                                    available = account!!.available,
                                )
                            )
                        }
                    balances.forEachIndexed { index, balance ->
                        if (index > 0) Hairline()
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "${balance.label.ifBlank { balance.currency }} ${balance.currency}",
                                fontSize = 12.5.sp,
                                color = Tokens.Muted,
                            )
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    if (balanceShown) formatCents(balance.available, balance.currency) else "••••••",
                                    fontSize = 12.5.sp,
                                    color = Tokens.Ink,
                                    fontWeight = FontWeight.Medium,
                                )
                                if (index == balances.lastIndex) {
                                    Spacer(Modifier.size(8.dp))
                                    Icon(
                                        Icons.Eye,
                                        contentDescription = "显示或隐藏余额",
                                        tint = Tokens.Muted,
                                        modifier = Modifier
                                            .size(15.dp)
                                            .clickable { balanceShown = !balanceShown },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        SectionHeader("交易设置", selected?.productName ?: "—")
        HairlineCard(Modifier.padding(horizontal = 14.dp)) {
            Column {
                if (selected == null) {
                    Text(
                        "选择一张卡片后可调整线上支付、境外交易与单日限额。",
                        fontSize = 12.5.sp,
                        color = Tokens.Muted,
                        modifier = Modifier.padding(14.dp),
                    )
                } else {
                    val busy = busyCardId == selected.id
                    CardSwitchRow(
                        label = "线上支付",
                        subtitle = "网上购物、App 内支付",
                        checked = selected.onlinePayment,
                        enabled = switchesEditable && !busy,
                    ) { next ->
                        mutateCard(selected) {
                            CardApi.updateSettings(selected.id, JSONObject().put("onlinePayment", next))
                        }
                    }
                    Hairline()
                    CardSwitchRow(
                        label = "境外交易",
                        subtitle = "境外商户与外币结算",
                        checked = selected.overseasPayment,
                        enabled = switchesEditable && !busy,
                    ) { next ->
                        mutateCard(selected) {
                            CardApi.updateSettings(selected.id, JSONObject().put("overseasPayment", next))
                        }
                    }
                    Hairline()
                    Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("单日限额", fontSize = 12.5.sp, color = Tokens.Muted)
                            Text(
                                formatCents(selected.dailyLimit),
                                fontSize = 12.5.sp,
                                color = Tokens.Ink,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            dailyLimitPresets.forEach { preset ->
                                val active = selected.dailyLimit == preset
                                Box(
                                    Modifier
                                        .weight(1f)
                                        .alpha(if (limitsEditable && !busy) 1f else 0.45f)
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(if (active) Tokens.Primary else Tokens.Surface)
                                        .border(
                                            1.dp,
                                            if (active) Tokens.Primary else Tokens.Border,
                                            RoundedCornerShape(14.dp),
                                        )
                                        .clickable(enabled = limitsEditable && !busy) {
                                            mutateCard(selected) {
                                                CardApi.updateSettings(
                                                    selected.id,
                                                    JSONObject().put("dailyLimit", preset),
                                                )
                                            }
                                        }
                                        .padding(vertical = 7.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        formatCents(preset),
                                        fontSize = 10.5.sp,
                                        color = if (active) Color.White else Tokens.Ink2,
                                    )
                                }
                            }
                        }
                    }
                    if (selected.status != "active") {
                        Hairline()
                        Text(
                            when (selected.status) {
                                "locked" -> "卡片已锁定：可以调整限额，开启支付需先解锁。"
                                "pending" -> "待激活卡片不能修改交易设置，请先激活。"
                                "lost" -> "已挂失卡片不能修改交易设置，请先解挂。"
                                "replaced" -> "已换发卡不能修改交易设置。"
                                else -> "当前状态不能修改交易设置。"
                            },
                            fontSize = 11.sp,
                            color = Tokens.Muted,
                            lineHeight = 17.sp,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        )
                    }
                }
            }
        }
    }

    if (applyOpen) {
        CardApplicationSheet(
            mode = ApplicationMode.OPEN,
            card = null,
            products = products,
            onDismiss = { applyOpen = false },
            onDone = { created ->
                cards = cards.filterNot { it.id == created.id } + created
                selectedId = created.id
                applyOpen = false
                error = null
                notice = buildString {
                    append("新卡已提交申请")
                    created.issuingFee?.let { append("，已收制卡费 ${formatCents(it)}") }
                    created.shippingAddress?.let { append("，将寄往 ${CardApi.formatAddress(it)}") }
                    append("；收到后需验证支付密码激活。")
                }
                scope.launch { reloadProducts() }
            },
        )
    }

    replaceFor?.let { card ->
        CardApplicationSheet(
            mode = ApplicationMode.REPLACE,
            card = card,
            products = products,
            onDismiss = { replaceFor = null },
            onDone = { created ->
                cards = cards.map {
                    if (it.id == created.replacedFromId) {
                        it.copy(status = "replaced", onlinePayment = false, overseasPayment = false)
                    } else {
                        it
                    }
                } + created
                selectedId = created.id
                replaceFor = null
                error = null
                notice = "换卡已提交，旧卡已停用；新卡收到后需验证支付密码激活。"
                scope.launch { reloadCards(true); reloadProducts() }
            },
        )
    }

    activateFor?.let { card ->
        CardPinActionSheet(
            title = "激活卡片",
            description = "确认已收到 ${card.productName}（尾号 ${card.last4}）并立即启用。激活需要验证支付密码。",
            confirmLabel = "确认激活",
            onDismiss = { activateFor = null },
            action = { pin -> CardApi.activateCard(card.id, pin) },
            onDone = { fresh ->
                applyFresh(fresh)
                activateFor = null
                error = null
                notice = "卡片已激活，可以开始使用"
            },
        )
    }

    lossFor?.let { (card, recover) ->
        CardPinActionSheet(
            title = if (recover) "找回解挂" else "正式挂失",
            description = if (recover) {
                "请确认已经找回卡片。解挂恢复挂失前状态，线上和境外支付保持关闭；待激活卡仍需单独激活。"
            } else {
                "挂失后立即拦截该卡消费并关闭支付开关。普通解锁不能解除挂失；资金账户与余额不变。"
            },
            confirmLabel = if (recover) "确认找回并解挂" else "确认挂失",
            onDismiss = { lossFor = null },
            action = { pin ->
                if (recover) CardApi.recoverCard(card.id, pin) else CardApi.reportCardLost(card.id, pin)
            },
            onDone = { fresh ->
                applyFresh(fresh)
                unlocked = unlocked - fresh.id
                lossFor = null
                error = null
                notice = if (recover) "已解挂，支付开关保持关闭" else "已正式挂失"
            },
        )
    }

    secretsFor?.let { card ->
        CardPinActionSheet(
            title = "查看完整卡号与安全码",
            description = "${card.productName} · 尾号 ${card.last4}。验证支付密码后显示，可见时间结束后自动隐藏；不会保存密码。",
            confirmLabel = "验证并查看",
            onDismiss = { secretsFor = null },
            action = { pin -> CardApi.revealCardSecrets(card.id, pin) },
            onSecrets = { secrets ->
                unlocked = unlocked + (card.id to UnlockedSecrets(
                    secrets = secrets,
                    expiresAt = System.currentTimeMillis() + secrets.revealSeconds.coerceAtLeast(1) * 1000L,
                ))
                now = System.currentTimeMillis()
                secretsFor = null
                error = null
            },
        )
    }

    deliveryFor?.let { card ->
        CardDeliverySheet(card = card, onDismiss = { deliveryFor = null })
    }
}

/* ─────────────────────────── 卡面 ─────────────────────────── */

@Composable
private fun CardFace(
    card: BankCard,
    selected: Boolean,
    revealed: CardSecrets?,
    onSelect: () -> Unit,
    onReveal: () -> Unit,
    onHide: () -> Unit,
) {
    val dimmed = card.status == "replaced" || card.status == "pending"
    Box(
        Modifier
            .width(296.dp)
            .aspectRatio(1.62f)
            .clip(RoundedCornerShape(10.dp))
            .background(cardColor(card).copy(alpha = if (dimmed) 0.62f else 1f))
            .border(
                if (selected) 2.dp else 1.dp,
                if (selected) Tokens.Accent else Color.White.copy(alpha = 0.25f),
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onSelect)
            .padding(16.dp),
    ) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.SpaceBetween) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(R.drawable.support_cat),
                    contentDescription = null,
                    modifier = Modifier.size(28.dp),
                    contentScale = ContentScale.Fit,
                )
                Spacer(Modifier.size(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        card.productName.ifBlank { "银行卡" },
                        fontSize = 13.sp,
                        color = Color.White,
                        fontWeight = FontWeight.Medium,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "尾号 ${card.last4.ifBlank { "——" }} · ${statusLabel(card.status)}",
                        fontSize = 11.sp,
                        color = Color.White.copy(alpha = 0.75f),
                    )
                }
                Box(
                    Modifier
                        .border(1.dp, Color.White.copy(alpha = 0.35f), RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        networkLabel(card.network),
                        fontSize = 10.sp,
                        color = Color.White.copy(alpha = 0.85f),
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    revealed?.pan?.takeIf { it.isNotBlank() }?.let(::formatPan)
                        ?: "•••• •••• •••• ••••",
                    fontSize = 15.sp,
                    color = Color.White,
                    letterSpacing = 1.sp,
                )
                Spacer(Modifier.size(8.dp))
                Icon(
                    Icons.Eye,
                    contentDescription = if (revealed != null) "隐藏卡号" else "显示完整卡号",
                    tint = Color.White.copy(alpha = 0.8f),
                    modifier = Modifier
                        .size(16.dp)
                        .clickable { if (revealed != null) onHide() else onReveal() },
                )
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom,
            ) {
                Text(
                    card.cardholder.ifBlank { "—" },
                    fontSize = 12.sp,
                    color = Color.White.copy(alpha = 0.85f),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Column(horizontalAlignment = Alignment.End) {
                        Text("VALID THRU", fontSize = 8.5.sp, color = Color.White.copy(alpha = 0.7f))
                        Text(
                            revealed?.expiry?.takeIf { it.isNotBlank() } ?: "••/••",
                            fontSize = 12.sp,
                            color = Color.White.copy(alpha = 0.85f),
                        )
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text("CVV", fontSize = 8.5.sp, color = Color.White.copy(alpha = 0.7f))
                        Text(
                            revealed?.cvv?.takeIf { it.isNotBlank() } ?: "•••",
                            fontSize = 12.sp,
                            color = Color.White.copy(alpha = 0.85f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ApplyCardTile(onClick: () -> Unit) {
    Box(
        Modifier
            .width(296.dp)
            .aspectRatio(1.62f)
            .clip(RoundedCornerShape(10.dp))
            .background(Tokens.Surface)
            .border(1.dp, Tokens.Border, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Plus, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(26.dp))
            Spacer(Modifier.height(9.dp))
            Text("申请新卡", fontSize = 12.5.sp, color = Tokens.Muted)
        }
    }
}

/* ─────────────────────────── 动作与设置 ─────────────────────────── */

@Composable
private fun CardActionTile(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    HairlineCard(modifier) {
        Column(
            Modifier
                .fillMaxWidth()
                .alpha(if (enabled) 1f else 0.45f)
                .clickable(enabled = enabled, onClick = onClick)
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
private fun CardSwitchRow(
    label: String,
    subtitle: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else 0.45f)
            .clickable(enabled = enabled) { onChange(!checked) }
            .padding(horizontal = 14.dp, vertical = 13.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 13.sp, color = Tokens.Ink)
            Spacer(Modifier.height(3.dp))
            Text(subtitle, fontSize = 10.5.sp, color = Tokens.Muted)
        }
        Box(
            Modifier
                .size(width = 42.dp, height = 24.dp)
                .clip(CircleShape)
                .background(if (checked) Tokens.Primary else Color(0xFFDFE6EE)),
        ) {
            Box(
                Modifier
                    .padding(top = 2.dp, start = if (checked) 20.dp else 2.dp)
                    .size(20.dp)
                    .clip(CircleShape)
                    .background(Color.White)
            )
        }
    }
}

@Composable
private fun NoticeBanner(text: String, color: Color, background: Color, onDismiss: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(Tokens.FieldRadius.dp))
            .background(background)
            .clickable(onClick = onDismiss)
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        Text(text, fontSize = 11.5.sp, color = color, lineHeight = 17.sp)
    }
}

/* ─────────────────────────── 申卡 / 换卡 ─────────────────────────── */

private enum class ApplicationMode { OPEN, REPLACE }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CardApplicationSheet(
    mode: ApplicationMode,
    card: BankCard?,
    products: List<CardProduct>,
    onDismiss: () -> Unit,
    onDone: (BankCard) -> Unit,
) {
    var productCode by remember {
        mutableStateOf(
            when (mode) {
                ApplicationMode.REPLACE ->
                    products.firstOrNull { it.network == card?.network }?.code
                        ?: products.firstOrNull()?.code.orEmpty()
                ApplicationMode.OPEN ->
                    products.firstOrNull { !it.held }?.code
                        ?: products.firstOrNull()?.code.orEmpty()
            }
        )
    }
    var address by remember { mutableStateOf(MailingAddress()) }
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val product = products.firstOrNull { it.code == productCode }
    val quote = products.firstOrNull { it.network == card?.network }?.feeQuote
    val fee = when (mode) {
        ApplicationMode.OPEN -> product?.payableFee
        ApplicationMode.REPLACE -> quote?.payable
    }
    val blocked = mode == ApplicationMode.OPEN && product?.held == true

    fun submit() {
        if (submitting) return
        if (mode == ApplicationMode.OPEN && product == null) {
            error = "请选择卡种"
            return
        }
        if (mode == ApplicationMode.OPEN && product?.held == true) {
            error = "该卡组织已有在用卡，每位客户各至多一张。"
            return
        }
        val addressError = CardApi.validateAddress(address)
        if (addressError != null) {
            error = addressError
            return
        }
        if (!Regex("^\\d{6}$").matches(pin)) {
            error = "请输入 6 位数字支付密码"
            return
        }
        submitting = true
        error = null
        scope.launch {
            runCatching {
                when (mode) {
                    ApplicationMode.OPEN -> CardApi.openCard(
                        productCode = product!!.code,
                        address = address,
                        paymentPassword = pin,
                    )
                    ApplicationMode.REPLACE -> CardApi.replaceCard(
                        cardId = card!!.id,
                        address = address,
                        paymentPassword = pin,
                    )
                }
            }.onSuccess { created -> onDone(created) }
                .onFailure { failure ->
                    error = failure.message ?: "提交失败，请稍后重试"
                    if ((failure as? BankApiException)?.code?.contains("PAY_PASSWORD") == true) pin = ""
                }
            submitting = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!submitting) onDismiss() },
        sheetState = rememberModalBottomSheetState(),
        containerColor = Tokens.Surface,
    ) {
        Column(
            Modifier
                .padding(horizontal = 18.dp)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            Text(
                if (mode == ApplicationMode.OPEN) "申请新卡" else "换卡",
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Ink,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                if (mode == ApplicationMode.OPEN) {
                    "实体卡将寄送到你填写的地址，制卡费用从储蓄账户扣除；新卡与现有卡片同属一个资金账户，不新开户。"
                } else {
                    "换卡后旧卡立即失效、卡号变更；新卡寄到填写的地址，收到后需激活。"
                },
                fontSize = 11.5.sp,
                color = Tokens.Ink2,
                lineHeight = 18.sp,
            )
            Spacer(Modifier.height(14.dp))

            if (mode == ApplicationMode.OPEN) {
                Text("选择卡种", fontSize = 12.sp, color = Tokens.Muted)
                Spacer(Modifier.height(8.dp))
                if (products.isEmpty()) {
                    Text("卡产品暂不可用，无法提交申请。", fontSize = 12.5.sp, color = Tokens.Coral)
                } else {
                    products.forEach { item ->
                        val active = item.code == productCode
                        val payable = item.payableFee
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(bottom = 8.dp)
                                .clip(RoundedCornerShape(Tokens.CardRadius.dp))
                                .background(if (active) Tokens.AccentWash else Tokens.Surface)
                                .border(
                                    1.dp,
                                    if (active) Tokens.Accent else Tokens.Border,
                                    RoundedCornerShape(Tokens.CardRadius.dp),
                                )
                                .alpha(if (item.held) 0.55f else 1f)
                                .clickable(enabled = !item.held) { productCode = item.code }
                                .padding(12.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        item.name,
                                        fontSize = 13.sp,
                                        color = Tokens.Ink,
                                        fontWeight = FontWeight.Medium,
                                    )
                                    Spacer(Modifier.height(3.dp))
                                    Text(
                                        if (item.held) "已持有同组织卡" else "${networkLabel(item.network)} · 预计 ${item.deliveryDays} 个工作日寄达",
                                        fontSize = 10.5.sp,
                                        color = Tokens.Muted,
                                    )
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(
                                        formatCents(payable),
                                        fontSize = 13.sp,
                                        color = Tokens.Ink,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    item.feeQuote?.takeIf { it.waived > 0 }?.let {
                                        Text(
                                            "已减 ${formatCents(it.waived)}",
                                            fontSize = 9.5.sp,
                                            color = Tokens.AccentDeep,
                                        )
                                    }
                                }
                            }
                            if (item.perks.isNotEmpty()) {
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    item.perks.joinToString(" · "),
                                    fontSize = 10.5.sp,
                                    color = Tokens.Muted,
                                    lineHeight = 15.sp,
                                )
                            }
                        }
                    }
                }
            } else {
                card?.let {
                    KvRow("银行卡", "${it.productName} · 尾号 ${it.last4}")
                    val feeText = fee?.let { amount -> formatCents(amount) } ?: "以提交后扣款为准"
                    KvRow("换卡费用", feeText)
                }
            }

            Spacer(Modifier.height(6.dp))
            Text("邮寄地址", fontSize = 12.sp, color = Tokens.Muted)
            Spacer(Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TextFieldRow("收件人", address.recipient, { address = address.copy(recipient = it) }, placeholder = "请输入收件人姓名")
                TextFieldRow(
                    "手机号",
                    address.phone,
                    { address = address.copy(phone = it.filter(Char::isDigit).take(11)) },
                    placeholder = "快递联系用，11 位手机号",
                    keyboardType = KeyboardType.Number,
                )
                TextFieldRow("省 / 直辖市", address.region, { address = address.copy(region = it) }, placeholder = "如：上海市")
                TextFieldRow("城市", address.city, { address = address.copy(city = it) }, placeholder = "如：上海市")
                TextFieldRow("详细地址", address.detail, { address = address.copy(detail = it) }, placeholder = "街道、门牌、楼层房号")
                TextFieldRow(
                    "邮政编码（选填）",
                    address.postalCode,
                    { address = address.copy(postalCode = it.filter(Char::isDigit).take(6)) },
                    placeholder = "6 位数字",
                    keyboardType = KeyboardType.Number,
                )
            }

            Spacer(Modifier.height(14.dp))
            TextFieldRow(
                label = "支付密码",
                value = pin,
                onValueChange = { if (!submitting) { pin = it.filter(Char::isDigit).take(6); error = null } },
                placeholder = "6 位数字支付密码",
                password = true,
                keyboardType = KeyboardType.Number,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "支付密码只随本次提交发送，不会保存。连续输错 5 次会冻结账号。",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
                lineHeight = 16.sp,
            )

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, fontSize = 11.5.sp, color = Tokens.Coral, lineHeight = 17.sp)
            }

            Spacer(Modifier.height(14.dp))
            PrimaryButton(
                text = when {
                    submitting -> "提交中…"
                    blocked -> "该卡组织已有在用卡"
                    else -> when {
                        fee != null && mode == ApplicationMode.OPEN -> "支付 ${formatCents(fee)} 并申请"
                        fee != null -> "支付 ${formatCents(fee)} 并换卡"
                        mode == ApplicationMode.OPEN -> "确认申请"
                        else -> "确认换卡"
                    }
                },
                onClick = { if (!blocked) submit() },
                modifier = Modifier.alpha(if (submitting || blocked) 0.55f else 1f),
            )
            Spacer(Modifier.height(8.dp))
        }
    }
}

/* ─────────────────────────── 验证支付密码的动作 ─────────────────────────── */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CardPinActionSheet(
    title: String,
    description: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    action: suspend (String) -> Any,
    onDone: (BankCard) -> Unit = {},
    onSecrets: (CardSecrets) -> Unit = {},
) {
    var pin by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (busy) return
        if (!Regex("^\\d{6}$").matches(pin)) {
            error = "请输入 6 位数字支付密码"
            return
        }
        busy = true
        error = null
        scope.launch {
            runCatching { action(pin) }
                .onSuccess { result ->
                    when (result) {
                        is BankCard -> onDone(result)
                        is CardSecrets -> onSecrets(result)
                        else -> error = "服务端返回了无法识别的结果"
                    }
                }
                .onFailure { failure ->
                    error = failure.message ?: "操作失败，请稍后重试"
                    if ((failure as? BankApiException)?.code?.contains("PAY_PASSWORD") == true) pin = ""
                }
            busy = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = rememberModalBottomSheetState(),
        containerColor = Tokens.Surface,
    ) {
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 24.dp)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(8.dp))
            Text(description, fontSize = 12.sp, color = Tokens.Ink2, lineHeight = 18.sp)
            Spacer(Modifier.height(14.dp))
            TextFieldRow(
                label = "支付密码",
                value = pin,
                onValueChange = { if (!busy) { pin = it.filter(Char::isDigit).take(6); error = null } },
                placeholder = "6 位数字支付密码",
                password = true,
                keyboardType = KeyboardType.Number,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "支付密码只随本次请求发送，不会保存。连续输错 5 次会冻结账号。",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
                lineHeight = 16.sp,
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, fontSize = 11.5.sp, color = Tokens.Coral, lineHeight = 17.sp)
            }
            Spacer(Modifier.height(14.dp))
            PrimaryButton(
                text = if (busy) "处理中…" else confirmLabel,
                onClick = { submit() },
                modifier = Modifier.alpha(if (busy) 0.55f else 1f),
            )
            Spacer(Modifier.height(8.dp))
        }
    }
}

/* ─────────────────────────── 寄送信息 ─────────────────────────── */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CardDeliverySheet(card: BankCard, onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(),
        containerColor = Tokens.Surface,
    ) {
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 24.dp)) {
            Text("寄送信息", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(12.dp))
            KvRow("银行卡", "${card.productName} · 尾号 ${card.last4}")
            val address = card.shippingAddress
            if (address == null) {
                Text(
                    "服务端没有这张卡的寄送地址记录。",
                    fontSize = 12.sp,
                    color = Tokens.Muted,
                    lineHeight = 18.sp,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            } else {
                KvRow("收件人", address.recipient.ifBlank { "—" })
                KvRow("联系电话", address.phone.ifBlank { "—" })
                KvRow("寄送地址", CardApi.formatAddress(address).ifBlank { "—" })
                if (address.postalCode.isNotBlank()) KvRow("邮政编码", address.postalCode)
            }
            KvRow("已收制卡费", card.issuingFee?.let { formatCents(it) } ?: "—")
            KvRow("卡片状态", statusLabel(card.status))
            Spacer(Modifier.height(6.dp))
            Text(
                "物流轨迹未由银行卡接口提供，无法在此展示。",
                fontSize = 10.5.sp,
                color = Tokens.Muted,
                lineHeight = 16.sp,
            )
            Spacer(Modifier.height(16.dp))
        }
    }
}

/* ─────────────────────────── 展示辅助 ─────────────────────────── */

private fun statusLabel(status: String): String = when (status) {
    "active" -> "使用中"
    "locked" -> "已锁定"
    "pending" -> "待激活"
    "lost" -> "已挂失"
    "replaced" -> "已换卡"
    else -> status.ifBlank { "未知状态" }
}

private fun networkLabel(network: String): String = when (network) {
    "unionpay" -> "银联"
    "visa" -> "VISA"
    else -> network.uppercase().ifBlank { "—" }
}

private fun cardColor(card: BankCard): Color = when {
    card.productName.contains("星享") -> Color(0xFF08233E)
    card.network == "unionpay" -> Color(0xFF126B62)
    card.network == "visa" -> Color(0xFF5840C4)
    card.theme == "ink" -> Color(0xFF08233E)
    else -> Color(0xFF5840C4)
}

private fun formatPan(pan: String): String = pan.chunked(4).joinToString(" ")
