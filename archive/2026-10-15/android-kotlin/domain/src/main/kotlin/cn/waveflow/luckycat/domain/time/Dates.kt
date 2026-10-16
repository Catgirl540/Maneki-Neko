package cn.waveflow.luckycat.domain.time

import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 时间显示。格式**逐条照抄网页版 `app/src/lib/format.ts`** ——
 * 同一笔交易在两端显示成不同格式，用户会以为是两笔。
 *
 * 一律按**本机时区**渲染（网页版用的是 `new Date(iso)` + `getHours()`，
 * 同样是本地时区）。后端给的是 UTC，显示成本地时间这件事只能在这一层做。
 */
object Dates {

    /** `2026-09-20 08:12` */
    fun dateTime(iso: String): String = format(iso, "yyyy-MM-dd HH:mm")

    /** `2026-09-20 08:12:33`，回单要精确到秒（交易编号与授权码要跟时间一起核对）。 */
    fun dateTimeFull(iso: String): String = format(iso, "yyyy-MM-dd HH:mm:ss")

    /** `2026-09-20` */
    fun date(iso: String): String = format(iso, "yyyy-MM-dd")

    /** `9月20日` */
    fun monthDay(iso: String): String = format(iso, "M月d日")

    /** 解析不出来时**原样返回**，而不是显示 "—"。看到原始串才知道后端给了什么。 */
    fun format(iso: String, pattern: String): String {
        val instant = parse(iso) ?: return iso
        return DateTimeFormatter.ofPattern(pattern)
            .withZone(ZoneId.systemDefault())
            .format(instant)
    }

    /**
     * 容错解析。三种形态都要认，因为"后端给的时间长什么样"在联调期会变：
     *
     *   1. `2026-09-20T08:12:00Z`      带 Z（当前演示后端就是这种）
     *   2. `2026-09-20T08:12:00+08:00` 带偏移
     *   3. `2026-09-20T08:12:00`       不带时区 —— 只能当本地时间
     *
     * 第三种是有歧义的，但比"直接抛异常导致整页崩"好。
     */
    fun parse(iso: String): Instant? {
        val text = iso.trim()
        if (text.isEmpty()) return null
        runCatching { return Instant.parse(text) }
        runCatching { return OffsetDateTime.parse(text).toInstant() }
        runCatching { return LocalDateTime.parse(text).atZone(ZoneId.systemDefault()).toInstant() }
        return null
    }
}
