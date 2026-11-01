package com.moneymeow.bank

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONObject
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
    val keyword: String? = null,
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
            query.keyword?.let { add("keyword=${enc(it)}") }
        }
        val root = getJson("/api/accounts/${enc(accountId)}/transactions?${params.joinToString("&")}")
        val items = root.getJSONArray("items")
        require(root.has("total") && root.getInt("total") >= 0) { "流水分页响应不完整" }
        val rows = buildList {
            if (items != null) {
                items.forEachObject { row ->
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
        pages: Int = 1,
    ): RecentTx = coroutineScope {
        val loadedPages = partitions.map { partition ->
            async {
                val first = transactions(
                    accountId = partition.id,
                    size = size,
                    query = query,
                    fallbackCurrency = partition.currency,
                )
                val all = first.items.toMutableList()
                for (page in 2..pages) {
                    if (all.size >= first.total) break
                    all += transactions(partition.id, page, size, query, partition.currency).items
                }
                TxPage(all, first.total)
            }
        }.awaitAll()
        RecentTx(
            items = loadedPages.flatMap { it.items }.distinctBy { it.id }
                .sortedWith(compareByDescending { parseBankTime(it.createdAt)?.toInstant() ?: Instant.EPOCH }),
            total = loadedPages.sumOf { it.total },
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

    suspend fun report(period: String, value: String, currency: String): JSONObject = withContext(Dispatchers.IO) {
        require(period in listOf("month", "year") && currency in listOf("CNY", "USD", "HKD"))
        getJson("/api/statistics/report?period=${enc(period)}&value=${enc(value)}&currency=${enc(currency)}")
    }

    suspend fun reportCsv(period: String, value: String, currency: String): String = withContext(Dispatchers.IO) {
        require(period in listOf("month", "year") && currency in listOf("CNY", "USD", "HKD"))
        val data = getJson("/api/statistics/report/export?period=${enc(period)}&value=${enc(value)}&currency=${enc(currency)}")
        datasetsCsv(listOf(data))
    }

    suspend fun transactionsCsv(partitions: List<CurrencyPartition>, query: TxQuery): String = withContext(Dispatchers.IO) {
        require(partitions.isNotEmpty()) { "没有可导出的币种分区" }
        val params = buildList {
            query.direction?.let { add("direction=${enc(it)}") }
            query.category?.let { add("category=${enc(it)}") }
            query.from?.let { add("from=${enc(it)}") }
            query.to?.let { add("to=${enc(it)}") }
            query.keyword?.let { add("keyword=${enc(it)}") }
        }.joinToString("&")
        val datasets = partitions.map { getJson("/api/accounts/${enc(it.id)}/transactions/export" + if (params.isEmpty()) "" else "?$params") }
        datasetsCsv(datasets)
    }

    internal fun datasetsCsv(datasets: List<JSONObject>): String {
        val columns = datasets.first().getJSONArray("columns")
        fun cell(value: String): String {
            val numeric = value.matches(Regex("[+-]?[0-9]+(\\.[0-9]+)?"))
            val text = if (!numeric && value.trimStart().firstOrNull() in setOf('=', '+', '-', '@')) "'$value" else value
            return if (text.any { it in ",\"\r\n" }) "\"${text.replace("\"", "\"\"")}\"" else text
        }
        val keys = (0 until columns.length()).map { columns.getJSONObject(it).getString("key") }
        val lines = mutableListOf((0 until columns.length()).joinToString(",") { cell(columns.getJSONObject(it).getString("label")) })
        for (data in datasets) {
            require(data.getJSONArray("columns").toString() == columns.toString()) { "币种导出列不一致" }
            val rows = data.getJSONArray("rows")
            rows.forEachObject { row ->
                lines += keys.joinToString(",") { cell(row.optString(it, "")) }
            }
        }
        return "\uFEFF" + lines.joinToString("\r\n") + "\r\n"
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

    private fun getJson(path: String): JSONObject = org.json.JSONTokener(getText(path)).nextValue() as JSONObject

    private fun getText(path: String): String =
        // I/O 由 BankHttp 统一实现；只读接口同样走统一的错误体与 401 语义。
        BankHttp.raw(method = "GET", path = path)
}
