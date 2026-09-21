package cn.waveflow.luckycat.contract

/**
 * 一条 SSE 消息。
 *
 * [event] 为 `null` 表示服务端**没给** `event:` 字段。桥接的两条流用的是两种写法，
 * 不是笔误，实测确认过：
 *
 * - agent 事件流：只有 `data: {"type":"assistant",…}`，类型在 JSON 里；
 * - 语音流：`event: start` / `event: audio` / … ，类型在 SSE 字段里。
 *
 * 所以解析器两种都要认，不能只认一种。
 */
data class SseMessage(val event: String?, val data: String)

/**
 * 增量 SSE 解析器：**按行喂**，遇到空行派发。
 *
 * 按行而不是按块，是因为 OkHttp 的 `readUtf8Line()` 已经把行尾处理掉了
 * （`\n` 与 `\r\n` 都算），分块解析要自己处理"块边界切在 `\r` 和 `\n` 中间"
 * 这种情形，白白多一份容易错的代码。
 */
class SseParser {
    private var event: String? = null
    private val data = StringBuilder()

    /**
     * 喂一行（**不含**行尾）。遇到空行就派发：
     * 有 data 就返回消息，没有就返回 null（SSE 规范：data 为空不派发）。
     */
    fun feedLine(line: String): SseMessage? {
        // 空行 = 一条消息结束
        if (line.isEmpty()) return dispatch()

        // 以冒号开头的是注释。桥接会定期发 `: ping` 保活，必须安静地吃掉。
        if (line.startsWith(":")) return null

        val colon = line.indexOf(':')
        val field: String
        val value: String
        if (colon < 0) {
            // 规范允许没有冒号的行，此时整行是字段名、值为空串
            field = line
            value = ""
        } else {
            field = line.substring(0, colon)
            // 冒号后**最多**去掉一个空格（去掉多个会把内容里的前导空格吃掉）
            value = line.substring(colon + 1).removePrefix(" ")
        }

        when (field) {
            "event" -> event = value
            // 多行 data 用换行拼接，这是规范行为
            "data" -> data.append(value).append('\n')
            // id / retry 以及未知字段：忽略。断线重连由 OkHttp 之上自己管，
            // 桥接也不发这两个字段。
        }
        return null
    }

    private fun dispatch(): SseMessage? {
        val pendingEvent = event
        val pendingData = data.toString()
        event = null
        data.setLength(0)
        if (pendingData.isEmpty()) return null
        return SseMessage(pendingEvent, pendingData.removeSuffix("\n"))
    }
}
