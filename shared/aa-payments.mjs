import { findBalance } from './account-model.mjs'
import { calculateSplitCollection } from './split-collection.mjs'
import { displayNameOf, maskedNameOf } from './name-display.mjs'

const fail = (message, code = 'INVALID_AA_REQUEST', status = 400) => Object.assign(new Error(message), { code, status })
const clone = value => structuredClone(value)
const text = (value, label, max) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw fail(`请填写有效的${label}`)
  return value.trim()
}
const version = (row, expected) => { if (row.version !== expected) throw fail('付款通知已变化，请刷新后确认', 'VERSION_CONFLICT', 409) }
const balance = (profile, currency) => [ ...profile.accounts, ...(profile.currencyBalances ?? []) ].find(row => row.currency === currency)

const PHONE = /^1[3-9]\d{9}$/
const ACCOUNT_NO = /^\d{12,19}$/

/** 成员的身份字段：手机号或本行账号，二者有一个即可，但必须同时给出姓名。 */
function memberIdentity(item) {
      const phone = typeof item.phone === 'string' ? item.phone.replace(/\s+/g, '') : ''
      const accountNo = typeof item.accountNo === 'string' ? item.accountNo.replace(/\s+/g, '') : ''
      if (!phone && !accountNo) throw fail('请填写成员的注册手机号或本行收款账号', 'INVALID_MEMBER_IDENTITY')
      if (phone && !PHONE.test(phone)) throw fail('成员手机号须为 11 位', 'INVALID_PHONE')
      if (accountNo && !ACCOUNT_NO.test(accountNo)) throw fail('成员账号须为 12 至 19 位数字', 'INVALID_ACCOUNT_NO')
      return { ...(phone ? { phone } : {}), ...(accountNo ? { accountNo } : {}) }
}

/**
 * 姓名核对：客户填的姓名必须对得上账户户名。
 *
 * 只做「像不像同一个人」这一档判断，接受三种写法，避免因为展示形态不同而误拒：
 * 真实姓名、列表里的脱敏名（林*满）、以及「林女士」这种称呼写法。
 * 对不上就拒绝——把付款通知发给一位名字对不上的人，比让发起人改一次更难收场。
 */
function nameMatches(input, user) {
      const typed = String(input ?? '').replace(/\s+/g, '')
      if (!typed) return false
      const candidates = [
        String(user?.name ?? '').replace(/\s+/g, ''),
        maskedNameOf(user?.name ?? '').replace(/\s+/g, ''),
        displayNameOf(user?.name ?? '', user?.honorific).replace(/\s+/g, ''),
      ].filter(Boolean)
      return candidates.includes(typed)
}

export function normalizeAaMembers(inputMembers) {
      if (!Array.isArray(inputMembers) || inputMembers.length < 1 || inputMembers.length > 30) throw fail('请填写 1 至 30 位 AA 成员')
      const members = inputMembers.map(item => {
        if (!item || typeof item !== 'object') throw fail('成员信息格式不正确', 'INVALID_MEMBER_IDENTITY')
        const identity = memberIdentity(item)
        // 姓名是成员身份的一部分：只给手机号或只给账号都不足以在列表里说清是谁。
        const name = text(item.name, '成员姓名（最多 40 字）', 40)
        if (!Number.isSafeInteger(item.amount) || item.amount < 1 || item.amount > 100000000) throw fail('成员金额须为 1 至 100000000 整数分', 'INVALID_AMOUNT')
        return { ...identity, name, amount: item.amount, memo: text(item.memo, '转账备注（最多 140 字）', 140) }
      })
      const keys = members.map(row => row.phone ?? row.accountNo)
      if (new Set(keys).size !== members.length) throw fail('同一位成员不能重复填写')
      const amount = members.reduce((sum, row) => sum + row.amount, 0)
      if (amount > 100000000) throw fail('待收总额不能超过 100000000 分', 'INVALID_AMOUNT')
      return { members, amount }
}

export function calculateAaAllocation(input, members) {
  if (input === undefined) return undefined
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('请提供有效的均分清单')
  const result = calculateSplitCollection(input)
  if (result.participants.length !== members.length || result.participants.some((person, index) => person.amount !== members[index].amount)) {
    throw fail('成员付款金额须与均分清单逐人一致，请重新核对', 'AA_ALLOCATION_MISMATCH')
  }
  return result
}

/** Account inbox requests and their transfer evidence share the bank unit of work. */
export function createAaPayments({ getDb, persistRelatedProfiles, findProfileByPhone, findProfileByAccountNo, findProfileByUserId, nextId, verifyPassword, executeTransfer, now = Date.now }) {
  const date = () => new Date(now()).toISOString()
  const requests = profile => profile.aaPaymentRequests ?? []
  const collections = profile => profile.splitCollections ?? []
  const resolveCollection = async (request, owners) => {
    const owner = owners?.get(request.collectorUserId) ?? await findProfileByUserId(request.collectorUserId)
    if (owner && owners) owners.set(owner.user.id, owner)
    const collection = owner && collections(owner).find(row => row.id === request.collectionId)
    const participant = collection?.participants.find(row => row.requestId === request.id && row.userId === getDb().user.id)
    if (!collection || !participant) throw fail('付款通知不存在', 'AA_REQUEST_NOT_FOUND', 404)
    return { owner, collection, participant }
  }
  const sync = (request, payer, collection, participant) => {
    if (request.transactionId) {
      const tx = payer.transactions.find(row => row.id === request.transactionId)
      if (!tx || tx.direction !== 'out' || tx.amount !== request.amount || findBalance(payer, tx.accountId)?.currency !== request.currency) throw fail('付款流水状态异常，请联系客服', 'AA_PAYMENT_EVIDENCE_MISSING', 409)
      request.status = tx.status === 'success' ? 'paid' : tx.status === 'pending' ? 'processing' : 'unpaid'
      if (request.status === 'paid') request.paidAt = tx.createdAt
      request.pendingReason = tx.pendingReason
      request.holdUntil = tx.holdUntil
    }
    if (collection.status === 'cancelled' && request.status !== 'paid' && request.status !== 'processing') request.status = 'cancelled'
    participant.status = request.status
    participant.transactionId = request.transactionId
    participant.paidAt = request.paidAt
    if (collection.status !== 'cancelled') collection.status = collection.participants.every(row => row.status === 'paid') ? 'complete' : 'open'
  }
  const publicRequest = row => {
    const { collectorUserId, ...result } = row
    return clone(result)
  }
  return {
    async createCollection(input) {
      if (input.confirmed !== true) throw fail('请确认成员姓名、手机号或账号、金额和转账备注', 'CONFIRMATION_REQUIRED')
      if (['amount', 'participants', 'expenses', 'collectorName'].some(key => input[key] !== undefined)) throw fail('AA 收款仅填写成员身份（姓名与手机号或账号）、金额和备注')
      const db = getDb(), title = text(input.title, '收款事由', 80), key = text(input.clientRequestId, '幂等标识', 100)
      if (!['CNY', 'USD', 'HKD'].includes(input.currency) || !balance(db, input.currency)) throw fail('请选择本人已有的币种余额', 'INVALID_CURRENCY')
      const { members, amount } = normalizeAaMembers(input.members)
      const allocation = calculateAaAllocation(input.allocation, members)
      const fingerprint = JSON.stringify({ title, currency: input.currency, members, ...(allocation ? { allocation } : {}) })
      const prior = collections(db).find(row => row.clientRequestId === key)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw fail('幂等标识已用于其他收款单', 'IDEMPOTENCY_CONFLICT', 409)
        return clone(prior)
      }
      if (collections(db).filter(row => row.status === 'open').length >= 50) throw fail('最多保留 50 条待收款 AA 单', 'SPLIT_LIMIT')
      // Resolve and validate EVERY recipient before writing any inbox or collection.
      const mentioned = new Set()
      const targets = []
      for (const member of members) {
        // 手机号或账号任一即可定位成员；两个都填时必须指向同一位客户。
        const byPhone = member.phone ? await findProfileByPhone(member.phone) : null
        const byAccount = member.accountNo ? await findProfileByAccountNo(member.accountNo) : null
        const target = byAccount ?? byPhone
        if (!target || !balance(target, input.currency)) throw fail(`成员「${member.name}」未开通对应银行账号或币种，请核对手机号或账号`, 'AA_MEMBER_UNAVAILABLE')
        if (byPhone && byAccount && byPhone.user.id !== byAccount.user.id) throw fail(`成员「${member.name}」的手机号与账号不属于同一位客户`, 'AA_MEMBER_MISMATCH')
        if (!nameMatches(member.name, target.user)) throw fail(`成员「${member.name}」与账户户名不一致，请核对姓名`, 'AA_MEMBER_NAME_MISMATCH')
        if (mentioned.has(target.user.id)) throw fail(`成员「${member.name}」重复出现`, 'AA_MEMBER_DUPLICATE')
        mentioned.add(target.user.id)
        if (target.user.id === db.user.id) throw fail('AA 付款成员不能包含本人')
        if (requests(target).filter(row => ['unpaid', 'processing'].includes(row.status)).length >= 300) throw fail('成员待付款通知已达上限', 'AA_INBOX_LIMIT', 409)
        targets.push(target)
      }
      const createdAt = date(), collection = { id: nextId('split'), clientRequestId: key, fingerprint, title, amount, currency: input.currency, accountId: balance(db, input.currency).id, accountNo: db.accounts[0].accountNo, status: 'open', version: 1, createdAt, updatedAt: createdAt, delivery: 'account-inbox', participants: [] }
      if (allocation?.expenses) {
        collection.collectorName = allocation.collectorName
        collection.expenseTotal = allocation.expenseTotal
        collection.selfAmount = allocation.selfAmount
        collection.expenses = allocation.expenses
      }
      members.forEach((member, index) => {
        const target = targets[index], id = `${collection.id}_${db.user.id}_${nextId('aa_request')}`
        collection.participants.push({ id: nextId('participant'), name: member.name, accountName: target.user.name, ...(allocation ? { splitName: allocation.participants[index].name } : {}), userId: target.user.id, requestId: id, ...member, status: 'unpaid', reminders: 0 })
        ;(target.aaPaymentRequests ??= []).push({ id, collectionId: collection.id, collectorUserId: db.user.id, collectorName: db.user.name, collectorAccountNo: collection.accountNo, title, amount: member.amount, currency: input.currency, memo: member.memo, status: 'unpaid', version: 1, createdAt })
      })
      ;(db.splitCollections ??= []).push(collection)
      persistRelatedProfiles(targets)
      return clone(collection)
    },
    async listRequests() {
      const db = getDb(), touched = new Map(), owners = new Map()
      for (const request of requests(db)) {
        const { owner, collection, participant } = await resolveCollection(request, owners)
        const before = JSON.stringify([request, participant, collection.status])
        sync(request, db, collection, participant)
        if (JSON.stringify([request, participant, collection.status]) !== before) { request.version++; collection.version++; collection.updatedAt = date(); touched.set(owner.user.id, owner) }
      }
      if (touched.size) persistRelatedProfiles([...touched.values()])
      return requests(db).map(publicRequest).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async refreshCollection(collection) {
      if (collection.delivery !== 'account-inbox') return
      const touched = []
      for (const participant of collection.participants) {
        const payer = await findProfileByUserId(participant.userId)
        const request = payer && requests(payer).find(row => row.id === participant.requestId)
        if (!request) throw fail('成员付款通知缺失', 'AA_REQUEST_NOT_FOUND', 409)
        const before = JSON.stringify([request, participant, collection.status])
        sync(request, payer, collection, participant)
        if (JSON.stringify([request, participant, collection.status]) !== before) { request.version++; touched.push(payer) }
      }
      if (touched.length) { collection.version++; collection.updatedAt = date(); persistRelatedProfiles(touched) }
    },
    async payRequest(id, input) {
      const db = getDb(), request = requests(db).find(row => row.id === id)
      if (!request) throw fail('付款通知不存在', 'AA_REQUEST_NOT_FOUND', 404)
      if (input.confirmed !== true) throw fail('请确认收款人、金额和备注后付款', 'CONFIRMATION_REQUIRED')
      let { owner, collection, participant } = await resolveCollection(request)
      sync(request, db, collection, participant)
      if (request.status === 'paid' || request.status === 'processing') { persistRelatedProfiles([owner]); return publicRequest(request) }
      version(request, input.version)
      if (request.status !== 'unpaid' || collection.status !== 'open') throw fail('收款单已关闭，不能付款', 'SPLIT_CLOSED', 409)
      const account = balance(db, request.currency)
      if (!account) throw fail('付款币种余额不存在', 'ACCOUNT_NOT_FOUND')
      if (owner.accounts[0].accountNo !== request.collectorAccountNo || owner.user.name !== request.collectorName) throw fail('收款账号已变化，请重新发起 AA', 'AA_RECIPIENT_CHANGED', 409)
      await verifyPassword(input.paymentPassword)
      const result = await executeTransfer({ fromAccountId: account.id, channel: 'bank', scope: 'domestic', payeeBankCode: 'LCB', payeeBankRegion: 'CN', payeeName: owner.user.name, payeeAccountNo: request.collectorAccountNo, amount: request.amount, memo: request.memo })
      // The transfer may reload/persist the recipient profile. Never overwrite its credited
      // balance with the pre-transfer snapshot (browser and unscoped memory adapters).
      ;({ owner, collection, participant } = await resolveCollection(request))
      request.transactionId = result.transactionId
      sync(request, db, collection, participant)
      request.version++; collection.version++; collection.updatedAt = date()
      persistRelatedProfiles([owner])
      return publicRequest(request)
    },
    async cancelCollection(collection) {
      const targets = []
      await this.refreshCollection(collection)
      if (collection.participants.some(row => row.status === 'processing')) throw fail('存在处理中付款，请等待结果后取消', 'AA_PAYMENT_PROCESSING', 409)
      for (const participant of collection.participants) {
        const target = await findProfileByUserId(participant.userId)
        const request = target && requests(target).find(row => row.id === participant.requestId)
        if (!request) throw fail('成员付款通知缺失', 'AA_REQUEST_NOT_FOUND', 409)
        if (request.status === 'unpaid') { request.status = 'cancelled'; request.version++; participant.status = 'cancelled' }
        targets.push(target)
      }
      collection.status = 'cancelled'; collection.version++; collection.updatedAt = date()
      persistRelatedProfiles(targets)
      return clone(collection)
    },
  }
}
