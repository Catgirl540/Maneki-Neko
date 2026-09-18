/**
 * 加固包离线测试：脱敏规则、深层脱敏、白名单守卫。
 * 全程本地，环境变量用注入的假表，不读真实密钥。
 *
 * 跑法：node --test packages/hardening/tests/
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildRules,
  denialReason,
  makeToolAllowListGuard,
  normalizeAllowList,
  redactDeep,
  redactText,
} from '../lib/index.js'

describe('redactText（按形态）', () => {
  const rules = buildRules()

  it('抹掉 sk- 前缀密钥', () => {
    const result = redactText('调用失败，key=sk-or-v1-abcdefghijklmnopqrstuvwx', rules)
    assert.ok(!result.text.includes('sk-or-v1-abcdefghijklmnopqrstuvwx'))
    assert.ok(result.text.includes('[REDACTED:sk-key]'))
  })

  it('抹掉 Bearer 令牌', () => {
    const result = redactText('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345', rules)
    assert.ok(!result.text.includes('abcdefghijklmnopqrstuvwxyz012345'))
  })

  it('赋值式只抹掉取值，保留键名（便于排查）', () => {
    const result = redactText('config: api_key = "abcdefghijklmnop"', rules)
    assert.ok(result.text.includes('api_key'))
    assert.ok(!result.text.includes('abcdefghijklmnop'))
  })

  it('抹掉 AWS access key 与 PEM 私钥块', () => {
    const aws = redactText('AKIAIOSFODNN7EXAMPLE', rules)
    assert.ok(aws.text.includes('[REDACTED:aws-key]'))
    const pem = redactText('-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----', rules)
    assert.ok(pem.text.includes('[REDACTED:pem-private-key]'))
  })

  it('没有命中时原文不变、命中列表为空', () => {
    const result = redactText('这是一段普通文本，没有密钥。', rules)
    assert.equal(result.text, '这是一段普通文本，没有密钥。')
    assert.deepEqual(result.hits, [])
  })

  it('同一套规则重复使用结果一致（正则 lastIndex 不能残留）', () => {
    const text = 'sk-or-v1-abcdefghijklmnopqrstuvwx 和 sk-or-v1-zyxwvutsrqponmlkjihgfedc'
    const first = redactText(text, rules)
    const second = redactText(text, rules)
    assert.equal(first.text, second.text)
    assert.equal((first.text.match(/\[REDACTED:sk-key\]/g) ?? []).length, 2, '两条都要被抹掉')
  })
})

describe('redactText（按环境变量取值）', () => {
  it('按取值精确脱敏，标签里带变量名', () => {
    const env = { MY_FAKE_KEY: 'super-secret-value-123456' }
    const rules = buildRules({ secretEnv: ['MY_FAKE_KEY'] }, env)
    const result = redactText('日志里出现了 super-secret-value-123456 这串东西', rules)
    assert.ok(!result.text.includes('super-secret-value-123456'))
    assert.ok(result.text.includes('[REDACTED:env:MY_FAKE_KEY]'))
  })

  it('取值过短不当密钥（避免把 "1" 抹得到处都是）', () => {
    const rules = buildRules({ secretEnv: ['SHORT'] }, { SHORT: 'abc' })
    const result = redactText('abc 应该原样保留', rules)
    assert.equal(result.text, 'abc 应该原样保留')
  })

  it('变量未设置时跳过该规则', () => {
    const rules = buildRules({ secretEnv: ['MISSING_VAR'] }, {})
    assert.equal(rules.some(rule => rule.label === 'env:MISSING_VAR'), false)
  })

  it('正则元字符按字面量匹配', () => {
    const env = { WEIRD: 'a+b*c?d[e]f(g)h.i^j$k' }
    const rules = buildRules({ secretEnv: ['WEIRD'] }, env)
    const result = redactText('值：a+b*c?d[e]f(g)h.i^j$k 结束', rules)
    assert.ok(!result.text.includes('a+b*c?d[e]f(g)h.i^j$k'))
  })

  it('非法正则在构造规则时就抛错（必须加载期失败，不能静默不脱敏）', () => {
    assert.throws(() => buildRules({ extraPatterns: ['('] }))
  })
})

describe('redactDeep（遥测记录）', () => {
  it('对嵌套结构里的字符串做脱敏', () => {
    const rules = buildRules()
    const record = {
      id: 'rec-1',
      payload: {
        messages: [{ text: 'Bearer abcdefghijklmnopqrstuvwxyz012345' }],
        meta: { note: '干净' },
      },
    }
    const result = redactDeep(record, rules)
    assert.ok(!JSON.stringify(result.value).includes('abcdefghijklmnopqrstuvwxyz012345'))
    assert.equal(result.value.payload.meta.note, '干净')
    assert.ok(result.hits.includes('bearer'))
  })

  it('保留结构、不改类型', () => {
    const rules = buildRules()
    const result = redactDeep({ n: 1, b: true, nil: null, list: ['x'] }, rules)
    assert.deepEqual(result.value, { n: 1, b: true, nil: null, list: ['x'] })
  })
})

describe('白名单守卫', () => {
  it('名单内放行、名单外拒绝', () => {
    const guard = makeToolAllowListGuard(['knowledge_lookup', 'luckycat_ping'])
    assert.equal(guard('knowledge_lookup'), undefined)
    assert.equal(guard('luckycat_ping'), undefined)
    const reason = guard('bash')
    assert.ok(typeof reason === 'string' && reason.includes('bash'))
  })

  it('拒绝理由要告诉模型有哪些可用工具（面向模型的文案）', () => {
    const reason = denialReason('bash', normalizeAllowList(['a_tool']))
    assert.ok(reason.includes('a_tool'), '必须列出可用工具')
    assert.ok(reason.includes('Do not retry'), '必须告诉模型不要重试')
  })

  it('空名单在构造时就报错（会让所有工具不可用）', () => {
    assert.throws(() => makeToolAllowListGuard([]), /allowedTools 不能为空/)
    assert.throws(() => makeToolAllowListGuard(['   ', '']), /allowedTools 不能为空/)
  })

  it('名单项会去掉首尾空白', () => {
    const guard = makeToolAllowListGuard(['  spaced_tool  '])
    assert.equal(guard('spaced_tool'), undefined)
  })
})