import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { STAFF_TOOLS } from '../packages/staff-tools/src/definitions.mjs'
import { OPS_NATIVE_TOOLS } from '../packages/ops-native/src/names.mjs'
const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => value }))
export function checkPolicy(path) {
  const rows = yaml.load(readFileSync(path, 'utf8'), { schema })
  const policies = rows.filter(r => r.id === 'luckycat-hardening')
  if (policies.length !== 1) throw Error('员工工具必须配置唯一的白名单')
  const expected = /[\\/]staff-ops[\\/]/.test(path) ? ['ask_user_question', 'staff_operations_overview', ...OPS_NATIVE_TOOLS] : ['ask_user_question', ...STAFF_TOOLS.filter(t=>t.roles.some(role=>['csr','supervisor'].includes(role))).map(t => t.name)]
  const allowed = policies[0].config.allowedTools
  if (!Array.isArray(allowed) || allowed.length !== expected.length || new Set(allowed).size !== expected.length || expected.some(n => !allowed.includes(n))) throw Error('员工工具白名单不匹配；不得包含客户工具、文件或系统工具')
  if (rows.some(r => r.id === 'luckycat-bank-demo' || r.insert?.some(p => p.id === 'luckycat-bank-demo'))) throw Error('员工 profile 不得加载客户银行插件')
  return expected.length
}
