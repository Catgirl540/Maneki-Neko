package com.moneymeow.bank

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/** 统一使用北京时间展示与筛选，与后端统计口径一致。 */
internal val bankZone: ZoneId = ZoneId.of("Asia/Shanghai")

/** 解析后端 ISO 时间；非法或缺失时返回 null，绝不拿“今天”冒充真实时间。 */
internal fun parseBankTime(iso: String): ZonedDateTime? {
    if (iso.isBlank()) return null
    return runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(bankZone) }
        .recoverCatching { Instant.parse(iso).atZone(bankZone) }
        .recoverCatching { LocalDateTime.parse(iso.take(19)).atZone(bankZone) }
        .getOrNull()
}

internal fun bankTimeText(iso: String): String? =
    parseBankTime(iso)?.format(DateTimeFormatter.ofPattern("HH:mm"))

internal fun bankDayKey(iso: String): String? = parseBankTime(iso)?.toLocalDate()?.toString()

internal fun bankDayLabel(date: LocalDate, today: LocalDate = LocalDate.now(bankZone)): String = when {
    date == today -> "今天"
    date == today.minusDays(1) -> "昨天"
    else -> "${date.monthValue}月${date.dayOfMonth}日"
}

/** 账户下的币种记账分区；分区 ID 才是个流水分页接口的账户参数。 */
internal data class CurrencyPartition(val id: String, val currency: String)

internal fun AccountDto.partitions(): List<CurrencyPartition> {
    val rows = currencyBalances
        .map { CurrencyPartition(it.id, it.currency) }
        .filter { it.id.isNotEmpty() }
        .distinctBy { it.id }
    if (rows.isNotEmpty()) return rows
    return if (id.isNotEmpty()) listOf(CurrencyPartition(id, currency)) else emptyList()
}

/** 服务端筛选参数：方向/分类/自然日闭区间。客户端不再对第一页做假筛选。 */
internal data class TxQuery(
    val direction: String? = null,
    val category: String? = null,
    val from: String? = null,
    val to: String? = null,
)

internal data class TxRecord(
    val id: String,
    val direction: String,
    val amount: Long,
    val counterparty: String,
    val category: String,
    val memo: String,
    val createdAt: String,
    val currency: String,
    val status: String,
    val pendingReason: String,
    val classificationState: String,
)

internal data class TxPage(val items: List<TxRecord>, val total: Int)
internal data class RecentTx(val items: List<TxRecord>, val total: Int)

/** 完整账本的月度统计（`/api/statistics/report`），不是近期样本合计。 */
internal data class MonthReport(
    val month: String,
    val currency: String,
    val totalIncome: Long,
    val totalExpense: Long,
    val periodStatus: String,
    val asOf: String,
)

/**
 * 交易与统计的补充接口。
 *
 * `BankApi` 由其他页面并行维护，这里不改动它；只复用其公开的 `baseUrl`、
 * 当前令牌和 401 回调，补齐服务端筛选分页与完整账本月报。
 */
internal object LedgerApi {

    suspend fun transactions(
        accountId: String,
        page: Int = 1,
        size: Int = 30,
        query: TxQuery = TxQuery(),
        fallbackCurrency: String = "CNY",
    ): TxPage = withContext(Dispatchers.IO) {
        val params = buildList {
            add("page=$page")
            add("size=$size")
            query.direction?.let { add("direction=${enc(it)}") }
            query.category?.let { add("category=${enc(it)}") }
            query.from?.let { add("from=${enc(it)}") }
            query.to?.let { add("to=${enc(it)}") }
        }
        val root = getJson("/api/accounts/${enc(accountId)}/transactions?${params.joinToString("&")}")
        val items = root.optJSONArray("items")
        val rows = buildList {
            if (items != null) {
                for (index in 0 until items.length()) {
                    val row = items.getJSONObject(index)
                    add(
                        TxRecord(
                            id = row.optString("id"),
                            direction = row.optString("direction"),
                            amount = row.optLong("amount"),
                            counterparty = row.optString("counterparty"),
                            category = row.optString("category"),
                            memo = row.optString("memo"),
                            createdAt = row.optString("createdAt"),
                            currency = row.optString("currency").ifEmpty { fallbackCurrency },
                            status = row.optString("status"),
                            pendingReason = row.optString("pendingReason"),
                            classificationState = row.optString("classificationState"),
                        )
                    )
                }
            }
        }
        TxPage(items = rows, total = root.optInt("total", rows.size))
    }

    /** 并行读取所选币种分区的最新流水，按真实时间倒序合并。 */
    suspend fun recent(
        partitions: List<CurrencyPartition>,
        size: Int = 30,
        query: TxQuery = TxQuery(),
    ): RecentTx = coroutineScope {
        val pages = partitions.map { partition ->
            async {
                transactions(
                    accountId = partition.id,
                    size = size,
                    query = query,
                    fallbackCurrency = partition.currency,
                )
            }
        }.awaitAll()
        RecentTx(
            items = pages.flatMap { it.items }
                .sortedWith(compareByDescending { parseBankTime(it.createdAt)?.toInstant() ?: Instant.EPOCH }),
            total = pages.sumOf { it.total },
        )
    }

    suspend fun monthlyReport(month: String, currency: String): MonthReport = withContext(Dispatchers.IO) {
        val root = getJson(
            "/api/statistics/report?period=month&value=${enc(month)}&currency=${enc(currency)}"
        )
        MonthReport(
            month = root.optString("value", month),
            currency = root.optString("currency", currency),
            totalIncome = root.optLong("totalIncome"),
            totalExpense = root.optLong("totalExpense"),
            periodStatus = root.optString("periodStatus"),
            asOf = root.optString("asOf"),
        )
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

    private fun getJson(path: String): JSONObject {
        val connection = (URL(BankApi.baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 8000
            readTimeout = 12000
            setRequestProperty("Accept", "application/json")
            BankApi.currentToken()?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (status !in 200..299) {
                val error = runCatching { JSONObject(text) }.getOrNull()
                val message = error?.optString("message").orEmpty()
                val code = error?.optString("code").orEmpty().ifEmpty { null }
                if (status == 401) BankApi.onUnauthorized?.invoke()
                throw BankApiException(status, message.ifEmpty { "请求失败（$status）" }, code)
            }
            return org.json.JSONTokener(text).nextValue() as JSONObject
        } finally {
            connection.disconnect()
        }
    }
}
