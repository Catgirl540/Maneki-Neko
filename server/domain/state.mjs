import { ledgerBalances, findBalance, normalizeFundingAccount } from '../../shared/account-model.mjs';
export { ledgerBalances, findBalance, normalizeFundingAccount } from '../../shared/account-model.mjs';
import { aumAssets, beijingDay, freshMembership, normalizeMembership, priorityOpenAt, recordAssetSnapshot } from '../../shared/membership.mjs';
export {
    applyRealtimeUpgrade,
    aumAssets,
    beijingDay,
    beijingMonth,
    cardFeeQuote,
    effectiveSpread,
    entitlements,
    evaluateMembership,
    freshMembership,
    fxRateFor,
    membershipOverview,
    memberBenefits,
    nextMonth,
    nextTier,
    normalizeMembership,
    OCCUPYING_CARD_STATUSES,
    MEMBER_TIER_RULES,
    previousMonth,
    ratedAssets,
    recordAssetSnapshot,
    recordCardFeeWaiver,
    redeemLoungePass,
    transferFee,
    transferFeeWaived,
    wealthPriorityGate,
} from '../../shared/membership.mjs';
import { hashPassword, needsRehash } from '../passwords.mjs';
// Server-owned business implementation; API contract preserved from the existing client.
/* ==========================================================================
   本地模拟数据库
   纯前端 MVP 的数据源：内存对象 + localStorage 持久化。
   结构刻意与后端表结构一致，将来换成真接口时删掉整个 mock/ 目录即可。
   ========================================================================== */
import { STORAGE_KEYS, storage } from '../lib/storage.mjs';
import { PRIMARY_BIN } from './bin-table.mjs';
import { INTERNAL_ACCOUNT_PREFIX } from './card-bin.mjs';
/**
 * 模拟库的结构版本。
 *
 * MockDb 里的字段只要有增删，就把这个数字 +1：loadDb() 读取时校验，
 * 旧版本增量迁移全部客户档案；无法识别的版本拒绝写入，不重建资金数据。
 *
 * ⚠️ 不要再用「改 localStorage 的 key」来做版本管理 —— key 只能防住改 key 那一次，
 * 防不住同一个 key 下字段又变了。之前正是这么漏的：key 升到 v2 之后才给明细加了
 * accountLabel / accountNo，于是浏览器里留下了一份「v2 但缺字段」的数据，
 * 交易详情页读 undefined 直接抛出，整棵树被卸载成白屏。
 *
 * 版本沿革：
 *   3 → 交易明细（accountLabel / accountNo / counterpartyName）
 *   4 → Bank 增加必填的 region（收款银行换成两地真实清算代码）。
 *       忘了 +1 的后果实测过：旧 banks 数组没有 region，收款银行列表筛出来 0 家。
 *   5 → Bank 增加 domain / logo（行标改为本地托管的真实图标）
 *   6 → MockDb 增加 payPassword / payPasswordFailures（开卡要付钱，付钱要支付密码）
 *   7 → 新增理财：products / holdings / riskAssessment（投资与资产板块）
 *   8 → Account 增加必填的 tier；MockDb 增加 pendingSms（开户：账户分类 + 短信验证）
 *   9 → BankCard 增加必填的 accountId（卡是支付工具，必须绑到具体账户）
 *  10 → 新增 wealthAccount（理财账户 / 投资账户，开户后才能买理财）
 *  11 → BankCard / CardProduct 的 brand 拆成 theme + network
 *       （卡面配色与卡组织是两件事；星享卡同样走 Visa 网络）
 *  12 → Bank 增加 primaryBin（选定收款行时补全卡号前缀用）
 *  13 → 新增 cardSecrets（完整卡号与安全码，与卡列表分开存）
 *  14 → 卡号改用真实感号段（Visa 402688 / 银联 620522）
 *       —— 卡号存在 cardSecrets 里，不升版本的话浏览器会继续用旧号段
 *  15 → 新增账户域（存钱计划 / 一次性虚拟卡）与我的域（邀请 / 会员）：
 *       savings / virtualCards / invitations / membership
 *  16 → 新增工资与备用金 / 借款与分期 / 理财扩展（现金管理 / 投资与定投 / 保险）：
 *       salaryPlan / overdraft / credit / cashManagement / investments / insurance
 *  18 → 支出基金改称支出预算：funds / fundPointDays / fundPasses
 *       → budgets / budgetPointDays / budgetPasses
 */
export const MOCK_SCHEMA = 23;
const DAY = 86_400_000;
/** 借记卡的展示文案，与种子数据里的星享借记卡一致 */
export const CARD_PAYMENT_METHOD = '招财猫 · 星享借记卡 尾号 8888';
/* ------------------------------------------------------------------ 换汇 */
/**
 * 换汇基准汇率表：1 单位该币种 = ? 人民币。
 * 真实系统由行情源推送，这里固定住以保证演示可复现、可断言。
 */
export const FX_MID_RATES = {
    CNY: 1,
    USD: 7.1562,
    HKD: 0.91547,
};
/** 换汇点差 0.35%，已经包含在成交汇率里，不再单独收一笔换汇手续费 */
export const FX_SPREAD = 0.0035;
/** 报价有效期 30 秒。汇率是时效性数据，过期必须重新询价 */
export const FX_QUOTE_TTL = 30;
/**
 * 1 from = ? to，含点差。
 * 点差永远对客户不利（换出去的钱比基准价少一点），这是银行的收入来源。
 */
export function fxRate(from, to) {
    if (from === to)
        return 1;
    const mid = FX_MID_RATES[from] / FX_MID_RATES[to];
    return mid * (1 - FX_SPREAD);
}
/* ------------------------------------------------------- 交易编号 / 授权码 */
/** FNV-1a：把字符串散列成一个稳定的 32 位无符号整数 */
function fnv(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
        h = (h ^ seed.charCodeAt(i)) >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
/**
 * 交易编号由 id 确定性派生，而不是随机生成：
 * 同一条记录每次刷新、每次重新登录拿到的凭证号必须一致，否则客服无法核对。
 * 位数（19 位）与真实回单保持一致。
 */
export function makeReferenceNo(seed) {
    let x = fnv(`ref:${seed}`);
    let out = '';
    while (out.length < 18) {
        x = (Math.imul(x ^ (x >>> 13), 2246822519) + 0x9e3779b9) >>> 0;
        out += String(x % 10_000_000_000).padStart(10, '0');
    }
    return `2${out.slice(0, 18)}`;
}
/** 6 位授权码，只有卡类 / 快捷支付才有 */
export function makeAuthCode(seed) {
    return String(fnv(`auth:${seed}`) % 1_000_000).padStart(6, '0');
}
/** 按分类推断渠道：转账与房租走汇款，工资走代发，其余是消费类 */
function defaultChannel(category, direction) {
    if (category === 'transfer' || category === 'housing')
        return 'transfer';
    if (category === 'salary')
        return 'account';
    return direction === 'in' ? 'account' : 'quickpay';
}
function defaultPaymentMethod(channel, account) {
    return channel === 'card' || channel === 'quickpay' ? CARD_PAYMENT_METHOD : account.label;
}
/* -------------------------------------------------------------- 余额回推 */
/**
 * 交易前后余额：从账户**当前**余额按时间倒着推。
 * 台账里每笔都带自己的 signedAmount（手续费是独立一笔），
 * 所以这个推导对任意条数据都成立，转账 / 转入之后立刻是准的。
 */
export function withBalances(rows, closing) {
    let running = closing;
    return rows.map((row) => {
        const balanceAfter = running;
        // 在途仅冻结可用额度，失败/撤销没有扣款，不能参与余额回推。
        if (row.status !== 'failed' && row.pendingReason !== 'inflight')
            running -= row.signedAmount;
        return { ...row, detail: { ...row.detail, balanceAfter, balanceBefore: running } };
    });
}
/**
 * 列表 DTO：交易列表只需要够渲染一行的字段。
 * 明细（交易编号 / 渠道 / 汇率 / 交易前后余额）由 getTransaction 单独下发。
 */
export function toTransactionListItem(rec) {
    return {
        id: rec.id,
        accountId: rec.accountId,
        direction: rec.direction,
        amount: rec.amount,
        signedAmount: rec.signedAmount,
        counterparty: rec.counterparty,
        memo: rec.memo,
        category: rec.category,
        createdAt: rec.createdAt,
        status: rec.status,
        // 后台分类中/失败要透传到列表，前端才能显示「正在分类」而不是干等
        ...(rec.classificationState ? { classificationState: rec.classificationState } : {}),
        // 在途/清算中要透传到列表（清单 §9.2），前端才有得渲染倒计时
        ...(rec.pendingReason ? { pendingReason: rec.pendingReason } : {}),
        ...(rec.holdUntil ? { holdUntil: rec.holdUntil } : {}),
    };
}
/** 相对今天偏移 n 天、指定时刻的 ISO 字符串 */
function daysAgo(n, hour = 12, minute = 0) {
    const d = new Date(Date.now() - n * DAY);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
}
function inDays(n, hour = 9) {
    const d = new Date(Date.now() + n * DAY);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
}
function monthKey(offset = 0) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/**
 * 会员评定的日终资产快照种子：最近 62 个北京自然日各一条，
 * 围绕基准余额 ±1.5% 内的确定性波动（固定种子伪随机，断言可复现）。
 * 这是演示档案的初始凭证，不是从流水回推出来的 —— 正式客户
 * 的快照只能从 `persist()` 起逐日积累，缺日按 0 计日均。
 */
function seedAssetSnapshots(base) {
    let x = 88_230_001 >>> 0;
    const rand = () => {
        x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
        return x / 0xffffffff;
    };
    const out = [];
    for (let n = 61; n >= 1; n--) {
        const jitter = Math.round(base * (rand() - 0.5) * 0.03);
        out.push({ date: beijingDay(Date.now() - n * DAY), assets: base + jitter });
    }
    return out;
}
let seq = 0;
const nextId = (prefix) => `${prefix}_${String(++seq).padStart(4, '0')}`;
/**
 * 汇率口径与 ZA / Alipay+ 一致：**已包含外币交易手续费**，不再单独列一笔手续费。
 * 因此记账金额 = 原币金额 × 这里的汇率，四舍五入到分。
 */
const USD_CNY_RATE = 7.2958; // 基准 ~7.1562 × 1.0195（1.95% 外币交易手续费）
const HKD_CNY_RATE = 0.93341; // 基准 ~0.9155 × 1.0195
const FX_NOTE = '已包括 1.95% 外币交易手续费';
const SEED_ROWS = [
    // —— 最近 7 天：喂给「现金流」图表，保证每天都有进出 ——
    {
        direction: 'out', amount: 8620, counterparty: '全家便利店', memo: '全家便利店',
        category: 'shopping', day: 0, hour: 8, minute: 42,
        detail: { channel: 'card', location: '上海市浦东新区 · 世纪大道店' },
    },
    {
        direction: 'out', amount: 4500, counterparty: 'Manner Coffee', memo: 'Manner Coffee',
        category: 'dining', day: 0, hour: 14, minute: 10,
        detail: { channel: 'card', location: '上海市浦东新区 · 国金中心店' },
    },
    {
        direction: 'out', amount: 259900, counterparty: 'Apple Store', memo: 'Apple Store 消费',
        category: 'shopping', day: 1, hour: 14, minute: 32,
        detail: {
            channel: 'quickpay',
            merchantId: 'M1008842137',
            merchantCountry: '中国',
            merchantCity: '上海市',
            location: '线上商户 · Apple Store 中国',
            counterpartyBank: '支付宝（中国）网络技术有限公司',
            remark: 'MacBook Air 配件与 AppleCare',
        },
    },
    // 外币交易：原币 USD，记账币 CNY，汇率已含 1.95% 外币交易手续费
    {
        direction: 'out', amount: 3648, counterparty: 'FIRWWORKS.AI',
        memo: 'AI 图像生成服务订阅', category: 'subscription', day: 1, hour: 15, minute: 18,
        detail: {
            channel: 'quickpay',
            merchantId: 'M1650870866',
            merchantCountry: '美国',
            merchantCity: '加利福尼亚州',
            location: '线上商户 · fireworks.ai',
            counterpartyBank: 'Stripe Payments',
            originAmount: 500,
            originCurrency: 'USD',
            exchangeRate: USD_CNY_RATE,
            exchangeRateNote: FX_NOTE,
        },
    },
    {
        direction: 'out', amount: 12840, counterparty: '盒马鲜生', memo: '盒马鲜生',
        category: 'shopping', day: 1, hour: 19, minute: 5,
        detail: { channel: 'quickpay', location: '上海市浦东新区 · 金桥店' },
    },
    {
        direction: 'out', amount: 32800, counterparty: '海底捞', memo: '海底捞火锅',
        category: 'dining', day: 2, hour: 19, minute: 20,
        detail: {
            channel: 'card',
            merchantId: 'M2044190583',
            merchantCountry: '中国',
            merchantCity: '上海市',
            location: '上海市静安区 · 南京西路店',
        },
    },
    {
        direction: 'in', amount: 120000, counterparty: '闲鱼卖出', memo: '闲置相机镜头',
        category: 'other', day: 2, hour: 21, minute: 48,
        detail: {
            channel: 'account',
            counterpartyName: '闲鱼买家',
            counterpartyBank: '支付宝（中国）网络技术有限公司',
        },
    },
    {
        direction: 'out', amount: 650000, counterparty: '房租', memo: '本月房租',
        category: 'housing', day: 3, hour: 9, minute: 0,
        detail: {
            channel: 'transfer',
            counterpartyName: '张伟',
            counterpartyAccountNo: '1100 **** **** 3321',
            counterpartyBank: '中国建设银行',
            location: '招财猫银行 App',
            remark: '本月房租',
        },
    },
    {
        direction: 'in', amount: 420000, counterparty: '项目奖金', memo: '季度项目奖金',
        category: 'salary', day: 4, hour: 11, minute: 30,
        detail: {
            channel: 'account',
            counterpartyName: '上海云栖科技有限公司',
        },
    },
    {
        direction: 'out', amount: 5200, counterparty: '滴滴出行', memo: '滴滴出行',
        category: 'transport', day: 4, hour: 22, minute: 12,
        detail: { channel: 'quickpay', location: '线上商户 · 滴滴出行' },
    },
    {
        direction: 'out', amount: 21000, counterparty: '万达影城', memo: '电影票',
        category: 'other', day: 5, hour: 20, minute: 0,
        detail: { channel: 'card', location: '上海市杨浦区 · 五角场店' },
    },
    {
        direction: 'out', amount: 8900, counterparty: '美团外卖', memo: '美团外卖',
        category: 'dining', day: 5, hour: 12, minute: 36,
        detail: { channel: 'quickpay', location: '线上商户 · 美团' },
    },
    // 工资放在 7 天窗口之外，避免单根尖峰把现金流图压平（近 30 天视图仍能看到）
    {
        direction: 'in', amount: 1800000, counterparty: '工资入账', memo: '本月薪资',
        category: 'salary', day: 9, hour: 10, minute: 0,
        detail: {
            channel: 'account',
            paymentMethod: '工资代发',
            counterpartyName: '上海云栖科技有限公司',
            counterpartyAccountNo: '1001 **** **** 8899',
            location: '代发渠道',
            remark: '本月薪资',
        },
    },
    {
        direction: 'out', amount: 6800, counterparty: '瑞幸咖啡', memo: '瑞幸咖啡',
        category: 'dining', day: 6, hour: 9, minute: 12,
        detail: { channel: 'quickpay', location: '线上商户 · 瑞幸咖啡' },
    },
    {
        direction: 'out', amount: 14592, counterparty: 'OpenAI', memo: 'API 用量结算',
        category: 'subscription', day: 6, hour: 10, minute: 5,
        detail: {
            channel: 'quickpay',
            merchantId: 'M1993002748',
            merchantCountry: '美国',
            merchantCity: '加利福尼亚州',
            location: '线上商户 · platform.openai.com',
            counterpartyBank: 'Stripe Payments',
            originAmount: 2000,
            originCurrency: 'USD',
            exchangeRate: USD_CNY_RATE,
            exchangeRateNote: FX_NOTE,
        },
    },
    // —— 更早：喂给「消费分析」的当月与近 6 个月走势 ——
    {
        direction: 'out', amount: 12800, counterparty: '滴滴出行', memo: '滴滴出行',
        category: 'transport', day: 8, hour: 8, minute: 40,
        detail: { channel: 'quickpay' },
    },
    {
        direction: 'out', amount: 2500, counterparty: '网易云音乐', memo: '黑胶会员',
        category: 'subscription', day: 8, hour: 0, minute: 5,
        detail: {
            channel: 'quickpay',
            merchantId: 'M1003310275',
            merchantCountry: '中国',
            merchantCity: '杭州市',
            location: '线上商户 · 网易云音乐',
            remark: '自动扣款 · 黑胶会员',
        },
    },
    {
        direction: 'out', amount: 45600, counterparty: '优衣库', memo: '换季衣物',
        category: 'shopping', day: 10, hour: 18, minute: 26,
        detail: { channel: 'card', location: '上海市徐汇区 · 港汇恒隆店' },
    },
    {
        direction: 'out', amount: 15000, counterparty: '转账 · 陈嘉禾', memo: '房租 AA',
        category: 'transfer', day: 11, hour: 21, minute: 3,
        detail: {
            channel: 'transfer',
            counterpartyName: '陈嘉禾',
            counterpartyAccountNo: '6222 **** **** 4471',
            counterpartyBank: '招财猫银行',
            location: '招财猫银行 App',
            remark: '房租 AA',
        },
    },
    // 港币消费：验证汇率按 ISO 4217 惯例展示（金额「代码 数字」、汇率「数字 代码 数字」）
    {
        direction: 'out', amount: 83914, counterparty: 'Apple Store 香港',
        memo: 'AirPods Pro', category: 'shopping', day: 12, hour: 16, minute: 40,
        detail: {
            channel: 'card',
            merchantId: 'M3007719024',
            merchantCountry: '中国香港',
            merchantCity: '中环',
            location: '香港中环 · ifc mall 店',
            originAmount: 89900,
            originCurrency: 'HKD',
            exchangeRate: HKD_CNY_RATE,
            exchangeRateNote: FX_NOTE,
        },
    },
    {
        direction: 'out', amount: 8800, counterparty: '喜茶', memo: '喜茶',
        category: 'dining', day: 12, hour: 15, minute: 47,
        detail: { channel: 'quickpay' },
    },
    {
        direction: 'in', amount: 32000, counterparty: '退款 · 京东', memo: '订单退款',
        category: 'other', day: 13, hour: 11, minute: 20,
        detail: { channel: 'quickpay', counterpartyName: '京东', counterpartyBank: '京东支付' },
    },
    {
        direction: 'out', amount: 19900, counterparty: '腾讯视频', memo: '年度会员',
        category: 'subscription', day: 14, hour: 0, minute: 3,
        detail: { channel: 'quickpay', remark: '自动扣款 · 年度会员' },
    },
    {
        direction: 'out', amount: 8900, counterparty: '地铁出行', memo: '交通卡充值',
        category: 'transport', day: 15, hour: 7, minute: 55,
        detail: { channel: 'quickpay', location: '上海地铁 · 自动充值' },
    },
    {
        direction: 'out', amount: 128000, counterparty: '无印良品', memo: 'MUJI 家居',
        category: 'shopping', day: 22, hour: 16, minute: 10,
        detail: { channel: 'card', location: '上海市静安区 · 兴业太古汇店' },
    },
    {
        direction: 'out', amount: 26000, counterparty: '西贝莜面村', memo: '西贝莜面村',
        category: 'dining', day: 28, hour: 12, minute: 30,
        detail: { channel: 'card' },
    },
    // 境外转账：手续费是独立一笔台账，所以在详情里只留汇款信息
    {
        direction: 'out', amount: 500000, counterparty: '转账 · Wing Chan', memo: '境外转账至汇丰',
        category: 'transfer', day: 30, hour: 10, minute: 12,
        detail: {
            channel: 'transfer',
            counterpartyName: 'Wing Chan',
            counterpartyAccountNo: '0041 **** **** 9118',
            counterpartyBank: '汇丰银行（香港）',
            location: '招财猫银行 App',
            remark: '生活费',
        },
    },
    {
        direction: 'in', amount: 1800000, counterparty: '工资入账', memo: '上月薪资',
        category: 'salary', day: 36, hour: 10, minute: 0,
        detail: {
            channel: 'account',
            paymentMethod: '工资代发',
            counterpartyName: '上海云栖科技有限公司',
        },
    },
    {
        direction: 'out', amount: 650000, counterparty: '房租', memo: '上月房租',
        category: 'housing', day: 33, hour: 9, minute: 0,
        detail: {
            channel: 'transfer',
            counterpartyName: '张伟',
            location: '招财猫银行 App',
            remark: '上月房租',
        },
    },
    {
        direction: 'out', amount: 368000, counterparty: '京东', memo: '显示器',
        category: 'shopping', day: 40, hour: 20, minute: 15,
        detail: { channel: 'quickpay', counterpartyBank: '京东支付' },
    },
    {
        direction: 'out', amount: 42000, counterparty: '山姆会员店', memo: '山姆会员店',
        category: 'shopping', day: 44, hour: 17, minute: 5,
        detail: { channel: 'card' },
    },
    {
        direction: 'out', amount: 18000, counterparty: '健身房', memo: '月卡',
        category: 'subscription', day: 48, hour: 8, minute: 0,
        detail: { channel: 'quickpay', remark: '自动扣款 · 月卡' },
    },
    {
        direction: 'in', amount: 1800000, counterparty: '工资入账', memo: '两月前薪资',
        category: 'salary', day: 66, hour: 10, minute: 0,
        detail: {
            channel: 'account',
            paymentMethod: '工资代发',
            counterpartyName: '上海云栖科技有限公司',
        },
    },
    {
        direction: 'out', amount: 650000, counterparty: '房租', memo: '两月前房租',
        category: 'housing', day: 63, hour: 9, minute: 0,
        detail: { channel: 'transfer', counterpartyName: '张伟', location: '招财猫银行 App' },
    },
    {
        direction: 'out', amount: 215000, counterparty: '携程旅行', memo: '周末机票',
        category: 'transport', day: 70, hour: 13, minute: 40,
        detail: { channel: 'quickpay', counterpartyBank: '携程支付' },
    },
];
/**
 * 台账种子的组装：默认值由这里补齐，SEED_ROWS 只声明「这条交易特别在哪」。
 * 交易前后余额不在这里落库 —— 它们随账户余额变化，由 withBalances 在读取时回推。
 */
function seedTransactions(account) {
    return SEED_ROWS.map((row) => {
        const id = nextId('txn');
        const channel = row.detail?.channel ?? defaultChannel(row.category, row.direction);
        const detail = {
            referenceNo: makeReferenceNo(id),
            channel,
            paymentMethod: defaultPaymentMethod(channel, account),
            accountLabel: account.label,
            accountNo: account.accountNo,
            settleCurrency: account.currency,
            balanceBefore: 0,
            balanceAfter: 0,
            // 授权码只有卡类 / 快捷支付才有；转账与代发不产生授权码
            ...(channel === 'card' || channel === 'quickpay' ? { authCode: makeAuthCode(id) } : {}),
        };
        if (row.detail)
            Object.assign(detail, row.detail);
        return {
            id,
            accountId: account.id,
            direction: row.direction,
            amount: row.amount,
            signedAmount: row.direction === 'in' ? row.amount : -row.amount,
            counterparty: row.counterparty,
            memo: row.memo,
            category: row.category,
            createdAt: daysAgo(row.day, row.hour ?? 12, row.minute ?? 0),
            status: 'success',
            detail,
        };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/* 承诺语句与惩戒文案在 lib/account-opening.ts —— 页面与 mock 共用同一份来源 */
/* ------------------------------------------------------------ 卡产品与支付密码 */
/** 演示用的支付密码 */
export const DEFAULT_PAY_PASSWORD = '888888';
/**
 * 本行给这位客户的转数快 FPS ID。
 *
 * 转数快标识是**登记制**：手机号 / 电邮 / FPS ID 三选一都能收款，
 * 但都得先在银行登记过。这里固定一个值，别的客户登记册（FPS_REGISTRY）里不会出现它。
 */
export const USER_FPS_ID = '2046881';
/** 支付密码连续输错多少次就锁定 */
export const PAY_PASSWORD_MAX_ATTEMPTS = 3;
/**
 * 可申请的卡产品。
 * 定价与权益归后端 —— 前端只负责展示和收款，不写死费率。
 */
export const CARD_PRODUCTS = [
    {
        code: 'LCB-UP-DEBIT',
        name: '招财猫 · 云闪付借记卡',
        theme: 'gold',
        network: 'unionpay',
        kind: 'debit',
        issuingFee: 1_000, // ¥10.00
        deliveryFee: 0, // 挂号信寄送，不收费
        perks: ['境内跨行 ATM 取现每月前 5 笔免手续费', '云闪付乘车码 9 折', '动账短信提醒'],
        deliveryDays: 5,
    },
    {
        code: 'LCB-VISA-DEBIT',
        name: '招财猫 · Visa 全球借记卡',
        theme: 'ink',
        network: 'visa',
        kind: 'debit',
        issuingFee: 2_000, // ¥20.00
        deliveryFee: 1_500, // ¥15.00 快递
        perks: ['境外消费免 1.5% 货币转换费', '全球 ATM 取现每月前 3 笔免费', '旅行意外险'],
        deliveryDays: 7,
    },
];
/* ==========================================================================
   理财：产品、风险测评、持仓
   --------------------------------------------------------------------------
   数据口径对着监管来（见 api/types.ts 顶部的注释）。净值序列用固定种子的
   伪随机游走生成 —— 每次刷新都一样，便于断言，也免得演示时数字乱跳。
   ========================================================================== */
const pad2 = (n) => String(n).padStart(2, '0');
/**
 * 固定种子的净值序列。
 * 用伪随机而不是 Math.random()：同一天多次刷新得到的曲线必须一致，
 * 否则用户会觉得数据在乱跳，截图和断言也没法做。
 */
function navSeries(seed, days, drift, vol) {
    let x = seed >>> 0;
    const rand = () => {
        x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
        return x / 0xffffffff;
    };
    const out = [];
    let nav = 1;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i -= 1) {
        nav *= 1 + drift / 365 + (rand() - 0.5) * vol;
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        out.push({
            date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
            nav: Number(nav.toFixed(4)),
        });
    }
    return out;
}
/** 按日计提、已体现在净值里的费率 */
const ONGOING_FEES_STD = [
    { label: '固定管理费', rate: 0.003 },
    { label: '托管费', rate: 0.0005 },
    { label: '销售服务费', rate: 0.002 },
];
export const WEALTH_PRODUCTS = [
    {
        code: 'LCB-CASH-A',
        name: '招财猫现金添利 A',
        issuer: '招财猫理财有限责任公司',
        category: 'cash',
        risk: 'R1',
        principalProtected: false,
        benchmark: {
            kind: 'range',
            low: 0.016,
            high: 0.021,
            basis: '以组合平均剩余期限 90 天以内、同业存单与短融为主要配置测算',
        },
        sevenDayYield: 0.0186,
        nav: 1.0015,
        navDate: '',
        sinceInception: 0.0181,
        volatility: 0.0004,
        minAmount: 100,
        stepAmount: 100,
        term: '随时赎回',
        openEnded: true,
        ongoingFees: [
            { label: '固定管理费', rate: 0.0015 },
            { label: '托管费', rate: 0.0002 },
            { label: '销售服务费', rate: 0.002 },
        ],
        transactionFees: [],
        navHistory: navSeries(11, 30, 0.018, 0.00008),
        topHoldings: [
            { name: '同业存单（穿透后合并列示）', weight: 0.42, lookThrough: false },
            { name: '短期融资券', weight: 0.26, lookThrough: false },
            { name: '现金及银行存款', weight: 0.22, lookThrough: false },
            { name: '政策性金融债', weight: 0.1, lookThrough: false },
            { name: '国家开发银行 2025 年第 8 期金融债', weight: 0.09, lookThrough: true },
            { name: '中国工商银行 2025 年第 3 期同业存单', weight: 0.08, lookThrough: true },
            { name: '中国农业银行 2025 年第 12 期同业存单', weight: 0.07, lookThrough: true },
        ],
    },
    {
        code: 'LCB-FIXED-090',
        name: '招财猫稳盈 90 天',
        issuer: '招财猫理财有限责任公司',
        category: 'fixed',
        risk: 'R2',
        principalProtected: false,
        benchmark: {
            kind: 'range',
            low: 0.023,
            high: 0.028,
            basis: '以中债-新综合全价(1 年以下)指数近一年收益率乘以 92% 测算，已扣除产品费用',
        },
        nav: 1.0064,
        navDate: '',
        sinceInception: 0.0258,
        volatility: 0.0031,
        minAmount: 1_000_000,
        stepAmount: 100_000,
        term: '90 天',
        openEnded: false,
        ongoingFees: ONGOING_FEES_STD,
        transactionFees: [],
        navHistory: navSeries(23, 30, 0.026, 0.0006),
        topHoldings: [
            { name: '国债', weight: 0.31, lookThrough: false },
            { name: '政策性金融债', weight: 0.28, lookThrough: false },
            { name: '高等级信用债', weight: 0.24, lookThrough: false },
            { name: '现金及银行存款', weight: 0.17, lookThrough: false },
            { name: '中国进出口银行 2025 年第 5 期金融债', weight: 0.11, lookThrough: true },
            { name: '中国建设银行 2025 年第 22 期同业存单', weight: 0.09, lookThrough: true },
        ],
    },
    {
        code: 'LCB-FIXED-365',
        name: '招财猫稳盈 365 天',
        issuer: '招财猫理财有限责任公司',
        category: 'fixed',
        risk: 'R2',
        principalProtected: false,
        // 公式型基准：新规鼓励的做法 —— 收益从哪来、跟着什么走，一眼能看明白
        benchmark: {
            kind: 'formula',
            formula: '中债-新综合全价(1 年以下)指数收益率 × 90% + 沪深 300 指数收益率 × 3% + 活期存款利率 × 7%',
            basis: '债权类资产打底（90%）、权益类小幅增强（3%），并保留 7% 流动性与活期利率挂钩',
        },
        nav: 1.0128,
        navDate: '',
        sinceInception: 0.0287,
        volatility: 0.0042,
        minAmount: 1_000_000,
        stepAmount: 100_000,
        term: '365 天',
        openEnded: false,
        // 热门产品：钻石会员提前申购窗口（窗口结束全员开放）
        priorityTier: 'diamond',
        priorityOpenAt: priorityOpenAt(),
        ongoingFees: ONGOING_FEES_STD,
        transactionFees: [],
        navHistory: navSeries(37, 30, 0.029, 0.0008),
        topHoldings: [
            { name: '政策性金融债', weight: 0.36, lookThrough: false },
            { name: '国债', weight: 0.25, lookThrough: false },
            { name: '高等级信用债', weight: 0.21, lookThrough: false },
            { name: '权益类基金', weight: 0.05, lookThrough: false },
            { name: '现金及银行存款', weight: 0.13, lookThrough: false },
            { name: '中国农业发展银行 2025 年第 9 期金融债', weight: 0.13, lookThrough: true },
            { name: '沪深 300 交易型开放式指数基金', weight: 0.04, lookThrough: true },
        ],
    },
    {
        code: 'LCB-MIXED-180',
        name: '招财猫平衡配置 180 天',
        issuer: '招财猫理财有限责任公司',
        category: 'mixed',
        risk: 'R3',
        principalProtected: false,
        benchmark: {
            kind: 'formula',
            formula: '中债-新综合全价指数收益率 × 60% + 沪深 300 指数收益率 × 35% + 活期存款利率 × 5%',
            basis: '股债六四开，权益部分跟踪沪深 300，债券部分跟踪中债综合全价指数',
        },
        nav: 0.9984,
        navDate: '',
        sinceInception: 0.0412,
        volatility: 0.0248,
        minAmount: 1_000_000,
        stepAmount: 100_000,
        term: '180 天',
        openEnded: false,
        // 热门产品：白金及以上提前申购窗口（窗口结束全员开放）
        priorityTier: 'platinum',
        priorityOpenAt: priorityOpenAt(),
        ongoingFees: ONGOING_FEES_STD,
        transactionFees: [],
        navHistory: navSeries(51, 30, 0.045, 0.006),
        topHoldings: [
            { name: '债券', weight: 0.58, lookThrough: false },
            { name: '股票', weight: 0.29, lookThrough: false },
            { name: '基金', weight: 0.08, lookThrough: false },
            { name: '现金及银行存款', weight: 0.05, lookThrough: false },
            { name: '沪深 300 交易型开放式指数基金', weight: 0.07, lookThrough: true },
            { name: '招商银行股份有限公司', weight: 0.021, lookThrough: true },
            { name: '宁德时代新能源科技股份有限公司', weight: 0.018, lookThrough: true },
        ],
    },
    {
        code: 'LCB-EQUITY-300',
        name: '招财猫沪深 300 指数增强',
        issuer: '招财猫理财有限责任公司',
        category: 'equity',
        risk: 'R4',
        principalProtected: false,
        benchmark: {
            kind: 'formula',
            formula: '沪深 300 指数收益率 × 95% + 活期存款利率 × 5%',
            basis: '以沪深 300 指数为业绩基准，力争在控制跟踪误差的前提下取得超额收益',
        },
        nav: 1.0342,
        navDate: '',
        sinceInception: 0.0863,
        volatility: 0.1876,
        minAmount: 1_000_000,
        stepAmount: 100_000,
        term: '随时赎回',
        openEnded: true,
        ongoingFees: ONGOING_FEES_STD,
        // 一次性收取、投资者额外承担 —— 与按日计提的那几项性质不同，要分开列
        transactionFees: [
            { label: '申购费', rate: 0.0015 },
            { label: '赎回费（持有不满 7 天）', rate: 0.005 },
        ],
        navHistory: navSeries(67, 30, 0.08, 0.018),
        topHoldings: [
            { name: '股票', weight: 0.93, lookThrough: false },
            { name: '现金及银行存款', weight: 0.07, lookThrough: false },
            { name: '贵州茅台酒股份有限公司', weight: 0.052, lookThrough: true },
            { name: '宁德时代新能源科技股份有限公司', weight: 0.041, lookThrough: true },
            { name: '中国平安保险(集团)股份有限公司', weight: 0.033, lookThrough: true },
        ],
    },
    {
        code: 'LCB-GOLD-365',
        name: '招财猫黄金挂钩 365 天',
        issuer: '招财猫理财有限责任公司',
        category: 'derivative',
        risk: 'R5',
        principalProtected: false,
        benchmark: {
            kind: 'formula',
            formula: '上海金基准价收益率 × 90% + 活期存款利率 × 10%',
            basis: '以上海黄金交易所上海金基准价为跟踪标的，含衍生品头寸，净值波动显著',
        },
        nav: 1.0571,
        navDate: '',
        sinceInception: 0.0947,
        volatility: 0.3125,
        minAmount: 5_000_000,
        stepAmount: 500_000,
        term: '365 天',
        openEnded: false,
        ongoingFees: ONGOING_FEES_STD,
        transactionFees: [{ label: '申购费', rate: 0.003 }],
        navHistory: navSeries(83, 30, 0.09, 0.03),
        topHoldings: [
            { name: '黄金现货合约', weight: 0.74, lookThrough: false },
            { name: '黄金 ETF', weight: 0.18, lookThrough: false },
            { name: '现金及银行存款', weight: 0.08, lookThrough: false },
            { name: '上海黄金交易所 Au99.99 现货合约', weight: 0.61, lookThrough: true },
            { name: '华安易富黄金交易型开放式证券投资基金', weight: 0.17, lookThrough: true },
        ],
    },
];
/**
 * 风险承受能力测评问卷。
 * 题目覆盖监管列明的维度（年龄、财务状况、投资经验、投资目的、收益期望、
 * 风险偏好、流动性要求、风险认识及风险损失承受程度），不是随便编几道。
 */
export const RISK_QUESTIONS = [
    {
        id: 'q1',
        question: '您的年龄区间是？',
        options: [
            { label: '60 岁以上', score: 1 },
            { label: '46–60 岁', score: 2 },
            { label: '31–45 岁', score: 3 },
            { label: '18–30 岁', score: 4 },
        ],
    },
    {
        id: 'q2',
        question: '您的家庭年收入（税后）大致为？',
        options: [
            { label: '10 万元以下', score: 1 },
            { label: '10 万–30 万元', score: 2 },
            { label: '30 万–100 万元', score: 3 },
            { label: '100 万元以上', score: 4 },
        ],
    },
    {
        id: 'q3',
        question: '您计划投入理财的资金占家庭金融资产的比例？',
        options: [
            { label: '70% 以上', score: 1 },
            { label: '50%–70%', score: 2 },
            { label: '20%–50%', score: 3 },
            { label: '20% 以下', score: 4 },
        ],
    },
    {
        id: 'q4',
        question: '您的投资经验是？',
        options: [
            { label: '只买过存款和国债', score: 1 },
            { label: '买过货币基金、银行理财', score: 2 },
            { label: '买过股票或股票型基金', score: 3 },
            { label: '买过期货、期权等衍生品', score: 4 },
        ],
    },
    {
        id: 'q5',
        question: '您能接受的本金最大回撤是？',
        options: [
            { label: '不能接受任何亏损', score: 1 },
            { label: '5% 以内', score: 2 },
            { label: '5%–20%', score: 3 },
            { label: '20% 以上', score: 4 },
        ],
    },
    {
        id: 'q6',
        question: '这笔资金您计划投资多久？',
        options: [
            { label: '随时可能要用', score: 1 },
            { label: '半年以内', score: 2 },
            { label: '半年到两年', score: 3 },
            { label: '两年以上', score: 4 },
        ],
    },
];
/** 总分 → 风险承受能力等级 */
export function toleranceFromScore(score) {
    if (score <= 9)
        return 'C1';
    if (score <= 12)
        return 'C2';
    if (score <= 16)
        return 'C3';
    if (score <= 20)
        return 'C4';
    return 'C5';
}
/* ==========================================================================
   收款银行名录（真实数据）
   --------------------------------------------------------------------------
   两地的「银行代码」是两套不同的真实体系，但**结构完全对应**：
   都是 3 位、银行级、由各自的清算机构分配 —— 所以放在同一个 code 字段里，
   用 region 区分。

   · 内地 = 人民银行《支付系统银行行别、行号业务标准》（银发〔2003〕189 号）
            里的「银行行别代码」。3 位 = 1 位类别 + 2 位顺序编码：
            0 中央银行 / 1 国有独资商业银行 / 2 政策性银行 / 3 其他商业银行 /
            4 非银行金融机构 / 5-7 外资银行 / 9 特许参与者。
            例：102 中国工商银行、104 中国银行、308 招商银行、403 邮储银行。
   · 香港 = HKICL 清算所银行代码（3 位），在 FPS / CHATS / 支票清算里通用。
            例：004 汇丰、012 中银香港、024 恒生。

   ⚠️ 两套码表是**相互独立**的，code 单独并不唯一：在完整码表里
      307（内地平安 / 香港 ABN AMRO）、308、309、316 两地都有机构在用。
      本名录收窄后恰好没有撞号，但这是巧合不是保证 —— 加一家银行就可能撞上，
      所以定位一家银行**必须**带上 region。真实跨境接口也是用
      (国家/地区, 清算代码) 这一对来定位的。

   收录范围刻意收窄，不是全量：
     内地 —— 六大行 + 全国性股份制商业银行（零售汇款会遇到的）
     香港 —— 本地持牌零售银行 + 内地银行在港机构（跨境支付通的实际收款方）
   未收录香港虚拟银行（众安 / Mox / livi 等）：它们的清算代码没找到可靠来源，
   宁可缺也不猜。
   ========================================================================== */
/** 内地：人民银行支付系统行别代码 */
const CN_BANKS = [
    // 本行是虚构机构，不占用真实行别代码，用内部代码 LCB 表示，也没有行标
    // internal: 本行账户由本行核验，不参与卡 BIN 识别（见 Bank.internal）
    { code: 'LCB', region: 'CN', name: '招财猫银行', shortName: '招财猫', color: '#E0A83C', internal: true, logo: '/banks/cn-LCB.svg' },
    { code: '102', region: 'CN', name: '中国工商银行', shortName: '工商银行', color: '#C7000B', domain: 'icbc.com.cn', logo: '/banks/cn-102.svg' },
    { code: '103', region: 'CN', name: '中国农业银行', shortName: '农业银行', color: '#00843D', domain: 'abchina.com', logo: '/banks/cn-103.svg' },
    { code: '104', region: 'CN', name: '中国银行', shortName: '中国银行', color: '#A6192E', domain: 'boc.cn', logo: '/banks/cn-104.svg' },
    { code: '105', region: 'CN', name: '中国建设银行', shortName: '建设银行', color: '#0066B3', domain: 'ccb.com', logo: '/banks/cn-105.svg' },
    { code: '301', region: 'CN', name: '交通银行', shortName: '交通银行', color: '#003D7C', domain: 'bankcomm.com', logo: '/banks/cn-301.svg' },
    { code: '308', region: 'CN', name: '招商银行', shortName: '招商银行', color: '#C8102E', domain: 'cmbchina.com', logo: '/banks/cn-308.svg' },
    { code: '302', region: 'CN', name: '中信银行', shortName: '中信银行', color: '#E60012', domain: 'citicbank.com', logo: '/banks/cn-302.svg' },
    { code: '303', region: 'CN', name: '中国光大银行', shortName: '光大银行', color: '#7A2E8E', domain: 'cebbank.com', logo: '/banks/cn-303.svg' },
    { code: '304', region: 'CN', name: '华夏银行', shortName: '华夏银行', color: '#C8102E', domain: 'hxb.com.cn', logo: '/banks/cn-304.svg' },
    { code: '305', region: 'CN', name: '中国民生银行', shortName: '民生银行', color: '#005BAC', domain: 'cmbc.com.cn', logo: '/banks/cn-305.svg' },
    // 306 / 307 在行别代码表里是「广东发展银行」「深圳发展银行」，两家后来分别更名为广发、平安
    { code: '306', region: 'CN', name: '广发银行', shortName: '广发银行', color: '#C8102E', domain: 'cgbchina.com.cn', logo: '/banks/cn-306.svg' },
    { code: '307', region: 'CN', name: '平安银行', shortName: '平安银行', color: '#EA5504', domain: 'bank.pingan.com', logo: '/banks/cn-307.svg' },
    { code: '309', region: 'CN', name: '兴业银行', shortName: '兴业银行', color: '#00693E', domain: 'cib.com.cn', logo: '/banks/cn-309.svg' },
    { code: '310', region: 'CN', name: '上海浦东发展银行', shortName: '浦发银行', color: '#00538C', domain: 'spdb.com.cn', logo: '/banks/cn-310.svg' },
    { code: '315', region: 'CN', name: '恒丰银行', shortName: '恒丰银行', color: '#C8102E', domain: 'hfbank.com.cn', logo: '/banks/cn-315.svg' },
    { code: '316', region: 'CN', name: '浙商银行', shortName: '浙商银行', color: '#005BAC', domain: 'czbank.com', logo: '/banks/cn-316.svg' },
    { code: '318', region: 'CN', name: '渤海银行', shortName: '渤海银行', color: '#003D7C', domain: 'cbhb.com.cn', logo: '/banks/cn-318.svg' },
    { code: '319', region: 'CN', name: '徽商银行', shortName: '徽商银行', color: '#C8102E', domain: 'hsbank.com.cn', logo: '/banks/cn-319.svg' },
    { code: '403', region: 'CN', name: '中国邮政储蓄银行', shortName: '邮储银行', color: '#00693E', domain: 'psbc.com', logo: '/banks/cn-403.svg' },
];
/**
 * 香港：HKICL 清算所银行代码。
 * 后半段（214 起）是内地银行在港机构的代码 —— 跨境支付通的实际收款方就在其中。
 */
const HK_BANKS = [
    { code: 'LCB', region: 'HK', name: '招财猫银行（香港模拟通道）', shortName: '招财猫', color: '#E0A83C', internal: true },
    { code: '003', region: 'HK', name: '渣打银行（香港）', shortName: '渣打银行', color: '#0473BE', domain: 'sc.com', logo: '/banks/hk-003.svg' },
    { code: '004', region: 'HK', name: '香港上海汇丰银行', shortName: '汇丰银行', color: '#DB0011', domain: 'hsbc.com.hk', logo: '/banks/hk-004.svg' },
    { code: '006', region: 'HK', name: '花旗银行', shortName: '花旗银行', color: '#003D7C', domain: 'citi.com', logo: '/banks/hk-006.svg' },
    { code: '009', region: 'HK', name: '中国建设银行（亚洲）', shortName: '建行亚洲', color: '#0066B3', domain: 'asia.ccb.com', logo: '/banks/hk-009.svg' },
    { code: '012', region: 'HK', name: '中国银行（香港）', shortName: '中银香港', color: '#A6192E', domain: 'bochk.com', logo: '/banks/hk-012.svg' },
    { code: '015', region: 'HK', name: '东亚银行', shortName: '东亚银行', color: '#00693E', domain: 'hkbea.com', logo: '/banks/hk-015.svg' },
    { code: '016', region: 'HK', name: '星展银行（香港）', shortName: '星展银行', color: '#EC1C24', domain: 'dbs.com.hk', logo: '/banks/hk-016.svg' },
    { code: '018', region: 'HK', name: '中信银行（国际）', shortName: '中信国际', color: '#E60012', domain: 'cncbinternational.com', logo: '/banks/hk-018.svg' },
    { code: '020', region: 'HK', name: '招商永隆银行', shortName: '招商永隆', color: '#C8102E', domain: 'cmbwinglungbank.com', logo: '/banks/hk-020.svg' },
    { code: '022', region: 'HK', name: '华侨银行', shortName: '华侨银行', color: '#C8102E', domain: 'ocbc.com', logo: '/banks/hk-022.svg' },
    { code: '024', region: 'HK', name: '恒生银行', shortName: '恒生银行', color: '#00843D', domain: 'hangseng.com', logo: '/banks/hk-024.svg' },
    { code: '025', region: 'HK', name: '上海商业银行', shortName: '上海商业', color: '#00538C', domain: 'shacombank.com.hk', logo: '/banks/hk-025.svg' },
    { code: '027', region: 'HK', name: '交通银行', shortName: '交通银行', color: '#003D7C', domain: 'bankcomm.com.hk', logo: '/banks/hk-027.svg' },
    { code: '028', region: 'HK', name: '大众银行（香港）', shortName: '大众银行', color: '#C8102E', domain: 'publicbank.com.hk', logo: '/banks/hk-028.svg' },
    { code: '035', region: 'HK', name: '华侨永亨银行', shortName: '华侨永亨', color: '#C8102E', domain: 'ocbcwh.com', logo: '/banks/hk-035.svg' },
    { code: '039', region: 'HK', name: '集友银行', shortName: '集友银行', color: '#A6192E', domain: 'chiyubank.com', logo: '/banks/hk-039.svg' },
    { code: '040', region: 'HK', name: '大新银行', shortName: '大新银行', color: '#C8102E', domain: 'dahsing.com', logo: '/banks/hk-040.svg' },
    { code: '041', region: 'HK', name: '创兴银行', shortName: '创兴银行', color: '#00538C', domain: 'chbank.com', logo: '/banks/hk-041.svg' },
    { code: '043', region: 'HK', name: '南洋商业银行', shortName: '南洋商业', color: '#A6192E', domain: 'ncb.com.hk', logo: '/banks/hk-043.svg' },
    { code: '061', region: 'HK', name: '大生银行', shortName: '大生银行', color: '#6B7280', domain: 'taisangbank.com', logo: '/banks/hk-061.png' },
    { code: '071', region: 'HK', name: '大华银行', shortName: '大华银行', color: '#003D7C', domain: 'uobgroup.com', logo: '/banks/hk-071.svg' },
    { code: '072', region: 'HK', name: '中国工商银行（亚洲）', shortName: '工银亚洲', color: '#C7000B', domain: 'icbcasia.com', logo: '/banks/hk-072.svg' },
    { code: '128', region: 'HK', name: '富邦银行（香港）', shortName: '富邦银行', color: '#00538C', domain: 'fubonbank.com.hk', logo: '/banks/hk-128.svg' },
    { code: '214', region: 'HK', name: '中国工商银行', shortName: '工商银行', color: '#C7000B', domain: 'icbc.com.cn', logo: '/banks/hk-214.svg' },
    { code: '221', region: 'HK', name: '中国建设银行', shortName: '建设银行', color: '#0066B3', domain: 'ccb.com', logo: '/banks/hk-221.svg' },
    { code: '222', region: 'HK', name: '中国农业银行', shortName: '农业银行', color: '#00843D', domain: 'abchina.com', logo: '/banks/hk-222.svg' },
    { code: '238', region: 'HK', name: '招商银行', shortName: '招商银行', color: '#C8102E', domain: 'cmbchina.com', logo: '/banks/hk-238.svg' },
    { code: '250', region: 'HK', name: '花旗银行（香港）', shortName: '花旗香港', color: '#003D7C', domain: 'citibank.com.hk', logo: '/banks/hk-250.svg' },
    { code: '338', region: 'HK', name: '中国银行（香港分行）', shortName: '中行香港', color: '#A6192E', domain: 'boc.cn', logo: '/banks/hk-338.svg' },
    { code: '345', region: 'HK', name: '上海浦东发展银行', shortName: '浦发银行', color: '#00538C', domain: 'spdb.com.cn', logo: '/banks/hk-345.svg' },
    { code: '353', region: 'HK', name: '中国民生银行', shortName: '民生银行', color: '#005BAC', domain: 'cmbc.com.cn', logo: '/banks/hk-353.svg' },
    { code: '368', region: 'HK', name: '中国光大银行', shortName: '光大银行', color: '#7A2E8E', domain: 'cebbank.com', logo: '/banks/hk-368.svg' },
    { code: '372', region: 'HK', name: '上海银行（香港）', shortName: '上海银行', color: '#00538C', domain: 'bosc.cn', logo: '/banks/hk-372.svg' },
    { code: '377', region: 'HK', name: '兴业银行', shortName: '兴业银行', color: '#00693E', domain: 'cib.com.cn', logo: '/banks/hk-377.svg' },
    { code: '382', region: 'HK', name: '交通银行（香港）', shortName: '交银香港', color: '#003D7C', domain: 'bankcomm.com.hk', logo: '/banks/hk-382.svg' },
];
/**
 * 把「常用借记卡号段」贴到银行记录上。
 *
 * BIN 表本身留在服务端（`bin-table.ts`）供反查「输卡号认银行」用，
 * 随名录下发的只有这一个提示字段 —— 完整表十万量级，不可能下发给客户端。
 */
const BANKS = [...CN_BANKS, ...HK_BANKS].map((bank) => {
    // 本行的前缀不是从真实码表来的，就是我们自己的账号格式（8820…），所以单独给
    if (bank.internal)
        return { ...bank, primaryBin: INTERNAL_ACCOUNT_PREFIX };
    const primaryBin = bank.region === 'CN' ? PRIMARY_BIN[bank.code] : undefined;
    return primaryBin ? { ...bank, primaryBin } : bank;
});
/** 按 (region, code) 定位银行 —— code 单独会撞号，必须成对查 */
export function findBank(banks, code, region) {
    if (!code)
        return undefined;
    return banks.find((b) => b.code === code && (region == null || b.region === region));
}
/** 转数快是香港的清算网络，登记册里的银行一律是香港机构 */
export const FPS_REGISTRY = [
    { idType: 'mobile', id: '91234567', name: '梁乐怡', bankCode: '004', bankName: '香港上海汇丰银行', bankCount: 2 },
    { idType: 'mobile', id: '62345678', name: '陳嘉禾', bankCode: '020', bankName: '招商永隆银行', bankCount: 1 },
    { idType: 'mobile', id: '98761234', name: '黄敏仪', bankCode: '012', bankName: '中国银行（香港）', bankCount: 3 },
    { idType: 'email', id: 'ken.ho@example.com', name: 'Ken Ho', bankCode: '012', bankName: '中国银行（香港）', bankCount: 1 },
    { idType: 'email', id: 'wing.chan@example.com', name: 'Wing Chan', bankCode: '004', bankName: '香港上海汇丰银行', bankCount: 1 },
    { idType: 'fpsid', id: '8820314', name: 'Ken Ho', bankCode: '012', bankName: '中国银行（香港）', bankCount: 1 },
    { idType: 'fpsid', id: '1002938', name: '黄敏仪', bankCode: '004', bankName: '香港上海汇丰银行', bankCount: 3 },
];
/** Persisted customer registrations and external demo fixtures share one resolver. */
export async function lookupFpsRegistration(idType, id) {
    const value = id.replace(/\s/g, '').toLowerCase();
    const candidates = storage.profileStore ? await storage.profileStore.fpsProfiles(idType, value) : listAllProfiles();
    for (const candidate of candidates) {
        const profile = prepareLoadedProfile(candidate);
        const registration = profile.fpsRegistrations?.find(r => r.idType === idType && r.id === value);
        const account = registration && ledgerBalances(profile).find(a => a.id === registration.accountId && a.currency === 'HKD');
        if (account)
            return { idType, id: value, name: profile.user.name, bankCode: 'LCB', bankName: '招财猫银行（香港模拟通道）', bankCount: 1, accountNo: profile.accounts[0].accountNo, customerId: profile.user.id, balanceId: account.id };
    }
    return FPS_REGISTRY.find(r => r.idType === idType && r.id.toLowerCase() === value);
}
/**
 * 拼一个完整卡号：号段 + 自由位 + 该卡的后四位。
 *
 * 号段取的是**真实感**的借记卡号段（Visa `402688`、银联 `620522`），
 * 而不是 Visa 官方那个测试 BIN `411111` —— 测试号段一眼就会被看出是演示数据。
 *
 * ⚠️ 代价说清楚：这样做**理论上可能与某张真实存在的卡撞号**（概率极低）。
 * 这是个明确做过的取舍 —— 演示要的是「看起来像真卡」，因此不再保证绝不撞号。
 * 如果哪天要绝对安全，换回 `411111` / `620000` 两个测试号段即可。
 *
 * 自由位穷举到 **Luhn 校验通过**：真卡都满足 Luhn，校验位算错会一眼露馅。
 */
export function cardPan(network, last4) {
    const prefix = network === 'visa' ? '402688' : '620522';
    for (let n = 0; n < 1_000_000; n += 1) {
        const body = prefix + String(n).padStart(6, '0') + last4.slice(0, 3);
        let total = 0;
        let alt = true;
        for (let i = body.length - 1; i >= 0; i -= 1) {
            let d = Number(body[i]);
            if (alt) {
                d *= 2;
                if (d > 9)
                    d -= 9;
            }
            total += d;
            alt = !alt;
        }
        if ((10 - (total % 10)) % 10 === Number(last4[3]))
            return body + last4[3];
    }
    return prefix + '000000' + last4;
}
function seed() {
    seq = 0;
    const currentAccountId = nextId('acc');
    const accounts = [
        {
            id: currentAccountId,
            kind: 'savings',
            label: '储蓄账户',
            accountNo: '8820000000112233445',
            currency: 'CNY',
            // 2026-10-12 抬到 ¥1,284,640.55：延迟到账阈值设到 ¥500,000 后，
            // 原 ¥284,640.55 连一笔大额都转不出去，演示必挂。
            balance: 128_464_055,
            available: 128_464_055,
            interestRate: 0.0155,
            monthNetChange: 0,
        },
        {
            id: nextId('acc'),
            kind: 'savings',
            label: '云闪付联名卡账户',
            accountNo: '8820000000112233366',
            currency: 'CNY',
            balance: 0,
            available: 0,
            interestRate: 0.0155,
            monthNetChange: 0,
        },
        {
            id: nextId('acc'),
            kind: 'savings',
            label: 'Visa 全球借记卡账户',
            accountNo: '8820000000112232046',
            currency: 'CNY',
            balance: 0,
            available: 0,
            interestRate: 0.0155,
            monthNetChange: 0,
        },
    ];
    const db = {
        schema: MOCK_SCHEMA,
        fpsRegistrations: [],
        user: {
            id: 'u_0001',
            name: '林小满',
            phone: '13800138000',
            memberTier: 'platinum',
            avatarInitial: '林',
        },
        passwordDigest: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
        payPassword: hashPassword(DEFAULT_PAY_PASSWORD),
        payPasswordFailures: 0,
        accounts,
        transactions: seedTransactions(accounts[0]),
        banks: BANKS,
        payees: [
            {
                id: nextId('pay'),
                name: '陈嘉禾',
                channel: 'bank',
                bankCode: 'LCB',
                bankRegion: 'CN',
                bankName: '招财猫银行',
                accountNo: '8820000000124471',
                scope: 'domestic',
                lastUsedAt: daysAgo(10, 21, 3),
            },
            {
                id: nextId('pay'),
                name: '苏晚',
                channel: 'bank',
                bankCode: '308',
                bankRegion: 'CN',
                bankName: '招商银行',
                accountNo: '6214830200989028',
                scope: 'domestic',
                lastUsedAt: daysAgo(21, 14, 30),
            },
            {
                id: nextId('pay'),
                name: 'Wing Chan',
                channel: 'bank',
                bankCode: '004',
                bankRegion: 'HK',
                bankName: '香港上海汇丰银行',
                accountNo: '004123456789118',
                scope: 'overseas',
                lastUsedAt: daysAgo(58, 10, 12),
            },
            {
                id: nextId('pay'),
                name: '梁乐怡',
                channel: 'fps',
                fpsMethod: 'mobile',
                fpsId: '91234567',
                payeeCurrency: 'HKD',
                bankCode: '004',
                bankRegion: 'HK',
                bankName: '香港上海汇丰银行',
                scope: 'overseas',
                lastUsedAt: daysAgo(4, 12, 40),
            },
            {
                id: nextId('pay'),
                name: 'Ken Ho',
                channel: 'fps',
                fpsMethod: 'fpsid',
                fpsId: '8820314',
                payeeCurrency: 'HKD',
                bankCode: '012',
                bankRegion: 'HK',
                bankName: '中国银行（香港）',
                scope: 'overseas',
                lastUsedAt: daysAgo(30, 9, 15),
            },
        ],
        holdings: [
            {
                id: nextId('hold'),
                productCode: 'LCB-CASH-A',
                productName: '招财猫现金添利 A',
                category: 'cash',
                risk: 'R1',
                shares: 5_000,
                costNav: 1,
                principal: 500_000,
                marketValue: 0,
                profit: 0,
                profitRate: 0,
                purchasedAt: daysAgo(46, 10, 30),
                redeemableAt: null,
                closed: false,
            },
            {
                id: nextId('hold'),
                productCode: 'LCB-FIXED-090',
                productName: '招财猫稳盈 90 天',
                category: 'fixed',
                risk: 'R2',
                shares: 20_000,
                costNav: 1,
                principal: 2_000_000,
                marketValue: 0,
                profit: 0,
                profitRate: 0,
                purchasedAt: daysAgo(24, 14, 5),
                redeemableAt: inDays(66, 0),
                closed: true,
            },
        ],
        pendingSms: null,
        wealthAccount: {
            opened: false,
            accountNo: '',
            openedAt: '',
            settlementAccountId: '',
            agreementSignedAt: '',
            riskLevelAtOpening: 'C1',
        },
        riskAssessment: {
            done: false,
            level: 'C1',
            score: 0,
            assessedAt: '',
            expiresAt: '',
            expired: true,
        },
        cardSecrets: {},
        cards: [
            {
                id: nextId('card'),
                accountId: currentAccountId,
                productName: '招财猫 · 星享借记卡',
                last4: '8888',
                cardholder: 'LIN XIAOMAN',
                expiry: '08/29',
                theme: 'ink',
                network: 'visa',
                kind: 'debit',
                status: 'active',
                onlinePayment: true,
                overseasPayment: false,
                dailyLimit: 5_000_000,
            },
            {
                id: nextId('card'),
                accountId: accounts[1].id,
                productName: '招财猫 · 云闪付联名卡',
                last4: '3366',
                cardholder: 'LIN XIAOMAN',
                expiry: '03/28',
                theme: 'gold',
                network: 'unionpay',
                kind: 'debit',
                // 历史卡：银联名额空出来才能演示再次申请；已换卡的卡不占名额
                status: 'replaced',
                onlinePayment: false,
                overseasPayment: false,
                dailyLimit: 2_000_000,
            },
            // 历史卡：曾是寄送中的 Visa 卡，寄送信息 + 已收制卡费两个状态仍可点开看
            {
                id: nextId('card'),
                accountId: accounts[2].id,
                productName: '招财猫 · Visa 全球借记卡',
                last4: '2046',
                cardholder: 'LIN XIAOMAN',
                expiry: '11/30',
                theme: 'gold',
                network: 'visa',
                kind: 'debit',
                status: 'replaced',
                onlinePayment: false,
                overseasPayment: false,
                dailyLimit: 200_000,
                shippingAddress: {
                    recipient: '林小满',
                    phone: '13800138000',
                    region: '上海市',
                    city: '上海市',
                    detail: '浦东新区世纪大道 100 号 32 层',
                    postalCode: '200120',
                },
                issuingFee: 3_500,
            },
        ],
        autoDebits: [
            { id: nextId('ad'), merchant: '网易云音乐', amount: 2500, cycle: '每月 8 日', nextRunAt: inDays(6), enabled: true, category: 'subscription' },
            { id: nextId('ad'), merchant: '腾讯视频', amount: 19900, cycle: '每年 5 月', nextRunAt: inDays(23), enabled: true, category: 'subscription' },
            { id: nextId('ad'), merchant: '房租', amount: 650000, cycle: '每月 3 日', nextRunAt: inDays(2), enabled: true, category: 'housing' },
            { id: nextId('ad'), merchant: '健身房月卡', amount: 18000, cycle: '每月 18 日', nextRunAt: inDays(15), enabled: false, category: 'subscription' },
        ],
        security: {
            score: 82,
            level: '防护良好',
            identityVerified: true,
            devices: [
                { id: nextId('dev'), name: 'MacBook Pro · Chrome', location: '上海 · 浦东新区', lastActiveAt: new Date().toISOString(), current: true },
                { id: nextId('dev'), name: 'iPhone 17 Pro · App', location: '上海 · 徐汇区', lastActiveAt: daysAgo(0, 8, 20), current: false },
                { id: nextId('dev'), name: 'iPad Air · Safari', location: '杭州 · 西湖区', lastActiveAt: daysAgo(12, 21, 5), current: false },
            ],
            logs: [
                { id: nextId('log'), action: '登录成功', detail: 'MacBook Pro · Chrome · 上海', createdAt: new Date().toISOString(), level: 'info' },
                { id: nextId('log'), action: '修改转账限额', detail: '单日限额调整为 ¥50,000.00', createdAt: daysAgo(4, 15, 12), level: 'info' },
                { id: nextId('log'), action: '异地登录提醒', detail: '杭州 · 已通过短信二次验证', createdAt: daysAgo(12, 21, 6), level: 'warn' },
                { id: nextId('log'), action: '开启境外交易', detail: '星享借记卡 · 尾号 8888', createdAt: daysAgo(26, 9, 30), level: 'info' },
            ],
            riskRules: [
                { id: 'rule_amount', label: '大额转账二次确认', description: '单笔超过 ¥5,000.00 需再次确认', enabled: true },
                { id: 'rule_overseas', label: '境外交易拦截', description: '境外收款方自动触发人工复核', enabled: true },
                { id: 'rule_new_device', label: '新设备登录验证', description: '陌生设备登录需短信验证码', enabled: true },
                { id: 'rule_night', label: '深夜交易提醒', description: '23:00–06:00 的交易实时推送', enabled: false },
            ],
        },
        savings: {
            totalSaved: 0,
            goals: [
                {
                    id: 'goal_0001',
                    name: '旅行基金',
                    icon: 'travel',
                    targetAmount: 800_000,
                    savedAmount: 186_000,
                    deadline: '2027-03-01',
                    createdAt: daysAgo(60, 9, 12),
                    sweep: { amount: 50_000, cycle: '每月 1 日', accountId: currentAccountId },
                },
                {
                    id: 'goal_0002',
                    name: '换新手机',
                    icon: 'device',
                    targetAmount: 600_000,
                    savedAmount: 120_000,
                    deadline: null,
                    createdAt: daysAgo(20, 20, 5),
                    sweep: null,
                },
            ],
            roundup: {
                enabled: true,
                roundupTo: 1_000,
                dailyCap: 5_000,
                accountId: currentAccountId,
                goalId: null,
            },
            streak: {
                days: 12,
                longestDays: 34,
                lastSavedAt: daysAgo(0, 8, 0),
                badges: [
                    { id: 'b_first', label: '第一步', earned: true, hint: '完成首个存钱目标' },
                    { id: 'b_week', label: '坚持一周', earned: true, hint: '连续存钱 7 天' },
                    { id: 'b_month', label: '月度达人', earned: true, hint: '连续存钱 30 天' },
                    { id: 'b_year', label: '年度冠军', earned: false, hint: '连续存钱 365 天' },
                ],
            },
            rewards: [
                {
                    id: 'rw_0001',
                    title: '连续存钱 7 天奖励',
                    description: '利息加成 +0.3%，有效期 30 天',
                    status: 'credited',
                    amount: 1_000,
                    creditedAt: daysAgo(5, 8, 0),
                },
                {
                    id: 'rw_0002',
                    title: '本月存满 ¥1,000',
                    description: '达标后自动发放存钱红包',
                    status: 'qualified',
                    amount: 2_000,
                    creditedAt: null,
                },
            ],
        },
        virtualCards: [],
        budgets: [],
        budgetPointDays: [],
        budgetPasses: [],
        invitations: {
            invite: {
                code: 'LC2026XIAOMAN',
                link: 'https://luckycat.bank/i/LC2026XIAOMAN',
                createdAt: daysAgo(90, 10, 0),
            },
            friends: [
                { id: 'inv_0001', name: '陈嘉禾', maskedPhone: '136****6000', stage: 'reward_earned', joinedAt: daysAgo(40, 14, 20), reward: 3000 },
                { id: 'inv_0002', name: '苏晚', maskedPhone: '138****9028', stage: 'account_opened', joinedAt: daysAgo(12, 11, 5), reward: 0 },
                { id: 'inv_0003', name: '梁乐怡', maskedPhone: '150****4471', stage: 'registered', joinedAt: daysAgo(3, 19, 40), reward: 0 },
            ],
            rewards: [
                { id: 'ir_0001', title: '邀请开户奖励', description: '好友成功开户后发放', status: 'credited', amount: 3000, createdAt: daysAgo(38, 15, 0) },
                { id: 'ir_0002', title: '好友首笔消费奖励', description: '好友完成首笔消费后发放', status: 'pending', amount: 5000, createdAt: daysAgo(2, 9, 30) },
            ],
            totalEarned: 3000,
        },
        // 会员等级按上月日均 AUM 评定；林小满储蓄 ≈¥128 万 → 白金
        membership: {
            ...freshMembership(),
            tier: 'platinum',
        },
        // 日终快照存当日 AUM（储蓄 + 理财 + 现金管理），在 db 建好后按全口径生成
        assetSnapshots: [],
        salaryPlan: {
            salaryDay: 8,
            amount: 2_180_000,
            employer: '星瀚科技（上海）有限公司',
            accountId: currentAccountId,
            nextPayday: daysAgo(-5, 10, 0).slice(0, 10),
            history: [
                { id: 'sal_0001', month: daysAgo(35).slice(0, 7), amount: 2_180_000, paidAt: daysAgo(35, 10, 0) },
                { id: 'sal_0002', month: daysAgo(5).slice(0, 7), amount: 2_180_000, paidAt: daysAgo(5, 10, 0) },
            ],
        },
        overdraft: {
            active: false,
            creditLimit: 500_000,
            used: 0,
            available: 500_000,
            apr: 0.058,
            activatedAt: null,
            interestNote: '按日计息，随借随还，无手续费；单笔最长 30 天免息期内不计息。',
        },
        credit: {
            creditLimit: 3_000_000,
            availableCredit: 2_400_000,
            products: [
                {
                    id: 'loan_quick',
                    name: '秒借',
                    description: '实时审批，最快 1 分钟到账，按日计息',
                    minAmount: 100_000,
                    maxAmount: 2_000_000,
                    minTermMonths: 3,
                    maxTermMonths: 24,
                    apr: 0.049,
                    disbursement: '实时到账',
                    tags: ['按日计息', '随借随还'],
                },
                {
                    id: 'loan_installment',
                    name: '大额分期',
                    description: '最高 50 万分 36 期，适合装修购车等大额支出',
                    minAmount: 500_000,
                    maxAmount: 5_000_000,
                    minTermMonths: 6,
                    maxTermMonths: 36,
                    apr: 0.038,
                    disbursement: 'T+1 到账',
                    tags: ['等额本息', '大额低息'],
                },
            ],
            loans: [
                {
                    id: 'ln_0001',
                    productName: '秒借',
                    principal: 600_000,
                    outstanding: 225_000,
                    termMonths: 12,
                    monthlyPayment: 53_200,
                    apr: 0.049,
                    nextDueDate: daysAgo(-12, 8, 0).slice(0, 10),
                    paidPeriods: 8,
                    totalPeriods: 12,
                    status: 'active',
                    createdAt: daysAgo(240, 9, 30),
                },
            ],
            installments: [
                {
                    id: 'inst_0001',
                    title: 'MacBook Pro 分期',
                    merchant: 'Apple Store',
                    totalAmount: 1_599_000,
                    remainingAmount: 799_500,
                    periods: 12,
                    paidPeriods: 6,
                    monthlyPayment: 133_250,
                    nextDueDate: daysAgo(-9, 8, 0).slice(0, 10),
                    feeRate: 0.024,
                    createdAt: daysAgo(180, 15, 0),
                },
            ],
            builder: {
                score: 728,
                level: '优秀',
                streakMonths: 14,
                nextMilestone: '连续按时还款 18 个月可提升额度',
                tips: ['保持按时还款', '避免短期内频繁申请借款', '适度使用分期并按时结清'],
            },
        },
        cashManagement: {
            balance: 1_250_000,
            totalYield: 3_420,
            sevenDayYield: 0.0219,
            accountId: currentAccountId,
            sweepEnabled: true,
            sweepThreshold: 500_000,
            products: [
                { id: 'cm_ymf', name: '招财宝货币A', sevenDayYield: 0.0219, minAmount: 100, flexible: true },
                { id: 'cm_ymf_b', name: '招财宝货币B', sevenDayYield: 0.0231, minAmount: 100_000, flexible: true },
            ],
        },
        investments: {
            holding: 1_860_000,
            totalReturn: 92_400,
            plans: [
                {
                    id: 'ip_0001',
                    productCode: 'CSI300',
                    productName: '沪深300指数基金',
                    amount: 100_000,
                    cycle: '每月 8 日',
                    nextRunAt: daysAgo(-3, 9, 0).slice(0, 10),
                    executedRuns: 9,
                    totalInvested: 900_000,
                    status: 'active',
                    createdAt: daysAgo(270, 9, 0),
                },
            ],
            products: [
                { id: 'inv_csi300', code: 'CSI300', name: '沪深300指数基金', category: 'etf', nav: 1.4321, risk: 'medium', oneYearReturn: 0.0821, minAmount: 10_000 },
                { id: 'inv_sp500', code: 'SP500', name: '标普500指数基金', category: 'etf', nav: 2.1140, risk: 'medium', oneYearReturn: 0.1205, minAmount: 10_000 },
                { id: 'inv_bond', code: 'BOND-A', name: '稳利纯债基金A', category: 'fund', nav: 1.0876, risk: 'low', oneYearReturn: 0.0342, minAmount: 10_000 },
                { id: 'inv_robo', code: 'ROBO-1', name: '智能投顾·稳健组合', category: 'robo', nav: 1.2055, risk: 'low', oneYearReturn: 0.0528, minAmount: 50_000 },
            ],
        },
        insurance: {
            totalCoverage: 1_000_000,
            policies: [
                {
                    id: 'pol_0001',
                    productName: '百万医疗险',
                    insurer: '招财人寿',
                    premium: 38_800,
                    coverage: 6_000_000,
                    status: 'active',
                    effectiveAt: daysAgo(300, 0, 0),
                    expireAt: daysAgo(-65, 0, 0),
                    insuredName: '林小满',
                },
            ],
            products: [
                { id: 'ins_medical', name: '百万医疗险', category: '医疗', insurer: '招财人寿', premiumPerYear: 38_800, coverage: 6_000_000, highlight: '住院可垫付，不限社保用药', tags: ['高杠杆', '门急诊可报'] },
                { id: 'ins_critical', name: '守护重疾险', category: '重疾', insurer: '招财人寿', premiumPerYear: 128_000, coverage: 3_000_000, highlight: '确诊即赔，覆盖 120 种重疾', tags: ['确诊即赔', '含轻症'] },
                { id: 'ins_accident', name: '出行意外险', category: '意外', insurer: '招财财险', premiumPerYear: 9_900, coverage: 1_000_000, highlight: '全年不限次数，含交通意外', tags: ['低保费', '含航空'] },
            ],
        },
    };
    /**
     * 卡安全码按卡 id 挂上去。
     *
     * 放在对象建好之后，是因为卡的 id 是上面 `nextId('card')` 现场生成的，写不进字面量。
     * 固定值而不是随机：演示要能复现，断言也才有得对。
     */
    db.cardSecrets = {
        // 只有使用中（active）的卡留安全码；已换卡的历史卡秘密随旧卡一起作废
        [db.cards[0].id]: { cvv: '417', pan: cardPan('visa', db.cards[0].last4) },
    };
    // 种子快照按新 AUM 口径生成（储蓄 + 理财市值 + 现金管理），日均约 ¥129 万 → 白金
    db.assetSnapshots = seedAssetSnapshots(aumAssets(db, FX_MID_RATES));
    normalizeFundingAccount(db);
    return db;
}
let cache = null;
const PROFILES_KEY = 'luckycat.mock.user-profiles.v1';
function profiles() {
    return storage.get(PROFILES_KEY, {});
}
function prepareLoadedProfile(profile) {
    if (!profile || !storage.profileStore) return profile;
    const ready = migrateProfile(profile);
    normalizeFundingAccount(ready);
    // A legacy recipient/staff target may not be the active customer. Migrate it
    // before any business rule uses its balances; commit only this customer's
    // changed projection, keeping the original history and frozen funds.
    storage.set(PROFILES_KEY, { [ready.user.phone]: ready });
    return ready;
}
/** 演示收款人也有自己的登录档案、资金账户和可收款银行卡。 */
function ensureDemoRecipient() {
    if (process.env.NODE_ENV === 'production') return;
    if (storage.profileStore && !storage.profileStore.initializing) return;
    const all = profiles();
    if (all['13600136000'])
        return;
    const demo = seed();
    demo.user = { id: 'u_demo_chen', name: '陈嘉禾', phone: '13600136000', memberTier: 'standard', avatarInitial: '陈' };
    demo.accounts = [{
            id: 'acc_demo_chen', kind: 'savings', label: '储蓄账户',
            accountNo: '8820000000124471', currency: 'CNY',
            balance: 800_000, available: 800_000, interestRate: 0.0155, monthNetChange: 0,
        }];
    demo.currencyBalances = []; demo.retiredBalances = []; demo.accountAliases = {}; demo.accountNumberAliases = {};
  Object.assign(demo, emptyCustomerDomains(demo.user, demo.accounts[0].id));
    demo.transactions = [];
    demo.cards = [{
            id: 'card_demo_chen', accountId: demo.accounts[0].id,
            productName: '招财猫 · 云闪付借记卡', last4: '4471',
            cardholder: 'CHEN JIAHE', expiry: '09/30', theme: 'gold',
            network: 'unionpay', kind: 'debit', status: 'active',
            onlinePayment: true, overseasPayment: false, dailyLimit: 2_000_000,
        }];
    demo.cardSecrets = { card_demo_chen: { cvv: '641', pan: cardPan('unionpay', '4471') } };
    demo.payees = [];
    demo.holdings = [];
    demo.autoDebits = [];
    demo.pendingSms = null;
    storage.set(PROFILES_KEY, { ...all, [demo.user.phone]: demo });
}
/**
 * 演示用「马斯克」账户：余额拉满，便于测试「从他行/他人提取资金」到本行账户。
 *
 * 只在允许演示种子时创建（`BANK_ALLOW_DEMO_SEED=true` 或非生产环境），
 * 与演示收款人一样遵守单账户模型：一个资金账户 + 多币种余额 + 一张卡。
 */
function ensureDemoWhale() {
    if (process.env.NODE_ENV === 'production' && process.env.BANK_ALLOW_DEMO_SEED !== 'true') return;
    if (storage.profileStore && !storage.profileStore.initializing) return;
    const all = profiles();
    if (all['13900000000']) return;
    const demo = seed();
    demo.user = { id: 'u_demo_musk', name: '马斯克', phone: '13900000000', memberTier: 'diamond', avatarInitial: '马' };
    const accountId = 'acc_demo_musk';
    // 余额拉满：CNY 999.99 亿、USD 100 亿、HKD 500 亿（分）
    demo.accounts = [{
            id: accountId, kind: 'savings', label: '储蓄账户',
            accountNo: '8820000000000001', currency: 'CNY',
            balance: 9_999_999_999_999, available: 9_999_999_999_999,
            interestRate: 0.0155, monthNetChange: 0,
        }];
    demo.currencyBalances = [
        { id: 'bal_demo_musk_usd', kind: 'savings', label: 'USD 余额', accountNo: `ledger:u_demo_musk:USD`, currency: 'USD', balance: 1_000_000_000_000, available: 1_000_000_000_000, interestRate: 0.0155, monthNetChange: 0 },
        { id: 'bal_demo_musk_hkd', kind: 'savings', label: 'HKD 余额', accountNo: `ledger:u_demo_musk:HKD`, currency: 'HKD', balance: 5_000_000_000_000, available: 5_000_000_000_000, interestRate: 0.0155, monthNetChange: 0 },
    ];
    demo.retiredBalances = []; demo.accountAliases = {}; demo.accountNumberAliases = {};
    Object.assign(demo, emptyCustomerDomains(demo.user, accountId));
    demo.transactions = [];
    demo.cards = [{
            id: 'card_demo_musk', accountId,
            productName: '招财猫 · 黑金借记卡', last4: '0001',
            cardholder: 'ELON MUSK', expiry: '12/32', theme: 'ink',
            network: 'visa', kind: 'debit', status: 'active',
            onlinePayment: true, overseasPayment: true,
            dailyLimit: 1_000_000_000,
            channelLimits: { online: 1_000_000_000, offline: 1_000_000_000, overseas: 1_000_000_000 },
            merchantLimits: { dining: 1_000_000_000, shopping: 1_000_000_000, other: 1_000_000_000 },
        }];
    demo.cardSecrets = { card_demo_musk: { cvv: '001', pan: cardPan('visa', '0001') } };
    demo.payees = [];
    demo.holdings = [];
    demo.autoDebits = [];
    demo.pendingSms = null;
    storage.set(PROFILES_KEY, { ...all, [demo.user.phone]: demo });
}
/** 按本行账户号或已激活银行卡号查收款账户，扫描所有演示用户档案。 */
export async function findRecipientByNumber(number) {
    const normalized = number.replace(/\D/g, '');
    const candidates = storage.profileStore ? await storage.profileStore.recipientProfiles(normalized) : Object.values(profiles());
    const all = Object.fromEntries(candidates.map(prepareLoadedProfile).map(profile => [profile.user.phone, profile]));
    all[loadDb().user.phone] = loadDb();
    for (const profile of Object.values(all)) {
        const account = profile.accounts.find((row) => row.accountNo === normalized) ?? findBalance(profile, profile.accountNumberAliases?.[normalized]);
        if (account)
            return { profile, account, card: null };
        const card = profile.cards.find((row) => row.status === 'active' && profile.cardSecrets[row.id]?.pan === normalized);
        if (card) {
            const bound = profile.accounts.find((row) => row.id === card.accountId);
            if (bound)
                return { profile, account: bound, card };
        }
    }
    return null;
}
/** 一次保存付款人与收款人的档案；SQLite 存储适配器负责落盘。 */
export function persistRelatedProfiles(related) {
    const current = loadDb();
    recordAssetSnapshot(current, FX_MID_RATES);
    for (const profile of related)
        recordAssetSnapshot(profile, FX_MID_RATES);
    const all = profiles();
    all[current.user.phone] = current;
    for (const profile of related)
        all[profile.user.phone] = profile;
    if (!storage.setMany([[STORAGE_KEYS.mockDb, current], [PROFILES_KEY, all]])) {
        throw new Error('转账账务写入失败，请重试');
    }
}
/** 按手机号找一个独立演示档案，不切换当前用户。 */
export async function findProfileByPhone(phone) {
    const normalized = phone.replace(/\D/g, '');
    if (storage.profileStore) return prepareLoadedProfile(await storage.profileStore.findProfileByPhone(normalized));
    const current = loadDb();
    if (current.user.phone === normalized)
        return current;
    return profiles()[normalized] ?? null;
}
/** 按用户 id 找档案（员工端放行挂起转账用：指令里记的是 customerId，不是手机号）。 */
export async function findProfileByUserId(userId) {
    if (storage.profileStore) return prepareLoadedProfile(await storage.profileStore.findProfileByUserId(userId));
    const current = loadDb();
    if (current.user.id === userId)
        return current;
    for (const profile of Object.values(profiles())) {
        if (profile.user.id === userId)
            return profile;
    }
    return null;
}
/**
 * 列出所有演示档案（含当前激活的那个）。
 * 在途窗口的定时扫账要跨用户扫：每个档案是独立的一份台账，
 * 只扫当前档案会漏掉别的客户的到期转账。
 */
export function listAllProfiles() {
    const current = loadDb();
    const all = profiles();
    const out = [current];
    for (const profile of Object.values(all)) {
        if (profile.user.id !== current.user.id)
            out.push(profile);
    }
    return out;
}
/** 换绑手机号后移除旧索引，避免旧号码继续指向该用户档案。 */
export function forgetProfilePhone(phone) {
    const all = profiles();
    delete all[phone.replace(/\D/g, '')];
    storage.set(PROFILES_KEY, all);
}
/**
 * 存储里这个用户最新的一份档案；没有就 null。
 * 只查存储，**不看内存 cache**——cache 本身可能就是要被淘汰的那份旧快照。
 */
function latestStoredProfile(userId) {
    for (const profile of Object.values(profiles())) {
        if (profile.user.id === userId)
            return profile;
    }
    const current = storage.get(STORAGE_KEYS.mockDb, null);
    return current?.user?.id === userId ? current : null;
}
/**
 * 注册/登录成功后切换到该用户的独立数据档案。
 *
 * 装入的是**存储里最新一份**，不是调用方递进来的对象——后者可能是旧快照。
 * 定时扫账跨档案遍历时，收款方刚入账的新余额就是这么被旧快照写回抹掉的：
 * `persist()` 写 `PROFILES_KEY` 会对地图里每个档案跑 `saveLedger()`（删表重建），
 * 旧对象一写回，收款方那几行就被删掉重建成了旧数据。
 * 2026-10-12 issue #3：付款 success、审批 settled、收款方一分没进。
 *
 * 已存在档案的上下文切换不写回台账。想改字段，必须在 activateDb() **之后**改再 persist()；
 * 改在切档前会被最新一份盖掉。
 */
export function activateDb(next) {
    const stored = latestStoredProfile(next.user.id);
    cache = migrateProfile(stored ?? next);
    storage.profileStore?.activateProfile(cache);
    normalizeFundingAccount(cache);
    syncSeq(cache);
    for (const profile of Object.values(profiles()))
        syncSeq(profile);
    if (!stored)
        persist();
}
function syncSeq(db) {
    const ids = [
        ...ledgerBalances(db).map((row) => row.id), ...db.cards.map((row) => row.id),
        ...db.transactions.map((row) => row.id), ...db.payees.map((row) => row.id),
    ];
    for (const id of ids) {
        const match = /_(\d+)$/.exec(id);
        if (match)
            seq = Math.max(seq, Number(match[1]));
    }
}
/** 给既有演示档案中的三张卡补上独立账户，保留原账户余额及历史流水。 */
/** Only product catalogues are shared. Customer activity always starts empty. */
export function emptyCustomerDomains(user, accountId) {
    const catalog = seed();
    return {
        fpsRegistrations: [],
        savings: { totalSaved: 0, goals: [], roundup: { enabled: false, roundupTo: 1000, dailyCap: 5000, accountId, goalId: null },
            streak: { days: 0, longestDays: 0, lastSavedAt: '', badges: [] }, rewards: [] },
        virtualCards: [],
        budgets: [],
        budgetPointDays: [],
        budgetPasses: [],
        invitations: { invite: { code: `LC-${user.id}`, link: `https://luckycat.bank/i/LC-${user.id}`, createdAt: new Date().toISOString() }, friends: [], rewards: [], totalEarned: 0 },
        membership: freshMembership(),
        assetSnapshots: [],
        salaryPlan: { salaryDay: 8, amount: 0, employer: '', accountId, nextPayday: '', history: [] },
        overdraft: { ...catalog.overdraft, active: false, creditLimit: 0, available: 0, used: 0, activatedAt: null },
        credit: { creditLimit: 0, availableCredit: 0, products: catalog.credit.products, loans: [], installments: [], builder: { score: 0, level: '未评估', streakMonths: 0, nextMilestone: '', tips: [] } },
        cashManagement: { balance: 0, totalYield: 0, sevenDayYield: 0, accountId, sweepEnabled: false, sweepThreshold: 0, products: catalog.cashManagement.products },
        investments: { holding: 0, totalReturn: 0, plans: [], products: catalog.investments.products },
        insurance: { totalCoverage: 0, policies: [], products: catalog.insurance.products },
    };
}
export function migrateProfile(profile) {
    if (typeof profile.payPassword === 'string' && !profile.payPassword.startsWith('scrypt$')) profile.payPassword = hashPassword(profile.payPassword);
    if (!Number.isInteger(profile.schema) || profile.schema > MOCK_SCHEMA || !profile.user || !Array.isArray(profile.accounts)) {
        throw new Error('无法识别客户档案版本，已保留原数据');
    }
    // 会员结构与快照字段的修补对全版本幂等：旧订阅字段与 legacy 一律删除，新字段补默认
    normalizeMembership(profile);
    profile.assetSnapshots ??= [];
    if (profile.schema === MOCK_SCHEMA)
        return profile;
    profile = structuredClone(profile);
    // v18：支出基金改称支出预算，旧键就地转换，避免与默认域同时生成两张空表
    if (Array.isArray(profile.funds)) {
        profile.budgets ??= profile.funds;
        profile.budgetPointDays ??= profile.fundPointDays ?? [];
        profile.budgetPasses ??= profile.fundPasses ?? [];
    }
    delete profile.funds;
    delete profile.fundPointDays;
    delete profile.fundPasses;
    const defaults = emptyCustomerDomains(profile.user, profile.accounts[0]?.id ?? '');
    for (const key of Object.keys(defaults)) {
        if (profile[key] === undefined)
            Object.assign(profile, { [key]: defaults[key] });
    }
    if (!profile.banks.some(b => b.code === 'LCB' && b.region === 'HK'))
        profile.banks.push(BANKS.find(b => b.code === 'LCB' && b.region === 'HK'));
    normalizeFundingAccount(profile);
    profile.schema = MOCK_SCHEMA;
    return profile;
}
export function loadDb() {
    if (cache)
        return cache;
    // 历史结构版本曾经用 key 区分，清掉以免在 localStorage 里留垃圾
    storage.remove('mock.db.v1');
    storage.remove('mock.db.v2');
    const stored = storage.get(STORAGE_KEYS.mockDb, null);
    // 使用客户索引中的最新台账，避免重启时旧当前快照覆盖新入账。
    if (!stored && process.env.NODE_ENV === 'production' && process.env.BANK_ALLOW_DEMO_SEED !== 'true') throw new Error('An initialized database is required in production; automatic demo seeding is disabled');
    cache = stored ? migrateProfile(profiles()[stored.user.phone] ?? stored) : seed();
    const all = profiles();
    for (const [phone, profile] of Object.entries(all))
        all[phone] = migrateProfile(profile);
    if (!storage.setMany([[PROFILES_KEY, all]])) {
        cache = null;
        throw new Error('客户档案迁移写入失败');
    }
    normalizeFundingAccount(cache);
    ensureDemoRecipient();
    ensureDemoWhale();
    syncSeq(cache);
    for (const profile of Object.values(profiles()))
        syncSeq(profile);
    persist();
    return cache;
}
export function persist() {
    if (cache) {
        // 每次落盘顺手记一笔当日（北京时间）资产快照：当日最后一次写即日终值
        recordAssetSnapshot(cache, FX_MID_RATES);
        if (!storage.setMany([[STORAGE_KEYS.mockDb, cache], [PROFILES_KEY, { ...profiles(), [cache.user.phone]: cache }]])) {
            cache = null;
            throw new Error('客户档案写入失败，请重试');
        }
    }
}
export function resetDb() {
    storage.remove(PROFILES_KEY);
    cache = seed();
    ensureDemoRecipient();
    ensureDemoWhale();
    persist();
    return cache;
}
export { monthKey, nextId };

// Drop failed request state; the next operation reloads committed SQL records.
export function discardCache() { cache = null; }
