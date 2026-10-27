/**
 * 统一客户会员等级：纯函数部分。
 *
 * 规则（docs/product/membership-rules.md，2026-10-20 用户定稿）：
 * - 四档：普通（standard，开户即享）、金卡、白金、钻石，按**月均总资产 AUM** 评定。
 * - AUM 口径 = 资金账户折人民币余额（含外币按中间价折算）
 *   + 理财持仓市值 + 现金管理余额；不含信用卡 / 授信额度。
 * - 每月 1 号按上月日均重算；**升级即时**（当前实时 AUM 达更高档当天就升）；
 *   **降级需连续 2 个评定周期不达标**（belowPeriods 计数，1 个月缓冲）。
 * - 日终快照按北京时间落档，存的是当日 AUM；上月缺快照的日子按 0 计入日均 ——
 *   只可能低估，不回推、不编造历史达标情况。
 * - 权益收敛到 `entitlements(tier)`，各业务在收费 / 排队 / 核销处统一调用。
 *   旧的两项已接通权益（制卡/换卡费减免、换汇点差折扣）与新权益并存。
 *
 * 两侧共用：浏览器 mock（app/src/api/mock/db.ts）与银行服务端
 * （server/domain/state.mjs）都从这份文件取规则，口径才不会漂移。
 */

export const MEMBER_TIERS = ['standard', 'gold', 'platinum', 'diamond']

/**
 * 档位规则。
 *
 * 旧字段 cardFeeFreePerYear / cardFeeRate / includeShipping / fxFeeRate 保留：
 * 制卡费减免与换汇点差折扣已接通结算，不在本轮新方案里下线。
 */
export const MEMBER_TIER_RULES = {
    standard: { label: '普通会员', threshold: 0, cardFeeFreePerYear: 0, cardFeeRate: 1, includeShipping: false, fxFeeRate: 1 },
    gold: { label: '金卡会员', threshold: 10_000_000, cardFeeFreePerYear: 1, cardFeeRate: 0.5, includeShipping: false, fxFeeRate: 0.9 },
    platinum: { label: '白金会员', threshold: 50_000_000, cardFeeFreePerYear: 1, cardFeeRate: 0, includeShipping: false, fxFeeRate: 0.8 },
    diamond: { label: '钻石会员', threshold: 300_000_000, cardFeeFreePerYear: 2, cardFeeRate: 0, includeShipping: true, fxFeeRate: 0.7 },
}

/** 机场 / 高铁贵宾厅年度额度（次） */
export const LOUNGE_PASSES_PER_YEAR = { standard: 0, gold: 0, platinum: 2, diamond: 6 }

/** 生日礼遇文档标「暂缓」：保留字段但为 false，界面展示为规划中 */
export const PLANNED_MEMBER_PERKS = ['生日礼遇']

/** 境外转账手续费：金额 × 费率，不足最低按最低收 */
export const OVERSEAS_TRANSFER_RATE = 0.001
export const OVERSEAS_TRANSFER_MIN_FEE = 5_000

/** 每个卡组织（Visa / 银联）每位客户至多一张；replaced 的历史卡不占名额 */
export const OCCUPYING_CARD_STATUSES = ['active', 'locked', 'pending', 'lost']

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

/* ------------------------------------------------------------------ AUM */

/**
 * AUM（分）：资金账户折人民币余额 + 理财持仓市值 + 现金管理余额。
 *
 * 资金账户：accounts[0].balance 是本币余额，currencyBalances 是同一账户下的
 * 外币记账分区（不是独立账户）。没有可靠中间价的币种不并入，不瞎折算。
 * 理财持仓：mock / 服务端都放在 db.holdings（wealthAccount 本身只存账户信息）；
 * 这里同时兼容 wealthAccount.holdings，避免两侧结构差异造成漏算。
 * 不含信用卡额度 / 授信额度。
 *
 * @param db 客户档案
 * @param midRates 币种 → CNY 中间价表（各侧自己的 FX_MID_RATES）
 */
export function aumAssets(db, midRates) {
    let total = db.accounts?.[0]?.balance ?? 0
    for (const row of db.currencyBalances ?? []) {
        const rate = midRates[row.currency]
        if (!rate) continue
        total += Math.round(row.balance * rate)
    }
    // 两侧实际都放在 db.holdings；wealthAccount.holdings 作为兼容口径，
    // 只在没有顶层持仓时使用，避免同一批持仓被算两次。
    const holdings = (db.holdings?.length ? db.holdings : db.wealthAccount?.holdings) ?? []
    for (const holding of holdings) {
        total += holding.marketValue ?? 0
    }
    total += db.cashManagement?.balance ?? 0
    return total
}

/** 旧名保留为别名：评级资产现在就是 AUM 全口径 */
export const ratedAssets = aumAssets

/** 达标最高档；avg 为分 */
export function tierForAssets(avgAssets) {
    let tier = 'standard'
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

/** 档位序号；未知档位按普通会员处理 */
function tierRank(tier) {
    const index = MEMBER_TIERS.indexOf(tier)
    return index < 0 ? 0 : index
}

function tierLabel(tier) {
    return MEMBER_TIER_RULES[tier]?.label ?? MEMBER_TIER_RULES.standard.label
}

/* ------------------------------------------------------------------ 权益 */

/**
 * 当前档位权益集合。业务函数只认这一份，不再各自散写 if-else。
 *
 * 权益递进：高等级含低等级全部权益。
 * 生日礼遇按文档「暂缓」：字段保留但恒为 false。
 */
export function entitlements(tier) {
    const rank = tierRank(tier)
    const atLeast = (t) => rank >= tierRank(t)
    const rule = MEMBER_TIER_RULES[tier] ?? MEMBER_TIER_RULES.standard
    return {
        freeTransferFee: atLeast('gold'),
        freeOverseasRemit: tier === 'diamond',
        vipChannel: atLeast('gold'),
        birthdayGift: false,
        dedicatedManager: atLeast('platinum'),
        dedicatedAdvisor: tier === 'diamond',
        wealthPriority: atLeast('platinum'),
        loungePassesPerYear: LOUNGE_PASSES_PER_YEAR[tier] ?? 0,
        // —— 旧权益并存：制卡 / 换卡费减免、换汇点差折扣 ——
        cardFeeWaiversPerYear: rule.cardFeeFreePerYear,
        cardFeeRate: rule.cardFeeRate,
        includeShipping: rule.includeShipping,
        fxFeeRate: rule.fxFeeRate,
    }
}

/** 当前档位生效权益文案（递进：含低档），供会员中心展示 */
export function memberBenefits(tier) {
    const rank = tierRank(tier)
    const e = entitlements(tier)
    const lines = ['基础银行服务']
    if (e.freeTransferFee) lines.push('境外转账手续费全免')
    if (e.vipChannel) lines.push('客服工单 VIP 优先处理')
    if (e.dedicatedManager) lines.push('专属客户经理')
    if (e.wealthPriority) lines.push('理财产品优先申购')
    if (e.loungePassesPerYear > 0) lines.push(`机场 / 高铁贵宾厅 ${e.loungePassesPerYear} 次 / 年`)
    if (e.dedicatedAdvisor) lines.push('专属理财顾问')
    if (e.freeOverseasRemit) lines.push('境外汇款手续费减免')
    if (e.cardFeeWaiversPerYear > 0) {
        lines.push(`制卡 / 换卡费年度减免 ${e.cardFeeWaiversPerYear} 次${e.includeShipping ? '（含寄送费）' : ''}`)
    }
    if (e.fxFeeRate < 1) lines.push(`换汇点差 ${Math.round(e.fxFeeRate * 10)} 折`)
    if (rank >= tierRank('gold')) lines.push('生日礼遇（规划中）')
    return lines
}

/**
 * 境外转账手续费（分）。FPS 走香港即时结算通道免手续费；
 * 金卡及以上 `freeTransferFee` 为真 → 0。
 */
export function transferFee(db, { amount, scope, isFps = false }) {
    if (isFps || scope !== 'overseas') return 0
    if (entitlements(db.membership?.tier ?? 'standard').freeTransferFee) return 0
    return Math.max(Math.round(amount * OVERSEAS_TRANSFER_RATE), OVERSEAS_TRANSFER_MIN_FEE)
}

/** 本次境外转账费是否被会员权益减免（quote 回给前端展示） */
export function transferFeeWaived(db, { scope, isFps = false }) {
    return !isFps && scope === 'overseas' && entitlements(db.membership?.tier ?? 'standard').freeTransferFee
}

/* ------------------------------------------------------------------ 评定 */

/** 年度权益额度跨年清零（制卡减免次数与贵宾厅核销次数一起重置） */
function ensureBenefitYear(membership, now) {
    const year = Number(beijingMonth(now).slice(0, 4))
    if (membership.benefitUsage?.year !== year) {
        membership.benefitUsage = { year, cardFeeWaiversUsed: 0, loungePassesUsed: 0 }
    }
    membership.benefitUsage.cardFeeWaiversUsed ??= 0
    membership.benefitUsage.loungePassesUsed ??= 0
    return year
}

function pushRecord(membership, label, now) {
    membership.records ??= []
    membership.records.unshift({
        id: `mbr_${now.toString(36)}_${membership.records.length}`,
        label,
        amount: 0,
        createdAt: new Date(now).toISOString(),
    })
}

/**
 * 升级即时：当前实时 AUM 达到更高档门槛，当天就升，不等月度评定。
 *
 * 只在**升**的方向生效；降级走 evaluateMembership 的两期缓冲。
 * @returns 是否升级
 */
export function applyRealtimeUpgrade(db, midRates, now = Date.now()) {
    const membership = db.membership
    if (!membership) return false
    const before = membership.tier ?? 'standard'
    const live = aumAssets(db, midRates)
    const target = tierForAssets(live)
    if (tierRank(target) <= tierRank(before)) return false
    membership.tier = target
    membership.belowPeriods = 0
    membership.since = new Date(now).toISOString()
    pushRecord(membership, `会员升级：${tierLabel(before)} → ${tierLabel(target)}（实时 AUM 达标）`, now)
    db.user.memberTier = target
    return true
}

/**
 * 惰性月度评定：本月还没评过时，用上月日终快照算出月均 AUM。
 *
 * - 达标更高档 → 即时升级；
 * - 低于当前档门槛 → belowPeriods +1，连续 2 个周期才降级（1 个月缓冲）；
 * - 达标当前档 → belowPeriods 清零。
 *
 * 直接改档案：tier / since / evaluation / belowPeriods / benefitUsage / records /
 * user.memberTier。缺快照的日子按 0 计入日均 —— 保守，只能降级不能虚高升级。
 * 新档案没有任何快照时：上月日均计 0，落普通会员。
 *
 * @returns 是否发生了评定（写了评定结果）
 */
export function evaluateMembership(db, now = Date.now()) {
    const month = beijingMonth(now)
    const iso = new Date(now).toISOString()
    const membership = db.membership
    if (!membership) return false
    ensureBenefitYear(membership, now)
    if (membership.evaluation?.for === month) return false

    const prev = previousMonth(month)
    const dim = daysInMonth(prev)
    const prefix = `${prev}-`
    const snaps = (db.assetSnapshots ?? []).filter((s) => s.date.startsWith(prefix))
    const sum = snaps.reduce((total, s) => total + s.assets, 0)
    const avgAssets = Math.round(sum / dim)
    const target = tierForAssets(avgAssets)
    const before = membership.tier ?? 'standard'
    membership.evaluation = {
        for: month,
        avgAssets,
        coveredDays: snaps.length,
        daysInMonth: dim,
        evaluatedAt: iso,
    }

    if (tierRank(target) > tierRank(before)) {
        // 达标更高档：即时升级
        membership.tier = target
        membership.belowPeriods = 0
        membership.since = iso
        pushRecord(membership, `会员评级：${tierLabel(before)} → ${tierLabel(target)}（${prev} 月均 AUM）`, now)
    } else if (tierRank(target) === tierRank(before)) {
        membership.belowPeriods = 0
    } else {
        // 低于当前档门槛：先记一次缓冲，连续两期不达标才降
        membership.belowPeriods = (membership.belowPeriods ?? 0) + 1
        if (membership.belowPeriods >= 2) {
            membership.tier = target
            membership.belowPeriods = 0
            membership.since = iso
            pushRecord(membership, `会员降级：${tierLabel(before)} → ${tierLabel(target)}（连续 2 期月均 AUM 未达标）`, now)
        }
    }
    // memberTier 只是等级的展示投影，同一份口径，不允许两处各写各的
    db.user.memberTier = membership.tier ?? 'standard'
    return true
}

/**
 * 制卡 / 换卡实付报价。
 * 年度剩余减免次数 > 0 才给减免：金卡半价、白金/钻石全免、钻石含寄送费。
 * @returns { listFee, payable, waived }  waived > 0 表示本次会消耗一次减免
 */
export function cardFeeQuote(db, product) {
    const perks = MEMBER_TIER_RULES[db.membership?.tier ?? 'standard']
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
    ensureBenefitYear(m, Date.now())
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
    const perks = MEMBER_TIER_RULES[db.membership?.tier ?? 'standard']
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

/**
 * 核销一次机场 / 高铁贵宾厅额度。
 *
 * @returns 是否核销成功；额度不足返回 false（由 API 层转 409）
 */
export function redeemLoungePass(db, now = Date.now()) {
    const m = db.membership
    if (!m) return false
    ensureBenefitYear(m, now)
    const perYear = entitlements(m.tier ?? 'standard').loungePassesPerYear
    const used = m.benefitUsage.loungePassesUsed ?? 0
    if (used >= perYear) return false
    m.benefitUsage.loungePassesUsed = used + 1
    pushRecord(m, '会员权益：机场/高铁贵宾厅 ×1', now)
    return true
}

/** 降级缓冲提示；不在缓冲期返回 null */
function downgradeWarning(membership, avgAssets) {
    const current = membership.tier ?? 'standard'
    if ((membership.belowPeriods ?? 0) < 1) return null
    if (avgAssets >= MEMBER_TIER_RULES[current].threshold) return null
    const target = tierForAssets(avgAssets)
    return `月均资产低于${tierLabel(current)}门槛，连续 2 个月未达标将降级为${tierLabel(target)}`
}

/** 把 db.membership 整理成对外的 MembershipOverview（派生字段现算，不落库） */
export function membershipOverview(db, midRates) {
    const m = db.membership
    const tier = m.tier ?? 'standard'
    const next = nextTier(tier)
    const ent = entitlements(tier)
    const evaluation = m.evaluation ?? null
    const avgAssets = evaluation?.avgAssets ?? 0
    const year = m.benefitUsage?.year ?? Number(beijingMonth().slice(0, 4))
    const used = m.benefitUsage?.loungePassesUsed ?? 0
    return {
        tier,
        tierLabel: tierLabel(tier),
        aum: avgAssets,
        nextTier: next,
        nextThreshold: next ? MEMBER_TIER_RULES[next].threshold : null,
        benefits: memberBenefits(tier),
        entitlements: ent,
        since: m.since ?? null,
        evaluation,
        downgradeWarning: downgradeWarning(m, avgAssets),
        lounge: {
            year,
            perYear: ent.loungePassesPerYear,
            used,
            remaining: Math.max(0, ent.loungePassesPerYear - used),
        },
        records: m.records ?? [],
    }
}

/**
 * 档案里的会员结构统一为新形态（幂等，可反复跑）：
 * 旧订阅字段（current / plans）与只读 legacy 一律删除；旧 silver 归并为 standard。
 */
export function normalizeMembership(db) {
    const m = db.membership
    if (!m || typeof m !== 'object') {
        db.membership = freshMembership()
        if (db.user) {
            delete db.user.memberLevel
            db.user.memberTier = db.membership.tier
        }
        return
    }
    delete m.current
    delete m.plans
    delete m.legacy
    if (m.tier === 'silver' || m.tier === undefined) m.tier = 'standard'
    m.since ??= null
    m.evaluation ??= null
    m.belowPeriods ??= 0
    m.benefitUsage ??= { year: Number(beijingMonth().slice(0, 4)), cardFeeWaiversUsed: 0, loungePassesUsed: 0 }
    m.benefitUsage.cardFeeWaiversUsed ??= 0
    m.benefitUsage.loungePassesUsed ??= 0
    m.records ??= []
    if (db.user) {
        // 旧字段只做过展示投影，已由 memberTier 取代；存量档案里若还有就删掉
        delete db.user.memberLevel
        db.user.memberTier = m.tier
    }
}

/** 新客户的会员初始结构 */
export function freshMembership() {
    return {
        tier: 'standard',
        since: null,
        evaluation: null,
        belowPeriods: 0,
        benefitUsage: { year: Number(beijingMonth().slice(0, 4)), cardFeeWaiversUsed: 0, loungePassesUsed: 0 },
        records: [],
    }
}

/**
 * 日终资产快照：同一天的重复写入互相覆盖，最后一次写的就是当日日终 AUM。
 * 保留最近 400 天，防无限膨胀。写完顺手做一次「升级即时」检查。
 */
export function recordAssetSnapshot(db, midRates, now = Date.now()) {
    db.assetSnapshots ??= []
    const date = beijingDay(now)
    const assets = aumAssets(db, midRates)
    const existing = db.assetSnapshots.find((s) => s.date === date)
    if (existing) existing.assets = assets
    else db.assetSnapshots.push({ date, assets })
    if (db.assetSnapshots.length > 400) db.assetSnapshots.splice(0, db.assetSnapshots.length - 400)
    applyRealtimeUpgrade(db, midRates, now)
}

/* ------------------------------------------------------------------ 理财优先购 */

/** 热门产品对高等级开放的提前申购窗口（天） */
export const WEALTH_PRIORITY_LEAD_DAYS = 10

/** 提前申购窗口的起算时间（ISO）。两侧目录在模块加载时各取一次，保持未来窗口。 */
export function priorityOpenAt(now = Date.now()) {
    return new Date(now + WEALTH_PRIORITY_LEAD_DAYS * 86_400_000).toISOString()
}

/**
 * 优先购闸门：窗口内只允许 priorityTier 及以上申购。
 * @returns null = 可申购；否则返回拦截原因
 */
export function wealthPriorityGate(product, tier, now = Date.now()) {
    if (!product?.priorityOpenAt || !product?.priorityTier) return null
    if (new Date(product.priorityOpenAt).getTime() <= now) return null
    if (tierRank(tier) >= tierRank(product.priorityTier)) return null
    return {
        priorityTier: product.priorityTier,
        priorityOpenAt: product.priorityOpenAt,
        message: `该产品处于${tierLabel(product.priorityTier)}及以上优先申购期，${product.priorityOpenAt.slice(0, 10)} 后开放全员申购`,
    }
}
