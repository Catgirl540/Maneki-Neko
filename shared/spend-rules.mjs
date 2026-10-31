/**
 * 模拟消费的本地分类兜底。
 *
 * 分类器的正路是服务端异步调用模型（见 server/lib/categorize.mjs）：
 * 记账时先落 other，后台判定完成后回写。但演示环境常常没有配置模型密钥，
 * 或者模型调用失败——那时如果一直停在 other / pending，账单分析里就只剩
 * 「其他」一桶，看不出消费结构，页面还会长期显示「正在分类」。
 *
 * 这里给出确定性的商户规则：
 * - 预设的 12 个平台口径固定（美团外卖、瑞幸、星巴克 → 餐饮；淘宝、京东、
 *   拼多多、盒马 → 购物；滴滴 → 交通；爱奇艺、中国移动 → 订阅；自如 → 居住；
 *   猫眼 → 其他娱乐，没有对应分类，保留 other）。
 * - 自定义商家（custom / Stripe）按商户名里的关键词兜底，认不出来就 other。
 *
 * 规则只回答「这笔刷卡更可能是哪一类」，不改变金额、商户身份与流水；
 * 模型可用时仍以模型判定为准，模型失败才回落到这里。
 */

import { SPEND_PLATFORMS } from './spend-platforms.mjs'

/** 预设平台 → 交易分类（与 CATEGORY_LABEL 的键一致）。 */
export const SPEND_PLATFORM_CATEGORIES = Object.freeze({
    meituan: 'dining',
    luckin: 'dining',
    starbucks: 'dining',
    hema: 'shopping',
    taobao: 'shopping',
    jd: 'shopping',
    pinduoduo: 'shopping',
    didi: 'transport',
    iqiyi: 'subscription',
    'china-mobile': 'subscription',
    ziroom: 'housing',
    maoyan: 'other',
});

/** 自由商家的关键词规则：按顺序命中，先到先得。 */
const MERCHANT_KEYWORDS = [
    { category: 'dining', words: ['餐', '饭', '食', '外卖', '咖啡', '茶', '奶茶', '面包', '蛋糕', '烧烤', '火锅', '面馆', '料理', '酒'] },
    { category: 'transport', words: ['打车', '出行', '地铁', '公交', '高铁', '火车', '机票', '航空', '加油', '停车', '单车'] },
    { category: 'housing', words: ['房租', '物业', '水电', '燃气', '居住', '公寓', '中介'] },
    { category: 'subscription', words: ['会员', '订阅', '续费', '月费', '云服务', '视频', '音乐', '网盘'] },
    { category: 'shopping', words: ['超市', '商城', '百货', '便利', '购物', '旗舰店', '专卖', '生鲜', '药房', '书店'] },
];

/**
 * 按本地规则给一笔模拟消费归类。
 *
 * @param {{ platformId?: string, merchantName?: string }} input
 *   platformId 是 SPEND_PLATFORMS 的 id；merchantName 是自由商家填写的名称。
 * @returns {string|null} 分类键；规则认不出来时返回 null（调用方保留 other）。
 */
export function classifySpendMerchant({ platformId, merchantName } = {}) {
    if (typeof platformId === 'string' && Object.hasOwn(SPEND_PLATFORM_CATEGORIES, platformId)) {
        return SPEND_PLATFORM_CATEGORIES[platformId];
    }
    if (typeof merchantName !== 'string') return null;
    const name = merchantName.trim();
    if (!name) return null;
    // 流水里只落商户名，所以预设平台再按名字认一遍（例如「美团外卖」「京东」）
    const preset = SPEND_PLATFORMS.find((platform) => platform.name === name)
    if (preset) return SPEND_PLATFORM_CATEGORIES[preset.id] ?? null
    for (const rule of MERCHANT_KEYWORDS) {
        if (rule.words.some((word) => name.includes(word))) return rule.category;
    }
    return null;
}
