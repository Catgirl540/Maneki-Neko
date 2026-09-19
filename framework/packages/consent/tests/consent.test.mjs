/**
 * 敏感操作闸门的离线测试：挑战生成、判定矩阵、通道解析。
 *
 * 全部纯本地：不起 agent、不联网（通道那几条用假的 fetch）。
 * 判定矩阵的每个分支都要有用例 —— 这个函数的返回值直接决定钱动不动。
 *
 * 跑法：node --test packages/consent/tests/consent.test.mjs
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertAllowedEndpoint,
  createChallenge,
  judge,
  methodLabel,
  parseAnswer,
  renderChallenge,
  MAX_FIELD_VALUE_CHARS,
} from '../lib/index.js'

/** 一个转账类的声明，测试里反复用。 */
function transferSpec(overrides = {}) {
  return {
    toolName: 'bank_transfer',
    kind: '转账',
    describe: (args) => [
      { label: '收款人', value: String(args.payeeName) },
      { label: '金额', value: `${(args.amountCents / 100).toFixed(2)} 元`, emphasis: true },
    ],
    verification: 'payment-password',
    consequence: '确认后立即扣款，不可撤销。',
    ...overrides,
  }
}

const NOW = 1_700_000_000_000

describe('createChallenge', () => {
  it('生成挑战时带上会话、调用、展示字段与到期时刻', () => {
    const challenge = createChallenge(
      transferSpec(),
      { payeeName: '梁乐怡', amountCents: 80_000 },
      { sessionId: 'session-1', callId: 'call-1' },
      NOW,
      60_000,
    )
    assert.equal(challenge.sessionId, 'session-1')
    assert.equal(challenge.callId, 'call-1')
    assert.equal(challenge.toolName, 'bank_transfer')
    assert.equal(challenge.kind, '转账')
    assert.equal(challenge.verification, 'payment-password')
    assert.equal(challenge.createdAt, NOW)
    assert.equal(challenge.expiresAt, NOW + 60_000)
    assert.deepEqual(challenge.fields.map(f => f.label), ['收款人', '金额'])
    assert.equal(challenge.fields[1].emphasis, true)
  })

  it('每次生成的 challengeId 都不同（防重放的随机 nonce）', () => {
    const args = { payeeName: '梁乐怡', amountCents: 1 }
    const a = createChallenge(transferSpec(), args, { sessionId: 's', callId: 'c' }, NOW)
    const b = createChallenge(transferSpec(), args, { sessionId: 's', callId: 'c' }, NOW)
    assert.notEqual(a.challengeId, b.challengeId)
  })

  it('展示值按码点截断，不把多字节字符切成半个', () => {
    const long = '喵'.repeat(MAX_FIELD_VALUE_CHARS + 50)
    const challenge = createChallenge(
      transferSpec({ describe: () => [{ label: '备注', value: long }] }),
      {},
      { sessionId: 's', callId: 'c' },
      NOW,
    )
    const value = challenge.fields[0].value
    assert.equal([...value].length, MAX_FIELD_VALUE_CHARS + 1) // +1 是省略号
    assert.ok(value.endsWith('…'))
  })

  it('describe 抛异常时向上抛，由闸门转成拒绝', () => {
    assert.throws(() => createChallenge(
      transferSpec({ describe: () => { throw new Error('参数不完整') } }),
      {},
      { sessionId: 's', callId: 'c' },
      NOW,
    ), /参数不完整/)
  })
})

describe('judge（判定矩阵，全部 fail-closed）', () => {
  const spec = transferSpec()
  const challenge = createChallenge(spec, { payeeName: '梁乐怡', amountCents: 80_000 }, { sessionId: 's', callId: 'c' }, NOW, 60_000)
  const approve = { decision: 'approve', challengeId: challenge.challengeId, verification: { method: 'payment-password', verified: true, ticket: 't-1' } }

  it('同意 + 验证通过 → 放行', () => {
    assert.deepEqual(judge(challenge, approve, NOW), { allowed: true })
  })

  it('没有收到答复 → 拒绝（通道故障/超时）', () => {
    const verdict = judge(challenge, undefined, NOW)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /没有收到用户的确认答复/)
  })

  it('challengeId 对不上 → 拒绝（重放旧答复）', () => {
    const verdict = judge(challenge, { ...approve, challengeId: 'other-id' }, NOW)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /重放/)
  })

  it('已过期 → 拒绝', () => {
    const verdict = judge(challenge, approve, NOW + 60_001)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /过期/)
  })

  it('用户取消 → 拒绝', () => {
    const verdict = judge(challenge, { decision: 'reject', challengeId: challenge.challengeId }, NOW)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /取消/)
  })

  it('需要验证但答复里没有 verification → 拒绝', () => {
    const verdict = judge(challenge, { decision: 'approve', challengeId: challenge.challengeId }, NOW)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /需要身份验证/)
  })

  it('需要验证但 verified=false → 拒绝', () => {
    const verdict = judge(challenge, {
      ...approve,
      verification: { method: 'payment-password', verified: false },
    }, NOW)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /没有通过验证/)
  })

  it('验证方式不符 → 拒绝（不能用短信码顶替支付密码）', () => {
    const verdict = judge(challenge, {
      ...approve,
      verification: { method: 'sms', verified: true, ticket: 't-2' },
    }, NOW)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /身份验证方式不符/)
  })

  it('不需要验证的操作：同意即放行，缺 verification 也不影响', () => {
    const plain = createChallenge(transferSpec({ verification: undefined }), {}, { sessionId: 's', callId: 'c' }, NOW)
    assert.deepEqual(
      judge(plain, { decision: 'approve', challengeId: plain.challengeId }, NOW),
      { allowed: true },
    )
  })

  it('不需要验证的操作：带了一个假 verification 也不影响放行（多余字段被忽略）', () => {
    const plain = createChallenge(transferSpec({ verification: undefined }), {}, { sessionId: 's', callId: 'c' }, NOW)
    assert.deepEqual(
      judge(plain, { decision: 'approve', challengeId: plain.challengeId, verification: { method: 'face', verified: true } }, NOW),
      { allowed: true },
    )
  })
})

describe('renderChallenge（模型看到的必须和用户看到的是同一份信息）', () => {
  it('包含类别、每个字段、补充说明与验证方式', () => {
    const challenge = createChallenge(transferSpec(), { payeeName: '梁乐怡', amountCents: 80_000 }, { sessionId: 's', callId: 'c' }, NOW)
    const text = renderChallenge(challenge)
    assert.match(text, /【待确认】转账/)
    assert.match(text, /收款人：梁乐怡/)
    assert.match(text, /金额：800\.00 元/)
    assert.match(text, /确认后立即扣款，不可撤销。/)
    assert.match(text, /需要验证：支付密码/)
  })

  it('不需要验证时不写"需要验证"那一行', () => {
    const challenge = createChallenge(transferSpec({ verification: undefined }), { payeeName: '甲', amountCents: 1 }, { sessionId: 's', callId: 'c' }, NOW)
    assert.ok(!renderChallenge(challenge).includes('需要验证'))
  })
})

describe('methodLabel', () => {
  it('三种验证方式都有中文标签', () => {
    assert.equal(methodLabel('payment-password'), '支付密码')
    assert.equal(methodLabel('sms'), '短信验证码')
    assert.equal(methodLabel('face'), '人脸核身')
  })
})

describe('parseAnswer（通道返回体的形状校验）', () => {
  it('读出完整的批准答复', () => {
    assert.deepEqual(
      parseAnswer({ decision: 'approve', challengeId: 'c-1', verification: { method: 'payment-password', verified: true, ticket: 't' } }),
      { decision: 'approve', challengeId: 'c-1', verification: { method: 'payment-password', verified: true, ticket: 't' } },
    )
  })

  it('拒绝答复不需要 verification', () => {
    assert.deepEqual(
      parseAnswer({ decision: 'reject', challengeId: 'c-1' }),
      { decision: 'reject', challengeId: 'c-1' },
    )
  })

  it('verified 不是 true 时归一成 false（不是"真值即通过"）', () => {
    const answer = parseAnswer({ decision: 'approve', challengeId: 'c-1', verification: { method: 'face', verified: 'yes' } })
    assert.equal(answer.verification.verified, false)
  })

  it('decision 非法 → 抛错', () => {
    assert.throws(() => parseAnswer({ decision: 'maybe', challengeId: 'c-1' }), /decision 非法/)
  })

  it('challengeId 缺失 → 抛错', () => {
    assert.throws(() => parseAnswer({ decision: 'approve' }), /challengeId 缺失/)
  })

  it('verification.method 非法 → 抛错', () => {
    assert.throws(() => parseAnswer({ decision: 'approve', challengeId: 'c-1', verification: { method: 'magic', verified: true } }), /method 非法/)
  })

  it('不是对象 → 抛错', () => {
    assert.throws(() => parseAnswer([1, 2]), /不是一个 JSON 对象/)
    assert.throws(() => parseAnswer('nope'), /不是一个 JSON 对象/)
  })
})

describe('assertAllowedEndpoint（通道地址的传输安全）', () => {
  it('允许本机回环的 http', () => {
    assert.equal(assertAllowedEndpoint('http://127.0.0.1:8788/consent/challenge').hostname, '127.0.0.1')
    assert.equal(assertAllowedEndpoint('http://localhost:8788/x').hostname, 'localhost')
  })

  it('允许任何 https', () => {
    assert.equal(assertAllowedEndpoint('https://bank.example.com/consent').protocol, 'https:')
  })

  it('拒绝非本机的明文 http', () => {
    assert.throws(() => assertAllowedEndpoint('http://10.0.0.5:8788/x'), /明文 http 只允许本机回环地址/)
  })

  it('拒绝其它协议', () => {
    assert.throws(() => assertAllowedEndpoint('ftp://127.0.0.1/x'), /只支持 https/)
  })

  it('拒绝非法 URL', () => {
    assert.throws(() => assertAllowedEndpoint('not a url'), /不是合法 URL/)
  })
})
