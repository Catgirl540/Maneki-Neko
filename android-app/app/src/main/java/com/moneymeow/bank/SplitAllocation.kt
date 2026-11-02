package com.moneymeow.bank

/**
 * 一位参与者的身份：姓名 + 手机号或本行账号（二者填一个即可）。
 *
 * 镜像 `shared/split-collection.mjs` 的 `identityOf`。参加者不能只靠姓名聚合：同名的两个人会被
 * 合并成一个、只算一份钱，钱最后发给谁也说不清。唯一标识取手机号或账号，姓名只用来核对户名。
 * 手机号与账号都填时用 `手机号|账号` 作主键，与网页端、服务端保持同一条规则。
 */
internal data class SplitIdentity(val name: String, val phone: String = "", val accountNo: String = "") {
    /** 手机号 / 账号里填的那一个，界面上展示用。 */
    val identity: String get() = phone.ifEmpty { accountNo }
    val key: String get() = if (phone.isNotEmpty() && accountNo.isNotEmpty()) "$phone|$accountNo" else identity
}

/**
 * 把「姓名 + 一格数字」解析成身份，同时校验格式，与网页端 `toIdentity` 同一套规则：
 * 11 位按手机号，12–19 位按本行账号。只写手机号就只传手机号，不会顺手补一个空账号。
 */
internal fun identityOf(name: String, digits: String): SplitIdentity {
    val who = name.trim()
    val value = digits.filter(Char::isDigit)
    require(who.isNotEmpty()) { "请填写参与者姓名" }
    require(who.length <= 40) { "参与者姓名最多 40 个字" }
    require(value.isNotEmpty()) { "请填写${who}的手机号或本行账号" }
    if (value.length > 11) {
        require(value.matches(Regex("\\d{12,19}"))) { "${who}的账号须为 12 至 19 位数字" }
        return SplitIdentity(who, accountNo = value)
    }
    require(value.matches(Regex("1[3-9][0-9]{9}"))) { "${who}的手机号须为 11 位" }
    return SplitIdentity(who, phone = value)
}

internal data class SplitExpenseInput(val title: String, val amount: Long, val participants: List<SplitIdentity>)
internal data class SplitShare(val identity: SplitIdentity, val amount: Long)

internal data class SplitAllocationResult(
    /** 待收总额（分项模式下已扣除本人份额）。 */
    val amount: Long,
    val participants: List<SplitShare>,
    val selfAmount: Long = 0,
    /** 分项模式下的消费合计，均分模式为 0。 */
    val expenseTotal: Long = 0,
    /** 分项模式下每项消费各自的份额明细，用于「参与人清单」上方的汇总行。 */
    val expenses: List<SplitExpenseDetail> = emptyList(),
)

internal data class SplitExpenseDetail(val title: String, val shares: List<SplitShare>)

/** 均分：按人平分，每人至少 1 分，余数从前往后各加 1 分（与服务端 `sharesOf` 一致）。 */
internal fun allocateSplit(amount: Long, participants: List<SplitIdentity>): SplitAllocationResult {
    val people = validIdentities(participants, 2)
    require(amount in people.size.toLong()..100_000_000L) { "金额须为每人至少 1 分且总额不超过 100 万元" }
    return SplitAllocationResult(amount, people.mapIndexed { index, person -> SplitShare(person, amount / people.size + if (index < amount % people.size) 1 else 0) })
}

/**
 * 分项：每项消费先各自平分，再把每个人在各项里的份额累加到他头上；本人的份额不计入待收。
 *
 * [self] 是当前登录用户（发起人就是收款人），必须出现在某几项的参加者里才有自付份额。
 */
internal fun allocateExpenses(self: SplitIdentity, expenses: List<SplitExpenseInput>): SplitAllocationResult {
    require(expenses.size in 1..30) { "请填写 1 至 30 项消费" }
    var expenseTotal = 0L
    var own = 0L
    // 按身份主键累加：同一个人在不同消费里只填手机号或只填账号也能合并，同名的两个人不会被并成一份。
    val totals = linkedMapOf<String, Pair<SplitIdentity, Long>>()
    val details = mutableListOf<SplitExpenseDetail>()
    expenses.forEach { expense ->
        require(expense.title.isNotBlank() && expense.title.trim().length <= 80) { "请填写有效消费事由" }
        val allocation = allocateSplit(expense.amount, expense.participants)
        expenseTotal = Math.addExact(expenseTotal, expense.amount)
        require(expenseTotal <= 100_000_000L) { "消费合计不能超过 100 万元" }
        allocation.participants.forEach { share ->
            if (share.identity.key == self.key) {
                own += share.amount
            } else {
                val prior = totals[share.identity.key]
                // 补齐先前缺的身份字段，界面上一次性展示手机号或账号。
                totals[share.identity.key] = if (prior == null) share.identity to share.amount
                else prior.first.copy(
                    phone = prior.first.phone.ifEmpty { share.identity.phone },
                    accountNo = prior.first.accountNo.ifEmpty { share.identity.accountNo },
                ) to (prior.second + share.amount)
            }
        }
        details += SplitExpenseDetail(expense.title.trim(), allocation.participants)
    }
    require(totals.isNotEmpty()) { "须有其他付款人，且总人数不超过 30 人" }
    require(totals.size + 1 <= 30) { "参与总人数不能超过 30 人，且须有其他付款人" }
    return SplitAllocationResult(
        amount = expenseTotal - own,
        participants = totals.values.map { (person, share) -> SplitShare(person, share) },
        selfAmount = own,
        expenseTotal = expenseTotal,
        expenses = details,
    )
}

private fun validIdentities(input: List<SplitIdentity>, minimum: Int): List<SplitIdentity> {
    require(input.size in minimum..30) { "参与人数须为 $minimum 至 30 人" }
    require(input.map { it.key }.distinct().size == input.size) { "同一位参与者不能重复出现" }
    return input
}
