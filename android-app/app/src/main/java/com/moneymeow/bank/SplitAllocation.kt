package com.moneymeow.bank

internal data class SplitExpenseInput(val title: String, val amount: Long, val participants: List<String>)
internal data class SplitAllocationResult(val amount: Long, val participants: List<Pair<String, Long>>, val selfAmount: Long = 0)

internal fun allocateSplit(amount: Long, participants: List<String>): SplitAllocationResult {
    val names = validSplitNames(participants)
    require(amount in names.size.toLong()..100_000_000L) { "金额须为每人至少 1 分且总额不超过 100 万元" }
    return SplitAllocationResult(amount, names.mapIndexed { index, name -> name to (amount / names.size + if (index < amount % names.size) 1 else 0) })
}

internal fun allocateExpenses(collector: String, expenses: List<SplitExpenseInput>): SplitAllocationResult {
    val self = collector.trim()
    require(self.isNotEmpty() && self.length <= 40 && expenses.size in 1..30) { "请填写本人姓名和 1 至 30 项消费" }
    val totals = linkedMapOf<String, Long>()
    var total = 0L
    var own = 0L
    expenses.forEach { expense ->
        require(expense.title.isNotBlank() && expense.title.trim().length <= 80) { "请填写有效消费事由" }
        val allocation = allocateSplit(expense.amount, expense.participants)
        total = Math.addExact(total, expense.amount)
        require(total <= 100_000_000L) { "消费合计不能超过 100 万元" }
        allocation.participants.forEach { (name, cents) -> if (name == self) own += cents else totals[name] = (totals[name] ?: 0L) + cents }
    }
    require(totals.isNotEmpty() && totals.size < 30) { "须有其他付款人且总人数不超过 30 人" }
    return SplitAllocationResult(total - own, totals.toList(), own)
}

private fun validSplitNames(input: List<String>): List<String> {
    val names = input.map { it.trim() }
    require(names.size in 2..30 && names.all { it.isNotEmpty() && it.length <= 40 } && names.distinct().size == names.size) { "参与人须为 2 至 30 个不重复的完整姓名" }
    return names
}
