import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import yaml from 'js-yaml'
import { validateSkills, frameworkRoot, MAX_SKILL_BODY_BYTES } from '../../../scripts/check-skills.mjs'

const source = resolve(frameworkRoot, 'skills')
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)))
const valid = validateSkills()

test('10 个入口唯一映射；正文有界、结果确定、技能不扩张银行工具', () => {
  assert.equal(valid.skills.length, 10)
  assert.deepEqual(validateSkills(), valid)
  assert(valid.skills.every(s => Buffer.byteLength(s.content) <= MAX_SKILL_BODY_BYTES))
  const bundle = yaml.load(readFileSync(resolve(frameworkRoot, 'packages/skills/cordis.patch.yml'), 'utf8'))[0].insert
  assert.deepEqual(bundle.map(e => e.id), ['skills', 'skill-filesystem', 'tool-skill'])
  assert.equal(bundle[1].config.includeDefaultRoots, false)
  const staff = readFileSync(resolve(frameworkRoot, 'profiles/staff/cordis.patch.yml'), 'utf8')
  assert(!staff.includes('dsh-skills') && !staff.includes('skill-filesystem'))
})

test('60 条固定用例覆盖每个技能、口语、缺信息、多技能与能力边界', () => {
  assert(cases.length >= 60)
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length)
  for (const skill of valid.skills) {
    const group = cases.filter(c => c.expectedSkills[0] === skill.skillName)
    assert(group.length >= 6)
    assert(group.some(c => c.kind === 'boundary'))
    assert(group.some(c => c.kind === 'cross'))
    for (const c of group) {
      assert(c.query.trim())
      for (const name of c.expectedSkills) assert(valid.skills.some(s => s.skillName === name))
      for (const phrase of c.instructionIncludes) assert(skill.content.includes(phrase), `${c.id}: 缺少处理依据 ${phrase}`)
    }
  }
})

test('无办理工具的技能明确限制，不将网页或假设数据当作已办理', () => {
  const limits = {
    'bank-exchange': ['没有查询独立换汇实时汇率或提交兑换的工具', '不调用转账给自己'],
    'bank-savings': ['不能代建、修改储蓄目标或开启自动存入'],
    'bank-credit': ['不能查询个人额度或实际贷款利率', '没有可验证计算结果'],
    'bank-insurance': ['没有保险查询、投保或理赔工具', '不得补编银行产品条款'],
    'bank-security': ['不能代改密码手机号', '不保证追回资金'],
    'bank-support': ['不代表人工在线或立即接通', '不能把网页已有功能说成 Agent 已有工具'],
  }
  for (const [name, phrases] of Object.entries(limits)) for (const phrase of phrases) assert(valid.skills.find(s => s.skillName === name).content.includes(phrase), name)
})

test('错误映射、元数据、工具、路由、依据、越界和超长正文必须阻止构建', async t => {
  const mutations = {
    '重复入口': dir => editCatalog(dir, c => c.services[1].serviceId = c.services[0].serviceId),
    '重复名称': dir => editCatalog(dir, c => c.services[1].skillName = c.services[0].skillName),
    '路径遍历': dir => editCatalog(dir, c => c.services[0].skillName = '../bank-transfer'),
    '缺失头部': dir => editSkill(dir, () => '无头部'),
    '未注册工具': dir => editSkill(dir, s => s.replace('bank_get_balance', 'bank_make_loan')),
    '正文引用未声明工具': dir => editSkill(dir, s => s + '\nbank_apply_card\n'),
    '无效路由': dir => editSkill(dir, s => s.replace('"/transfer"', '"/does-not-exist"')),
    '不存在依据': dir => editSkill(dir, s => s.replace('framework/bridge/bank-agent.mjs', 'framework/no-such-file.mjs')),
    '越界依据': dir => editSkill(dir, s => s.replace('framework/bridge/bank-agent.mjs', '../outside.mjs')),
    '描述过长': dir => editSkill(dir, s => s.replace('"description": "', '"description": "' + '长'.repeat(181))),
    '正文超长': dir => editSkill(dir, s => s + '字'.repeat(MAX_SKILL_BODY_BYTES)),
    '章节缺失': dir => editSkill(dir, s => s.replace('## 能力限制', '## 其他')),
    '标签不一致': dir => editSkill(dir, s => s.replace('智能转账', '未知标签')),
    '禁止平铺维护文档': dir => writeFileSync(join(dir, 'README.md'), '# 维护说明'),
    '关闭自动调用': dir => editSkill(dir, s => s.replace('"name":', '"disable-model-invocation": true,\n  "name":')),
  }
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-validator-'))
    try { cpSync(source, dir, { recursive: true }); mutate(dir); assert.throws(() => validateSkills({ skillsRoot: dir })) }
    finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

function editCatalog(dir, fn) {
  const path = join(dir, 'catalog.json'), value = JSON.parse(readFileSync(path, 'utf8'))
  fn(value); writeFileSync(path, JSON.stringify(value))
}
function editSkill(dir, fn) {
  const path = join(dir, 'bank-transfer/SKILL.md')
  writeFileSync(path, fn(readFileSync(path, 'utf8')))
}
