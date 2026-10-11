/** 校验实际注册的银行工具在生产及自检 profile 中均可使用，不扩大到其他工具。 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { HTTP_OPERATIONS } from '../packages/bank-demo/lib/http-tools.js'
const root = fileURLToPath(new URL('../', import.meta.url))
// 配置中的 JS 表达式仅作为文本解析，校验过程不读取或执行环境变量。
const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => value }))
export const bankTools = HTTP_OPERATIONS.map(operation => operation.toolName)
export function checkPolicy(path) {
  const patch = yaml.load(readFileSync(path, 'utf8'), { schema })
  const policies = patch.filter(entry => entry.id === 'luckycat-hardening')
  if (policies.length !== 1) throw Error(`${path}: 必须存在唯一的工具策略`)
  const allowed = policies[0].config.allowedTools
  const bank = allowed.filter(name => name.startsWith('bank_'))
  const missing = bankTools.filter(name => !bank.includes(name))
  const extra = bank.filter(name => !bankTools.includes(name))
  if (missing.length || extra.length || new Set(allowed).size !== allowed.length) throw Error(`${path}: 工具策略与注册不一致；缺少 ${missing.join('、')}；多余 ${extra.join('、')}；重复 ${allowed.length - new Set(allowed).size}`)
  return bank.length
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const paths = process.argv.slice(2)
  for (const path of paths.length ? paths : ['profiles/luckycat/cordis.patch.yml', 'profiles/luckycat/doctor.patch.yml'].map(path => resolve(root, path))) {
    console.log(`PASS 银行工具策略：${checkPolicy(path)} 项，${path}`)
  }
}
