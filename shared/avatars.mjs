/**
 * 用户头像池（唯一来源）。
 *
 * 头像只从这 10 张里选，不做上传：id 与文件名一一对应，
 * 网页端放在 `app/public/avatars/<id>.png`，安卓端放在 `res/drawable-nodpi/avatar_NN.png`。
 * 两边与服务器共用这份清单，改名或增删要同时跑 `tools/check-avatar-pool.mjs`。
 */
export const AVATAR_IDS = Object.freeze([
  'avatar-01',
  'avatar-02',
  'avatar-03',
  'avatar-04',
  'avatar-05',
  'avatar-06',
  'avatar-07',
  'avatar-08',
  'avatar-09',
  'avatar-10',
])

/** 头像文件在网页端的公开路径。 */
export function avatarUrl(id) {
  return `/avatars/${id}.png`
}

/** 是否是合法头像 id；接口与前端选项都用它校验。 */
export function isAvatarId(value) {
  return typeof value === 'string' && AVATAR_IDS.includes(value)
}

/** FNV-1a：给没有头像字段的历史数据算一个稳定下标，同一个 id 永远得到同一张。 */
function hashIndex(seed, size) {
  let hash = 0x811c9dc5
  const text = String(seed ?? '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % size
}

/** 历史数据（或注册前）用的确定性默认头像：同一用户每次看到同一张。 */
export function avatarIdFor(seed) {
  return AVATAR_IDS[hashIndex(seed, AVATAR_IDS.length)]
}

/** 新用户注册时随机分配一张。 */
export function randomAvatarId() {
  return AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)]
}
