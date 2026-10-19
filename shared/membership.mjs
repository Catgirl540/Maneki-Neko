/**
 * 统一客户会员等级：纯函数部分。
 *
 * 规则（docs/product/cards-and-membership-proposal.md 已确认口径）：
 * - 四档：白银（开户即享）、黄金、铂金、钻石，由上月日均储蓄资产评定本月等级。
 * - 评级资产 = 资金账户折人民币余额（仅储蓄，不含理财持仓、借款额度）。
 * - 日终快照按北京时间落档；上月快照缺的日子按 0 计入日均 —— 只可能低估，
 *   不回推、不编造历史达标情况。
 * - 权益只列已接通结算的（制卡费减免、换汇点差折扣）；返现、加息为规划中。
 *
 * 两侧共用：浏览器 mock（app/src/api/mock/db.ts）与银行服务端
 * （server/domain/state.mjs）都从这份文件取规则，口径才不会漂移。
 */

export const MEMBER_TIERS = ['silver', 'gold', 'platinum', 'diamond']

export const MEMBER_TIER_RULES = {
    silver: { label: '白银会员', threshold: 0, cardFeeFreePerYear: 0, cardFeeRate: 1, includeShipping: false, fxFeeRate: 1 },
    gold: { label: '黄金会员', threshold: 1_000_000, cardFeeFreePerYear: 1, cardFeeRate: 0.5, includeShipping: false, fxFeeRate: 0.9 },
    platinum: { label: '铂金会员', threshold: 10_000_000, cardFeeFreePerYear: 1, cardFeeRate: 0, includeShipping: false, fxFeeRate: 0.8 },
    diamond: { label: '钻石会员', threshold: 50_000_000, cardFeeFreePerYear: 2, cardFeeRate: 0, includeShipping: true, fxFeeRate: 0.7 },
}

/** 规划中、尚未接通结算的权益 —— 只能标注，不能展示成已享权益 */
export const PLANNED_MEMBER_PERKS = ['刷卡消费返现', '储蓄余额加息收益']

/** 每个卡组织（Visa / 银联）每位客户至多一张；replaced 的历史卡不占名额 */
export const OCCUPYING_CARD_STATUSES = ['active', 'locked', 'pending']

/* ------------------------------------------------------------------ 北京时间 */

const BEIJING_OFFSET = 8 * 3_600_000

/** 北京时间当日日期 `YYYY-MM-DD` */
export function beijingDay(now = Date.now()) {
    return new Date(now + BEIJING_OFFSET).toISOString().slice(0, 10)
}

/** 北京时间当月 `YYYY-MM` */
export function beijingMonth(now = Date.now()) {
    return new Date(now + BEIJING_OFFSET).toISOString().slice(0, 7)
}

/** `YYYY-MM` 的上一个月 */
export function previousMonth(month) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 2, 1))
    return d.toISOString().slice(0, 7)
}

/** `YYYY-MM` 的下一个月 */
export function nextMonth(month) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m, 1))
    return d.toISOString().slice(0, 7)
}

/** `YYYY-MM` 的天数 */
export function daysInMonth(month) {
    const [y, m] = month.split('-').map(Number)
    return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/* ------------------------------------------------------------------ 评定 */

/**
 * 评级资产（分）：资金账户折人民币余额。
 * @param db 客户档案（accounts[0] 为资金账户，currencyBalances 为币种分区）
 * @param midRates 币种 → CNY 中间价表（各侧自己的 FX_MID_RATES）
 */
export function ratedAssets(db, midRates) {
    let total = db.accounts?.[0]?.balance ?? 0
    for (const row of db.currencyBalances ?? []) {
        const rate = midRates[row.currency]
        if (!rate) continue // 无可靠汇率的币种不并入，不瞎折算
        total += Math.round(row.balance * rate)
    }
    return total
}

/** 达标最高档；avg 为分 */
export function tierForAssets(avgAssets) {
    let tier = 'silver'
    for (const t of MEMBER_TIERS) {
        if (avgAssets >= MEMBER_TIER_RULES[t].threshold) tier = t
    }
    return tier
}

/** 下一档；最高档返回 null */
export function nextTier(tier) {
    const index = MEMBER_TIERS.indexOf(tier)
    return index >= 0 && index < MEMBER_TIERS.length - 1 ? MEMBER_TIERS[index + 1] : null
}

/**
 * 惰性月度评定：本月还没评过时，用上月日终快照算出等级。
 *
 * 直接改档案：tier / since / evaluation / benefitUsage / records / user.memberLevel。
 * 缺快照的日子按 0 计入日均 —— 保守，只能降级不能虚高升级。
 * 新档案没有任何快照时：上月日均计 0，落白银。
 *
 * @returns 是否发生了评定（等级可能变化、写了评定记录）
 */
export function evaluateMembership(db, now = Date.now()) {
    const month = beijingMonth(now)
    const iso = new Date(now).toISOString()
    const membership = db.membership
    const year = Number(month.slice(0, 4))
    // 年度权益额度独立于评定重置
    if (membership.benefitUsage?.year !== year) {
        membership.benefitUsage = { year, cardFeeWaiversUsed: 0 }
    }
    if (membership.evaluation?.for === month) return false

    const prev = previousMonth(month)
    const dim = daysInMonth(prev)
    const prefix = `${prev}-`
    const snaps = (db.assetSnapshots ?? []).filter((s) => s.date.startsWith(prefix))
    const sum = snaps.reduce((total, s) => total + s.assets, 0)
    const avgAssets = Math.round(sum / dim)
    const tier = tierForAssets(avgAssets)
    const before = membership.tier ?? 'silver'

    membership.tier = tier
    membership.evaluation = {
        for: month,
        avgAssets,
        coveredDays: snaps.length,
        daysInMonth: dim,
        evaluatedAt: iso,
    }
    if (tier !== before) {
        membership.since = iso
        membership.records ??= []
        membership.records.unshift({
            id: `mbr_${now.toString(36)}`,
            label: `会员评级：${MEMBER_TIER_RULES[before].label} → ${MEMBER_TIER_RULES[tier].label}（${prev} 日均资产）`,
            amount: 0,
            createdAt: iso,
        })
    }
    // memberLevel 只是等级的展示投影，同一份口径，不允许两处各写各的
    db.user.memberLevel = MEMBER_TIER_RULES[tier].label
    return true
}

/**
 * 制卡 / 换卡实付报价。
 * 年度剩余减免次数 > 0 才给减免：黄金半价、铂金/钻石全免、钻石含寄送费。
 * @returns { listFee, payable, waived }  waived > 0 表示本次会消耗一次减免
 */
export function cardFeeQuote(db, product) {
    const perks = MEMBER_TIER_RULES[db.membership?.tier ?? 'silver']
    const usage = db.membership?.benefitUsage
    const quotaLeft = perks.cardFeeFreePerYear - (usage?.cardFeeWaiversUsed ?? 0)
    const listFee = product.issuingFee + product.deliveryFee
    if (quotaLeft <= 0) return { listFee, payable: listFee, waived: 0 }
    const payable = Math.round(product.issuingFee * perks.cardFeeRate) + (perks.includeShipping ? 0 : product.deliveryFee)
    return { listFee, payable, waived: listFee - payable }
}

/**
 * 核销一次制卡费减免并留痕：使用记录进 membership.records，年度计数 +1。
 */
export function recordCardFeeWaiver(db, waivedAmount) {
    const m = db.membership
    m.benefitUsage.cardFeeWaiversUsed += 1
    m.records.unshift({
        id: `mbr_${Date.now().toString(36)}`,
        label: `会员权益：制卡/换卡费减免 −¥${(waivedAmount / 100).toFixed(2)}`,
        amount: waivedAmount,
        createdAt: new Date().toISOString(),
    })
}

/**
 * 换汇有效点差：会员按档打折（fxFeeRate 是点差系数，0.7 = 七折）。
 */
export function effectiveSpread(db, baseSpread) {
    const perks = MEMBER_TIER_RULES[db.membership?.tier ?? 'silver']
    return baseSpread * perks.fxFeeRate
}

/**
 * 换汇实际汇率：mid × (1 − 有效点差)。
 */
export function fxRateFor(db, from, to, midRates, baseSpread) {
    if (from === to) return 1
    const mid = midRates[from] / midRates[to]
    return mid * (1 - effectiveSpread(db, baseSpread))
}

/** 把 db.membership 整理成对外的 MembershipOverview（派生字段现算，不落库） */
export function membershipOverview(db, midRates) {
    const m = db.membership
    const perks = MEMBER_TIER_RULES[m.tier]
    const next = nextTier(m.tier)
    const month = beijingMonth()
    return {
        tier: m.tier,
        tierName: perks.label,
        since: m.since ?? null,
        evaluation: m.evaluation ?? null,
        nextEvaluationAt: `${nextMonth(month)}-01`,
        upgradeGap: next ? Math.max(0, MEMBER_TIER_RULES[next].threshold - (m.evaluation?.avgAssets ?? 0)) : null,
        nextTierName: next ? MEMBER_TIER_RULES[next].label : null,
        benefits: {
            cardFeeWaiversPerYear: perks.cardFeeFreePerYear,
            cardFeeWaiversUsed: m.benefitUsage?.cardFeeWaiversUsed ?? 0,
            includeShipping: perks.includeShipping,
            fxFeeRate: perks.fxFeeRate,
            plannedPerks: PLANNED_MEMBER_PERKS,
        },
        records: m.records ?? [],
        ...(m.legacy ? { legacy: m.legacy } : {}),
    }
}

/**
 * 档案里的会员结构统一为新形态（幂等，可反复跑）：
 * 旧版 { current, plans, records } 订阅结构 → legacy 只读保留，新字段补默认。
 */
export function normalizeMembership(db) {
    const m = db.membership
    if (!m || typeof m !== 'object') {
        db.membership = freshMembership()
        return
    }
    if (m.plans !== undefined || m.current !== undefined) {
        m.legacy ??= { current: m.current ?? null, plans: m.plans ?? [] }
        delete m.current
        delete m.plans
    }
    m.tier ??= 'silver'
    m.since ??= null
    m.evaluation ??= null
    m.benefitUsage ??= { year: Number(beijingMonth().slice(0, 4)), cardFeeWaiversUsed: 0 }
    m.records ??= []
}

/** 新客户的会员初始结构 */
export function freshMembership() {
    return {
        tier: 'silver',
        since: null,
        evaluation: null,
        benefitUsage: { year: Number(beijingMonth().slice(0, 4)), cardFeeWaiversUsed: 0 },
        records: [],
    }
}

/**
 * 日终资产快照：同一天的重复写入互相覆盖，最后一次写的就是当日日终值。
 * 保留最近 400 天，防无限膨胀。
 */
export function recordAssetSnapshot(db, midRates, now = Date.now()) {
    db.assetSnapshots ??= []
    const date = beijingDay(now)
    const assets = ratedAssets(db, midRates)
    const existing = db.assetSnapshots.find((s) => s.date === date)
    if (existing) existing.assets = assets
    else db.assetSnapshots.push({ date, assets })
    if (db.assetSnapshots.length > 400) db.assetSnapshots.splice(0, db.assetSnapshots.length - 400)
}
