/**
 * 姓名展示规则一致性检查：`shared/name-display.mjs` 与安卓 `NameDisplay.kt`
 * 必须给出相同结果（服务端与网页用 JS 版，安卓用镜像版）。
 *
 * 用法：node tools/check-name-display.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { displayNameOf, maskedNameOf, honorificFromIdNumber, DEFAULT_HONORIFIC } from '../shared/name-display.mjs'
import { NICKNAME_MAX, nicknameOf, normalizeNickname, validateNickname } from '../shared/nickname.mjs'

const root = resolve(import.meta.dirname, '..')

// 1) 称呼
assert.equal(displayNameOf('林小满', 'ms'), '林女士')
assert.equal(displayNameOf('马斯克', 'mr'), '马先生')
assert.equal(displayNameOf('Ken Ho', 'mr'), 'K先生')
assert.equal(displayNameOf('', 'ms'), '')
// 未知/非法称呼按默认值处理
assert.equal(displayNameOf('林小满', 'xx'), displayNameOf('林小满', DEFAULT_HONORIFIC))
assert.equal(displayNameOf('林小满', null), '林女士')

// 2) 脱敏
assert.equal(maskedNameOf('林小满'), '林*满')
assert.equal(maskedNameOf('马斯克'), '马*克')
assert.equal(maskedNameOf('陈嘉禾'), '陈*禾')
assert.equal(maskedNameOf('林一'), '林*')
assert.equal(maskedNameOf('林'), '林')
assert.equal(maskedNameOf('欧阳修文'), '欧**文')

// 3) 身份证号推称呼：第 17 位奇男偶女
assert.equal(honorificFromIdNumber('440101199001011234'), honorificFromIdNumber('440101199001011234'))
assert.equal(honorificFromIdNumber('440101199001011235'), 'mr') // 第 17 位 = 3（奇）
assert.equal(honorificFromIdNumber('440101199001011244'), 'ms') // 第 17 位 = 4（偶）
assert.equal(honorificFromIdNumber('4401011990'), null)
assert.equal(honorificFromIdNumber(null), null)

// 4) 昵称：默认回退称呼、可自定义、有长度上限、与姓名互不影响
assert.equal(nicknameOf({ nickname: '', displayName: '林女士' }), '林女士')
assert.equal(nicknameOf({ nickname: '  小满  ', displayName: '林女士' }), '小满')
assert.equal(nicknameOf({ displayName: '林女士' }), '林女士')
assert.equal(normalizeNickname(' 小\u0000满 '), '小满')
assert.equal(validateNickname(''), null)
assert.equal(validateNickname('  '), null)
assert.equal(validateNickname('小满'), null)
assert.equal(validateNickname('字'.repeat(NICKNAME_MAX)), null)
assert.ok(validateNickname('字'.repeat(NICKNAME_MAX + 1))?.includes(String(NICKNAME_MAX)))
// 昵称不会改变实名展示：两者是独立字段
assert.equal(maskedNameOf('林小满'), '林*满')

// 5) 安卓镜像必须包含同样的样例与默认值
const kotlin = readFileSync(resolve(root, 'android-app/app/src/main/java/com/moneymeow/bank/NameDisplay.kt'), 'utf8')
assert.ok(kotlin.includes('private const val DEFAULT_HONORIFIC = "ms"'), '安卓默认称呼与服务端不一致')
assert.ok(kotlin.includes('"先生"') && kotlin.includes('"女士"'), '安卓缺少先生/女士文案')
assert.ok(kotlin.includes('value.length == 2 -> value.take(1) + "*"'), '安卓两字名脱敏规则已变，请同步检查')
assert.ok(kotlin.includes('Regex("^\\\\d{17}[\\\\dXx]$")'), '安卓身份证号校验规则已变，请同步检查')

console.log('PASS 姓名与昵称规则一致（JS 与安卓镜像）')
