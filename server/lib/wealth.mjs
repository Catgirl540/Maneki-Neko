// Server-owned business implementation; API contract preserved from the existing client.
/* ==========================================================================
   理财的合规文案与适当性规则
   --------------------------------------------------------------------------
   这些字符串是**监管规定必须出现**的，不是营销话术，所以集中放一处、
   不许各处随手改写：

   · 「理财非存款、产品有风险、投资须谨慎」
     —— 《理财公司理财产品销售管理暂行办法》第四十九条第一项，须在醒目位置提示
   · 「业绩比较基准不是预期收益率，不代表未来表现和实际收益，不构成收益承诺」
     —— 《银行保险机构资产管理产品信息披露管理办法》（2026-09-01 施行）要求
   · 风险确认语句必须由投资者**完整抄录**，不是一个勾选框
     —— 同办法第四十九条第七项
   ========================================================================== */
/** 风险揭示书首句，必须在醒目位置 */
export const WEALTH_DEPOSIT_WARNING = '理财非存款、产品有风险、投资须谨慎';
/** 业绩比较基准的免责声明 */
export const BENCHMARK_DISCLAIMER = '业绩比较基准不是预期收益率，不代表未来表现和实际收益，不构成收益承诺';
/** 开立理财账户时须签署的投资协议（服务端逐字校验） */
export const WEALTH_INVESTMENT_AGREEMENT = '本人已阅读并同意《理财产品投资协议》《风险揭示书》及《投资者权益须知》，自愿开立理财账户并独立承担投资风险';
/** 投资者须完整抄录的风险确认语句 */
export const RISK_ACKNOWLEDGEMENT = '本人已经阅读风险揭示，愿意承担投资风险';
/** 风险等级：通俗说法优先（新规要求），R 符号退到次要位置 */
export const RISK_PLAIN_LABEL = {
    R1: '低风险',
    R2: '中低风险',
    R3: '中风险',
    R4: '中高风险',
    R5: '高风险',
};
/** 风险等级的官方释义，用于产品详情 */
export const RISK_DEFINITION = {
    R1: '产品结构简单，净值历史波动率低，投资标的流动性很好、不含衍生品',
    R2: '产品结构简单，净值历史波动率较低，投资标的流动性好，衍生品以套期保值为目的',
    R3: '产品结构较简单，净值历史波动率较高，投资标的流动性较好，衍生品以对冲为目的',
    R4: '产品结构较复杂，净值历史波动率高，投资标的流动性较差，杠杆一倍以上至三倍以下',
    R5: '产品结构复杂，净值历史波动率很高，投资标的流动性差，杠杆三倍及以上',
};
export const TOLERANCE_LABEL = {
    C1: '保守型',
    C2: '谨慎型',
    C3: '稳健型',
    C4: '积极型',
    C5: '激进型',
};
export const CATEGORY_LABEL = {
    cash: '现金管理类',
    fixed: '固定收益类',
    mixed: '混合类',
    equity: '权益类',
    derivative: '商品及金融衍生品类',
};
export const RISK_LEVELS = ['R1', 'R2', 'R3', 'R4', 'R5'];
export const TOLERANCE_LEVELS = ['C1', 'C2', 'C3', 'C4', 'C5'];
/**
 * 适当性匹配规则：C1 只能买 R1，C2 能买 R2 及以下，依此类推。
 * 反过来「误导投资者购买与其风险承受能力不相匹配的理财产品」是明令禁止的行为
 * （《销售管理暂行办法》第二十五条第一项），所以这里是硬拦截，不是提示。
 */
export function maxRiskFor(tolerance) {
    if (tolerance === null)
        return 'R1';
    const index = TOLERANCE_LEVELS.indexOf(tolerance);
    return RISK_LEVELS[Math.max(0, Math.min(RISK_LEVELS.length - 1, index))];
}
/** 该承受能力能否购买该风险等级的产品 */
export function canBuyRisk(tolerance, risk) {
    if (tolerance === null)
        return false;
    return RISK_LEVELS.indexOf(risk) <= RISK_LEVELS.indexOf(maxRiskFor(tolerance));
}
/** 不匹配时的说明文案 */
export function suitabilityMessage(tolerance, risk) {
    if (tolerance === null)
        return '请先完成风险测评';
    return `该产品风险等级为 ${risk}（${RISK_PLAIN_LABEL[risk]}），超过你的风险承受能力 ${tolerance}（${TOLERANCE_LABEL[tolerance]}）。按投资者适当性管理要求，无法购买。如风险承受能力已变化，请重新测评。`;
}
/** 业绩比较基准的一行文案 —— 取用时永远带上测算依据 */
export function benchmarkLabel(benchmark) {
    if (benchmark.kind === 'formula')
        return benchmark.formula ?? '';
    return `年化 ${(benchmark.low * 100).toFixed(2)}% ~ ${(benchmark.high * 100).toFixed(2)}%`;
}
/** 年化费率 → "0.15%/年" */
export function rateLabel(rate) {
    return `${(rate * 100).toFixed(2)}%/年`;
}
