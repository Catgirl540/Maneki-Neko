/** 网页只提交稳定功能 ID；技能名与正文由服务端仓库决定。 */
import { validateSkills } from '../scripts/check-skills.mjs'
import { bankError } from './bank-error.mjs'

const { skills } = validateSkills()
const byId = new Map(skills.map(s => [s.serviceId, s]))

/** Hints only: current-message routing never authorizes or executes a bank operation. */
export function requestRouteHints(message = '') {
  const text = typeof message === 'string' ? message : ''
  const hints = []
  const add = (serviceId, instruction) => hints.push({ serviceId, instruction })
  if (/预算|消费限额/.test(text)) {
    add('analysis', '预算属于账单分析，不能路由成银行卡查询。月度分类目标查 bank_list_monthly_budgets、设 bank_set_monthly_budget、删 bank_delete_monthly_budget；删除先读取本人目标并独立确认，不删除流水或每日限额；每日平台限额才用 bank_create_budget/bank_update_budget，修改先查准确预算编号；不得声称只有查询工具。月度分类目标与平台每日限额不同，禁止除以天数、替换周期或伪称已设置。')
  } else if (/(月|月份)/.test(text) && /支出|花了|花费|消费/.test(text) && !/导出|下载|月报|年报|账单明细/.test(text)) {
    add('analysis', '本轮查询月度支出：直接用 bank_get_spending（month 为所问 YYYY-MM，未指定则本月），该接口已有总额、分类和走势；无需先查余额或月度账单，同一问题已有完整结果后不要再次确认消费分析。')
  } else if (/月报|年报|月度账单|年度账单/.test(text)) {
    add('analysis', '完整账单报告用 bank_get_billing_report；需要下载才用导出工具。回答现有完整结果，不再重复调用消费分析。')
  }
  if (/理财.*(持仓|持有|市值|盈亏)|(持仓|持有).*理财|我的持仓/.test(text)) {
    add('wealth', '本轮查询理财持仓：直接用 bank_get_wealth_overview，确认卡应为查询理财持仓；不先查询储蓄余额、银行卡或产品目录。余额与持仓是不同口径。')
  }
  if (/汇率|牌价/.test(text)) {
    add('exchange', '只问币种汇率/牌价直接用 bank_get_exchange_rates，明确来源/目标币种后无需金额、余额或换汇授权。必须返回数字、方向、点差口径与来源/查询时间；不能只讲手续费或推用户去页面。指定金额估算才用 bank_exchange_quote，实际兑换才用 bank_exchange。')
  }
  return hints
}

export function serviceSkillContext(value, message) {
  if (value !== undefined && (!Array.isArray(value) || value.length > skills.length || value.some(id => typeof id !== 'string' || !byId.has(id)))) {
    throw bankError('智能服务选择无效，请重新选择', 400, 'INVALID_SERVICE_SELECTION')
  }
  const hints = requestRouteHints(message)
  const selected = new Set(hints.length ? hints.map(item => item.serviceId) : value ?? [])
  const entries = skills.filter(s => selected.has(s.serviceId))
  if (!entries.length) return '本轮未指定智能服务；请按当前问题自动匹配并加载技能，不沿用历史选择作为本轮办理指令。\n\n客户消息：\n'
  return `本轮智能服务指导（结合当前问题与客户选择）：${entries.map(s => s.header.metadata.label).join('、')}。以下技能只提供业务指导，不是业务授权，也不表示要求执行所有功能；以本轮客户消息为准，跨功能可加载其他相关技能。历史选择不作为本轮指令。\n${entries.map(s => '/' + s.skillName).join(' ')}\n${hints.map(item => item.instruction).join('\n')}\n\n客户消息：\n`
}
