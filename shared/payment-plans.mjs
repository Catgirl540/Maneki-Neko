import { createAaPayments } from './aa-payments.mjs'
import { calculateSplitCollection } from './split-collection.mjs'
import { findBalance, internalExchange as internalExchangeTransaction } from './account-model.mjs'

const fail = (message, code, status = 400) => Object.assign(new Error(message), { status, code })
const text = (value, label, max = 80) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw fail(`${label}无效`, 'INVALID_PAYMENT_PLAN')
  return value.trim()
}
const cents = value => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000_000) throw fail('金额须为 1 至 100000000 整数分', 'INVALID_AMOUNT')
  return value
}
const checkedVersion = (row, version) => { if (version !== row.version) throw fail('记录已变化，请刷新后确认', 'VERSION_CONFLICT', 409) }
const clone = value => structuredClone(value)
const keyOf = input => text(input.clientRequestId, '幂等标识', 100)
const publicSchedule = row => {
  const { request, requestFingerprint, ...summary } = row
  return { ...clone(summary), fromAccountId: request.fromAccountId, payeeName: request.payeeName, payeeBankCode: request.payeeBankCode, payeeBankRegion: request.payeeBankRegion, payeeAccountNo: request.payeeAccountNo, amount: request.amount, memo: request.memo }
}

/** A standing instruction is independent of an in-flight transfer and stores no password. */
export function createPaymentPlans({ getDb, persist, nextId, verifyPassword, resolveRecipient, executeTransfer, findProfileByPhone, findProfileByUserId, persistRelatedProfiles, now = Date.now }) {
  const aa = createAaPayments({ getDb, nextId, verifyPassword, executeTransfer, findProfileByPhone, findProfileByUserId, persistRelatedProfiles, now })
  const schedules = () => getDb().scheduledTransfers ?? []
  const splits = () => getDb().splitCollections ?? []
  const getSchedule = id => {
    const row = schedules().find(item => item.id === id)
    if (!row) throw fail('定时转账不存在', 'SCHEDULE_NOT_FOUND', 404)
    return row
  }
  const getSplit = id => {
    const row = splits().find(item => item.id === id)
    if (!row) throw fail('AA 收款单不存在', 'SPLIT_NOT_FOUND', 404)
    return row
  }
  return {
    async listScheduledTransfers() { return schedules().map(publicSchedule).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },
    async createScheduledTransfer(input) {
      if (input.confirmed !== true) throw fail('请明确确认定时执行时间、收款人和金额', 'CONFIRMATION_REQUIRED')
      const db = getDb(), clientRequestId = keyOf(input)
      const account = findBalance(db, input.fromAccountId)
      if (!account) throw fail('付款币种余额不存在', 'ACCOUNT_NOT_FOUND', 404)
      if (input.channel !== 'bank' || input.scope !== 'domestic' || input.payeeBankRegion !== 'CN' || (input.payeeCurrency && input.payeeCurrency !== account.currency)) throw fail('定时转账仅支持境内银行账户同币种转账；跨境及换汇须届时重新询价确认', 'SCHEDULE_UNSUPPORTED')
      const executeAt = input.executeAt
      const time = typeof executeAt === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|\+08:00)$/.test(executeAt) ? Date.parse(executeAt) : NaN
      if (!Number.isFinite(time) || new Date(`${executeAt.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== executeAt.slice(0, 10)) throw fail('执行时间须为有效的带时区 ISO 时间', 'INVALID_EXECUTION_TIME')
      const request = { fromAccountId: account.id, channel: 'bank', scope: 'domestic', payeeName: text(input.payeeName, '收款人'), payeeBankCode: text(input.payeeBankCode, '银行代码', 20), payeeBankRegion: 'CN', payeeAccountNo: text(input.payeeAccountNo, '完整收款账号', 32).replace(/\s/g, ''), amount: cents(input.amount), memo: typeof input.memo === 'string' ? input.memo.trim().slice(0, 140) : '' }
      if (!/^\d{12,19}$/.test(request.payeeAccountNo)) throw fail('请填写 12 至 19 位完整银行账号', 'INVALID_ACCOUNT_NO')
      if (!db.banks.some(bank => bank.code === request.payeeBankCode && bank.region === 'CN')) throw fail('收款银行不存在', 'BANK_NOT_FOUND')
      const normalizedAt = new Date(time).toISOString(), requestFingerprint = JSON.stringify({ request, executeAt: normalizedAt })
      const prior = schedules().find(row => row.clientRequestId === clientRequestId)
      if (prior) {
        if (prior.requestFingerprint !== requestFingerprint) throw fail('幂等标识已用于其他指令', 'IDEMPOTENCY_CONFLICT', 409)
        return publicSchedule(prior)
      }
      if (time < now() + 60_000 || time > now() + 366 * 86_400_000) throw fail('执行时间须在一分钟后至未来 366 天内', 'INVALID_EXECUTION_TIME')
      if (schedules().filter(row => row.status === 'scheduled').length >= 50) throw fail('最多保留 50 条待执行定时转账', 'SCHEDULE_LIMIT')
      const recipient = await resolveRecipient(request)
      if (recipient?.sameOwner) throw fail('不能转给本人资金账户', 'SAME_ACCOUNT')
      await verifyPassword(input.paymentPassword)
      const createdAt = new Date(now()).toISOString()
      const row = { id: nextId('schedule'), clientRequestId, requestFingerprint, request, currency: account.currency, executeAt: normalizedAt, createdAt, updatedAt: createdAt, status: 'scheduled', version: 1, fee: 0, fundsReserved: false }
      ;(db.scheduledTransfers ??= []).push(row); persist()
      return publicSchedule(row)
    },
    async cancelScheduledTransfer(id, version) {
      const row = getSchedule(id)
      checkedVersion(row, version)
      if (row.status !== 'scheduled') throw fail('定时转账已执行或取消', 'SCHEDULE_NOT_CANCELLABLE', 409)
      row.status = 'cancelled'; row.version++; row.updatedAt = new Date(now()).toISOString(); persist()
      return publicSchedule(row)
    },
    async settleScheduledTransfers() {
      const outcomes = []
      for (const row of schedules().filter(item => item.status === 'scheduled' && Date.parse(item.executeAt) <= now())) {
        // Only pure preflight failures may become a committed failed instruction.
        // Any error from execution must escape so the bank rolls back ALL profiles.
        let rejected
        try {
          const balance = findBalance(getDb(), row.request.fromAccountId)
          if (!balance || balance.currency !== row.currency) throw fail('付款币种余额已变化', 'CURRENCY_MISMATCH', 409)
          if (row.request.amount > balance.available) throw fail('账户可用余额不足', 'INSUFFICIENT_FUNDS')
          const recipient = await resolveRecipient(clone(row.request))
          if (recipient?.sameOwner) throw fail('不能转给本人资金账户', 'SAME_ACCOUNT')
        } catch (error) {
          if (!error.status || error.status >= 500) throw error
          rejected = error
        }
        if (rejected) {
          row.status = 'failed'; row.failureCode = rejected.code ?? 'TRANSFER_REJECTED'; row.failureReason = rejected.message
        } else {
          const result = await executeTransfer(clone(row.request))
          row.status = 'executed'; row.transactionId = result.transactionId; row.settlementStatus = result.settlementStatus ?? 'success'
        }
        row.version++; row.updatedAt = new Date(now()).toISOString(); persist(); outcomes.push(publicSchedule(row))
      }
      return outcomes
    },
    async listSplitCollections() { for (const row of splits()) await aa.refreshCollection(row); return clone(splits()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },
    listSplitPaymentRequests: () => aa.listRequests(),
    paySplitRequest: (id, input) => aa.payRequest(id, input),
    async createSplitCollection(input) {
      if (input.members !== undefined) return aa.createCollection(input)
      const db = getDb(), title = text(input.title, '收款事由'), clientRequestId = keyOf(input)
      const calculation = calculateSplitCollection(input), { amount } = calculation
      if (!['CNY', 'USD', 'HKD'].includes(input.currency)) throw fail('币种无效', 'INVALID_CURRENCY')
      const account = [ ...db.accounts, ...(db.currencyBalances ?? []) ].find(row => row.currency === input.currency)
      if (!account) throw fail('请先开通该币种余额', 'ACCOUNT_NOT_FOUND')
      const names = calculation.participants.map(item => item.name)
      const fingerprint = JSON.stringify({ amount, title, currency: input.currency, names, ...(calculation.expenses ? { collectorName: calculation.collectorName, expenses: calculation.expenses } : {}) })
      const prior = splits().find(row => row.clientRequestId === clientRequestId)
      if (prior) { if (prior.fingerprint !== fingerprint) throw fail('幂等标识已用于其他收款单', 'IDEMPOTENCY_CONFLICT', 409); return clone(prior) }
      if (splits().filter(row => row.status === 'open').length >= 50) throw fail('最多保留 50 条待收款 AA 单', 'SPLIT_LIMIT')
      const createdAt = new Date(now()).toISOString()
      const row = { id: nextId('split'), clientRequestId, fingerprint, title, amount, currency: input.currency, accountId: account.id, accountNo: db.accounts[0].accountNo, status: 'open', version: 1, createdAt, updatedAt: createdAt,
        ...calculation, participants: calculation.participants.map(person => ({ ...person, id: nextId('participant'), status: 'unpaid', reminders: 0 })) }
      ;(db.splitCollections ??= []).push(row); persist(); return clone(row)
    },
    async confirmSplitPayment(id, input) {
      const db = getDb(), row = getSplit(id)
      if (row.delivery === 'account-inbox') throw fail('请由成员在 AA 付款中确认支付', 'AA_PAYMENT_REQUIRED')
      checkedVersion(row, input.version)
      if (row.status !== 'open') throw fail('收款单已关闭', 'SPLIT_CLOSED', 409)
      const participant = row.participants.find(item => item.id === input.participantId)
      if (!participant || participant.status !== 'unpaid') throw fail('参与者不存在或已确认收款', 'INVALID_SPLIT_PARTICIPANT', 409)
      const tx = db.transactions.find(item => item.id === input.transactionId)
      if (!tx || tx.direction !== 'in' || tx.status !== 'success' || tx.amount !== participant.amount || findBalance(db, tx.accountId)?.id !== row.accountId || internalExchangeTransaction(tx) || (tx.detail?.counterpartyName ?? '').trim() !== participant.name) throw fail('须提供该参与者同币种、同金额的成功转入流水', 'SPLIT_PAYMENT_NOT_MATCHED', 409)
      if (splits().some(split => split.participants.some(item => item.transactionId === tx.id))) throw fail('该笔流水已用于其他 AA 份额', 'SPLIT_PAYMENT_REUSED', 409)
      participant.status = 'paid'; participant.transactionId = tx.id; participant.paidAt = tx.createdAt
      if (row.participants.every(item => item.status === 'paid')) row.status = 'complete'
      row.version++; row.updatedAt = new Date(now()).toISOString(); persist(); return clone(row)
    },
    async remindSplitParticipant(id, input) {
      const row = getSplit(id); checkedVersion(row, input.version)
      const participant = row.participants.find(item => item.id === input.participantId)
      if (row.status !== 'open' || !participant || participant.status !== 'unpaid') throw fail('仅可提醒未付款参与者', 'SPLIT_CLOSED', 409)
      participant.reminders++; participant.lastRemindedAt = new Date(now()).toISOString(); row.version++; row.updatedAt = participant.lastRemindedAt; persist()
      return { collection: clone(row), delivered: false, text: `${participant.name}，请支付「${row.title}」AA 份额 ${(participant.amount / 100).toFixed(2)} ${row.currency} 至账户 ${row.accountNo}。`, notice: '仅生成催收文字，请自行发送；未向联系人发送消息。' }
    },
    async cancelSplitCollection(id, version) {
      const row = getSplit(id); checkedVersion(row, version)
      if (row.status !== 'open') throw fail('收款单已关闭', 'SPLIT_CLOSED', 409)
      if (row.delivery === 'account-inbox') return aa.cancelCollection(row)
      row.status = 'cancelled'; row.version++; row.updatedAt = new Date(now()).toISOString(); persist(); return clone(row)
    },
  }
}
