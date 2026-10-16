import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'
import { openBankDatabase } from './database.mjs'

const serverDir = fileURLToPath(new URL('.', import.meta.url))
const tempDir = mkdtempSync(join(tmpdir(), 'luckycat-server-smoke-'))
const probe = createServer()
const port = await new Promise((resolve, reject) => {
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => resolve(probe.address().port))
})
await new Promise((resolve) => probe.close(resolve))

const child = spawn(process.execPath, [join(serverDir, 'index.mjs')], {
  cwd: join(serverDir, '..'),
  env: {
    ...process.env,
    BANK_PORT: String(port),
    BANK_DB_FILE: join(tempDir, 'bank.sqlite'),
    BANK_STATE_FILE: join(tempDir, 'no-legacy-state.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', (chunk) => { logs += chunk })
child.stderr.on('data', (chunk) => { logs += chunk })
const base = `http://127.0.0.1:${port}`

async function call(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, data: await response.json() }
}

try {
  let healthy = false
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`后端提前退出：${logs}`)
    try {
      healthy = (await call('/health')).data.ok === true
      if (healthy) break
    } catch { /* 等待服务启动 */ }
    await delay(100)
  }
  assert.ok(healthy, `后端没有启动：${logs}`)

  assert.equal((await call('/api/accounts')).status, 401)
  assert.equal((await call('/api/accounts', { token: 'forged' })).status, 401)
  assert.equal((await call('/api/__demo/reset', { method: 'POST' })).status, 404)

  const phone = '13800138000'
  const sms = await call('/api/auth/sms-code', { method: 'POST', body: { phone } })
  assert.equal(sms.status, 200)
  assert.ok(sms.data.demoCode)
  const login = await call('/api/auth/login', {
    method: 'POST', body: { phone, password: '123456', smsCode: sms.data.demoCode },
  })
  assert.equal(login.status, 200, JSON.stringify(login.data))
  assert.ok(login.data.token)
  const token = login.data.token
  const accounts = await call('/api/accounts', { token })
  assert.equal(accounts.status, 200)
  assert.ok(Array.isArray(accounts.data) && accounts.data.length > 0)
  const transactions = await call(`/api/accounts/${accounts.data[0].id}/transactions?size=8`, { token })
  assert.equal(transactions.status, 200)
  assert.ok(Array.isArray(transactions.data.items))
  assert.equal((await call('/api/auth/profile', { token })).data.phone, phone)

  const beforeCards = await call('/api/cards', { token })
  const products = await call('/api/cards/products', { token })
  assert.ok(beforeCards.data.length > 0 && products.data.length > 0)
  assert.ok(!JSON.stringify(beforeCards.data).includes('cvv'))
  const demoCards = ['8888', '3366', '2046'].map((last4) => beforeCards.data.find((card) => card.last4 === last4))
  assert.ok(demoCards.every(Boolean))
  assert.equal(accounts.data.length, 1)
  assert.equal(new Set(demoCards.map((card) => card.accountId)).size, 1)
  const first = accounts.data[0]
  assert(demoCards.every(card => card.accountId === first.id))
  const selfTransfer = await call('/api/transfers', { method: 'POST', token, body: {
    fromAccountId: first.id, channel: 'bank', scope: 'domestic', payeeName: '林小满',
    amount: 100, memo: '', payeeBankCode: 'LCB', payeeBankRegion: 'CN',
    payeeAccountNo: first.accountNo,
  } })
  assert.equal(selfTransfer.status, 400)
  const address = {
    recipient: '测试用户', phone, region: '上海市', city: '上海市',
    detail: '测试路 1 号 101 室', postalCode: '200000',
  }
  const opened = await call('/api/cards/open', {
    method: 'POST', token,
    body: { productCode: products.data[0].code, address, paymentPassword: '888888' },
  })
  assert.equal(opened.status, 200, JSON.stringify(opened.data))
  assert.equal(opened.data.status, 'pending')
  const afterCards = await call('/api/cards', { token })
  assert.equal(afterCards.data.length, beforeCards.data.length + 1)
  const fee = products.data[0].issuingFee + products.data[0].deliveryFee
  const afterAccounts = await call('/api/accounts', { token })
  assert.equal(afterAccounts.data[0].balance, accounts.data[0].balance - fee)
  const afterTransactions = await call(`/api/accounts/${accounts.data[0].id}/transactions?size=100`, { token })
  assert.equal(afterTransactions.data.total, transactions.data.total + (fee > 0 ? 1 : 0))
  const revealPending = await call(`/api/cards/${opened.data.id}/secrets`, {
    method: 'POST', token, body: { paymentPassword: '888888' },
  })
  assert.equal(revealPending.status, 409)
  const activeCard = beforeCards.data.find((card) => card.status === 'active')
  const secret = await call(`/api/cards/${activeCard.id}/secrets`, {
    method: 'POST', token, body: { paymentPassword: '888888' },
  })
  assert.equal(secret.status, 200)
  assert.ok(secret.data.pan.endsWith(activeCard.last4))
  const badLimit = await call(`/api/cards/${activeCard.id}/settings`, {
    method: 'PATCH', token, body: { dailyLimit: -1 },
  })
  assert.equal(badLimit.status, 400)
  const settings = await call(`/api/cards/${activeCard.id}/settings`, {
    method: 'PATCH', token, body: { dailyLimit: 500_000 },
  })
  assert.equal(settings.status, 200)
  assert.equal(settings.data.dailyLimit, 500_000)
  const locked = await call(`/api/cards/${activeCard.id}/lock`, {
    method: 'POST', token, body: { locked: true },
  })
  assert.equal(locked.status, 200)
  assert.equal(locked.data.status, 'locked')
  assert.equal(locked.data.onlinePayment, false)
  const replaced = await call(`/api/cards/${activeCard.id}/replace`, {
    method: 'POST', token, body: { address, paymentPassword: '888888' },
  })
  assert.equal(replaced.status, 200, JSON.stringify(replaced.data))
  assert.equal(replaced.data.status, 'pending')
  assert.notEqual(replaced.data.id, activeCard.id)
  assert.equal((await call(`/api/cards/${activeCard.id}/secrets`, {
    method: 'POST', token, body: { paymentPassword: '888888' },
  })).status, 409)

  const sqlite = new DatabaseSync(join(tempDir, 'bank.sqlite'))
  try {
    const cardRow = sqlite.prepare('SELECT status, account_id FROM virtual_cards WHERE owner_id = ? AND id = ?')
      .get(login.data.user.id, opened.data.id)
    assert.equal(cardRow.status, 'pending')
    assert.equal(cardRow.account_id, accounts.data[0].id)
    assert.ok(sqlite.prepare('SELECT pan FROM virtual_card_secrets WHERE owner_id = ? AND card_id = ?')
      .get(login.data.user.id, opened.data.id)?.pan)
    const lockedRow = sqlite.prepare('SELECT status, daily_limit_cents FROM virtual_cards WHERE owner_id = ? AND id = ?')
      .get(login.data.user.id, activeCard.id)
    assert.equal(lockedRow.status, 'replaced')
    assert.equal(lockedRow.daily_limit_cents, 500_000)
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM virtual_card_secrets WHERE owner_id = ? AND card_id = ?')
      .get(login.data.user.id, activeCard.id).n, 0)
    assert.ok(sqlite.prepare('SELECT pan FROM virtual_card_secrets WHERE owner_id = ? AND card_id = ?')
      .get(login.data.user.id, replaced.data.id)?.pan)
  } finally { sqlite.close() }

  const recipientNo = '8820000000124471'
  const recipientLookup = await call('/api/transfers/recipient', { method: 'POST', token, body: {
    bankCode: 'LCB', bankRegion: 'CN', accountOrCardNo: recipientNo, payeeName: '陈嘉禾',
  } })
  assert.equal(recipientLookup.status, 200, JSON.stringify(recipientLookup.data))
  assert.equal(recipientLookup.data.kind, 'internal')
  assert.equal((await call('/api/transfers/recipient', { method: 'POST', token, body: {
    bankCode: 'LCB', bankRegion: 'CN', accountOrCardNo: recipientNo, payeeName: '错误姓名',
  } })).status, 400)
  const chenBeforeSms = await call('/api/auth/sms-code', { method: 'POST', body: { phone: '13600136000' } })
  const chenLogin = await call('/api/auth/login', { method: 'POST', body: {
    phone: '13600136000', password: '123456', smsCode: chenBeforeSms.data.demoCode,
  } })
  assert.equal(chenLogin.status, 200, JSON.stringify(chenLogin.data))
  const chenToken = chenLogin.data.token
  const chenBefore = await call('/api/accounts', { token: chenToken })
  assert.equal(chenBefore.data[0].accountNo, recipientNo)
  const chenCards = await call('/api/cards', { token: chenToken })
  assert.equal(chenCards.data[0].accountId, chenBefore.data[0].id)
  const chenPan = new DatabaseSync(join(tempDir, 'bank.sqlite'))
  let pan
  try {
    pan = chenPan.prepare('SELECT pan FROM virtual_card_secrets WHERE owner_id = ? AND card_id = ?')
      .get('u_demo_chen', chenCards.data[0].id).pan
  } finally { chenPan.close() }
  const cardLookup = await call('/api/transfers/recipient', { method: 'POST', token, body: {
    bankCode: 'LCB', bankRegion: 'CN', accountOrCardNo: pan, payeeName: '陈嘉禾',
  } })
  assert.equal(cardLookup.status, 200)
  assert.equal(cardLookup.data.cardLast4, '4471')
  const senderBefore = await call('/api/accounts', { token })
  const wrongName = await call('/api/transfers', { method: 'POST', token, body: {
    fromAccountId: first.id, channel: 'bank', scope: 'domestic', payeeName: '其他人',
    amount: 100, memo: '', payeeBankCode: 'LCB', payeeBankRegion: 'CN',
    payeeAccountNo: recipientNo,
  } })
  assert.equal(wrongName.status, 400)
  const unknownRecipient = await call('/api/transfers', { method: 'POST', token, body: {
    fromAccountId: first.id, channel: 'bank', scope: 'domestic', payeeName: '陌生人',
    amount: 100, memo: '', payeeBankCode: 'LCB', payeeBankRegion: 'CN',
    payeeAccountNo: '8820009999999999999',
  } })
  assert.equal(unknownRecipient.status, 404)
  const toPerson = await call('/api/transfers', { method: 'POST', token, body: {
    fromAccountId: first.id, channel: 'bank', scope: 'domestic', payeeName: '陈嘉禾',
    amount: 2_500, memo: '给其他用户转账', payeeBankCode: 'LCB', payeeBankRegion: 'CN',
    payeeAccountNo: recipientNo,
  } })
  assert.equal(toPerson.status, 200, JSON.stringify(toPerson.data))
  assert.equal(toPerson.data.settlementStatus, 'success')
  const byCard = await call('/api/transfers', { method: 'POST', token, body: {
    fromAccountId: first.id, channel: 'bank', scope: 'domestic', payeeName: '陈嘉禾',
    amount: 1_000, memo: '按卡号转账', payeeBankCode: 'LCB', payeeBankRegion: 'CN',
    payeeAccountNo: pan,
  } })
  assert.equal(byCard.status, 200, JSON.stringify(byCard.data))
  const senderAfter = await call('/api/accounts', { token })
  assert.equal(senderAfter.data.find((row) => row.id === first.id).balance,
    senderBefore.data.find((row) => row.id === first.id).balance - 3_500)
  const chenAfter = await call('/api/accounts', { token: chenToken })
  assert.equal(chenAfter.data[0].balance, chenBefore.data[0].balance + 3_500)
  const chenLedger = await call(`/api/accounts/${chenAfter.data[0].id}/transactions`, { token: chenToken })
  assert.equal(chenLedger.data.total, 2)
  assert.ok(chenLedger.data.items.every((row) => row.direction === 'in'))
  const persisted = new DatabaseSync(join(tempDir, 'bank.sqlite'))
  try {
    const row = persisted.prepare('SELECT value_json FROM app_storage WHERE key = ?')
      .get('luckycat.luckycat.mock.user-profiles.v1')
    const profiles = JSON.parse(row.value_json)
    assert.equal(profiles['13600136000'].accounts[0].balance, chenBefore.data[0].balance + 3_500)
    const accountRow = persisted.prepare('SELECT balance_cents FROM bank_accounts WHERE owner_id = ? AND id = ?')
      .get('u_demo_chen', chenBefore.data[0].id)
    assert.equal(accountRow.balance_cents, chenBefore.data[0].balance + 3_500)
    assert.equal(persisted.prepare('SELECT count(*) AS n FROM bank_transactions WHERE owner_id = ? AND account_id = ?')
      .get('u_demo_chen', chenBefore.data[0].id).n, 2)
  } finally { persisted.close() }

  const changedPhone = '13700137000'
  const changeSms = await call('/api/auth/sms-code', {
    method: 'POST', token, body: { phone: changedPhone },
  })
  const changeFace = await call('/api/security/verify', {
    method: 'POST', token, body: { channel: 'face' },
  })
  const changed = await call('/api/auth/phone', {
    method: 'PATCH', token,
    body: { newPhone: changedPhone, smsCode: changeSms.data.demoCode, faceTicket: changeFace.data.ticket },
  })
  assert.equal(changed.status, 200, JSON.stringify(changed.data))
  assert.equal(changed.data.phone, changedPhone)
  assert.equal((await call('/api/cards', { token })).data.length, beforeCards.data.length + 2)
  assert.equal((await call('/api/auth/profile', { token })).data.phone, changedPhone)

  await call('/api/auth/logout', { method: 'POST', token })
  assert.equal((await call('/api/accounts', { token })).status, 401)

  const newPhone = '13900139000'
  const newSms = await call('/api/auth/sms-code', { method: 'POST', body: { phone: newPhone } })
  assert.equal(newSms.status, 200)
  const face = await call('/api/security/verify', { method: 'POST', body: { channel: 'face' } })
  assert.equal(face.status, 200)
  const registration = await call('/api/auth/register', {
    method: 'POST',
    body: {
      phone: newPhone,
      password: '123456',
      holderName: '测试用户',
      idNumber: '110101199001011234',
      smsCode: newSms.data.demoCode,
      faceTicket: face.data.ticket,
      pledge: '本人充分了解并清楚知晓出租、出借、出售、购买账户的相关法律责任和惩戒措施，承诺依法依规开立和使用本人账户',
    },
  })
  assert.equal(registration.status, 200, JSON.stringify(registration.data))
  const newAccounts = await call('/api/accounts', { token: registration.data.token })
  assert.equal(newAccounts.status, 200)
  assert.equal(newAccounts.data.length, 1)
  assert.equal(newAccounts.data[0].balance, 0)
  assert.notEqual(newAccounts.data[0].id, accounts.data[0].id)
  const foreign = await call(`/api/accounts/${accounts.data[0].id}/transactions`, {
    token: registration.data.token,
  })
  assert.equal(foreign.status, 404)
  const sqliteAfter = new DatabaseSync(join(tempDir, 'bank.sqlite'))
  try {
    assert.equal(
      sqliteAfter.prepare('SELECT count(*) AS n FROM virtual_cards WHERE owner_id = ?').get(registration.data.user.id).n,
      0,
    )
  } finally { sqliteAfter.close() }
  const reopened = openBankDatabase(join(tempDir, 'bank.sqlite'))
  try {
    const profiles = JSON.parse(reopened.storage.getItem('luckycat.luckycat.mock.user-profiles.v1'))
    const original = Object.values(profiles).find((profile) => profile.user.id === login.data.user.id)
    assert.equal(original.cards.length, beforeCards.data.length + 2)
    assert.equal(original.cards.find((card) => card.id === activeCard.id).status, 'replaced')
    assert.equal(original.cardSecrets[activeCard.id], undefined)
  } finally { reopened.close() }
  console.log('PASS: auth, accounts, transactions, card lifecycle in SQLite, phone change, registration isolation')
} finally {
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)])
  rmSync(tempDir, { recursive: true, force: true })
}
