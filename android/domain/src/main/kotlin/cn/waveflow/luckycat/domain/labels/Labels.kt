package cn.waveflow.luckycat.domain.labels

import cn.waveflow.luckycat.contract.bank.Cents

/**
 * 枚举值 → 中文。**逐条照抄网页版** `app/src/lib/categories.ts` 与 `lib/tx.ts`。
 *
 * 后端给的是稳定的英文键（`dining` / `card` / `pending`），显示才是中文。
 * 两端各写一份映射必然漂开，所以这里的每条断言都直接写着网页版的那个词。
 *
 * 认不出的键**原样返回**：这样联调时一眼能看出"后端加了个新分类"，
 * 而不是界面上出现一个空白。
 */
object Labels {

    private val CATEGORY = mapOf(
        "salary" to "工资入账",
        "transfer" to "转账",
        "dining" to "餐饮",
        "shopping" to "购物",
        "housing" to "房租",
        "transport" to "交通",
        "subscription" to "订阅服务",
        "other" to "其他",
    )

    private val CHANNEL = mapOf(
        "quickpay" to "网上交易",
        "card" to "刷卡消费",
        "transfer" to "转账汇款",
        "account" to "账户划转",
        "interest" to "利息结算",
    )

    private val STATUS = mapOf(
        "success" to "交易成功",
        "pending" to "处理中",
        "failed" to "交易失败",
    )

    fun category(key: String): String = CATEGORY[key] ?: key

    fun channel(key: String): String = CHANNEL[key] ?: key

    fun status(key: String): String = STATUS[key] ?: key

    // ── 理财 ────────────────────────────────────────────────────────────

    /**
     * 风险等级。**通俗说法优先、R 符号退到次要位置**——这是新规的要求，
     * 网页版 `RISK_PLAIN_LABEL` 的注释里写着这句。
     */
    private val RISK = mapOf(
        "R1" to "低风险",
        "R2" to "中低风险",
        "R3" to "中风险",
        "R4" to "中高风险",
        "R5" to "高风险",
    )

    private val WEALTH_CATEGORY = mapOf(
        "cash" to "现金管理类",
        "fixed" to "固定收益类",
        "mixed" to "混合类",
        "equity" to "权益类",
        "derivative" to "商品及金融衍生品类",
    )

    /** 投资者风险承受能力。`C` 是投资者、`R` 是产品，两者不能混。 */
    private val TOLERANCE = mapOf(
        "C1" to "保守型",
        "C2" to "谨慎型",
        "C3" to "稳健型",
        "C4" to "积极型",
        "C5" to "激进型",
    )

    fun risk(level: String): String = RISK[level] ?: level

    fun wealthCategory(key: String): String = WEALTH_CATEGORY[key] ?: key

    fun tolerance(key: String): String = TOLERANCE[key] ?: key
}

/**
 * 理财页上那几个数字的说法。
 *
 * **业绩比较基准不是承诺收益**，所以这里刻意把它渲染成一个**区间**
 * （`1.60% ~ 2.10%`），而不是挑一个数字出来当"收益率"。后端给了
 * `kind`/`low`/`high` 三个字段就是为这件事。
 */
object WealthText {

    fun percent(value: Double): String =
        String.format(java.util.Locale.US, "%.2f%%", value * 100)

    /** 区间：`1.60% ~ 2.10%`；单点（`fixed`）：`2.00%`。 */
    fun benchmark(kind: String, low: Double, high: Double): String = when {
        kind == "fixed" -> percent(low)
        low == high -> percent(low)
        else -> "${percent(low)} ~ ${percent(high)}"
    }

    /** 收益的正负号。给界面决定颜色用（涨蓝跌红，与网页版一致）。 */
    fun isLoss(profit: Cents): Boolean = profit < 0
}

/*
 * 这里**刻意没有** `account.kind → 中文` 的映射。
 *
 * 网页版没有这张表：账户的显示名由后端在 `Account.label` 里直接给
 * （例如"储蓄账户"），前端只负责显示。我一开始照着 kind 猜了一张
 * （还顺手加了 mock 里根本不存在的 "time"），那是**自己发明业务语义**——
 * 后端加一个账户类型，客户端就得跟着改一次，而且改错了还没人报错。
 */
