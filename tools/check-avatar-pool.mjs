/**
 * 头像池一致性检查：shared/avatars.mjs 是唯一来源，
 * 网页公开目录、安卓 drawable、安卓 AvatarPool.kt 必须与它一一对应。
 *
 * 用法：node tools/check-avatar-pool.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { AVATAR_IDS, avatarUrl, isAvatarId, avatarIdFor, randomAvatarId } from '../shared/avatars.mjs'

const root = resolve(import.meta.dirname, '..')

// 1) id 形状与唯一性
assert.equal(new Set(AVATAR_IDS).size, AVATAR_IDS.length, '头像 id 不能重复')
for (const id of AVATAR_IDS) {
  assert.match(id, /^avatar-\d{2}$/, `头像 id 形状不对：${id}`)
  assert.ok(isAvatarId(id), `isAvatarId 不认识自己的 id：${id}`)
  assert.equal(avatarUrl(id), `/avatars/${id}.png`)
}
assert.equal(isAvatarId('avatar-11'), false, '池外 id 必须被拒绝')
assert.equal(isAvatarId(''), false)

// 2) 稳定派生与随机取值都在池内
for (const seed of ['u_0001', 'u_demo_chen', '13800138000', '']) {
  assert.ok(AVATAR_IDS.includes(avatarIdFor(seed)), `派生头像是池外值：${seed}`)
  assert.equal(avatarIdFor(seed), avatarIdFor(seed), '同一 seed 必须得到同一张')
}
for (let i = 0; i < 50; i += 1) assert.ok(AVATAR_IDS.includes(randomAvatarId()))

// 3) 网页静态文件齐全（vite 直接从 public/ 提供）
const webDir = resolve(root, 'app/public/avatars')
const webFiles = new Set(readdirSync(webDir).filter((name) => name.endsWith('.png')))
for (const id of AVATAR_IDS) assert.ok(webFiles.has(`${id}.png`), `网页缺少头像文件：app/public/avatars/${id}.png`)
assert.equal(webFiles.size, AVATAR_IDS.length, '网页头像目录里有池外文件')

// 4) 安卓 drawable 齐全
const androidDir = resolve(root, 'android-app/app/src/main/res/drawable-nodpi')
const androidFiles = new Set(readdirSync(androidDir).filter((name) => name.startsWith('avatar_') && name.endsWith('.png')))
assert.equal(androidFiles.size, AVATAR_IDS.length, '安卓头像 drawable 数量与池不一致')
for (const index of AVATAR_IDS.map((id) => Number(id.slice(-2)))) {
  assert.ok(androidFiles.has(`avatar_${String(index).padStart(2, '0')}.png`), `安卓缺少 drawable：avatar_${index}`)
}

// 5) AvatarPool.kt 的 id 列表与映射必须与共享清单一致
const kotlin = readFileSync(resolve(root, 'android-app/app/src/main/java/com/moneymeow/bank/AvatarPool.kt'), 'utf8')
const kotlinIds = [...kotlin.matchAll(/"(avatar-\d{2})"/g)].map((m) => m[1])
const uniqueKotlinIds = [...new Set(kotlinIds)]
assert.deepEqual(uniqueKotlinIds, [...AVATAR_IDS], 'AvatarPool.kt 的 id 列表与 shared/avatars.mjs 不一致')
for (const id of AVATAR_IDS) {
  const drawable = `R.drawable.avatar_${id.slice(-2)}`
  assert.ok(kotlin.includes(`"${id}" -> ${drawable}`), `AvatarPool.kt 缺少映射：${id} -> ${drawable}`)
}

console.log(`PASS 头像池一致（${AVATAR_IDS.length} 张）：shared / 网页 public / 安卓 drawable / AvatarPool.kt`)
