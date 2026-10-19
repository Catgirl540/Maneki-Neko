// 交易自动分类（OpenRouter · perplexity/pplx-decider-flash-v1.2）
//
// 设计要点：
// - pplx-decider 是 System One 决策模型，走 `/api/alpha/decisions`，
//   不是 chat/completions —— 它返回带概率的 typed 选择，没有自由文本要解析。
// - 分类在**记账时**一次性完成并落库，账单筛选 / 消费分析 / 导出读到的都是同一口径。
// - 网络、超时、响应异常一律回落 'other'，分类失败永远不影响记账主路径。
// - 同一「方向 + 渠道 + 对方户名 + 摘要」只做一次请求（缓存即单飞去重），
//   缓存上限封顶防内存膨胀。
// - 没有 OPENROUTER_API_KEY 时整体禁用，行为与旧代码一致。
import { CATEGORY_LABEL } from './categories.mjs'

const CATEGORY_KEYS = Object.keys(CATEGORY_LABEL)

/** choice 问题：键即分类代码，值为给模型看的判定标准 */
const CRITERIA = {
  salary: '工资、薪酬、报销等收入入账',
  transfer: '对外转账汇款（含同行、跨行、FPS）',
  dining: '餐饮、外卖、饮品',
  shopping: '购物、电商、日用消费',
  housing: '房租、物业、水电煤、居住相关',
  transport: '出行、打车、公交地铁、加油、停车',
  subscription: '周期性订阅、会员、自动续费、包月服务',
  other: '以上都不是；银行工本费、手续费、利息、理财申购赎回、换汇、借款放款、保费、账户内部记账等一律归此类',
}

const INSTRUCTIONS = '根据对方户名、摘要、渠道与金额，把这笔银行流水归入唯一最合适的分类；无法判断或属于银行内部账务时选 other。'

/**
 * @param {object} opts
 * @param {string} [opts.apiKey] - OpenRouter 密钥；缺省则禁用分类（全部回落 other）
 * @param {string} [opts.model] - 默认 perplexity/pplx-decider-flash-v1.2
 * @param {string} [opts.baseURL] - 默认 https://openrouter.ai（decisions 在 /api/alpha 下）
 * @param {number} [opts.timeoutMs]
 * @param {typeof fetch} [opts.fetchImpl] - 测试注入
 * @param {number} [opts.maxEntries] - 缓存上限
 */
export function createCategorizer({ apiKey, model = 'perplexity/pplx-decider-flash-v1.2', baseURL = 'https://openrouter.ai', timeoutMs = 6_000, fetchImpl = fetch, maxEntries = 512 } = {}) {
  const enabled = Boolean(apiKey)
  const cache = new Map()

  function cacheKey({ counterparty, memo, direction, channel }) {
    return [direction, channel, counterparty, memo].map((s) => String(s ?? '').trim().toLowerCase()).join('')
  }

  function remember(key, value) {
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value)
    cache.set(key, value)
    return value
  }

  async function request(state) {
    const res = await fetchImpl(`${baseURL.replace(/\/+$/, '')}/api/alpha/decisions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        state,
        questions: {
          category: {
            type: 'choice',
            instructions: INSTRUCTIONS,
            criteria: CRITERIA,
          },
        },
      }),
    })
    if (!res.ok) throw new Error(`categorize http ${res.status}`)
    const data = await res.json()
    const choice = data?.answers?.category?.choice
    return CATEGORY_KEYS.includes(choice) ? choice : 'other'
  }

  /**
   * 给一笔流水分类。返回 CATEGORY_LABEL 的键。
   * 未启用或任何异常都回落 'other'，绝不抛给记账主路径。
   */
  async function classify(tx) {
    if (!enabled) return 'other'
    const key = cacheKey(tx)
    if (cache.has(key)) return cache.get(key)
    const pending = (async () => {
      try {
        const yuan = Number.isSafeInteger(tx.amount) ? (tx.amount / 100).toFixed(2) : String(tx.amount ?? '')
        return await request({
          counterparty: tx.counterparty ?? '',
          memo: tx.memo ?? '',
          channel: tx.channel ?? '',
          direction: tx.direction === 'in' ? '收入' : '支出',
          amount: `${yuan} ${tx.currency ?? 'CNY'}`,
        })
      } catch {
        return 'other'
      }
    })()
    return remember(key, pending)
  }

  return { enabled, classify }
}
