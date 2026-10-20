/**
 * 理财产品结构化对比：纯函数，不动资金、不给投资建议。
 *
 * 输出按风险等级升序排列，字段对齐成同一组 key，方便上层做并列展示。
 * 合规边界：本模块**只做要素并列**，不输出「适合」「推荐」「更好」等
 * 倾向性结论；每条产品附带风险揭示文本。
 */

/** 分类枚举 → 中文标签。 */
const CATEGORY_LABELS = {
  cash: '现金管理类',
  fixed: '固定收益类',
  mixed: '混合类',
  equity: '权益类',
  derivative: '商品及金融衍生品类',
}

/** 风险等级排序权重（R1 最低）。 */
const RISK_ORDER = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5 }

/** 百分比格式化：0.0186 → '1.86%'。 */
function pct(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return null
  return `${(rate * 100).toFixed(2)}%`
}

/** 金额格式化：1000000 分 → '¥10,000.00'。 */
function yuan(cents) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null
  return `¥${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

/** 业绩比较基准 → 展示文本。 */
function benchmarkText(b) {
  if (!b) return null
  if (b.kind === 'range' && typeof b.low === 'number' && typeof b.high === 'number') {
    return `${pct(b.low)} ~ ${pct(b.high)}`
  }
  if (typeof b.rate === 'number') return pct(b.rate)
  return null
}

/** 持续费率合计 + 明细。 */
function feeSummary(fees) {
  if (!Array.isArray(fees) || fees.length === 0) return { total: null, breakdown: '无' }
  const total = fees.reduce((sum, f) => sum + (typeof f.rate === 'number' ? f.rate : 0), 0)
  const breakdown = fees.map((f) => `${f.label} ${pct(f.rate)}`).join(' + ')
  return { total: pct(total), breakdown }
}

/**
 * 生成结构化对比。
 *
 * @param {Array} products  WEALTH_PRODUCTS 风格的产品数组
 * @param {string[]} [codes]  可选筛选；缺省对比全部
 * @returns {{
 *   disclaimer: string,
 *   count: number,
 *   products: Array<object>,
 * }}
 */
export function compareWealthProducts(products, codes) {
  let list = Array.isArray(products) ? [...products] : []
  if (Array.isArray(codes) && codes.length > 0) {
    const wanted = new Set(codes.map((c) => String(c).trim().toUpperCase()))
    list = list.filter((p) => wanted.has(String(p.code).toUpperCase()))
    if (list.length < 2) {
      throw Object.assign(new Error('对比至少需要 2 个有效产品'), { status: 400, code: 'INSUFFICIENT_PRODUCTS' })
    }
  }
  // 按风险等级升序，同级按代码稳定排序
  list.sort((a, b) => (RISK_ORDER[a.risk] ?? 99) - (RISK_ORDER[b.risk] ?? 99) || String(a.code).localeCompare(String(b.code)))

  return {
    disclaimer: '理财非存款，产品不保本、不承诺收益。以下为产品要素并列展示，不构成投资建议或收益承诺。业绩比较基准不代表实际收益。',
    count: list.length,
    products: list.map((p) => {
      const fees = feeSummary(p.ongoingFees)
      return {
        code: p.code,
        name: p.name,
        risk: p.risk,
        category: CATEGORY_LABELS[p.category] ?? p.category,
        term: p.term,
        openEnded: p.openEnded === true,
        principalProtected: p.principalProtected === true,
        minAmount: yuan(p.minAmount),
        stepAmount: yuan(p.stepAmount),
        benchmark: benchmarkText(p.benchmark),
        benchmarkBasis: p.benchmark?.basis ?? null,
        sevenDayYield: pct(p.sevenDayYield),
        sinceInception: pct(p.sinceInception),
        volatility: pct(p.volatility),
        nav: typeof p.nav === 'number' ? p.nav.toFixed(4) : null,
        totalOngoingFeeRate: fees.total,
        feeBreakdown: fees.breakdown,
      }
    }),
  }
}
