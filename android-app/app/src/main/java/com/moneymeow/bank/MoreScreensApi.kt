package com.moneymeow.bank

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * 更多服务二级页的补充接口。
 *
 * `BankApi.kt` 由并行工作维护，这里只补 `MoreScreens` 需要、但 `BankApi`
 * 尚未暴露完整字段的契约：工资与备用金、借款与分期、邀请总览、保险产品与保单。
 * 鉴权、错误码与 401 处理沿用 `BankApi` 的规则；支付密码错误虽为 401，
 * 但只是业务校验失败，不能触发全局登出。
 */
internal object MoreScreensApi {
    data class SalaryRecordDto(
        val id: String,
        val month: String,
        val amount: Long,
        val paidAt: String,
    )

    data class SalaryPlanDto(
        val salaryDay: Int,
        val amount: Long,
        val employer: String,
        val accountId: String,
        /** 空字符串表示尚未设置工资计划，不能据此编造下次发薪日。 */
        val nextPayday: String,
        val history: List<SalaryRecordDto>,
    ) {
        val configured: Boolean get() = nextPayday.isNotBlank()
    }

    data class OverdraftDto(
        val active: Boolean,
        val creditLimit: Long,
        val used: Long,
        val available: Long,
        val apr: Double,
        val activatedAt: String?,
        val interestNote: String,
    )

    data class LoanProductDto(
        val id: String,
        val name: String,
        val description: String,
        val minAmount: Long,
        val maxAmount: Long,
        val minTermMonths: Int,
        val maxTermMonths: Int,
        val apr: Double,
        val disbursement: String,
        val tags: List<String>,
    )

    data class LoanDto(
        val id: String,
        val productName: String,
        val principal: Long,
        val outstanding: Long,
        val termMonths: Int,
        val monthlyPayment: Long,
        val apr: Double,
        val nextDueDate: String,
        val paidPeriods: Int,
        val totalPeriods: Int,
        val status: String,
    )

    data class InstallmentDto(
        val id: String,
        val title: String,
        val merchant: String,
        val totalAmount: Long,
        val remainingAmount: Long,
        val periods: Int,
        val paidPeriods: Int,
        val monthlyPayment: Long,
        val nextDueDate: String,
        val feeRate: Double,
    )

    data class CreditBuilderDto(
        val score: Int,
        val level: String,
        val streakMonths: Int,
        val nextMilestone: String,
        val tips: List<String>,
    )

    data class CreditOverviewDto(
        val creditLimit: Long,
        val availableCredit: Long,
        val products: List<LoanProductDto>,
        val loans: List<LoanDto>,
        val installments: List<InstallmentDto>,
        val builder: CreditBuilderDto,
    )

    data class InviteCodeDto(val code: String, val link: String)

    data class InviteFriendOverviewDto(
        val id: String,
        val name: String,
        val maskedPhone: String,
        val stage: String,
        val joinedAt: String,
        val reward: Long,
    )

    data class InviteRewardDto(
        val id: String,
        val title: String,
        val description: String,
        val status: String,
        val amount: Long,
        val createdAt: String,
    )

    data class InvitationOverviewDto(
        val invite: InviteCodeDto,
        val friends: List<InviteFriendOverviewDto>,
        val rewards: List<InviteRewardDto>,
        val totalEarned: Long,
    )

    data class InsuranceProductDto(
        val id: String,
        val name: String,
        val category: String,
        val insurer: String,
        val premiumPerYear: Long,
        val coverage: Long,
        val highlight: String,
        val tags: List<String>,
    )

    data class InsurancePolicyDto(
        val id: String,
        val productName: String,
        val insurer: String,
        val premium: Long,
        val coverage: Long,
        val status: String,
        val effectiveAt: String,
        val expireAt: String,
        val insuredName: String,
    )

    data class InsuranceOverviewDto(
        val totalCoverage: Long,
        val policies: List<InsurancePolicyDto>,
        val products: List<InsuranceProductDto>,
    )

    suspend fun salaryPlan(): SalaryPlanDto = withContext(Dispatchers.IO) {
        parseSalaryPlan(request("GET", "/api/cashflow/salary", null))
    }

    /**
     * 只保存发薪日与预计月薪，不触发工资入账。
     * 服务端接受 1–28 日，金额单位为分。
     */
    suspend fun updateSalary(
        salaryDay: Int,
        amount: Long,
        employer: String,
    ): SalaryPlanDto = withContext(Dispatchers.IO) {
        if (salaryDay !in 1..28) {
            throw BankApiException(400, "发薪日需在 1–28 之间", "INVALID_SALARY_DAY")
        }
        if (amount <= 0L) {
            throw BankApiException(400, "月薪必须大于 0", "INVALID_AMOUNT")
        }
        val body = JSONObject()
            .put("salaryDay", salaryDay)
            .put("amount", amount)
            .put("employer", employer)
        parseSalaryPlan(request("PATCH", "/api/cashflow/salary", body))
    }

    suspend fun overdraft(): OverdraftDto = withContext(Dispatchers.IO) {
        parseOverdraft(request("GET", "/api/cashflow/overdraft", null))
    }

    suspend fun setOverdraftActive(active: Boolean): OverdraftDto = withContext(Dispatchers.IO) {
        parseOverdraft(
            request(
                "POST",
                "/api/cashflow/overdraft/activate",
                JSONObject().put("active", active),
            ),
        )
    }

    suspend fun creditOverview(): CreditOverviewDto = withContext(Dispatchers.IO) {
        parseCreditOverview(request("GET", "/api/credit/overview", null))
    }

    /** 真实放款：服务端校验额度、期限和支付密码，并在同一事务里入账。 */
    suspend fun applyLoan(
        productId: String,
        amount: Long,
        termMonths: Int,
        purpose: String,
        accountId: String,
        paymentPassword: String,
    ): LoanDto = withContext(Dispatchers.IO) {
        if (productId.isBlank()) throw BankApiException(400, "请选择借款产品", "PRODUCT_REQUIRED")
        if (amount <= 0L) throw BankApiException(400, "金额必须是正数", "INVALID_AMOUNT")
        if (termMonths <= 0) throw BankApiException(400, "请选择借款期限", "INVALID_TERM")
        if (purpose.isBlank()) throw BankApiException(400, "请填写借款用途", "VALIDATION_ERROR")
        if (accountId.isBlank()) throw BankApiException(400, "未获取到人民币储蓄账户", "ACCOUNT_REQUIRED")
        if (!Regex("^\\d{6}$").matches(paymentPassword)) {
            throw BankApiException(400, "请输入 6 位数字支付密码", "BAD_PAY_PASSWORD")
        }
        val body = JSONObject()
            .put("productId", productId)
            .put("amount", amount)
            .put("termMonths", termMonths)
            .put("purpose", purpose)
            .put("accountId", accountId)
            .put("paymentPassword", paymentPassword)
        parseLoan(request("POST", "/api/credit/loans/apply", body))
    }

    suspend fun invitationOverview(): InvitationOverviewDto = withContext(Dispatchers.IO) {
        parseInvitations(request("GET", "/api/invitations", null))
    }

    suspend fun insuranceOverview(): InsuranceOverviewDto = withContext(Dispatchers.IO) {
        parseInsurance(request("GET", "/api/wealth/insurance", null))
    }

    /** 真实投保：保费从人民币储蓄账户扣除，保单以服务端返回记录为准。 */
    suspend fun enrollInsurance(
        productId: String,
        insuredName: String,
        paymentPassword: String,
    ): InsurancePolicyDto = withContext(Dispatchers.IO) {
        if (productId.isBlank()) throw BankApiException(400, "请选择保险产品", "PRODUCT_REQUIRED")
        if (insuredName.isBlank()) throw BankApiException(400, "请填写被保人姓名", "VALIDATION_ERROR")
        if (!Regex("^\\d{6}$").matches(paymentPassword)) {
            throw BankApiException(400, "请输入 6 位数字支付密码", "BAD_PAY_PASSWORD")
        }
        val body = JSONObject()
            .put("productId", productId)
            .put("insuredName", insuredName)
            .put("paymentPassword", paymentPassword)
        parsePolicy(request("POST", "/api/wealth/insurance/enroll", body))
    }

    /** 只切换已有合约的启停；不创建自动扣款，也不等于取消商户订阅。 */
    suspend fun setAutoDebitEnabled(id: String, enabled: Boolean): AutoDebitDto =
        withContext(Dispatchers.IO) {
            if (id.isBlank()) throw BankApiException(400, "扣款计划不存在", "AUTODEBIT_NOT_FOUND")
            parseAutoDebit(
                request(
                    "PATCH",
                    "/api/autodebits/$id",
                    JSONObject().put("enabled", enabled),
                ),
            )
        }

    /* ───────────────────────────── 解析 ───────────────────────────── */

    private fun parseSalaryPlan(root: JSONObject): SalaryPlanDto {
        val day = root.requiredInt("salaryDay")
        if (day !in 1..28) invalid("工资计划日期异常")
        val amount = root.requiredLong("amount")
        if (amount < 0L) invalid("工资计划金额异常")
        return SalaryPlanDto(
            salaryDay = day,
            amount = amount,
            employer = root.requiredString("employer"),
            accountId = root.requiredString("accountId"),
            nextPayday = root.requiredString("nextPayday"),
            history = root.requiredObjects("history").map(::parseSalaryRecord),
        )
    }

    private fun parseSalaryRecord(row: JSONObject): SalaryRecordDto {
        val amount = row.requiredLong("amount")
        if (amount < 0L) invalid("发薪记录金额异常")
        return SalaryRecordDto(
            id = row.requiredString("id"),
            month = row.requiredString("month"),
            amount = amount,
            paidAt = row.requiredString("paidAt"),
        )
    }

    private fun parseOverdraft(root: JSONObject): OverdraftDto {
        val creditLimit = root.requiredLong("creditLimit")
        val used = root.requiredLong("used")
        val available = root.requiredLong("available")
        if (creditLimit < 0L || used < 0L || available < 0L) invalid("备用金额度异常")
        val apr = root.requiredDouble("apr")
        if (apr < 0.0) invalid("备用金利率异常")
        return OverdraftDto(
            active = root.requiredBoolean("active"),
            creditLimit = creditLimit,
            used = used,
            available = available,
            apr = apr,
            activatedAt = root.optionalString("activatedAt"),
            interestNote = root.requiredString("interestNote"),
        )
    }

    private fun parseCreditOverview(root: JSONObject): CreditOverviewDto {
        val limit = root.requiredLong("creditLimit")
        val available = root.requiredLong("availableCredit")
        if (limit < 0L || available < 0L) invalid("授信额度异常")
        return CreditOverviewDto(
            creditLimit = limit,
            availableCredit = available,
            products = root.requiredObjects("products").map(::parseLoanProduct),
            loans = root.requiredObjects("loans").map(::parseLoan),
            installments = root.requiredObjects("installments").map(::parseInstallment),
            builder = parseCreditBuilder(root.optJSONObject("builder") ?: invalid()),
        )
    }

    private fun parseLoanProduct(row: JSONObject): LoanProductDto {
        val minAmount = row.requiredLong("minAmount")
        val maxAmount = row.requiredLong("maxAmount")
        val minTerm = row.requiredInt("minTermMonths")
        val maxTerm = row.requiredInt("maxTermMonths")
        val apr = row.requiredDouble("apr")
        if (minAmount < 0L || maxAmount < minAmount || minTerm <= 0 || maxTerm < minTerm || apr < 0.0) {
            invalid("借款产品参数异常")
        }
        return LoanProductDto(
            id = row.requiredString("id"),
            name = row.requiredString("name"),
            description = row.requiredString("description"),
            minAmount = minAmount,
            maxAmount = maxAmount,
            minTermMonths = minTerm,
            maxTermMonths = maxTerm,
            apr = apr,
            disbursement = row.requiredString("disbursement"),
            tags = row.requiredStrings("tags"),
        )
    }

    private fun parseLoan(row: JSONObject): LoanDto {
        val principal = row.requiredLong("principal")
        val outstanding = row.requiredLong("outstanding")
        val termMonths = row.requiredInt("termMonths")
        val paidPeriods = row.requiredInt("paidPeriods")
        val totalPeriods = row.requiredInt("totalPeriods")
        val monthlyPayment = row.requiredLong("monthlyPayment")
        val apr = row.requiredDouble("apr")
        if (principal < 0L || outstanding < 0L || termMonths <= 0 || totalPeriods <= 0 ||
            monthlyPayment < 0L || apr < 0.0 || paidPeriods !in 0..totalPeriods
        ) {
            invalid("借款记录参数异常")
        }
        return LoanDto(
            id = row.requiredString("id"),
            productName = row.requiredString("productName"),
            principal = principal,
            outstanding = outstanding,
            termMonths = termMonths,
            monthlyPayment = monthlyPayment,
            apr = apr,
            nextDueDate = row.requiredString("nextDueDate"),
            paidPeriods = paidPeriods,
            totalPeriods = totalPeriods,
            status = row.requiredString("status"),
        )
    }

    private fun parseInstallment(row: JSONObject): InstallmentDto {
        val total = row.requiredLong("totalAmount")
        val remaining = row.requiredLong("remainingAmount")
        val periods = row.requiredInt("periods")
        val paidPeriods = row.requiredInt("paidPeriods")
        val monthlyPayment = row.requiredLong("monthlyPayment")
        val feeRate = row.requiredDouble("feeRate")
        if (total < 0L || remaining < 0L || periods <= 0 || paidPeriods !in 0..periods ||
            monthlyPayment < 0L || feeRate < 0.0
        ) {
            invalid("分期计划参数异常")
        }
        return InstallmentDto(
            id = row.requiredString("id"),
            title = row.requiredString("title"),
            merchant = row.requiredString("merchant"),
            totalAmount = total,
            remainingAmount = remaining,
            periods = periods,
            paidPeriods = paidPeriods,
            monthlyPayment = monthlyPayment,
            nextDueDate = row.requiredString("nextDueDate"),
            feeRate = feeRate,
        )
    }

    private fun parseCreditBuilder(root: JSONObject): CreditBuilderDto {
        val score = root.requiredInt("score")
        val streakMonths = root.requiredInt("streakMonths")
        if (score < 0 || streakMonths < 0) invalid("信用培养数据异常")
        return CreditBuilderDto(
            score = score,
            level = root.requiredString("level"),
            streakMonths = streakMonths,
            nextMilestone = root.requiredString("nextMilestone"),
            tips = root.requiredStrings("tips"),
        )
    }

    private fun parseInvitations(root: JSONObject): InvitationOverviewDto {
        val invite = root.optJSONObject("invite") ?: invalid()
        val totalEarned = root.requiredLong("totalEarned")
        if (totalEarned < 0L) invalid("邀请奖励总额异常")
        return InvitationOverviewDto(
            invite = InviteCodeDto(
                code = invite.requiredString("code"),
                link = invite.requiredString("link"),
            ),
            friends = root.requiredObjects("friends").map { row ->
                val reward = row.requiredLong("reward")
                if (reward < 0L) invalid("邀请奖励金额异常")
                InviteFriendOverviewDto(
                    id = row.requiredString("id"),
                    name = row.requiredString("name"),
                    maskedPhone = row.requiredString("maskedPhone"),
                    stage = row.requiredString("stage"),
                    joinedAt = row.requiredString("joinedAt"),
                    reward = reward,
                )
            },
            rewards = root.requiredObjects("rewards").map { row ->
                val amount = row.requiredLong("amount")
                if (amount < 0L) invalid("奖励金额异常")
                InviteRewardDto(
                    id = row.requiredString("id"),
                    title = row.requiredString("title"),
                    description = row.requiredString("description"),
                    status = row.requiredString("status"),
                    amount = amount,
                    createdAt = row.requiredString("createdAt"),
                )
            },
            totalEarned = totalEarned,
        )
    }

    private fun parseInsurance(root: JSONObject): InsuranceOverviewDto {
        val totalCoverage = root.requiredLong("totalCoverage")
        if (totalCoverage < 0L) invalid("总保额异常")
        return InsuranceOverviewDto(
            totalCoverage = totalCoverage,
            policies = root.requiredObjects("policies").map(::parsePolicy),
            products = root.requiredObjects("products").map { row ->
                val premium = row.requiredLong("premiumPerYear")
                val coverage = row.requiredLong("coverage")
                if (premium < 0L || coverage < 0L) invalid("保险产品金额异常")
                InsuranceProductDto(
                    id = row.requiredString("id"),
                    name = row.requiredString("name"),
                    category = row.requiredString("category"),
                    insurer = row.requiredString("insurer"),
                    premiumPerYear = premium,
                    coverage = coverage,
                    highlight = row.requiredString("highlight"),
                    tags = row.requiredStrings("tags"),
                )
            },
        )
    }

    private fun parsePolicy(row: JSONObject): InsurancePolicyDto {
        val premium = row.requiredLong("premium")
        val coverage = row.requiredLong("coverage")
        if (premium < 0L || coverage < 0L) invalid("保单金额异常")
        return InsurancePolicyDto(
            id = row.requiredString("id"),
            productName = row.requiredString("productName"),
            insurer = row.requiredString("insurer"),
            premium = premium,
            coverage = coverage,
            status = row.requiredString("status"),
            effectiveAt = row.requiredString("effectiveAt"),
            expireAt = row.requiredString("expireAt"),
            insuredName = row.requiredString("insuredName"),
        )
    }

    private fun parseAutoDebit(row: JSONObject): AutoDebitDto {
        val amount = row.requiredLong("amount")
        if (amount < 0L) invalid("自动扣款金额异常")
        return AutoDebitDto(
            id = row.requiredString("id"),
            merchant = row.requiredString("merchant"),
            amount = amount,
            cycle = row.requiredString("cycle"),
            nextRunAt = row.requiredString("nextRunAt"),
            enabled = row.requiredBoolean("enabled"),
        )
    }

    /* ───────────────────────────── 网络 ───────────────────────────── */

    private fun request(method: String, path: String, body: JSONObject?): JSONObject {
        val text = requestRaw(method, path, body)
        val parsed = try {
            org.json.JSONTokener(text).nextValue()
        } catch (_: org.json.JSONException) {
            invalid()
        }
        return parsed as? JSONObject ?: invalid()
    }

    private fun requestRaw(method: String, path: String, body: JSONObject?): String =
        // I/O 由 BankHttp 统一实现；本文件的 JSON 校验（invalid）保持原样。
        BankHttp.raw(method = method, path = path, body = body, readTimeoutMs = 15_000)

}

