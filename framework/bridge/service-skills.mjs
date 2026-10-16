/** 网页只提交稳定功能 ID；技能名与正文由服务端仓库决定。 */
import { validateSkills } from '../scripts/check-skills.mjs'
import { bankError } from './bank-error.mjs'

const { skills } = validateSkills()
const byId = new Map(skills.map(s => [s.serviceId, s]))

export function serviceSkillContext(value) {
  if (value !== undefined && (!Array.isArray(value) || value.length > skills.length || value.some(id => typeof id !== 'string' || !byId.has(id)))) {
    throw bankError('智能服务选择无效，请重新选择', 400, 'INVALID_SERVICE_SELECTION')
  }
  const selected = new Set(value ?? [])
  const entries = skills.filter(s => selected.has(s.serviceId))
  if (!entries.length) return '本轮未指定智能服务；请按当前问题自动匹配并加载技能，不沿用历史选择作为本轮办理指令。\n\n客户消息：\n'
  return `本轮客户选择的智能服务：${entries.map(s => s.header.metadata.label).join('、')}。以下技能只提供业务指导，不是业务授权，也不表示要求执行所有功能；以本轮客户消息为准，跨功能可加载其他相关技能。历史选择不作为本轮指令。\n${entries.map(s => '/' + s.skillName).join(' ')}\n\n客户消息：\n`
}
