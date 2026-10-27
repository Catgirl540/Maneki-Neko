export function listStaffNotices(customerId) {
  const all = storage.get('support.staffNotices.v1', [])
  return all.filter((n) => n.customerId === customerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * 员工端投递一条留言到客户收件箱（staff-api 经 demo-bank 的 publishSupportNotice 调进来）。
 * 这里只管落盘；筛选、展示都在读的那一侧。
 */
export function appendStaffNotice(notice) {
  const stored = storage.get('support.staffNotices.v1', [])
  const row = { id: nextId('notice'), ...notice }
  stored.push(row)
  storage.set('support.staffNotices.v1', stored)
  return row
}


import { ledgerBalances, findBalance } from '../../shared/account-model.mjs';
import { requireCurrencyBalance, validateRoundup, spendingStatistics, cashFlowStatistics } from '../../shared/account-model.mjs'
import { validateInvestPlan, nextInvestDate, transitionInvestPlan } from '../../shared/invest-plan.mjs'
import { supportGuidance } from '../../shared/support-guidance.mjs'
import { FREE_MERCHANT_NAME_MAX, SPEND_MAX_CENTS, findFreeMerchant, findSpendPlatform } from '../../shared/spend-platforms.mjs'
import { BUDGET_MAX_COUNT, BUDGET_PASS_EXTRA_CENTS, BUDGET_PASS_MAX_FUTURE_DAYS, BUDGET_POINTS_PER_PASS, BudgetError, checkBudgetLimit, budgetPoints, budgetsOverview, shanghaiDay, settleBudgetPoints, validateBudgetInput, validateBudgetPatch, validatePassDay } from '../../shared/budgets.mjs'
import { hashPassword, verifyPassword, needsRehash } from '../passwords.mjs';
import { randomInt } from 'node:crypto';
// Server business rules with normalized SQL persistence; sandbox integrations are explicitly gated.
import { ApiError } from '../api/contract.mjs';
import { CATEGORY_LABEL } from '../lib/categories.mjs';
import { digitsOnly, maskBankAccount, maskFpsValue, validateBankAccount, validateFpsValue, } from '../lib/account.mjs';
import { assertTransferConfirmation } from '../lib/transfer-confirmation.mjs';
import { validateAddress } from '../lib/address.mjs';
import { RISK_ACKNOWLEDGEMENT, WEALTH_INVESTMENT_AGREEMENT, canBuyRisk, suitabilityMessage, } from '../lib/wealth.mjs';
export { RISK_ACKNOWLEDGEMENT };
import { ACCOUNT_OPENING_PLEDGE } from '../lib/account-opening.mjs';
import { formatAmount, formatDate, formatDateTimeFull, formatFxAmount, formatRate, } from '../lib/format.mjs';
import { redactSupportText } from '../../shared/support.mjs';
import { STORAGE_KEYS, storage } from '../lib/storage.mjs';
import { CHANNEL_LABEL, STATUS_LABEL } from '../lib/tx.mjs';
import { maskPhone } from '../lib/format.mjs';
import { CARD_PAYMENT_METHOD, DEFAULT_PAY_PASSWORD, CARD_PRODUCTS, emptyCustomerDomains, lookupFpsRegistration, cardPan, RISK_QUESTIONS, WEALTH_PRODUCTS, toleranceFromScore, FX_QUOTE_TTL, FX_SPREAD, FX_MID_RATES, findBank, PAY_PASSWORD_MAX_ATTEMPTS, applyRealtimeUpgrade, cardFeeQuote, effectiveSpread, entitlements, evaluateMembership, fxRateFor, membershipOverview, recordCardFeeWaiver, redeemLoungePass, transferFee, transferFeeWaived, wealthPriorityGate, OCCUPYING_CARD_STATUSES, loadDb, findProfileByPhone, findProfileByUserId, findRecipientByNumber, persistRelatedProfiles, forgetProfilePhone, activateDb, makeReferenceNo, nextId, persist, toTransactionListItem, withBalances, } from './state.mjs';
import { lookupCardBin } from './card-bin.mjs';
const delay = async () => {};
async function passwordDigest(value) { return hashPassword(value); }
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 户口名称部分隐藏：梁乐怡 → 梁*怡，Ken Ho → K***o */
function hideMiddle(name) {
    if (name.length <= 1)
        return name;
    if (name.length === 2)
        return `${name[0]}*`;
    return `${name[0]}${'*'.repeat(name.length - 2)}${name.slice(-1)}`;
}
/** 大额转账二次确认阈值：¥5,000.00 */
const LARGE_TRANSFER = 500_000;
/**
 * 银行账户转账单笔上限：¥1,000,000.00
 * （2026-10-12 抬高：延迟到账阈值已设到 ¥500,000，上限必须高过它，否则永远进不了窗口）
 */
const BANK_SINGLE_LIMIT = 100_000_000;
/** FPS（转数快）未登记收款人单笔上限：¥600,000.00（同上，要留出阈值之上的空间） */
const FPS_SINGLE_LIMIT = 60_000_000;
/** 历史收款人簿上限：每次转账成功都自动记账，超出后裁掉最久未用的 */
const MAX_PAYEES = 50;
/**
 * 安全码在界面上可见的时长（秒）。
 * 到点必须自动遮盖 —— 摊在那里不管，等于把「验一次身」这件事作废。
 */
const CARD_SECRET_REVEAL_SECONDS = 60;
const CHANNEL_NOTE = {
    bank: '境内转账实时到账免手续费；境外按 0.1% 计费（最低 ¥50.00）',
    fps: '转数快（FPS）按手机号 / 邮箱 / FPS ID 即时转账，免手续费，通常 5 秒内到账',
};
function findAccount(id) {
    const account = findBalance(loadDb(), id);
    if (!account)
        throw new ApiError('账户不存在', 404, 'ACCOUNT_NOT_FOUND');
    return withDerived(account);
}
/** 本地月份键，与 createdAt 的时区保持一致 */
function localMonth(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
/** 本地日 YYYY-MM-DD。不能用 iso.slice(0, 10) —— 那是 UTC 日，晚上会差一天 */
function localDay(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/**
 * 派生字段在读取时实时计算，而不是落库：
 * 这样转账 / 转入之后 monthNetChange 立刻是准的。
 */
function withDerived(account) {
    const month = localMonth(new Date().toISOString());
    const net = loadDb()
        .transactions.filter((t) => t.accountId === account.id && localMonth(t.createdAt) === month)
        .reduce((sum, t) => sum + t.signedAmount, 0);
    return { ...account, accountNo: loadDb().accounts[0].accountNo, label: account.id === loadDb().accounts[0].id ? account.label : `${account.currency} 余额`, monthNetChange: net };
}
/**
 * 生成换汇报价。扣账币种与收款币种相同时返回 undefined —— 不需要换汇。
 * 报价带 quotedAt / quoteTtlSeconds，调用方（UI）据此倒计时并在过期后重新询价。
 */
function buildFxQuote(db, from, to, fromAmount) {
    if (from === to || fromAmount <= 0)
        return undefined;
    const rate = fxRateFor(db, from, to, FX_MID_RATES, FX_SPREAD);
    return {
        fromCurrency: from,
        toCurrency: to,
        rate,
        fromAmount,
        toAmount: Math.round(fromAmount * rate),
        spread: effectiveSpread(db, FX_SPREAD),
        quoteTtlSeconds: FX_QUOTE_TTL,
        quotedAt: new Date().toISOString(),
    };
}
/** 安全评分由已开启的风控规则实时推导，避免读路径出现不一致 */
function withDerivedSecurity() {
    const db = loadDb();
    const enabledRules = db.security.riskRules.filter((r) => r.enabled).length;
    const score = Math.min(100, 60 + (db.security.identityVerified ? 12 : 0) + enabledRules * 6);
    return {
        ...db.security,
        score,
        level: score >= 90 ? '防护优秀' : score >= 75 ? '防护良好' : '建议加强',
    };
}
/**
 * 持仓的市值与收益实时从产品净值推导，不落库 ——
 * 净值一变，持仓和总资产要立刻跟着变，存下来只会不一致。
 */
function withDerivedHoldings(db) {
    return db.holdings.map((h) => {
        const product = WEALTH_PRODUCTS.find((p) => p.code === h.productCode);
        const nav = product?.nav ?? h.costNav;
        const marketValue = Math.round(h.shares * nav);
        const profit = marketValue - h.principal;
        return {
            ...h,
            marketValue,
            profit,
            profitRate: h.principal === 0 ? 0 : profit / h.principal,
            closed: h.redeemableAt != null && Date.now() < new Date(h.redeemableAt).getTime(),
        };
    });
}
/**
 * 风险测评结果。
 * 监管：超过一年未评估的投资者，再次购买前必须重新评估
 * （《理财公司理财产品销售管理暂行办法》第三十一条）——
 * 所以过期等同于未测评，购买会被拦下。
 */
function withDerivedRisk(db) {
    const raw = db.riskAssessment;
    if (!raw.done)
        return { done: false, level: null, score: null, assessedAt: '', expiresAt: '', expired: false, status: 'unassessed', eligible: false };
    const expiry = Date.parse(raw.expiresAt);
    const expired = !Number.isFinite(expiry) || Date.now() >= expiry;
    return { ...raw, expired, status: expired ? 'expired' : 'valid', eligible: !expired };
}
function productByCode(code) {
    const product = WEALTH_PRODUCTS.find((p) => p.code === code);
    if (!product)
        throw new ApiError('理财产品不存在', 404, 'PRODUCT_NOT_FOUND');
    return product;
}
/** 昨日收益：按各持仓份额 × 最近两日净值差 推导，不落库 */
function yesterdayProfitOf(holdings) {
    return holdings.reduce((sum, h) => {
        const product = WEALTH_PRODUCTS.find((p) => p.code === h.productCode);
        const series = product?.navHistory ?? [];
        if (series.length < 2)
            return sum;
        const diff = series[series.length - 1].nav - series[series.length - 2].nav;
        return sum + Math.round(h.shares * diff);
    }, 0);
}
/** 期限文案 → N 天后的 ISO 时间："90 天" → 90 天后 09:00 */
function inDaysFromNow(term) {
    const days = Number(term.replace(/\D/g, '')) || 90;
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
}
/** 一次性费用（申购费 / 赎回费）。内扣：从申赎金额里直接扣掉 */
function oneOffFee(product, amount, kind) {
    const item = product.transactionFees.find((f) => f.label.startsWith(kind));
    if (!item || item.rate === 0)
        return { fee: 0, label: '免费' };
    return { fee: Math.round(amount * item.rate), label: item.label };
}
/**
 * 理财申赎走的资金账户。
 *
 * 开理财账户时用户**指定**过一个账户（`wealthAccount.settlementAccountId`），
 * 界面也三处明说「申购扣款与赎回到账都走你指定的资金账户」——
 * 所以这里必须用它，不能图省事取 `accounts[0]`：那样用户指定了 B 账户，
 * 钱却从 A 账户扣，界面在说谎。
 *
 * 取不到时退回第一个账户只是**兜底**（老数据 / 账户被销户）：真实后端应当直接报错，
 * 这里静默退回是为了不让演示卡死；真接后端时这一条要改成抛 `SETTLEMENT_ACCOUNT_NOT_FOUND`。
 */
/** 根据每月发薪日推算下一次发薪日（YYYY-MM-DD）。按本地历法格式化：toISOString 是 UTC，东八区会落回前一日 */
function nextPaydayFrom(day) {
    const now = new Date();
    const candidate = new Date(now.getFullYear(), now.getMonth(), day);
    if (candidate.getTime() <= now.getTime())
        candidate.setMonth(candidate.getMonth() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${candidate.getFullYear()}-${pad(candidate.getMonth() + 1)}-${pad(candidate.getDate())}`;
}
function settlementAccount(db) { return requireCurrencyBalance(db, db.wealthAccount.settlementAccountId); }
function findCard(id) {
    const card = loadDb().cards.find((c) => c.id === id);
    if (!card)
        throw new ApiError('银行卡不存在', 404, 'CARD_NOT_FOUND');
    return card;
}
/**
 * 新发卡的安全码。
 *
 * 安全码是**每张卡各自**的（同一账户换一张卡就换一个码），所以新卡不能沿用旧卡的。
 * 真后端由发卡系统生成；这里随机一个 3 位数，格式对即可 ——
 * 检查工具断言的是「3 位数字且不等于别的卡」，不是具体值。
 */
function newCardCvv() {
    return String(randomInt(100, 1000));
}
let txClassifier = null;
/** 后台任务落库要开单元工作（scoped 投影）；由 createBankApi 注入，缺省直接执行。 */
let unitRunner = (work) => work();
/**
 * 后台分类：记账与响应都不等分类器 —— 流水先以 other 落库并标 pending，
 * 分类完成后回写 category 并把状态改成 done；全部模型重试失败标 failed（分类保持 other）。
 * 分类器内部已按「每模型 3 次 × 模型链」重试，这里不再叠加。
 */
const classifying = new Map();
function applyClassification(txId, category, failed) {
    const db = loadDb();
    const tx = db.transactions.find((row) => row.id === txId);
    if (!tx)
        return;
    if (!failed && category)
        tx.category = category;
    tx.classificationState = failed ? 'failed' : 'done';
    persist();
}
function scheduleClassification(txId, input) {
    if (!txClassifier) {
        applyClassification(txId, 'other', false);
        return;
    }
    if (classifying.has(txId))
        return;
    const task = unitRunner(async () => {
        try {
            const detail = typeof txClassifier.detailed === 'function'
                ? await txClassifier.detailed(input)
                : { category: await txClassifier(input), failed: false };
            applyClassification(txId, detail.category, detail.failed === true);
        }
        catch {
            applyClassification(txId, 'other', true);
        }
    }).catch(() => {}).finally(() => classifying.delete(txId));
    classifying.set(txId, task);
}
/** 进程重启后接着分没分完的流水；分类器不可用时直接标 failed，不留永久「分类中」 */
function resumePendingClassifications() {
    const rows = loadDb().transactions.filter((row) => row.classificationState === 'pending');
    for (const row of rows) {
        if (!txClassifier) {
            row.classificationState = 'failed';
            continue;
        }
        scheduleClassification(row.id, {
            counterparty: row.counterparty,
            memo: row.memo,
            direction: row.direction,
            channel: row.detail?.channel,
            amount: row.amount,
            currency: row.detail?.settleCurrency,
        });
    }
    persist();
}
/**
 * 追加一笔台账。渠道与支付方式由调用方显式给出 ——
 * 这样每笔新交易的凭证要素都是真的，而不是事后从分类里猜出来的。
 * 交易前后余额不落库：它们随账户余额变化，由 getTransaction 读取时回推。
 *
 * 分类：调用方明确给出 salary / transfer 等语义的直接落库；
 * 'other' 的支出流水交给模型自动分类（失败保留 other），换汇等 businessType 不参与。
 */
async function pushTransaction(tx, detail, save = true, identity) {
    const db = loadDb();
    const id = identity?.transactionId ?? nextId('txn');
    const created = {
        ...tx,
        id,
        createdAt: identity?.createdAt ?? tx.createdAt,
        detail: { ...detail, referenceNo: identity?.referenceNo ?? makeReferenceNo(id), balanceBefore: 0, balanceAfter: 0 },
    };
    if (txClassifier && created.category === 'other' && created.direction === 'out' && !created.businessType
        && tx.classificationState !== 'pending') {
        try {
            const category = await txClassifier({
                counterparty: created.counterparty,
                memo: created.memo,
                direction: created.direction,
                channel: detail.channel,
                amount: created.amount,
                currency: detail.settleCurrency ?? findBalance(db, created.accountId)?.currency,
            });
            if (category) created.category = category;
        }
        catch {
            // 分类失败不阻塞记账，保持 other
        }
    }
    db.transactions.unshift(created);
    if (save)
        persist();
    return created;
}
/**
 * 改动余额必须直接改台账里的那一行。
 * 注意不能接收 findAccount() 的返回值 —— 那是 withDerived 生成的副本，
 * 改副本只会让接口响应里余额变了、库里没变，刷新后金额又跳回去。
 */
function applyBalance(accountId, delta, save = true) {
    const row = findBalance(loadDb(), accountId);
    if (!row)
        throw new ApiError('账户不存在', 404, 'ACCOUNT_NOT_FOUND');
    if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(row.balance + delta) || !Number.isSafeInteger(row.available + delta) || row.balance + delta < 0 || row.available + delta < 0)
        throw new ApiError('余额变动无效', 400, 'INVALID_AMOUNT');
    row.balance += delta;
    row.available += delta;
    if (save)
        persist();
}
/* ---------------------------------------------------------------- 智能客服 */
const humanTickets = new Map();
const humanRequests = new Map();
const humanOwner = () => loadDb().user.id;
const humanRows = () => humanTickets.get(humanOwner()) ?? [];
const humanTicket = (id) => {
    const row = humanRows().find(row => row.ticketId === id);
    if (!row)
        throw new ApiError('工单不存在', 404, 'NOT_FOUND');
    return row;
};
function cannedReply(text) {
    const message = {
        id: nextId('msg'),
        role: 'agent',
        createdAt: new Date().toISOString(),
        ...supportGuidance(text),
    };
    return { message, canned: true };
}
/* --------------------------------------------------------- 支付密码 / 收费 */
/**
 * 校验支付密码。
 * 付钱这一步必须单独验证：登录密码泄露不等于能扣钱。
 * 连续输错达阈值即锁定，要求重新登录（真实系统还会要求去柜台或人脸解锁）。
 */
export function verifyPayPassword(input) {
    const db = loadDb();
    if (db.payPasswordFailures >= PAY_PASSWORD_MAX_ATTEMPTS) {
        throw new ApiError('支付密码已锁定，请重新登录后再试', 423, 'PAY_PASSWORD_LOCKED');
    }
    if (!/^\d{6}$/.test(input)) {
        throw new ApiError('请输入 6 位数字支付密码', 400, 'INVALID_PAY_PASSWORD');
    }
    if (!verifyPassword(input, db.payPassword)) {
        db.payPasswordFailures += 1;
        persist();
        const left = PAY_PASSWORD_MAX_ATTEMPTS - db.payPasswordFailures;
        throw new ApiError(left > 0 ? `支付密码不正确，还可尝试 ${left} 次` : '支付密码连续错误，已锁定，请重新登录', 401, 'BAD_PAY_PASSWORD');
    }
    if (needsRehash(db.payPassword)) db.payPassword = hashPassword(input);
    db.payPasswordFailures = 0;
    persist();
}
/**
 * 扣制卡费用并落一笔流水。
 * 收钱必须留痕 —— 只改余额不记账，对账单上就凭空少了一笔。
 */
async function chargeCardFee(amount, label) {
    if (amount <= 0)
        return;
    const db = loadDb();
    const account = db.accounts[0];
    if (amount > account.available) {
        throw new ApiError('储蓄账户可用余额不足，请先转入后再申请', 400, 'INSUFFICIENT_FUNDS');
    }
    applyBalance(account.id, -amount);
    await pushTransaction({
        accountId: account.id,
        direction: 'out',
        amount,
        signedAmount: -amount,
        counterparty: '制卡工本费',
        memo: label,
        category: 'other',
        createdAt: new Date().toISOString(),
        status: 'success',
    }, {
        channel: 'account',
        paymentMethod: account.label,
        accountLabel: account.label,
        accountNo: account.accountNo,
        settleCurrency: account.currency,
        location: '招财猫银行 App',
        remark: label,
    });
}
/* ------------------------------------------------------------- 导出：列定义 */
/**
 * 流水导出的列定义。
 * 导出哪些字段、金额怎么表达，是银行的账务与合规口径，不是前端展示选择 ——
 * 所以由后端（这里是 mock）给，前端只落文件。
 * 注意：手续费在台账里是**独立的一笔**（对方户名「手续费」），
 * 所以没有单独的「手续费」列，避免同一笔支出被重复计一次。
 */
const EXPORT_COLUMNS = [
    { key: 'createdAt', label: '交易时间' },
    { key: 'direction', label: '收支' },
    { key: 'amount', label: '交易金额' },
    { key: 'currency', label: '币种' },
    { key: 'originAmount', label: '原交易金额' },
    { key: 'exchangeRate', label: '记账汇率' },
    { key: 'counterpartyName', label: '对方户名' },
    { key: 'counterpartyAccountNo', label: '对方账号' },
    { key: 'counterpartyBank', label: '对方机构' },
    { key: 'channel', label: '交易渠道' },
    { key: 'category', label: '交易类型' },
    { key: 'status', label: '交易状态' },
    { key: 'balanceAfter', label: '交易后余额' },
    { key: 'referenceNo', label: '交易编号' },
    { key: 'remark', label: '附言' },
];
/* ------------------------------------------------------------------- 实现 */
/**
 * @param options.reviewThreshold - 大额转账延迟到账阈值（整数分）。
 *   传了才会启用在途窗口（真后端演示，清单 §9）；不传 = 一律立即完成（浏览器 mock 模式）。
 *   **可以传函数**（2026-10-12）：阈值改成运行时配置后，必须每笔现读，不能建实例时冻死。
 * @param options.holdWindowMs - 在途窗口时长（毫秒）。默认 5 分钟；演示时调小。
 * @param options.settleImmediately - 转账当场落 success，不进「模拟清算」。
 *   在途窗口到期执行时用：这笔已经等过一轮窗口了，到账就该落定，
 *   不该再挂 3 秒清算——否则「自动到账」变成延迟到账完又延迟一次。
 */
export function createBankBusinessApi(options) {
    const security = options?.security;
    // 交易自动分类器（OpenRouter），未注入时全部保持调用方给的分类
    txClassifier = options?.classify ?? null;
    unitRunner = typeof options?.runInUnit === 'function' ? options.runInUnit : (work) => work();
    // 重启恢复：把上次没分完的流水接着分（或标 failed），不让它们永远停在「分类中」
    resumePendingClassifications();
    const thresholdSource = options?.reviewThreshold;
    const readThreshold = async () => typeof thresholdSource === 'function' ? await thresholdSource() : thresholdSource;
    const holdWindowMs = options?.holdWindowMs ?? 5 * 60_000;
    const settleImmediately = options?.settleImmediately === true;
    const exchangeQuotes = new Map();
    return {
        async login(phone, password, smsCode) {
            await delay();
            const db = loadDb();
            if (!/^\d{11}$/.test(phone)) {
                throw new ApiError('请输入 11 位手机号', 400, 'INVALID_PHONE');
            }
            const target = await findProfileByPhone(phone);
            if (target === null || !verifyPassword(password, target.passwordDigest)) {
                throw new ApiError('手机号或密码不正确', 401, 'BAD_CREDENTIALS');
            }
            // 验证码在**密码之后**校验：先报密码错，免得"这个手机号存不存在"
            // 能被"验证码错误"这个提示反推出来。
            // 错误码与状态码**照抄其他几处短信校验**（开户 / 开理财户 / 换手机号）：
            // 同一件事已经有约定的 code 就别另造一个，否则后端要同时实现两套。
            await security.verifySms(phone, smsCode);
            db.pendingSms = null;
            persist();
            // activateDb() 装入的是存储里最新一份，不是这里的 target——
            // 字段必须在切档之后改，改在前面会被最新一份盖掉（见 activateDb 注释）。
            activateDb(target);
            const live = loadDb();
            live.pendingSms = null;
            if (needsRehash(live.passwordDigest)) live.passwordDigest = hashPassword(password);
            // 重新登录即解除支付密码锁定
            // A new login does not reset a locked payment credential.
            persist();
            return { token: `mock.${btoa(phone)}.${Date.now()}`, user: live.user };
        },
        async register(req) {
            await delay(760);
            const db = loadDb();
            const phone = digitsOnly(req.phone);
            if (!/^1[3-9]\d{9}$/.test(phone))
                throw new ApiError('请输入 11 位手机号', 400, 'INVALID_PHONE');
            if (await findProfileByPhone(phone) !== null)
                throw new ApiError('该手机号已注册', 409, 'PHONE_EXISTS');
            if (req.password.length < 6 || req.password.length > 20) {
                throw new ApiError('登录密码需为 6–20 个字符', 400, 'WEAK_PASSWORD');
            }
            if (!/^\d{6}$/.test(req.paymentPassword)) {
                throw new ApiError('请设置 6 位数字支付密码', 400, 'INVALID_PAY_PASSWORD');
            }
            if (!req.holderName.trim())
                throw new ApiError('请填写姓名', 400, 'NAME_REQUIRED');
            if (!/^\d{17}[\dXx]$/.test(req.idNumber.trim()))
                throw new ApiError('请输入 18 位身份证号', 400, 'INVALID_ID');
            await security.verifySms(phone, req.smsCode);
            if (!req.faceTicket)
                throw new ApiError('请先完成人脸识别', 400, 'FACE_REQUIRED');
            if (req.pledge.trim() !== ACCOUNT_OPENING_PLEDGE) {
                throw new ApiError('请确认合法开立和使用账户承诺', 400, 'PLEDGE_REQUIRED');
            }
            const now = new Date().toISOString();
            let newAccountNo;
            do {
                newAccountNo = `882000${String(Math.floor(1e12 + Math.random() * 9e12))}`;
            } while (await findRecipientByNumber(newAccountNo));
            const account = {
                id: `acc_${Date.now()}`,
                kind: 'savings',
                label: '储蓄账户',
                accountNo: newAccountNo,
                currency: 'CNY',
                balance: 0,
                available: 0,
                interestRate: 0.0155,
                monthNetChange: 0,
            };
            const next = structuredClone(db);
            next.user = {
                id: `u_${Date.now()}`,
                name: req.holderName.trim(),
                phone,
                memberTier: 'standard',
                avatarInitial: req.holderName.trim().slice(0, 1),
            };
            next.passwordDigest = await passwordDigest(req.password);
            next.accounts = [account]; next.currencyBalances = []; next.retiredBalances = []; next.accountAliases = {}; next.accountNumberAliases = {};
            Object.assign(next, emptyCustomerDomains(next.user, account.id));
            next.transactions = [];
            // 新用户不能继承当前档案的演示收款人或支付密码状态。
            next.payees = [];
            next.payPassword = hashPassword(req.paymentPassword);
            next.payPasswordFailures = 0;
            next.cards = [];
            next.cardSecrets = {};
            next.autoDebits = [];
            next.holdings = [];
            next.pendingSms = null;
            next.wealthAccount = { opened: false, accountNo: '', openedAt: '', settlementAccountId: '', agreementSignedAt: '', riskLevelAtOpening: 'C1' };
            next.riskAssessment = { done: false, level: 'C1', score: 0, assessedAt: '', expiresAt: '', expired: true };
            next.security = { ...next.security, score: 72, level: '基础防护', devices: [], logs: [], identityVerified: true };
            activateDb(next);
            return { token: `mock.${btoa(phone)}.${Date.now()}`, user: next.user, account, openedAt: now };
        },
        async logout() {
            await delay(120);
            // 退出只结束客户端会话。账户资料属于持久数据，不能随登出一起删除。
        },
        async profile() {
            await delay(140);
            const db = loadDb();
            if (evaluateMembership(db)) persist();
            return db.user;
        },
        async listAccounts() {
        await delay(160);
        const db = loadDb();
        return db.accounts.map(account => ({ ...withDerived(account), currencyBalances: ledgerBalances(db).map(row => ({ ...withDerived(row), accountNo: account.accountNo, label: row.currency === account.currency ? account.label : `${row.currency} 余额` })) }));
    },
        async getAccount(id) {
            await delay(140);
            return findAccount(id);
        },
        async listTransactions(accountId, query = {}) {
        await delay(180);
        const { page = 1, size = 8, category = 'all', keyword = '', direction = 'all', from, to } = query;
        accountId = findAccount(accountId).id;
        let rows = loadDb().transactions.filter((t) => t.accountId === accountId);
        if (category !== 'all')
            rows = rows.filter((t) => t.category === category);
        // 收支方向必须在这里过滤：前端对当前页过滤会在分页下给出错误的条数与页数。
        if (direction !== 'all')
            rows = rows.filter((t) => t.direction === direction);
        // 时间范围按本地自然日闭区间，口径同导出（localDay 而不是 UTC 切片）。
        if (from || to)
            rows = rows.filter((t) => {
                const day = localDay(t.createdAt);
                return (!from || day >= from) && (!to || day <= to);
            });
        if (keyword.trim()) {
            const kw = keyword.trim().toLowerCase();
            rows = rows.filter((t) => t.counterparty.toLowerCase().includes(kw) || t.memo.toLowerCase().includes(kw));
        }
        // 多币种对账：账户是单币种的，币种对不上就没有可对账的流水
        if (query.currency && query.currency !== 'all') {
            const acc = findBalance(loadDb(), accountId);
            if (acc && acc.currency !== query.currency)
                rows = [];
        }
        const start = (page - 1) * size;
        const result = {
            items: rows.slice(start, start + size).map(toTransactionListItem),
            page,
            size,
            total: rows.length,
        };
        return result;
    },
        async getTransaction(id) {
        await delay(200);
        const db = loadDb();
        const rec = db.transactions.find((t) => t.id === id);
        if (!rec)
            throw new ApiError('交易不存在或已超出可查询期限', 404, 'TX_NOT_FOUND');
        // 余额按账户**当前**余额回推，所以在转账 / 转入之后看到的仍然是对的
        const account = findBalance(db, rec.accountId);
        const ordered = withBalances(db.transactions
            .filter((t) => t.accountId === rec.accountId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), account?.balance ?? 0);
        return ordered.find((t) => t.id === id) ?? rec;
    },
        async exportTransactions(accountId, query = {}) {
        await delay(320);
        const db = loadDb();
        const account = findAccount(accountId);
        accountId = account.id;
        // 交易后余额按当前余额回推：导出的表里余额列必须自洽，否则对不了账
        const ordered = withBalances(db.transactions
            .filter((t) => t.accountId === accountId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), account.balance);
        const { from, to, category = 'all', keyword = '', direction = 'all' } = query;
        const kw = keyword.trim().toLowerCase();
        // 币种口径同列表：记账分区币种对不上就是没有可导出的流水。
        const currencyMismatch = !!query.currency && query.currency !== 'all' && account.currency !== query.currency;
        const rows = currencyMismatch ? [] : ordered.filter((t) => {
            const day = localDay(t.createdAt);
            if (from && day < from)
                return false;
            if (to && day > to)
                return false;
            if (category !== 'all' && t.category !== category)
                return false;
            if (direction !== 'all' && t.direction !== direction)
                return false;
            if (kw &&
                !t.counterparty.toLowerCase().includes(kw) &&
                !t.memo.toLowerCase().includes(kw)) {
                return false;
            }
            return true;
        });
        // 时间范围按**实际导出的数据**首尾给，而不是回显请求参数
        const days = rows.map((t) => localDay(t.createdAt)).sort();
        const range = days.length ? { from: days[0], to: days[days.length - 1] } : null;
        const stamp = range
            ? `${range.from.replace(/-/g, '')}-${range.to.replace(/-/g, '')}`
            : dayKey(new Date());
        return {
            batchNo: `EXP${Date.now().toString().slice(-10)}`,
            generatedAt: new Date().toISOString(),
            fileName: `招财猫银行_交易流水_${stamp}.csv`,
            total: rows.length,
            range,
            columns: EXPORT_COLUMNS,
            rows: rows.map((t) => ({
                createdAt: formatDateTimeFull(t.createdAt),
                direction: t.direction === 'in' ? '收入' : '支出',
                amount: formatAmount(t.amount),
                currency: t.detail.settleCurrency,
                originAmount: t.detail.originAmount != null && t.detail.originCurrency
                    ? formatFxAmount(t.detail.originAmount, t.detail.originCurrency)
                    : '',
                exchangeRate: t.detail.exchangeRate != null && t.detail.originCurrency
                    ? `1 ${t.detail.originCurrency} = ${t.detail.settleCurrency} ${formatRate(t.detail.exchangeRate)}`
                    : '',
                counterpartyName: t.detail.counterpartyName ?? t.counterparty,
                counterpartyAccountNo: t.detail.counterpartyAccountNo ?? '',
                counterpartyBank: t.detail.counterpartyBank ?? '',
                channel: CHANNEL_LABEL[t.detail.channel],
                category: CATEGORY_LABEL[t.category],
                status: STATUS_LABEL[t.status],
                balanceAfter: formatAmount(t.detail.balanceAfter),
                referenceNo: t.detail.referenceNo,
                remark: t.detail.remark ?? '',
            })),
        };
    },
        async getReceipt(id) {
            await delay(260);
            const rec = loadDb().transactions.find((t) => t.id === id);
            if (!rec)
                throw new ApiError('交易不存在或已超出可查询期限', 404, 'TX_NOT_FOUND');
            return {
                fileName: `招财猫银行_电子回单_${rec.detail.referenceNo}.pdf`,
                // 演示环境没有服务端 PDF 能力，url 给 null —— 这是能力声明，不是错误。
                // 真后端在这里返回带签名的临时下载地址即可，前端会优先用它。
                url: null,
                expiresAt: null,
            };
        },
        async deposit(accountId, amount, channel) {
        await delay(260);
        if (!Number.isSafeInteger(amount) || amount <= 0)
            throw new ApiError('转入金额必须大于 0', 400, 'INVALID_AMOUNT');
        if (amount > 5_000_000)
            throw new ApiError('单笔转入上限 ¥50,000.00', 400, 'LIMIT_EXCEEDED');
        const account = findAccount(accountId);
        accountId = account.id;
        applyBalance(accountId, amount, false);
        const salary = channel === 'salary';
        await pushTransaction({
            accountId,
            direction: 'in',
            amount,
            signedAmount: amount,
            counterparty: salary ? '工资入账' : '主动转入',
            memo: salary ? '工资入账' : '从绑定卡转入',
            category: salary ? 'salary' : 'other',
            createdAt: new Date().toISOString(),
            status: 'success',
        }, {
            channel: salary ? 'account' : 'card',
            paymentMethod: salary ? '工资代发' : CARD_PAYMENT_METHOD,
            accountLabel: account.label,
            accountNo: account.accountNo,
            settleCurrency: account.currency,
            counterpartyName: salary ? '上海云栖科技有限公司' : undefined,
            counterpartyBank: salary ? undefined : '中国建设银行',
            location: '招财猫银行 App',
            remark: salary ? '本月薪资' : '从绑定卡转入',
        }, false);
        persist();
        return findAccount(accountId);
    },
        async listBanks() {
            await delay(100);
            return loadDb().banks;
        },
        /**
         * 我的收款信息。
         *
         * 由后端拼而不是前端自己凑：账户号归**银行账户转账**用，转数快标识归**转数快**用，
         * 两者填的位置都不一样；而且要拿哪张账户、户名用中文还是英文，都是账户侧的规则。
         */
        async getReceivingInfo() {
        await delay(140);
        const db = loadDb();
        const account = ledgerBalances(db).find(a => db.fpsRegistrations.some(r => r.accountId === a.id)) ?? db.accounts[0];
        return {
            holder: db.user.name,
            accountNo: db.accounts[0].accountNo,
            accountLabel: db.accounts[0].label,
            bankName: db.fpsRegistrations.some(r => r.accountId === account.id) ? '招财猫银行（香港模拟通道）' : '招财猫银行',
            bankRegion: db.fpsRegistrations.some(r => r.accountId === account.id) ? 'HK' : 'CN',
            fpsRegistered: db.fpsRegistrations.some(r => r.accountId === account.id),
            fpsMobile: db.fpsRegistrations.find(r => r.accountId === account.id && r.idType === 'mobile')?.id ?? '',
            fpsId: db.fpsRegistrations.find(r => r.accountId === account.id && r.idType === 'fpsid')?.id ?? '',
            fpsRegistrations: db.fpsRegistrations.filter(r => r.accountId === account.id),
        };
    },
        /**
         * 卡 BIN 查询。规则本身在 card-bin.ts（纯函数，能被 tools/check-card-bin.mjs 直接测），
         * 这里只负责模拟一次网络往返。
         */
        async resolveCardBin({ digits, region }) {
            await delay(140);
            return lookupCardBin(loadDb().banks, digits, region);
        },
        async listPayees() {
            await delay(140);
            return [...loadDb().payees].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
        },
        async deletePayee(id) {
            await delay(160);
            const db = loadDb();
            const index = db.payees.findIndex((p) => p.id === id);
            if (index < 0)
                throw new ApiError('收款人不存在', 404, 'PAYEE_NOT_FOUND');
            db.payees.splice(index, 1);
            persist();
        },
        async resolveFps(idType, fpsId) {
            await delay(620);
            const value = (fpsId ?? '').replace(/\s/g, '');
            const hit = await lookupFpsRegistration(idType, value);
            if (!hit) {
                return {
                    registered: false,
                    reason: '该标识未登记转数快。请核对标识，或改用「收款账户」方式转账。',
                };
            }
            return {
                registered: true,
                // 回显时部分隐藏户口名称，与真实转数快一致（梁乐怡 → 梁*怡）
                name: hideMiddle(hit.name),
                bankName: hit.bankName,
                bankCode: hit.bankCode,
                bankRegion: 'HK',
                bankCount: hit.bankCount,
            };
        },
        async registerFps(req) {
            const db = loadDb();
            const account = findAccount(req.accountId);
            if (req.region !== 'HK' || req.currency !== 'HKD' || account.currency !== 'HKD')
                throw new ApiError('模拟登记仅支持香港通道的港币账户', 400, 'FPS_UNSUPPORTED');
            if (!['mobile', 'email', 'fpsid'].includes(req.idType) || typeof req.id !== 'string' || validateFpsValue(req.idType, req.id))
                throw new ApiError('FPS 标识格式无效', 400, 'INVALID_FPS_ID');
            const id = req.id.replace(/\s/g, '').toLowerCase();
            if ((req.idType === 'mobile' && !/^[4-9]\d{7}$/.test(id)) || (req.idType === 'fpsid' && !/^\d{7}$/.test(id)))
                throw new ApiError('FPS 标识格式无效', 400, 'INVALID_FPS_ID');
            if (await lookupFpsRegistration(req.idType, id))
                throw new ApiError('该标识已登记', 409, 'FPS_DUPLICATE');
            verifyPayPassword(req.paymentPassword);
            db.fpsRegistrations.push({ idType: req.idType, id, accountId: account.id, region: 'HK', currency: 'HKD', registeredAt: new Date().toISOString() });
            persist();
            return this.getReceivingInfo();
        },
        async quoteTransfer(req) {
        await delay(160);
        const db = loadDb();
        // 询价必须针对具体账户：可用余额与扣账币种都取决于它
        const current = findAccount(req.fromAccountId);
        const isFps = req.channel === 'fps';
        const singleLimit = isFps ? FPS_SINGLE_LIMIT : BANK_SINGLE_LIMIT;
        // FPS 走香港即时结算通道，免手续费；境外转账费按会员等级减免（金卡+）
        const fee = transferFee(db, { amount: req.amount, scope: req.scope, isFps });
        const feeWaived = transferFeeWaived(db, { scope: req.scope, isFps });
        const bank = findBank(db.banks, req.bankCode, req.bankRegion);
        const etaText = isFps
            ? '预计 5 秒内到账'
            : req.scope === 'overseas'
                ? '预计 1 个工作日到账'
                : bank?.internal // 本行内部转账实时到账；不要再裸比较行别代码（两地会撞号）
                    ? '实时到账'
                    : '预计 2 小时内到账';
        // 扣账币种 ≠ 收款币种时才需要换汇
        const fx = buildFxQuote(db, current.currency, req.payeeCurrency ?? current.currency, req.amount);
        const requiresConfirm = req.amount >= LARGE_TRANSFER;
        return {
            fee,
            ...(feeWaived ? { feeWaived: true } : {}),
            etaText,
            maxAmount: Math.min(current.available, singleLimit),
            singleLimit,
            requiresConfirm,
            confirmReason: requiresConfirm
                ? `单笔金额超过 ¥${(LARGE_TRANSFER / 100).toLocaleString('zh-CN')}，需二次确认`
                : undefined,
            channelNote: CHANNEL_NOTE[req.channel],
            ...(fx ? { fx } : {}),
        };
    },
        async resolveTransferRecipient(req) {
            await delay(180);
            const digits = digitsOnly(req.accountOrCardNo ?? '');
            const error = validateBankAccount(digits);
            if (error)
                throw new ApiError(error, 400, 'INVALID_ACCOUNT_NO');
            if (req.bankCode === 'LCB' && req.bankRegion === 'CN') {
                const found = await findRecipientByNumber(digits);
                if (!found)
                    throw new ApiError('本行未找到该收款账户或已激活银行卡', 404, 'RECIPIENT_NOT_FOUND');
                if (req.payeeName?.trim() && req.payeeName.trim() !== found.profile.user.name) {
                    throw new ApiError('收款人姓名与该账户登记户名不一致', 400, 'PAYEE_NAME_MISMATCH');
                }
                const name = found.profile.user.name;
                return {
                    kind: 'internal',
                    holderNameMasked: name.length > 1 ? `${name[0]}*${name.slice(-1)}` : name,
                    accountNoMasked: maskBankAccount(digits),
                    ...(found.card ? { cardLast4: found.card.last4 } : {}),
                };
            }
            return { kind: 'external', accountNoMasked: maskBankAccount(digits) };
        },
        async submitTransfer(req) {
        await delay(420);
        const db = loadDb();
        const account = findAccount(req.fromAccountId);
        req = { ...req, fromAccountId: account.id };
        const isFps = req.channel === 'fps';
        if (!Number.isSafeInteger(req.amount) || req.amount <= 0) {
            throw new ApiError('转账金额必须是大于 0 的整数分', 400, 'INVALID_AMOUNT');
        }
        // —— 收款标识校验 ——
        // 跨境支付通无论用哪种汇款方式都要指定收款银行（款项要路由到具体收款行）
        let identifier;
        if (isFps) {
            const method = req.fpsMethod ?? 'mobile';
            if (!req.payeeBankCode)
                throw new ApiError('请选择收款银行', 400, 'BANK_REQUIRED');
            // 3 位清算代码两地会撞号（内地 307 平安 / 香港 307 ABN AMRO），
            // 所以必须 (region, code) 成对校验
            if (!findBank(db.banks, req.payeeBankCode, req.payeeBankRegion)) {
                throw new ApiError('收款银行不存在', 400, 'BANK_NOT_FOUND');
            }
            if (method === 'account') {
                const err = validateFpsValue('account', req.payeeAccountNo ?? '');
                if (err)
                    throw new ApiError(err, 400, 'INVALID_ACCOUNT_NO');
                if (!req.payeeName.trim())
                    throw new ApiError('请填写收款户名', 400, 'PAYEE_REQUIRED');
                identifier = maskFpsValue('account', req.payeeAccountNo ?? '');
            }
            else {
                const err = validateFpsValue(method, req.fpsId ?? '');
                if (err)
                    throw new ApiError(err, 400, 'INVALID_FPS_ID');
                const registered = await lookupFpsRegistration(method, req.fpsId ?? '');
                if (!registered)
                    throw new ApiError('该标识未登记转数快', 400, 'FPS_NOT_REGISTERED');
                if (registered.bankCode !== req.payeeBankCode || req.payeeBankRegion !== 'HK' || hideMiddle(registered.name) !== req.payeeName)
                    throw new ApiError('FPS 登记资料不匹配', 409, 'RECIPIENT_CHANGED');
                identifier = maskFpsValue(method, req.fpsId ?? '');
            }
        }
        else {
            if (!req.payeeName.trim())
                throw new ApiError('请填写收款人', 400, 'PAYEE_REQUIRED');
            const err = validateBankAccount(req.payeeAccountNo ?? '');
            if (err)
                throw new ApiError(err, 400, 'INVALID_ACCOUNT_NO');
            identifier = maskBankAccount(req.payeeAccountNo ?? '');
        }
        const singleLimit = isFps ? FPS_SINGLE_LIMIT : BANK_SINGLE_LIMIT;
        // 与 quoteTransfer 同一份会员口径：报价与提交的费用校验必须一致
        const fee = transferFee(db, { amount: req.amount, scope: req.scope, isFps });
        const total = req.amount + fee;
        const quotedFx = buildFxQuote(db, account.currency, req.payeeCurrency ?? account.currency, req.amount);
        assertTransferConfirmation(req, fee, account.currency, quotedFx, options?.acceptedQuote);
        if (req.confirmedRecipient) {
            const registered = req.fpsMethod && req.fpsMethod !== 'account' ? await lookupFpsRegistration(req.fpsMethod, req.fpsId ?? '') : undefined;
            if (!isFps || req.fpsMethod === 'account' || !registered ||
                hideMiddle(registered.name) !== req.confirmedRecipient.name || registered.bankCode !== req.confirmedRecipient.bankCode ||
                req.confirmedRecipient.bankRegion !== 'HK' || req.payeeName !== req.confirmedRecipient.name ||
                req.payeeBankCode !== req.confirmedRecipient.bankCode || req.payeeBankRegion !== 'HK') {
                throw new ApiError('FPS 收款登记已变化，请重新核对', 409, 'RECIPIENT_CHANGED');
            }
        }
        if (req.amount > singleLimit) {
            throw new ApiError(`单笔转账上限 ¥${(singleLimit / 100).toLocaleString('zh-CN')}`, 400, 'LIMIT_EXCEEDED');
        }
        if (total > account.available) {
            throw new ApiError('账户可用余额不足', 400, 'INSUFFICIENT_FUNDS');
        }
        // —— 大额转账延迟到账窗口（清单 §9，只在真后端演示开启） ——
        // 钱**先冻结**（available 扣、balance 不扣）：窗口到点一定付得出去，
        // 不会出现「到点没钱」这种用户完全控制不了的失败。
        // 窗口内用户可撤销、员工可拦截；都没人动 → 自动到账。
        // 到账走 submitTransfer 同一条业务路（删占位后重提交），不复制业务规则。
        const fpsRecipient = isFps && req.fpsMethod !== 'account' ? await lookupFpsRegistration(req.fpsMethod ?? 'mobile', req.fpsId ?? '') : undefined;
        const fpsProfile = fpsRecipient?.customerId ? await findProfileByUserId(fpsRecipient.customerId) : null;
        const fpsBalance = fpsProfile && fpsRecipient?.balanceId ? findBalance(fpsProfile, fpsRecipient.balanceId) : null;
        if (fpsRecipient?.customerId && (!fpsProfile || !fpsBalance))
            throw new ApiError('收款币种余额不可用', 409, 'RECIPIENT_NOT_FOUND');
        const recipient = fpsProfile && fpsBalance ? { profile: fpsProfile, account: fpsBalance, card: null } : !isFps && req.scope === 'domestic' && req.payeeBankCode === 'LCB' && req.payeeBankRegion === 'CN' ? await findRecipientByNumber(req.payeeAccountNo ?? '') : null;
        if (!isFps && req.scope === 'domestic' && req.payeeBankCode === 'LCB' &&
            req.payeeBankRegion === 'CN' && !recipient) {
            throw new ApiError('本行未找到该收款账户或已激活银行卡', 404, 'RECIPIENT_NOT_FOUND');
        }
        if (recipient) {
            if (recipient.profile.user.id === db.user.id) {
                throw new ApiError('付款和收款账户不能相同', 400, 'SAME_ACCOUNT');
            }
            if (recipient.account.currency !== (isFps ? req.payeeCurrency : account.currency)) {
                throw new ApiError('本行账户币种不一致', 400, 'CURRENCY_MISMATCH');
            }
            if (req.payeeName.trim() !== (isFps ? hideMiddle(recipient.profile.user.name) : recipient.profile.user.name)) {
                throw new ApiError('收款人姓名与该账户登记户名不一致', 400, 'PAYEE_NAME_MISMATCH');
            }
        }
        const reviewThreshold = await readThreshold();
        if (reviewThreshold !== undefined && total >= reviewThreshold) {
            const holdUntil = new Date(Date.now() + holdWindowMs).toISOString();
            // 本金与手续费一起预留，避免手续费在窗口内被花掉；到账时才实际扣款。
            const senderRow = findBalance(loadDb(), req.fromAccountId);
            if (senderRow) {
                senderRow.available -= total;
                if (senderRow.available < 0) {
                    senderRow.available += total;
                    throw new ApiError('账户可用余额不足', 400, 'INSUFFICIENT_FUNDS');
                }
            }
            const held = await pushTransaction({
                accountId: req.fromAccountId,
                direction: 'out',
                amount: req.amount,
                signedAmount: -req.amount,
                counterparty: `转账 · ${req.payeeName.trim()}`,
                memo: req.memo || `转账至${req.payeeName.trim()}（处理中）`,
                category: 'transfer',
                createdAt: new Date().toISOString(),
                status: 'pending',
                pendingReason: 'inflight',
                holdUntil,
            }, {
                channel: 'transfer',
                paymentMethod: account.label,
                accountLabel: account.label,
                accountNo: account.accountNo,
                settleCurrency: account.currency,
                counterpartyName: req.payeeName.trim(),
                counterpartyAccountNo: identifier,
                location: '招财猫银行 App',
                remark: req.memo.trim() || undefined,
            }, false);
            held.heldRequest = { ...req };
            held.heldFrozenAmount = total;
            persist();
            return {
                transactionId: held.id,
                referenceNo: held.detail.referenceNo,
                amount: req.amount,
                fee,
                channel: req.channel,
                identifier,
                createdAt: held.createdAt,
                settlementStatus: 'pending',
                pendingReason: 'inflight',
                holdUntil,
                ...(quotedFx ? { fx: quotedFx } : {}),
            };
        }
        if (recipient) {
            const sender = findBalance(db, account.id);
            sender.balance -= req.amount;
            sender.available -= req.amount;
            recipient.account.balance += quotedFx?.toAmount ?? req.amount;
            recipient.account.available += quotedFx?.toAmount ?? req.amount;
            const isOwnAccount = recipient.profile.user.id === db.user.id;
            const createdAt = new Date().toISOString();
            const outgoing = await pushTransaction({
                accountId: sender.id, direction: 'out', amount: req.amount,
                signedAmount: -req.amount, counterparty: `转账 · ${req.payeeName.trim()}`,
                memo: req.memo || `本行转账至尾号 ${recipient.account.accountNo.slice(-4)}`,
                category: 'transfer', createdAt, status: 'success',
            }, {
                channel: isOwnAccount ? 'account' : 'transfer', paymentMethod: sender.label,
                accountLabel: sender.label, accountNo: db.accounts[0].accountNo,
                settleCurrency: sender.currency, counterpartyName: req.payeeName.trim(),
                counterpartyAccountNo: maskBankAccount(req.payeeAccountNo ?? ''),
                counterpartyBank: '招财猫银行', location: '招财猫银行 App',
                remark: req.memo.trim() || undefined,
            }, false, options?.settlementIdentity);
            const incomingId = nextId('txn');
            recipient.profile.transactions.unshift({
                id: incomingId,
                accountId: recipient.account.id, direction: 'in', amount: quotedFx?.toAmount ?? req.amount,
                signedAmount: quotedFx?.toAmount ?? req.amount, counterparty: `本行转入 · ${db.user.name}`,
                memo: req.memo || `本行转入自尾号 ${sender.accountNo.slice(-4)}`,
                category: 'transfer', createdAt, status: 'success',
                detail: {
                    referenceNo: makeReferenceNo(incomingId), balanceBefore: 0, balanceAfter: 0,
                    channel: isOwnAccount ? 'account' : 'transfer', paymentMethod: recipient.account.label,
                    accountLabel: recipient.account.label, accountNo: recipient.profile.accounts[0].accountNo,
                    settleCurrency: recipient.account.currency, counterpartyName: db.user.name,
                    counterpartyAccountNo: maskBankAccount(db.accounts[0].accountNo),
                    counterpartyBank: '招财猫银行', location: '招财猫银行 App',
                    remark: req.memo.trim() || undefined,
                },
            });
            try {
                persistRelatedProfiles(isOwnAccount ? [] : [recipient.profile]);
            }
            catch (error) {
                sender.balance += req.amount;
                sender.available += req.amount;
                recipient.account.balance -= quotedFx?.toAmount ?? req.amount;
                recipient.account.available -= quotedFx?.toAmount ?? req.amount;
                db.transactions.splice(db.transactions.findIndex((row) => row.id === outgoing.id), 1);
                recipient.profile.transactions.splice(recipient.profile.transactions.findIndex((row) => row.id === incomingId), 1);
                throw error;
            }
            return {
                transactionId: outgoing.id,
                referenceNo: outgoing.detail.referenceNo,
                amount: req.amount, fee: 0, channel: req.channel,
                identifier: maskBankAccount(req.payeeAccountNo ?? ''), createdAt,
                settlementStatus: 'success', ...(quotedFx ? { fx: quotedFx } : {}),
            };
        }
        // 使用本次提交计算并通过确认条件校验的价格；带确认条件的指令不静默改价。
        const fx = quotedFx;
        applyBalance(req.fromAccountId, -total, false);
        const bank = findBank(db.banks, req.payeeBankCode, req.payeeBankRegion);
        const tx = await pushTransaction({
            accountId: req.fromAccountId,
            direction: 'out',
            amount: req.amount,
            signedAmount: -req.amount,
            counterparty: `转账 · ${req.payeeName.trim()}`,
            memo: req.memo ||
                (isFps
                    ? `转数快 FPS 转账至 ${identifier}`
                    : `${req.scope === 'overseas' ? '境外' : '境内'}转账至${bank?.shortName ?? '对方银行'}`),
            category: 'transfer',
            createdAt: new Date().toISOString(),
            // 外行转账走「模拟清算」：钱已扣、单据先挂 pending，几秒后由扫账翻 success。
            // 必须带 pendingReason='clearing'——扫账靠它和「大额在途窗口」区分。
            // 没有这个字段的 pending 是孤儿数据，由 settleClearingTransactions 兜底结清，
            // 绝不允许停在 pending 上把钱吞掉（2026-10-12 事故根因）。
            status: isFps || settleImmediately ? 'success' : 'pending',
            ...(isFps || settleImmediately ? {} : { pendingReason: 'clearing' }),
        }, {
            channel: 'transfer',
            paymentMethod: account.label,
            accountLabel: account.label,
            accountNo: account.accountNo,
            settleCurrency: account.currency,
            counterpartyName: req.payeeName.trim(),
            // 收款标识已脱敏：转账详情里只回显掩码，不落明文
            counterpartyAccountNo: identifier,
            counterpartyBank: bank?.name,
            location: '招财猫银行 App',
            remark: req.memo.trim() || undefined,
            // 换汇后回单按银行口径存：原交易金额 = 收款币金额，
            // 记账汇率 = 1 原币（收款币）= ? 记账币（扣账币），即报价的倒数
            ...(fx
                ? {
                    originAmount: fx.toAmount,
                    originCurrency: fx.toCurrency,
                    exchangeRate: 1 / fx.rate,
                    exchangeRateNote: `已包括 ${(fx.spread * 100).toFixed(2)}% 换汇点差`,
                }
                : {}),
        }, false, options?.settlementIdentity);
        if (fee > 0) {
            // 手续费是独立的一笔台账，所以转账详情里不再重复列示 ——
            // 余额回推也就自然对得上（两笔各扣一次）
            await pushTransaction({
                accountId: req.fromAccountId,
                direction: 'out',
                amount: fee,
                signedAmount: -fee,
                counterparty: '手续费',
                memo: '境外转账手续费',
                category: 'other',
                createdAt: new Date().toISOString(),
                status: 'success',
            }, {
                channel: 'account',
                paymentMethod: account.label,
                accountLabel: account.label,
                accountNo: account.accountNo,
                settleCurrency: account.currency,
                location: '招财猫银行 App',
                remark: `境外转账手续费 · ${req.payeeName.trim()}`,
            }, false);
        }
        // 收款人簿：同标识视为同一人，只更新时间；否则新增
        const existing = db.payees.find((p) => `${p.channel}:${p.fpsMethod ?? ''}:${p.fpsId ?? ''}:${p.accountNo ?? ''}` ===
            `${req.channel}:${req.fpsMethod ?? ''}:${(req.fpsId ?? '').replace(/\s/g, '')}:${req.payeeAccountNo ?? ''}`);
        if (existing) {
            existing.lastUsedAt = new Date().toISOString();
            existing.name = req.payeeName.trim();
        }
        else {
            db.payees.unshift({
                id: nextId('pay'),
                name: req.payeeName.trim(),
                channel: req.channel,
                scope: isFps ? 'overseas' : req.scope,
                lastUsedAt: new Date().toISOString(),
                bankCode: req.payeeBankCode,
                bankRegion: req.payeeBankRegion,
                bankName: bank?.name ?? '未知银行',
                ...(isFps
                    ? {
                        fpsMethod: req.fpsMethod ?? 'mobile',
                        fpsId: (req.fpsId ?? '').replace(/\s/g, ''),
                        payeeCurrency: req.payeeCurrency ?? 'CNY',
                        ...(req.fpsMethod === 'account'
                            ? { accountNo: (req.payeeAccountNo ?? '').trim() }
                            : {}),
                    }
                    : { accountNo: (req.payeeAccountNo ?? '').replace(/\D/g, '') }),
            });
        }
        // 收款人簿封顶：超出时裁掉最久未用的尾部
        db.payees.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
        db.payees.length = Math.min(db.payees.length, MAX_PAYEES);
        persist();
        return {
            transactionId: tx.id,
            referenceNo: tx.detail.referenceNo,
            amount: req.amount,
            fee,
            channel: req.channel,
            identifier,
            createdAt: tx.createdAt,
            settlementStatus: isFps || settleImmediately ? 'success' : 'pending',
            // 区分「模拟清算」和「大额在途窗口」：前端据此显示「已提交模拟清算」
            // 还是「转账处理中」+ 倒计时。缺了它两种 pending 就没法分辨。
            ...(isFps || settleImmediately ? {} : { pendingReason: 'clearing' }),
            ...(fx ? { fx } : {}),
        };
    },
        /**
         * 撤销在途转账（清单 §9.3）：延迟到账窗口内用户随时可以自己撤回。
         * 资金侧只解除冻结——这笔指令从未执行过，不存在"退款"。
         */
        async recallTransfer(transactionId) {
            await delay(320);
            const rec = loadDb().transactions.find((t) => t.id === transactionId);
            if (!rec)
                throw new ApiError('交易不存在', 404, 'NOT_FOUND');
            if (rec.status !== 'pending' || rec.pendingReason !== 'inflight' || !rec.holdUntil || !Number.isFinite(Date.parse(rec.holdUntil)) || Date.parse(rec.holdUntil) <= Date.now()) {
                throw new ApiError('这笔转账已不在可撤销状态', 409, 'NOT_RECALLABLE');
            }
            await settleHeldTransfer(transactionId, 'recalled', '用户主动撤销');
            const after = loadDb().transactions.find((t) => t.id === transactionId);
            return {
                transactionId,
                status: after?.status ?? 'failed',
                memo: after?.memo ?? '已撤销',
            };
        },
        async listCards() {
            await delay(160);
            return loadDb().cards;
        },
        async listCardProducts() {
            await delay(140);
            const db = loadDb();
            if (evaluateMembership(db)) persist();
            return CARD_PRODUCTS.map((product) => ({
                ...product,
                held: db.cards.some((c) => c.network === product.network && OCCUPYING_CARD_STATUSES.includes(c.status)),
                feeQuote: cardFeeQuote(db, product),
            }));
        },
        async openCard(req) {
            await delay(700);
            const db = loadDb();
            if (evaluateMembership(db)) persist();
            const product = CARD_PRODUCTS.find((p) => p.code === req.productCode);
            if (!product)
                throw new ApiError('卡产品不存在', 404, 'PRODUCT_NOT_FOUND');
            // 每个卡组织至多一张：先拦名额再谈收费，拒绝的申请不收一分钱
            if (db.cards.some((c) => c.network === product.network && OCCUPYING_CARD_STATUSES.includes(c.status))) {
                throw new ApiError(`您已持有${product.network === 'visa' ? 'Visa' : '银联'}卡组织的银行卡，每位客户各至多一张，可在卡片管理中办理换卡`, 409, 'CARD_NETWORK_LIMIT');
            }
            // 先验密码再收钱，顺序不能反
            verifyPayPassword(req.paymentPassword);
            const addressError = validateAddress(req.address);
            if (addressError)
                throw new ApiError(addressError, 400, 'INVALID_ADDRESS');
            const quote = cardFeeQuote(db, product);
            const fee = quote.payable;
            await chargeCardFee(fee, `${product.name} 制卡费${product.deliveryFee > 0 ? '（含寄送费）' : ''}`);
            if (quote.waived > 0) recordCardFeeWaiver(db, quote.waived);
            // 显式构造而不是 spread 旧卡：新卡的字段应当全部明确，不继承别人的地址与费用
            const fresh = {
                id: nextId('card'),
                // 新卡绑定储蓄账户：卡本身不装钱，扣款走这个账户
                accountId: db.accounts[0].id,
                productName: product.name,
                last4: String(Math.floor(1000 + Math.random() * 8999)),
                cardholder: db.cards[0]?.cardholder ?? 'LIN XIAOMAN',
                expiry: '05/31',
                theme: product.theme,
                network: product.network,
                kind: product.kind,
                status: 'pending',
                onlinePayment: false,
                overseasPayment: false,
                dailyLimit: 200_000,
                shippingAddress: req.address,
                issuingFee: fee,
                replacedFromId: null,
            };
            db.cards.push(fresh);
            db.cardSecrets[fresh.id] = { cvv: newCardCvv(), pan: cardPan(fresh.network, fresh.last4) };
            persist();
            return fresh;
        },
        async setCardLock(id, locked) {
            await delay(300);
            const card = findCard(id);
            if (card.status === 'replaced')
                throw new ApiError('该卡已换卡，无法操作', 400, 'CARD_REPLACED');
            card.status = locked ? 'locked' : 'active';
            if (locked) {
                card.onlinePayment = false;
                card.overseasPayment = false;
            }
            persist();
            return card;
        },
        /**
         * 激活卡片：收到实体卡后启用（待激活 → 使用中）。
         * 与真实银行一致，激活属于敏感操作，要验支付密码；已使用中/已锁定的卡不走这里。
         */
        async activateCard(id, paymentPassword) {
            await delay(300);
            const card = findCard(id);
            // 先验身再看状态：反过来的话，密码不对的人也能从报错里探到卡状态
            verifyPayPassword(paymentPassword);
            if (card.status === 'replaced')
                throw new ApiError('该卡已换卡，无法激活', 409, 'CARD_REPLACED');
            if (card.status !== 'pending')
                throw new ApiError('该卡已是使用中状态，无需激活', 409, 'CARD_ALREADY_ACTIVE');
            card.status = 'active';
            persist();
            return card;
        },
        async replaceCard(id, req) {
            await delay(650);
            const db = loadDb();
            if (evaluateMembership(db)) persist();
            const card = findCard(id);
            if (card.status === 'replaced') {
                throw new ApiError('该卡已换卡，无法重复操作', 400, 'CARD_REPLACED');
            }
            verifyPayPassword(req.paymentPassword);
            const addressError = validateAddress(req.address);
            if (addressError)
                throw new ApiError(addressError, 400, 'INVALID_ADDRESS');
            // 换卡按同卡组织的产品定价；会员制卡费减免同步适用；本行自有卡没有对应产品，用固定工本费
            const product = CARD_PRODUCTS.find((p) => p.network === card.network);
            const quote = cardFeeQuote(db, product ?? { issuingFee: 2_000, deliveryFee: 0 });
            const fee = quote.payable;
            await chargeCardFee(fee, `${card.productName} 换卡工本费`);
            if (quote.waived > 0) recordCardFeeWaiver(db, quote.waived);
            // 换卡是一笔原子操作：旧卡停用和新卡接替在同一次落库里完成
            card.status = 'replaced';
            const fresh = {
                ...card,
                id: nextId('card'),
                last4: String(Math.floor(1000 + Math.random() * 8999)),
                status: 'pending',
                onlinePayment: false,
                overseasPayment: false,
                shippingAddress: req.address,
                issuingFee: fee,
                replacedFromId: card.id,
            };
            db.cards.push(fresh);
            // 换发的新卡是另一张卡，安全码必须重新生成，不能沿用旧卡的
            db.cardSecrets[fresh.id] = { cvv: newCardCvv(), pan: cardPan(fresh.network, fresh.last4) };
            persist();
            return fresh;
        },
        /**
         * 查看卡安全码。
         *
         * 单独一个接口、单独验一次支付密码，而不是塞进卡列表 —— 卡列表是渲染用的，
         * 里面带上 CVV 就等于每次打开卡片页都把安全码传到前端（PCI DSS 也不允许授权后留存）。
         * 所以 `listCards()` 返回的 `BankCard` 里根本没有这个字段，
         * 安全码只出现在这次响应里，前端也不落 localStorage。
         */
        async revealCardSecrets(id, paymentPassword) {
            await delay(360);
            const db = loadDb();
            const card = db.cards.find((c) => c.id === id);
            if (!card)
                throw new ApiError('银行卡不存在', 404, 'CARD_NOT_FOUND');
            // 先验身再看卡状态：反过来的话，密码不对的人也能从报错文案里探到卡的状态
            verifyPayPassword(paymentPassword);
            if (card.status === 'pending') {
                throw new ApiError('卡还在寄送途中，收到并激活后才能查看安全码', 409, 'CARD_NOT_DELIVERED');
            }
            if (card.status === 'replaced') {
                throw new ApiError('这张卡已换发，旧卡信息不再可用', 409, 'CARD_REPLACED');
            }
            const secret = db.cardSecrets[id];
            if (!secret)
                throw new ApiError('该卡暂无安全码记录', 404, 'CARD_SECRET_MISSING');
            return {
                pan: secret.pan,
                expiry: card.expiry,
                cvv: secret.cvv,
                revealSeconds: CARD_SECRET_REVEAL_SECONDS,
            };
        },
        async updateCardSettings(id, patch) {
            await delay(240);
            const card = findCard(id);
            if (card.status === 'locked' && (patch.onlinePayment || patch.overseasPayment)) {
                throw new ApiError('卡片已锁定，请先解锁', 400, 'CARD_LOCKED');
            }
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ApiError('无效卡设置', 400, 'INVALID_CARD_SETTINGS');
            const allowed = ['onlinePayment', 'overseasPayment', 'dailyLimit'];
            if (Object.keys(patch).some(k => !allowed.includes(k))) throw new ApiError('卡设置包含不可修改字段', 400, 'INVALID_CARD_SETTINGS');
            for (const key of ['onlinePayment', 'overseasPayment']) {
                if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new ApiError('无效支付设置', 400, 'INVALID_CARD_SETTINGS');
            }
            if (patch.dailyLimit !== undefined && (!Number.isSafeInteger(patch.dailyLimit) || patch.dailyLimit < 0)) throw new ApiError('无效限额', 400, 'INVALID_DAILY_LIMIT');
            Object.assign(card, patch);
            persist();
            return card;
        },
        /**
         * 模拟消费：预设商户上刷卡，从卡绑定的资金账户扣款并落一笔卡类流水。
         *
         * 卡只是支付工具，钱在账户里 —— 扣的是 `card.accountId` 对应的币种分区，
         * 不新建账户、不动其他币种。分类走与真实刷卡相同的分类器（先问再落库），
         * 商户类别限额按分类取桶；分类器不可用时落 other。
         */
        async spendOnCard(id, input) {
            await delay(320);
            const db = loadDb();
            const card = findCard(id);
            if (card.status === 'locked')
                throw new ApiError('卡片已锁定，请先解锁再消费', 409, 'CARD_LOCKED');
            if (card.status === 'pending')
                throw new ApiError('卡还在寄送途中，收到并激活后才能消费', 409, 'CARD_NOT_DELIVERED');
            if (card.status === 'replaced')
                throw new ApiError('这张卡已换发，旧卡不再消费', 409, 'CARD_REPLACED');
            if (card.paymentEnabled === false)
                throw new ApiError('该卡已关闭消费，请在卡片设置中开启', 409, 'CARD_PAYMENT_DISABLED');
            if (!card.onlinePayment)
                throw new ApiError('该卡已关闭线上支付，请先在卡片设置中开启', 409, 'CARD_ONLINE_PAYMENT_DISABLED');
            const preset = findSpendPlatform(input?.platform);
            const free = preset ? null : findFreeMerchant(input?.platform);
            if (!preset && !free)
                throw new ApiError('消费平台不存在', 404, 'SPEND_PLATFORM_NOT_FOUND');
            // 自由商家（自定义/Stripe）：商户名由请求给出，单行、2–40 字
            let merchantName = preset?.name;
            if (free) {
                const raw = typeof input?.merchant === 'string' ? input.merchant.trim() : '';
                if (raw.length < 2 || raw.length > FREE_MERCHANT_NAME_MAX
                    || [...raw].some(ch => (ch.codePointAt(0) ?? 0) < 32 || ch.codePointAt(0) === 127))
                    throw new ApiError(`商户名称需为 2–${FREE_MERCHANT_NAME_MAX} 字的单行文本`, 400, 'INVALID_MERCHANT');
                merchantName = raw;
            }
            const platform = preset ?? {
                ...free,
                name: merchantName,
                merchantId: `${free.merchantIdPrefix}${String(Date.now()).slice(-9)}`,
            };
            const amount = input?.amount;
            if (!Number.isSafeInteger(amount) || amount <= 0)
                throw new ApiError('消费金额必须大于 0', 400, 'INVALID_AMOUNT');
            if (amount > SPEND_MAX_CENTS)
                throw new ApiError(`单笔模拟消费上限 ¥${formatAmount(SPEND_MAX_CENTS)}`, 400, 'LIMIT_EXCEEDED');
            // 账单详情：店铺/商品说明，写进流水摘要；单行、去首尾空白、限长
            const note = typeof input?.note === 'string' ? input.note.trim() : '';
            if (note.length > 80 || [...note].some(ch => (ch.codePointAt(0) ?? 0) < 32 || ch.codePointAt(0) === 127))
                throw new ApiError('账单详情最多 80 字，且不能包含换行或控制字符', 400, 'INVALID_NOTE');
            const memo = note ? `${platform.name} · ${note}` : `${platform.name} 消费`;
            // 支出预算：命中就先拦，额度是业务规则，不建子账户也不动其他币种
            try {
                checkBudgetLimit(db.budgets, db.budgetPasses, db.transactions, platform.merchantId, amount, shanghaiDay(Date.now()));
            }
            catch (error) {
                if (error instanceof BudgetError)
                    throw new ApiError(error.message, error.status, error.code);
                throw error;
            }
            const balance = findBalance(db, card.accountId);
            if (!balance)
                throw new ApiError('账户不存在', 404, 'ACCOUNT_NOT_FOUND');
            const onlineLimit = card.channelLimits?.online;
            if (Number.isSafeInteger(onlineLimit) && amount > onlineLimit)
                throw new ApiError(`超过本卡线上消费单笔限额 ¥${formatAmount(onlineLimit)}`, 409, 'CHANNEL_LIMIT_EXCEEDED');
            // 分类是后台任务：写账时还不知道类别，商户类别限额按「其他」桶校验（不回溯）
            const merchantLimit = card.merchantLimits?.other;
            if (Number.isSafeInteger(merchantLimit) && amount > merchantLimit)
                throw new ApiError(`超过本卡该商户类别的单笔限额 ¥${formatAmount(merchantLimit)}`, 409, 'MERCHANT_LIMIT_EXCEEDED');
            const today = dayKey(new Date());
            const usedToday = db.transactions
                .filter((tx) => tx.detail?.cardId === card.id && tx.direction === 'out' && tx.status === 'success'
                    && dayKey(new Date(tx.createdAt)) === today)
                .reduce((sum, tx) => sum + tx.amount, 0);
            if (usedToday + amount > card.dailyLimit)
                throw new ApiError(`超过本卡单日限额 ¥${formatAmount(card.dailyLimit)}（今日已消费 ¥${formatAmount(usedToday)}）`, 409, 'DAILY_LIMIT_EXCEEDED');
            if (balance.available < amount)
                throw new ApiError('账户可用余额不足', 409, 'INSUFFICIENT_FUNDS');
            applyBalance(card.accountId, -amount, false);
            const classificationState = txClassifier ? 'pending' : 'done';
            const transaction = await pushTransaction({
                accountId: card.accountId,
                direction: 'out',
                amount,
                signedAmount: -amount,
                counterparty: platform.name,
                memo,
                category: 'other',
                classificationState,
                createdAt: new Date().toISOString(),
                status: 'success',
            }, {
                channel: 'card',
                paymentMethod: `${card.productName} 尾号 ${card.last4}`,
                accountLabel: balance.label,
                accountNo: balance.accountNo,
                settleCurrency: balance.currency,
                cardId: card.id,
                merchantId: platform.merchantId,
                merchantCountry: platform.country,
                merchantCity: platform.city,
                location: platform.location,
                counterpartyBank: platform.counterpartyBank,
                merchantNote: note || undefined,
                remark: `模拟消费 · ${platform.name}${note ? ` · ${note}` : ''}`,
            }, false);
            persist();
            if (classificationState === 'pending') {
                scheduleClassification(transaction.id, {
                    counterparty: platform.name,
                    memo,
                    direction: 'out',
                    channel: 'card',
                    amount,
                    currency: balance.currency,
                });
            }
            return { transaction, category: 'other', classificationState, available: balance.available, currency: balance.currency };
        },
        /* ------------------------------------------------------------ 开户 */
        async sendSmsCode(phone) {
            return security.sendSms(phone);
        },
        /* ------------------------------------------------------------ 理财 */
        async listWealthProducts() {
            await delay(220);
            const today = dayKey(new Date());
            return WEALTH_PRODUCTS.map((p) => ({ ...p, navDate: today }));
        },
        async getWealthProduct(code) {
            await delay(160);
            return { ...productByCode(code), navDate: dayKey(new Date()) };
        },
        async getWealthOverview() {
            await delay(240);
            const db = loadDb();
            // 未开立理财账户时，不存在可归属给用户的持仓与收益。
            // 旧演示数据可能残留 holdings，但不能在账户闸门前泄露成“收益”。
            const holdings = db.wealthAccount.opened ? withDerivedHoldings(db) : [];
            const totalValue = holdings.reduce((sum, h) => sum + h.marketValue, 0);
            const totalPrincipal = holdings.reduce((sum, h) => sum + h.principal, 0);
            return {
                account: db.wealthAccount,
                totalValue,
                totalPrincipal,
                totalProfit: totalValue - totalPrincipal,
                yesterdayProfit: yesterdayProfitOf(holdings),
                holdings,
                risk: withDerivedRisk(db),
            };
        },
        async openWealthAccount(req) {
            await delay(720);
            const db = loadDb();
            if (db.wealthAccount.opened) {
                throw new ApiError('理财账户已开立，无需重复开户', 400, 'ALREADY_OPENED');
            }
            // 使用已登录账户的实名状态，不接受客户端重新提交或替换身份资料。
            if (!db.security.identityVerified || !db.user.name.trim()) {
                throw new ApiError('当前账户尚未完成实名验证', 403, 'IDENTITY_REQUIRED');
            }
            await security.verifySms(db.user.phone, req.smsCode);
            if (!req.faceTicket)
                throw new ApiError('请先完成人脸识别', 400, 'FACE_REQUIRED');
            // —— 风险测评：开投资户的前置，不是可选项 ——
            const risk = withDerivedRisk(db);
            if (!risk.done || risk.expired || risk.level === null) {
                throw new ApiError('请先完成风险承受能力评估', 403, 'RISK_ASSESSMENT_REQUIRED');
            }
            // —— 签署投资协议 ——
            if (req.agreement.trim() !== WEALTH_INVESTMENT_AGREEMENT) {
                throw new ApiError('请阅读并签署投资协议', 400, 'AGREEMENT_REQUIRED');
            }
            // —— 绑定资金账户：申赎款项都走它 ——
            const settlement = requireCurrencyBalance(db, req.settlementAccountId);
            if (!settlement)
                throw new ApiError('请选择资金账户', 400, 'SETTLEMENT_REQUIRED');
            // 兼容旧演示档案：仅在开户成功时清理未开户期间残留的持仓。
            db.holdings = [];
            db.pendingSms = null;
            const now = new Date().toISOString();
            db.wealthAccount = {
                opened: true,
                accountNo: `9${String(Math.floor(1e11 + Math.random() * 8e11))}`.slice(0, 12),
                openedAt: now,
                settlementAccountId: settlement.id,
                agreementSignedAt: now,
                riskLevelAtOpening: risk.level,
            };
            persist();
            return db.wealthAccount;
        },
        async listRiskQuestions() {
            await delay(140);
            return RISK_QUESTIONS;
        },
        async submitRiskAssessment(answers) {
            await delay(500);
            const db = loadDb();
            if (answers.length !== RISK_QUESTIONS.length) {
                throw new ApiError('请完成全部题目', 400, 'INCOMPLETE_ANSWERS');
            }
            let score = 0;
            RISK_QUESTIONS.forEach((q, i) => {
                const option = q.options[answers[i]];
                if (!option)
                    throw new ApiError('答案无效', 400, 'INVALID_ANSWER');
                score += option.score;
            });
            const level = toleranceFromScore(score);
            const now = new Date();
            const expires = new Date(now);
            expires.setFullYear(expires.getFullYear() + 1);
            db.riskAssessment = {
                done: true,
                level,
                score,
                assessedAt: now.toISOString(),
                expiresAt: expires.toISOString(),
                expired: false,
            };
            persist();
            return withDerivedRisk(db);
        },
        async subscribeWealth(req) {
            await delay(620);
            const db = loadDb();
            const product = productByCode(req.productCode);
            // —— 先开理财账户：银行户 ≠ 理财户（ZA 也是这么分的）——
            if (!db.wealthAccount.opened) {
                throw new ApiError('请先开立理财账户', 403, 'WEALTH_ACCOUNT_REQUIRED');
            }
            const account = settlementAccount(db);
            // —— 适当性：不是提示，是硬拦截 ——
            // 「误导投资者购买与其风险承受能力不相匹配的理财产品」是明令禁止的行为
            const risk = withDerivedRisk(db);
            if (!risk.done || risk.expired) {
                throw new ApiError('请先完成风险承受能力评估', 403, 'RISK_ASSESSMENT_REQUIRED');
            }
            if (!canBuyRisk(risk.level, product.risk)) {
                throw new ApiError(suitabilityMessage(risk.level, product.risk), 403, 'RISK_MISMATCH');
            }
            // —— 会员优先购：热门产品窗口内仅白金及以上可申购，窗口结束全员开放 ——
            const priorityGate = wealthPriorityGate(product, db.membership.tier);
            if (priorityGate)
                throw new ApiError(priorityGate.message, 403, 'WEALTH_PRIORITY_WINDOW');
            // —— 风险确认语句必须完整抄录 ——（监管要求抄录，不是一个勾选框）
            if (req.riskAcknowledgement.trim() !== RISK_ACKNOWLEDGEMENT) {
                throw new ApiError(`请完整抄录风险确认语句：${RISK_ACKNOWLEDGEMENT}`, 400, 'ACKNOWLEDGEMENT_MISMATCH');
            }
            if (!Number.isSafeInteger(req.amount) || req.amount <= 0)
                throw new ApiError('金额必须是正的安全整数分', 400, 'INVALID_AMOUNT');
            if (req.amount < product.minAmount) {
                throw new ApiError(`起购金额 ¥${(product.minAmount / 100).toLocaleString('zh-CN')}`, 400, 'BELOW_MIN_AMOUNT');
            }
            if (req.amount % product.stepAmount !== 0) {
                throw new ApiError(`追加金额需为 ¥${(product.stepAmount / 100).toLocaleString('zh-CN')} 的整数倍`, 400, 'INVALID_STEP');
            }
            if (req.amount > account.available) {
                // 文案要带**实际那个账户**的名字：资金账户是用户自己指定的，
                // 使用后端返回的账户名称，避免客户端自行猜测资金账户
                throw new ApiError(`${account.label}可用余额不足`, 400, 'INSUFFICIENT_FUNDS');
            }
            // 扣钱这一步单独验支付密码，且放在所有校验之后 —— 先验密码再收钱
            verifyPayPassword(req.paymentPassword);
            const { fee } = oneOffFee(product, req.amount, '申购');
            const netAmount = req.amount - fee;
            const shares = Number((netAmount / product.nav).toFixed(2));
            applyBalance(account.id, -req.amount);
            await pushTransaction({
                accountId: account.id,
                direction: 'out',
                amount: req.amount,
                signedAmount: -req.amount,
                counterparty: `申购 · ${product.name}`,
                memo: `申购 ${product.name}`,
                category: 'other',
                createdAt: new Date().toISOString(),
                status: 'success',
            }, {
                channel: 'account',
                paymentMethod: account.label,
                accountLabel: account.label,
                accountNo: account.accountNo,
                settleCurrency: account.currency,
                location: '招财猫银行 App',
                remark: fee > 0 ? `申购费 ¥${(fee / 100).toFixed(2)}（内扣）` : '申购费免费',
            });
            // 同一产品合并持仓，按加权平均重算买入净值
            const existing = db.holdings.find((h) => h.productCode === product.code);
            const confirmedAt = new Date().toISOString();
            if (existing) {
                const totalShares = existing.shares + shares;
                existing.costNav =
                    (existing.shares * existing.costNav + shares * product.nav) / totalShares;
                existing.shares = totalShares;
                existing.principal += req.amount;
            }
            else {
                db.holdings.push({
                    id: nextId('hold'),
                    productCode: product.code,
                    productName: product.name,
                    category: product.category,
                    risk: product.risk,
                    shares,
                    costNav: product.nav,
                    principal: req.amount,
                    marketValue: 0,
                    profit: 0,
                    profitRate: 0,
                    purchasedAt: confirmedAt,
                    redeemableAt: product.openEnded ? null : inDaysFromNow(product.term),
                    closed: !product.openEnded,
                });
            }
            persist();
            const holding = withDerivedHoldings(db).find((h) => h.productCode === product.code);
            return { holding, confirmedAt, shares, nav: product.nav, fees: fee };
        },
        async redeemWealth(req) {
            await delay(560);
            const db = loadDb();
            const holding = db.holdings.find((h) => h.id === req.holdingId);
            if (!holding)
                throw new ApiError('持仓不存在', 404, 'HOLDING_NOT_FOUND');
            const product = productByCode(holding.productCode);
            const derived = withDerivedHoldings(db).find((h) => h.id === holding.id);
            if (derived.closed) {
                throw new ApiError(`该产品处于封闭期，${formatDate(derived.redeemableAt)} 起可赎回`, 400, 'IN_CLOSED_PERIOD');
            }
            const shares = req.shares == null ? holding.shares : req.shares;
            if (shares <= 0)
                throw new ApiError('赎回份额必须大于 0', 400, 'INVALID_SHARES');
            if (shares > holding.shares)
                throw new ApiError('赎回份额超过持有份额', 400, 'EXCEED_SHARES');
            const gross = Math.round(shares * product.nav);
            const { fee } = oneOffFee(product, gross, '赎回');
            const net = gross - fee;
            const account = settlementAccount(db);
            applyBalance(account.id, net);
            await pushTransaction({
                accountId: account.id,
                direction: 'in',
                amount: net,
                signedAmount: net,
                counterparty: `赎回 · ${product.name}`,
                memo: `赎回 ${product.name}`,
                category: 'other',
                createdAt: new Date().toISOString(),
                status: 'success',
            }, {
                channel: 'account',
                paymentMethod: account.label,
                accountLabel: account.label,
                accountNo: account.accountNo,
                settleCurrency: account.currency,
                location: '招财猫银行 App',
                remark: fee > 0 ? `赎回费 ¥${(fee / 100).toFixed(2)}（已扣除）` : '赎回费免费',
            });
            // 按份额比例扣减本金，剩下的继续持有
            const ratio = shares / holding.shares;
            holding.principal = Math.round(holding.principal * (1 - ratio));
            holding.shares = Number((holding.shares - shares).toFixed(2));
            if (holding.shares <= 0) {
                db.holdings = db.holdings.filter((h) => h.id !== holding.id);
            }
            persist();
            return {
                holdingId: holding.id,
                acceptedAt: new Date().toISOString(),
                shares,
                estimatedAmount: net,
                etaText: '预计 T+1 个工作日到账',
            };
        },
        async getSpending(month) { return spendingStatistics(loadDb(), month, CATEGORY_LABEL) },
        async getCashFlow(days = 7) { return cashFlowStatistics(loadDb(), days) },
        async listAutoDebits() {
            await delay(160);
            return loadDb().autoDebits;
        },
async setAutoDebitEnabled(id, enabled) {
            await delay(220);
            const item = loadDb().autoDebits.find((a) => a.id === id);
            if (!item)
                throw new ApiError('扣款计划不存在', 404, 'AUTODEBIT_NOT_FOUND');
            item.enabled = enabled;
            persist();
            return item;
        },
        /* ------------------------------------------------------- 支出预算 */
        async listBudgets() {
            await delay(180);
            const db = loadDb();
            const budgets = budgetsOverview(db);
            persist();
            return { budgets, today: shanghaiDay(), timeZone: 'Asia/Shanghai', pointsPerPass: BUDGET_POINTS_PER_PASS, passExtra: BUDGET_PASS_EXTRA_CENTS, maxFutureDays: BUDGET_PASS_MAX_FUTURE_DAYS };
        },
        async createBudget(input) {
            await delay(240);
            const db = loadDb();
            db.budgets ??= [];
            if (db.budgets.length >= BUDGET_MAX_COUNT)
                throw new ApiError(`最多同时持有 ${BUDGET_MAX_COUNT} 个支出预算`, 409, 'BUDGET_LIMIT_REACHED');
            let value;
            try {
                value = validateBudgetInput(input);
            }
            catch (error) {
                if (error instanceof BudgetError)
                    throw new ApiError(error.message, error.status, error.code);
                throw error;
            }
            const now = new Date().toISOString();
            const budget = { id: nextId('budget'), ...value, enabled: true, createdAt: now, updatedAt: now };
            db.budgets.push(budget);
            persist();
            return budgetsOverview(db).find(row => row.id === budget.id);
        },
        async updateBudget(id, patch) {
            await delay(220);
            const db = loadDb();
            const budget = (db.budgets ?? []).find(row => row.id === id);
            if (!budget)
                throw new ApiError('支出预算不存在', 404, 'BUDGET_NOT_FOUND');
            let next;
            try {
                next = validateBudgetPatch(patch ?? {}, budget);
            }
            catch (error) {
                if (error instanceof BudgetError)
                    throw new ApiError(error.message, error.status, error.code);
                throw error;
            }
            Object.assign(budget, next, { updatedAt: new Date().toISOString() });
            persist();
            return budgetsOverview(db).find(row => row.id === budget.id);
        },
        async deleteBudget(id) {
            await delay(200);
            const db = loadDb();
            const index = (db.budgets ?? []).findIndex(row => row.id === id);
            if (index < 0)
                throw new ApiError('支出预算不存在', 404, 'BUDGET_NOT_FOUND');
            db.budgets.splice(index, 1);
            // 预算没了，它的达标记录与额度券也就没有意义，一并清掉
            db.budgetPointDays = (db.budgetPointDays ?? []).filter(row => row.budgetId !== id);
            db.budgetPasses = (db.budgetPasses ?? []).filter(row => row.budgetId !== id);
            persist();
            return { removed: id };
        },
        async redeemBudgetPass(id, input) {
            await delay(240);
            const db = loadDb();
            const budget = (db.budgets ?? []).find(row => row.id === id);
            if (!budget)
                throw new ApiError('支出预算不存在', 404, 'BUDGET_NOT_FOUND');
            settleBudgetPoints(db);
            const points = budgetPoints(db.budgetPointDays, db.budgetPasses, id);
            if (points.available < BUDGET_POINTS_PER_PASS)
                throw new ApiError(`积分不足，兑换一次额度需要 ${BUDGET_POINTS_PER_PASS} 分（当前 ${points.available} 分）`, 409, 'INSUFFICIENT_BUDGET_POINTS');
            const now = Date.now();
            let day;
            try {
                day = validatePassDay(input?.day ?? shanghaiDay(now), now);
            }
            catch (error) {
                if (error instanceof BudgetError)
                    throw new ApiError(error.message, error.status, error.code);
                throw error;
            }
            const pass = { id: nextId('pass'), budgetId: id, day, extra: BUDGET_PASS_EXTRA_CENTS, createdAt: new Date(now).toISOString() };
            db.budgetPasses ??= [];
            db.budgetPasses.push(pass);
            persist();
            return { pass, points: budgetPoints(db.budgetPointDays, db.budgetPasses, id), budget: budgetsOverview(db).find(row => row.id === id) };
        },
async getSecurityOverview() {
            await delay(200);
            return withDerivedSecurity();
        },
        async setSecurityRule(id, enabled) {
            await delay(240);
            const db = loadDb();
            const rule = db.security.riskRules.find((r) => r.id === id);
            if (!rule)
                throw new ApiError('风控规则不存在', 404, 'RULE_NOT_FOUND');
            rule.enabled = enabled;
            db.security.logs.unshift({
                id: nextId('log'),
                action: enabled ? '开启风控规则' : '关闭风控规则',
                detail: rule.label,
                createdAt: new Date().toISOString(),
                level: enabled ? 'info' : 'warn',
            });
            persist();
            return withDerivedSecurity();
        },
        async changePhone(req) {
            await delay(640);
            const db = loadDb();
            const next = digitsOnly(req.newPhone);
            if (!/^1[3-9]\d{9}$/.test(next))
                throw new ApiError('请输入 11 位手机号', 400, 'INVALID_PHONE');
            if (next === db.user.phone) {
                throw new ApiError('新手机号与当前登录手机号相同', 400, 'SAME_PHONE');
            }
            if (await findProfileByPhone(next) !== null) {
                throw new ApiError('该手机号已注册', 409, 'PHONE_EXISTS');
            }
            // 换号是高危操作：先核身
            if (!req.faceTicket)
                throw new ApiError('请先完成人脸识别', 400, 'FACE_REQUIRED');
            // 再验新号的短信 —— 证明这个号真是你的
            await security.verifySms(next, req.smsCode);
            const previous = db.user.phone;
            db.pendingSms = null;
            db.user.phone = next;
            forgetProfilePhone(previous);
            // 换绑手机号要留痕：这类操作在安全日志里必须是 warn 级
            db.security.logs.unshift({
                id: nextId('log'),
                action: '更换登录手机号',
                detail: `${maskPhone(previous)} → ${maskPhone(next)}`,
                createdAt: new Date().toISOString(),
                level: 'warn',
            });
            persist();
            return db.user;
        },
        async changePassword(oldPassword, newPassword) {
            await delay(420);
            const db = loadDb();
            if (!verifyPassword(oldPassword, db.passwordDigest)) {
                throw new ApiError('原密码不正确', 400, 'BAD_OLD_PASSWORD');
            }
            if (newPassword.length < 6) {
                throw new ApiError('新密码至少 6 位', 400, 'WEAK_PASSWORD');
            }
            db.passwordDigest = await passwordDigest(newPassword);
            db.security.logs.unshift({
                id: nextId('log'),
                action: '修改登录密码',
                detail: '密码已更新，请在其他设备重新登录',
                createdAt: new Date().toISOString(),
                level: 'info',
            });
            persist();
        },
        async changePaymentPassword(req) {
            await delay(420);
            const db = loadDb();
            if (typeof req.oldPassword === 'string' && req.oldPassword.length > 0) {
                // 常规修改：和付款一样验原密码，错误次数会累计、已锁定必须走核身重置
                verifyPayPassword(req.oldPassword);
            }
            else {
                // 忘记原密码或已锁定：核身重置是唯一出口
                if (!req.faceTicket) {
                    throw new ApiError('请先完成人脸识别', 400, 'FACE_REQUIRED');
                }
            }
            if (!/^\d{6}$/.test(req.newPassword)) {
                throw new ApiError('请设置 6 位数字支付密码', 400, 'INVALID_PAY_PASSWORD');
            }
            db.payPassword = hashPassword(req.newPassword);
            db.payPasswordFailures = 0;
            db.security.logs.unshift({
                id: nextId('log'),
                action: req.oldPassword ? '修改支付密码' : '重置支付密码',
                detail: req.oldPassword ? '凭原支付密码修改' : '人脸核身后重置',
                createdAt: new Date().toISOString(),
                level: 'warn',
            });
            persist();
        },
        async verifyIdentity(channel) {
            return security.issueIdentityTicket(channel);
        },
        async listSupportMessages() {
        await delay(120);
        const history = storage.get(STORAGE_KEYS.supportHistory, null);
        // 员工端发来的留言（契约 v1.3）。条目自带 customerId，按当前登录人过滤——
        // 后端的 storage 是所有用户共用的一份，不过滤会把别人的话念给这个客户听。
        const mine = listStaffNotices(loadDb().user.id).map((n) => ({
            id: n.id,
            role: 'staff',
            text: n.text,
            staffName: n.staffName,
            createdAt: n.createdAt,
        }));
        const base = history?.length
            ? history
            : [
                {
                    id: nextId('msg'),
                    role: 'agent',
                    createdAt: new Date().toISOString(),
                    text: '你好，我是招财猫银行的智能客服。转账、锁卡、密码重置、消费分析都可以问我。',
                },
            ];
        // 按时间归并，别让员工留言和智能客服对话各堆一堆、读不出先后
        return [...mine, ...base].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
        async sendSupportMessage(text) {
            await delay(650);
            return cannedReply(text);
        },
        async requestHumanSupport(req) {
            if (!req.reason.trim() || req.reason.length > 500)
                throw new ApiError('请输入 500 字以内的问题描述', 400);
            const key = `${humanOwner()}:${req.requestId}`;
            const previous = humanRequests.get(key);
            if (previous)
                return structuredClone(humanTicket(previous));
            const now = new Date().toISOString();
            const row = {
                ticketId: nextId('T'), reason: redactSupportText(req.reason), status: 'open',
                priority: entitlements(loadDb().membership.tier).vipChannel ? 'vip' : 'normal',
                createdAt: now, updatedAt: now, messages: [],
            };
            humanTickets.set(humanOwner(), [row, ...humanRows()]);
            humanRequests.set(key, row.ticketId);
            return structuredClone(row);
        },
        async listSupportTickets(page = 1) {
            const rows = humanRows();
            return { items: structuredClone(rows.slice((page - 1) * 20, page * 20)), page, size: 20, total: rows.length };
        },
        async getSupportTicket(id) { return structuredClone(humanTicket(id)); },
        async replySupportTicket(id, req) {
            const row = humanTicket(id);
            if (row.status === 'resolved')
                throw new ApiError('工单已解决，请重新转人工', 409);
            const key = `${humanOwner()}:${req.requestId}`;
            const previous = humanRequests.get(key);
            if (previous)
                return { messageId: previous };
            const messageId = nextId('msg');
            row.messages.push({ id: messageId, sender: 'customer', text: redactSupportText(req.text), createdAt: new Date().toISOString() });
            row.updatedAt = new Date().toISOString();
            humanRequests.set(key, messageId);
            return { messageId };
        },
        /* -------------------------------------------------- 账户域扩展 */
        async quoteExchange(req) {
        await delay(180);
        const db = loadDb();
        if (evaluateMembership(db)) persist();
        const from = findBalance(db, req.fromAccountId);
        if (!from)
            throw new ApiError('账户不存在', 404, 'ACCOUNT_NOT_FOUND');
        if (req.toCurrency === from.currency) {
            throw new ApiError('目标币种与扣账币种相同', 400, 'SAME_CURRENCY');
        }
        if (!Number.isSafeInteger(req.amount) || req.amount <= 0 || !['CNY', 'HKD', 'USD'].includes(req.toCurrency))
            throw new ApiError('金额或币种无效', 400, 'INVALID_AMOUNT');
        if (req.amount > from.available) {
            throw new ApiError('可用余额不足', 400, 'INSUFFICIENT_BALANCE');
        }
        const rate = fxRateFor(db, from.currency, req.toCurrency, FX_MID_RATES, FX_SPREAD);
        const toAmount = Math.round(req.amount * rate);
        if (!Number.isSafeInteger(toAmount) || toAmount <= 0)
            throw new ApiError('换汇金额过小或超出范围', 400, 'INVALID_AMOUNT');
        const target = ledgerBalances(db).find((a) => a.currency === req.toCurrency);
        for (const [id, quote] of exchangeQuotes)
            if (quote.expiresAt <= Date.now())
                exchangeQuotes.delete(id);
        const quoteId = crypto.randomUUID();
        exchangeQuotes.set(quoteId, { ownerId: db.user.id, accountId: from.id, amount: req.amount, toCurrency: req.toCurrency, rate, expiresAt: Date.now() + FX_QUOTE_TTL * 1000 });
        return {
            quoteId,
            fx: {
                fromCurrency: from.currency,
                toCurrency: req.toCurrency,
                rate,
                fromAmount: req.amount,
                toAmount,
                spread: effectiveSpread(db, FX_SPREAD),
                quoteTtlSeconds: FX_QUOTE_TTL,
                quotedAt: new Date().toISOString(),
            },
            toAccountNo: db.accounts[0].accountNo,
            toAvailableAfter: (target?.available ?? 0) + toAmount,
        };
    },
        async submitExchange(req) {
        await delay(420);
        const db = loadDb();
        const from = findBalance(db, req.fromAccountId);
        if (!from)
            throw new ApiError('账户不存在', 404, 'ACCOUNT_NOT_FOUND');
        verifyPayPassword(req.paymentPassword);
        const confirmed = exchangeQuotes.get(req.quoteId);
        if (!confirmed || confirmed.expiresAt <= Date.now())
            throw new ApiError('报价已过期，请重新询价', 409, 'QUOTE_EXPIRED');
        if (confirmed.ownerId !== db.user.id || confirmed.accountId !== from.id || confirmed.amount !== req.amount || confirmed.toCurrency !== req.toCurrency || confirmed.rate !== fxRateFor(db, from.currency, req.toCurrency, FX_MID_RATES, FX_SPREAD))
            throw new ApiError('报价已变化，请重新确认', 409, 'QUOTE_CHANGED');
        exchangeQuotes.delete(req.quoteId);
        if (req.toCurrency === from.currency) {
            throw new ApiError('目标币种与扣账币种相同', 400, 'SAME_CURRENCY');
        }
        if (!Number.isSafeInteger(req.amount) || req.amount <= 0)
            throw new ApiError('金额必须是正的安全整数分', 400, 'INVALID_AMOUNT');
        if (req.amount > from.available) {
            throw new ApiError('可用余额不足', 400, 'INSUFFICIENT_BALANCE');
        }
        const rate = fxRateFor(db, from.currency, req.toCurrency, FX_MID_RATES, FX_SPREAD);
        const toAmount = Math.round(req.amount * rate);
        if (!Number.isSafeInteger(toAmount) || toAmount <= 0)
            throw new ApiError('换汇金额过小或超出范围', 400, 'INVALID_AMOUNT');
        let target = ledgerBalances(db).find((a) => a.currency === req.toCurrency);
        if (!target) {
            target = {
                id: nextId('balance'),
                kind: 'savings',
                label: `${req.toCurrency} 余额`,
                accountNo: `ledger:${db.user.id}:${req.toCurrency}`,
                currency: req.toCurrency,
                balance: 0,
                available: 0,
                interestRate: 0.0155,
                monthNetChange: 0,
            };
            db.currencyBalances ??= [];
            db.currencyBalances.push(target);
        }
        if (!Number.isSafeInteger(target.balance + toAmount) || !Number.isSafeInteger(target.available + toAmount))
            throw new ApiError('目标币种余额超出范围', 400, 'INVALID_AMOUNT');
        applyBalance(from.id, -req.amount, false);
        applyBalance(target.id, toAmount, false);
        const now = new Date().toISOString();
        const crossLabel = `币种划转 · ${from.currency}→${req.toCurrency}`;
        const outflow = await pushTransaction({
            businessType: 'exchange',
            accountId: from.id,
            direction: 'out',
            amount: req.amount,
            signedAmount: -req.amount,
            counterparty: crossLabel,
            memo: `账户内换汇 → ${target.label}`,
            category: 'other',
            createdAt: now,
            status: 'success',
        }, {
            channel: 'account',
            paymentMethod: '账户内换汇',
            accountLabel: from.label,
            accountNo: db.accounts[0].accountNo,
            settleCurrency: from.currency,
            counterpartyName: '账户内换汇',
            originAmount: req.amount,
            originCurrency: from.currency,
            exchangeRate: rate,
            exchangeRateNote: `1 ${from.currency} = ${req.toCurrency} ${formatRate(rate)}`,
        }, false);
        await pushTransaction({
            businessType: 'exchange',
            accountId: target.id,
            direction: 'in',
            amount: toAmount,
            signedAmount: toAmount,
            counterparty: crossLabel,
            memo: `账户内换汇入账 ← ${from.label}`,
            category: 'other',
            createdAt: now,
            status: 'success',
        }, {
            channel: 'account',
            paymentMethod: '账户内换汇',
            accountLabel: target.label,
            accountNo: db.accounts[0].accountNo,
            settleCurrency: target.currency,
            counterpartyName: '账户内换汇',
            originAmount: req.amount,
            originCurrency: from.currency,
            exchangeRate: rate,
            exchangeRateNote: `1 ${from.currency} = ${req.toCurrency} ${formatRate(rate)}`,
        }, false);
        persist();
        return {
            transactionId: outflow.id,
            referenceNo: outflow.detail.referenceNo,
            fromAccountId: from.id,
            toAccountId: target.id,
            fx: {
                fromCurrency: from.currency,
                toCurrency: req.toCurrency,
                rate,
                fromAmount: req.amount,
                toAmount,
                spread: effectiveSpread(db, FX_SPREAD),
                quoteTtlSeconds: FX_QUOTE_TTL,
                quotedAt: now,
            },
            createdAt: now,
        };
    },
        async getSavingsOverview() {
            await delay(200);
            const db = loadDb();
            const totalSaved = db.savings.goals.reduce((sum, g) => sum + g.savedAmount, 0);
            return { ...db.savings, totalSaved };
        },
        async createSavingsGoal(req) {
            await delay(280);
            const db = loadDb();
            if (!req.name || !req.name.trim())
                throw new ApiError('请填写目标名称', 400, 'INVALID_NAME');
            if (req.targetAmount <= 0)
                throw new ApiError('目标金额必须大于 0', 400, 'INVALID_AMOUNT');
            const goal = {
                id: nextId('goal'),
                name: req.name.trim(),
                icon: req.icon ?? 'flag',
                targetAmount: req.targetAmount,
                savedAmount: 0,
                deadline: req.deadline ?? null,
                createdAt: new Date().toISOString(),
                sweep: null,
            };
            db.savings.goals.push(goal);
            persist();
            return goal;
        },
        async updateSavingsGoal(id, req) {
            await delay(240);
            const db = loadDb();
            const goal = db.savings.goals.find((g) => g.id === id);
            if (!goal)
                throw new ApiError('存钱目标不存在', 404, 'GOAL_NOT_FOUND');
            if (req.name !== undefined && req.name.trim())
                goal.name = req.name.trim();
            if (req.targetAmount !== undefined) {
                if (req.targetAmount <= 0)
                    throw new ApiError('目标金额必须大于 0', 400, 'INVALID_AMOUNT');
                goal.targetAmount = req.targetAmount;
            }
            if (req.icon !== undefined)
                goal.icon = req.icon;
            if (req.deadline !== undefined)
                goal.deadline = req.deadline;
            persist();
            return goal;
        },
        async deleteSavingsGoal(id) {
            await delay(200);
            const db = loadDb();
            const index = db.savings.goals.findIndex((g) => g.id === id);
            if (index < 0)
                throw new ApiError('存钱目标不存在', 404, 'GOAL_NOT_FOUND');
            db.savings.goals.splice(index, 1);
            if (db.savings.roundup.goalId === id)
                db.savings.roundup.goalId = null;
            persist();
        },
        async updateSavingsRoundup(req) { const db = loadDb(); db.savings.roundup = validateRoundup(db, req); persist(); return db.savings.roundup },
        async createVirtualCard(id, req) {
            await delay(560);
            const db = loadDb();
            const card = db.cards.find((c) => c.id === id);
            if (!card)
                throw new ApiError('银行卡不存在', 404, 'CARD_NOT_FOUND');
            if (card.status !== 'active') {
                throw new ApiError('卡未激活，无法生成一次性卡号', 400, 'CARD_NOT_ACTIVE');
            }
            if (req.amountLimit <= 0)
                throw new ApiError('限额必须大于 0', 400, 'INVALID_AMOUNT');
            const hours = Math.min(Math.max(Math.round(req.validHours) || 24, 1), 72);
            const now = Date.now();
            const virtual = {
                id: nextId('vc'),
                pan: cardPan('visa', String(Math.floor(1000 + Math.random() * 9000))),
                cvv: String(Math.floor(100 + Math.random() * 900)),
                expiry: card.expiry,
                amountLimit: req.amountLimit,
                merchantNote: (req.merchantNote ?? '').trim(),
                createdAt: new Date(now).toISOString(),
                expiresAt: new Date(now + hours * 3_600_000).toISOString(),
            };
            db.virtualCards.unshift(virtual);
            persist();
            return virtual;
        },
        /* -------------------------------------------------- 我的域扩展 */
        async getInvitations() {
            await delay(180);
            return loadDb().invitations;
        },
        async getMembership() {
            await delay(180);
            const db = loadDb();
            let changed = evaluateMembership(db);
            // 升级即时：读取会员信息时也按当前实时 AUM 检查一次，不等月度评定
            if (applyRealtimeUpgrade(db, FX_MID_RATES))
                changed = true;
            if (changed)
                persist();
            return membershipOverview(db, FX_MID_RATES);
        },
        async redeemLoungePass() {
            await delay(220);
            const db = loadDb();
            if (!redeemLoungePass(db, Date.now()))
                throw new ApiError('本年度贵宾厅额度已用完', 409, 'LOUNGE_QUOTA_EXHAUSTED');
            persist();
            return membershipOverview(db, FX_MID_RATES);
        },
        /* -------------------------------------------------- 工资与备用金 */
        async getSalaryPlan() {
            await delay(180);
            return loadDb().salaryPlan;
        },
        async updateSalary(req) {
            await delay(420);
            const db = loadDb();
            if (req.salaryDay !== undefined) {
                if (!Number.isInteger(req.salaryDay) || req.salaryDay < 1 || req.salaryDay > 28) {
                    throw new ApiError('发薪日需在 1–28 之间', 400, 'INVALID_SALARY_DAY');
                }
                db.salaryPlan.salaryDay = req.salaryDay;
                db.salaryPlan.nextPayday = nextPaydayFrom(req.salaryDay);
            }
            if (req.amount !== undefined) {
                if (req.amount <= 0)
                    throw new ApiError('月薪必须大于 0', 400, 'INVALID_AMOUNT');
                db.salaryPlan.amount = req.amount;
            }
            if (req.accountId) {
                const account = requireCurrencyBalance(db, req.accountId);
                db.salaryPlan.accountId = account.id;
            }
            if (req.employer !== undefined)
                db.salaryPlan.employer = req.employer;
            persist();
            return db.salaryPlan;
        },
        async getOverdraft() {
            await delay(180);
            return loadDb().overdraft;
        },
        async activateOverdraft(active) {
            await delay(520);
            const db = loadDb();
            if (active && !db.overdraft.active) {
                db.overdraft.active = true;
                db.overdraft.activatedAt = new Date().toISOString();
            }
            else if (!active) {
                if (db.overdraft.used > 0) {
                    throw new ApiError('存在未还清的备用金，暂时无法关闭', 400, 'OVERDRAFT_IN_USE');
                }
                db.overdraft.active = false;
                db.overdraft.activatedAt = null;
            }
            persist();
            return db.overdraft;
        },
        /* -------------------------------------------------- 借款与分期 */
        async getCreditOverview() {
            await delay(200);
            return loadDb().credit;
        },
        async applyLoan(req) {
            await delay(900);
            const db = loadDb();
            const product = db.credit.products.find((p) => p.id === req.productId);
            if (!product)
                throw new ApiError('借款产品不存在', 404, 'PRODUCT_NOT_FOUND');
            if (!Number.isSafeInteger(req.amount) || req.amount <= 0)
                throw new ApiError('金额必须是正的安全整数分', 400, 'INVALID_AMOUNT');
            if (req.amount < product.minAmount || req.amount > product.maxAmount) {
                throw new ApiError(`借款金额需在 ¥${formatAmount(product.minAmount)}–¥${formatAmount(product.maxAmount)} 之间`, 400, 'INVALID_AMOUNT');
            }
            if (!Number.isSafeInteger(req.termMonths) || req.termMonths < product.minTermMonths || req.termMonths > product.maxTermMonths) {
                throw new ApiError('借款期限超出可选范围', 400, 'INVALID_TERM');
            }
            if (req.amount > db.credit.availableCredit) {
                throw new ApiError('超过可用授信额度', 400, 'OVER_CREDIT_LIMIT');
            }
            verifyPayPassword(req.paymentPassword);
            const totalInterest = Math.round((req.amount * product.apr * req.termMonths) / 12);
            const monthlyPayment = Math.round((req.amount + totalInterest) / req.termMonths);
            const account = requireCurrencyBalance(db, req.accountId);
            const loan = {
                id: nextId('ln'),
                productName: product.name,
                principal: req.amount,
                outstanding: req.amount + totalInterest,
                termMonths: req.termMonths,
                monthlyPayment,
                apr: product.apr,
                nextDueDate: nextPaydayFrom(8),
                paidPeriods: 0,
                totalPeriods: req.termMonths,
                status: 'active',
                createdAt: new Date().toISOString(),
            };
            applyBalance(account.id, req.amount, false);
            db.credit.loans.unshift(loan);
            db.credit.availableCredit -= req.amount;
            await pushTransaction({
                accountId: account.id,
                direction: 'in',
                amount: req.amount,
                signedAmount: req.amount,
                counterparty: product.name,
                memo: `借款放款 · ${req.purpose}`,
                category: 'other',
                createdAt: new Date().toISOString(),
                status: 'success',
            }, {
                channel: 'account',
                paymentMethod: account.label,
                accountLabel: account.label,
                accountNo: account.accountNo,
                settleCurrency: account.currency,
                location: '招财猫银行 App',
                remark: `借款放款 · ${req.purpose}`,
            }, false);
            persist();
            return loan;
        },
        async convertToInstallment(transactionId, req) {
            await delay(700);
            const db = loadDb();
            const tx = db.transactions.find((t) => t.id === transactionId);
            if (!tx)
                throw new ApiError('交易不存在', 404, 'NOT_FOUND');
            if (tx.status !== 'success' || !['shopping', 'dining', 'transport', 'housing', 'subscription'].includes(tx.category) || !['card', 'quickpay'].includes(tx.detail.channel) || tx.direction !== 'out')
                throw new ApiError('只有支出交易可以办理分期', 400, 'INVALID_TARGET');
            if (db.credit.installments.some(p => p.transactionId === transactionId))
                throw new ApiError('该交易已办理分期', 409, 'ALREADY_INSTALLED');
            if (!Number.isSafeInteger(req.periods) || req.periods < 3 || req.periods > 24)
                throw new ApiError('分期期数需在 3–24 期之间', 400, 'INVALID_PERIODS');
            const feeRate = 0.024;
            const plan = {
                id: nextId('inst'),
                transactionId,
                title: tx.memo || tx.counterparty,
                merchant: tx.counterparty,
                totalAmount: tx.amount,
                remainingAmount: tx.amount,
                periods: req.periods,
                paidPeriods: 0,
                monthlyPayment: Math.round((tx.amount * (1 + feeRate)) / req.periods),
                nextDueDate: nextPaydayFrom(8),
                feeRate,
                createdAt: new Date().toISOString(),
            };
            db.credit.installments.unshift(plan);
            persist();
            return plan;
        },
        /* -------------------------------------------------- 理财扩展 */
        async getCashManagement() {
            await delay(200);
            return loadDb().cashManagement;
        },
        async updateCashSweep(req) {
            await delay(480);
            const db = loadDb();
            if (req.threshold !== undefined && req.threshold < 0) {
                throw new ApiError('保留金额不能为负', 400, 'INVALID_AMOUNT');
            }
            if (req.enabled !== undefined)
                db.cashManagement.sweepEnabled = req.enabled;
            if (req.threshold !== undefined)
                db.cashManagement.sweepThreshold = req.threshold;
            if (req.accountId) {
                const account = requireCurrencyBalance(db, req.accountId);
                db.cashManagement.accountId = account.id;
            }
            persist();
            return db.cashManagement;
        },
        async getInvestments() {
            await delay(220);
            return { ...loadDb().investments, executionMode: 'plan-only' };
        },
        async createInvestPlan(req) {
            await delay(760);
            const db = loadDb();
            const account = requireCurrencyBalance(db, req.accountId);
            const risk = withDerivedRisk(db);
            const product = db.investments.products.find((p) => p.code === req.productCode);
            validateInvestPlan(product, risk, db.wealthAccount.opened, req.amount, req.cycle);
            verifyPayPassword(req.paymentPassword);
            const plan = {
                accountId: account.id,
                id: nextId('ip'),
                productCode: product.code,
                productName: product.name,
                amount: req.amount,
                cycle: req.cycle,
                nextRunAt: nextInvestDate(req.cycle),
                executedRuns: 0,
                totalInvested: 0,
                status: 'active',
                revision: 0,
                createdAt: new Date().toISOString(),
            };
            db.investments.plans.unshift(plan);
            persist();
            return plan;
        },
        async updateInvestPlan(id, req) {
            await delay(300);
            const db = loadDb();
            const plan = db.investments.plans.find(p => p.id === id);
            const next = transitionInvestPlan(plan, req);
            if (req.status === 'active') {
                requireCurrencyBalance(db, plan.accountId ?? db.accounts[0]?.id);
                const product = db.investments.products.find(p => p.code === plan.productCode);
                // Legacy monthly day cycles retain their anchor on resume.
                validateInvestPlan(product, withDerivedRisk(db), db.wealthAccount.opened, plan.amount, /^每月 \d+ 日$/.test(plan.cycle) ? '每月' : plan.cycle);
                verifyPayPassword(req.paymentPassword);
            }
            Object.assign(plan, next);
            persist();
            return plan;
        },
        async getInsurance() {
            await delay(220);
            return loadDb().insurance;
        },
        async enrollInsurance(req) {
            await delay(820);
            const db = loadDb();
            const product = db.insurance.products.find((p) => p.id === req.productId);
            if (!product)
                throw new ApiError('保险产品不存在', 404, 'PRODUCT_NOT_FOUND');
            if (!req.insuredName.trim())
                throw new ApiError('请填写被保人姓名', 400, 'VALIDATION_ERROR');
            verifyPayPassword(req.paymentPassword);
            const account = settlementAccount(db);
            if (product.premiumPerYear > account.available) {
                throw new ApiError('可用余额不足', 400, 'INSUFFICIENT_BALANCE');
            }
            const now = new Date();
            const policy = {
                id: nextId('pol'),
                productName: product.name,
                insurer: product.insurer,
                premium: product.premiumPerYear,
                coverage: product.coverage,
                status: 'active',
                effectiveAt: now.toISOString(),
                expireAt: new Date(now.getTime() + 365 * 86_400_000).toISOString(),
                insuredName: req.insuredName.trim(),
            };
            db.insurance.policies.unshift(policy);
            db.insurance.totalCoverage += product.coverage;
            applyBalance(account.id, -product.premiumPerYear, false);
            await pushTransaction({
                accountId: account.id,
                direction: 'out',
                amount: product.premiumPerYear,
                signedAmount: -product.premiumPerYear,
                counterparty: product.insurer,
                memo: `保费 · ${product.name}`,
                category: 'other',
                createdAt: now.toISOString(),
                status: 'success',
            }, {
                channel: 'account',
                paymentMethod: account.label,
                accountLabel: account.label,
                accountNo: account.accountNo,
                settleCurrency: account.currency,
                location: '招财猫银行 App',
                remark: `保费 · ${product.name}`,
            }, false);
            persist();
            return policy;
        },
    };
}
/** 解冻本次实际预留金额；兼容只冻结本金的旧指令。 */
function releaseFreeze(db, rec) {
    const row = findBalance(db, rec.accountId);
    if (row) {
        row.available += rec.heldFrozenAmount ?? rec.amount;
        if (row.available > row.balance + 0) {
            // 只在账目被外部改坏时才会发生；宁可夹住也不要出现可用>余额的脏数据
            row.available = row.balance;
        }
    }
}
/** 查在途中的指令（员工端建单、agent 提审防伪造用）。须先 activate 到对应档案。 */
export function getHeldTransfer(transactionId) {
    const db = loadDb();
    const rec = db.transactions.find((t) => t.id === transactionId);
    if (!rec || rec.status !== 'pending' || rec.pendingReason !== 'inflight' || !rec.heldRequest) {
        return null;
    }
    return {
        customerId: db.user.id,
        transactionId: rec.id,
        amount: rec.amount,
        payeeName: rec.heldRequest.payeeName,
        holdUntil: rec.holdUntil ?? new Date().toISOString(),
        request: rec.heldRequest,
    };
}
/**
 * 了结在途指令。
 * - `settled`：到点/员工立即放行 → 解冻后走 submitTransfer 真正执行
 * - `intercepted`：员工拦截 → 解冻，流水翻 failed 留痕
 * - `recalled`：用户撤销 → 同上，理由记「用户主动撤销」
 * 返回到账的转账结果（拦截/撤销返回 null）。执行失败抛错，调用方据此留痕。
 */
export async function settleHeldTransfer(transactionId, outcome, reason) {
    const db = loadDb();
    const index = db.transactions.findIndex((t) => t.id === transactionId && t.pendingReason === 'inflight' && t.status === 'pending');
    if (index < 0) {
        throw new ApiError('没有找到在途的转账指令', 404, 'HELD_TRANSFER_NOT_FOUND');
    }
    const rec = db.transactions[index];
    const held = rec.heldRequest;
    if (!held) {
        throw new ApiError('在途指令缺少快照，无法结算', 409, 'HELD_REQUEST_MISSING');
    }
    if (outcome !== 'settled') {
        // 拦截 / 撤销：解除冻结即可。钱从头到尾没离开过账户。
        releaseFreeze(db, rec);
        rec.status = 'failed';
        delete rec.pendingReason;
        delete rec.holdUntil;
        delete rec.heldRequest;
        delete rec.heldFrozenAmount;
        rec.memo = outcome === 'recalled'
            ? `${rec.memo} · 已撤销${reason ? `：${reason}` : ''}`
            : `${rec.memo} · 已拦截${reason ? `：${reason}` : ''}`;
        persist();
        return null;
    }
    // 到账：解冻 → 撤占位 → 按冻结指令走 submitTransfer 业务路。
    // 解冻在先，submitTransfer 里的可用余额校验才看得见这笔钱。
    releaseFreeze(db, rec);
    db.transactions.splice(index, 1);
    persist();
    try {
        // 不带 reviewThreshold = 纯执行，不会再进窗口。
        // settleImmediately = 到账就落定，不再挂「模拟清算」——这笔已经等过窗口了。
        return await createBankBusinessApi({
            acceptedQuote: true,
            settleImmediately: true,
            settlementIdentity: { transactionId: rec.id, referenceNo: rec.detail.referenceNo, createdAt: rec.createdAt },
        }).submitTransfer(held);
    }
    catch (error) {
        // 极少数情况（如收款账户校验在窗口内失效）才走到这里：留痕，别静默吞掉
        rec.status = 'failed';
        delete rec.pendingReason;
        delete rec.holdUntil;
        delete rec.heldRequest;
        delete rec.heldFrozenAmount;
        rec.memo = `${rec.memo} · 到账失败：${error instanceof Error ? error.message : '未知错误'}`;
        db.transactions.unshift(rec);
        persist();
        throw error;
    }
}
/**
 * 扫出**当前档案**里所有到点的在途指令并自动到账（清单 §9.1：没人拦 = 默认放行）。
 * 跨用户的扫描由调用方（demo-bank tickHolds）逐档案切换来做。
 * 返回本次自动到账的指令号列表，调用方据此关掉员工端的窗口记录。
 */
export async function settleExpiredHolds() {
    const db = loadDb();
    const now = Date.now();
    const expired = db.transactions.filter((t) => t.status === 'pending' && t.pendingReason === 'inflight' && t.holdUntil !== undefined
        && new Date(t.holdUntil).getTime() <= now);
    const settled = [];
    for (const rec of expired) {
        try {
            await settleHeldTransfer(rec.id, 'settled');
            settled.push({ transactionId: rec.id, outcome: 'settled' });
        }
        catch (error) {
            if (!error?.status || error.status >= 500) throw error;
            if (rec.status !== 'failed') throw error;
            settled.push({ transactionId: rec.id, outcome: 'failed', reason: '到期资金核验未通过，资金已解冻' });
        }
    }
    return settled;
}
/** 模拟清算多久后翻 success：够看见「已提交模拟清算」，又不至于像卡死 */
const CLEARING_SETTLE_MS = 3_000;
/**
 * 扫出**当前档案**里的模拟清算单，翻成 success（清单 §9.2）。
 *
 * 这条路**不动资金**——钱在 submitTransfer 提交时就已扣（applyBalance），
 * 这里只改状态。所以它和「大额在途窗口」是两回事：
 * - `inflight`：冻结 available、到期执行，走 settleHeldTransfer
 * - `clearing`：钱已扣，只是单据先挂 pending 装清算延迟，这里翻 success
 *
 * **兜底**：`pending` 但没有 `pendingReason` 的是孤儿数据（老库、或历史上
 * 漏写标记的单）。它同样已经扣过钱，绝不能停在 pending 上——一律结清。
 * 2026-10-12 就是这样把一笔 ¥6,969 吞掉的：扣了钱、单据永远 pending。
 *
 * 跨用户的扫描由调用方（demo-bank tickHolds）逐档案切换来做。
 * 返回本次结清的指令号列表。
 */
export function settleClearingTransactions(delayMs = CLEARING_SETTLE_MS) {
    const db = loadDb();
    const now = Date.now();
    const done = [];
    for (const rec of db.transactions) {
        if (rec.status !== 'pending')
            continue;
        // 大额在途窗口另有结算，这里不碰
        if (rec.pendingReason === 'inflight')
            continue;
        const age = now - new Date(rec.createdAt).getTime();
        // 刚建的清算单再等等，让「已提交模拟清算」看得见；孤儿数据同理
        if (Number.isFinite(age) && age < delayMs)
            continue;
        rec.status = 'success';
        delete rec.pendingReason;
        done.push(rec.id);
    }
    if (done.length > 0)
        persist();
    return done;
}
