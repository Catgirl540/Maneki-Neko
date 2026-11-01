package com.moneymeow.bank

import org.json.JSONArray
import org.json.JSONObject

/**
 * `org.json` 的取值与遍历扩展：全 App 共用一套校验与错误文案。
 *
 * 这些扩展原本私有在 `MoreScreensApi.kt`，其它页面各自手写
 * `for (index in 0 until array.length()) { array.getJSONObject(index) }`。
 * 集中到这里后，取值失败统一抛 [BankApiException]（`INVALID_RESPONSE`），
 * 界面拿到的错误文案与之前一致。
 */

/** 服务端返回的结构不符合约定。 */
internal fun invalid(message: String = "服务返回的数据格式异常，请稍后重试"): Nothing =
    throw BankApiException(502, message, "INVALID_RESPONSE")

/* ───────────────────────────── 数组遍历 ───────────────────────────── */

internal fun JSONArray.objects(): List<JSONObject> = buildList {
    for (index in 0 until length()) add(getJSONObject(index))
}

internal fun JSONArray.forEachObject(block: (JSONObject) -> Unit) {
    for (index in 0 until length()) block(getJSONObject(index))
}

/* ───────────────────────────── 取值 ───────────────────────────── */

internal fun JSONObject.requiredString(key: String): String {
    val value = opt(key)
    return if (value is String) value else invalid()
}

internal fun JSONObject.optionalString(key: String): String? =
    if (!has(key) || isNull(key)) null else requiredString(key)

internal fun JSONObject.requiredInt(key: String): Int {
    val value = opt(key)
    if (value !is Number) invalid()
    val long = value.toLong()
    if (value is Double && value != long.toDouble()) invalid()
    if (long < Int.MIN_VALUE.toLong() || long > Int.MAX_VALUE.toLong()) invalid()
    return long.toInt()
}

internal fun JSONObject.requiredLong(key: String): Long {
    val value = opt(key)
    if (value !is Number) invalid()
    if (value is Double && value != value.toLong().toDouble()) invalid()
    return value.toLong()
}

internal fun JSONObject.requiredDouble(key: String): Double {
    val value = opt(key)
    if (value !is Number) invalid()
    val double = value.toDouble()
    if (!double.isFinite()) invalid()
    return double
}

internal fun JSONObject.requiredBoolean(key: String): Boolean {
    val value = opt(key)
    return if (value is Boolean) value else invalid()
}

internal fun JSONObject.requiredObjects(key: String): List<JSONObject> {
    val array = optJSONArray(key) ?: invalid()
    return buildList {
        for (index in 0 until array.length()) {
            add(array.optJSONObject(index) ?: invalid())
        }
    }
}

internal fun JSONObject.requiredStrings(key: String): List<String> {
    val array = optJSONArray(key) ?: invalid()
    return buildList {
        for (index in 0 until array.length()) {
            val value = array.opt(index)
            if (value !is String) invalid()
            add(value)
        }
    }
}
