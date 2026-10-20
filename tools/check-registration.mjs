/** 注册开户与单账户隔离门禁。使用内存 localStorage，不污染浏览器演示数据。 */

class MemoryStorage {
  #items = new Map()
  getItem(key) { return this.#items.get(key) ?? null }
  setItem(key, value) { this.#items.set(key, String(value)) }
  removeItem(key) { this.#items.delete(key) }
  clear() { this.#items.clear() }
  dump() { return JSON.stringify([...this.#items]) }
}

const localStorage = new MemoryStorage()
globalThis.window = { localStorage, sessionStorage: new MemoryStorage() }

const [{ createMockApi }, { resetDb }, { ACCOUNT_OPENING_PLEDGE }] = await Promise.all([
  import('../app/src/api/mock/index.ts'),
  import('../app/src/api/mock/db.ts'),
  import('../app/src/lib/account-opening.ts'),
])

let failures = 0
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

resetDb()
const api = createMockApi()

const demoSms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', demoSms.demoCode)
const demoAccounts = await api.listAccounts()
check(demoAccounts.length === 1, '演示账号只有一个账户')
check(
  demoAccounts[0]?.id === 'acc_0001' &&
    demoAccounts[0]?.kind === 'savings' &&
    demoAccounts[0]?.balance === 128_464_055 &&
    demoAccounts[0]?.available === 128_464_055,
  '演示余额合并到 acc_0001 储蓄账户且全部可用',
)
check(!('tier' in (demoAccounts[0] ?? {})), '公开账户 DTO 不含 tier')

const phone = '13900139000'
const password = 'safe123'
const sms = await api.sendSmsCode(phone)
const face = await api.verifyIdentity('face')
const result = await api.register({
  phone,
  password,
  holderName: '测试用户',
  idNumber: '310101199001011234',
  smsCode: sms.demoCode,
  faceTicket: face.ticket,
  pledge: ACCOUNT_OPENING_PLEDGE,
})
check(Boolean(result.token && result.user && result.account && result.openedAt), '注册返回自动登录所需完整结果')
check(
  result.account.kind === 'savings' && result.account.balance === 0 && result.account.available === 0,
  '新用户获得独立零余额储蓄账户',
)

await api.logout()
const reloginSms = await api.sendSmsCode(phone)
await api.login(phone, password, reloginSms.demoCode)
const newUserAccounts = await api.listAccounts()
check(newUserAccounts.length === 1 && newUserAccounts[0]?.balance === 0, '新用户退出后可用新密码重新登录')

let reused = false
try {
  await api.login(phone, password, reloginSms.demoCode)
} catch (error) {
  reused = error?.code === 'SMS_NOT_SENT'
}
check(reused, '短信验证码登录后一次性消费')

const demoAgainSms = await api.sendSmsCode('13800138000')
await api.login('13800138000', '123456', demoAgainSms.demoCode)
const demoAgain = await api.listAccounts()
check(demoAgain[0]?.balance === 128_464_055, '切回演示账号后数据未被新用户覆盖')

const publicPayload = JSON.stringify({ result, accounts: newUserAccounts })
check(!publicPayload.includes(password) && !publicPayload.includes('passwordDigest'), '密码不出现在接口响应')
check(!localStorage.dump().includes(`\"password\":\"${password}\"`), '演示存储不新增明文登录密码字段')

if (failures) {
  console.error(`\n${failures} registration check(s) failed.`)
  process.exit(1)
}
console.log('\nRegistration and account isolation checks passed.')
