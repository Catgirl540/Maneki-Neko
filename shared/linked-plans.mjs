/** Birthday plans hold existing currency funds; merchant orders remain explicitly unconnected. */
import { findBalance, ledgerBalances } from './account-model.mjs'

const DAY = 86400000, OFFSET = 8 * 3600000
const fail = (message, code = 'INVALID_BIRTHDAY_PLAN', status = 400) => { throw Object.assign(new Error(message), { status, code }) }
const dateKey = value => new Date(value + OFFSET).toISOString().slice(0, 10)
const validNow = now => { if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) fail('计划时间无效') }
function owner(profile) { if (typeof profile?.user?.id !== 'string' || !profile.user.id) fail('客户身份无效', 'UNAUTHORIZED', 401); return profile.user.id }
function accountFor(profile, id, currency) {
  const account = id ? findBalance(profile, id) : ledgerBalances(profile).find(row => row.currency === currency)
  if (!account || account.currency !== currency) fail('请选择本人资金账户中的对应币种余额', 'ACCOUNT_NOT_FOUND', 404)
  if (!Number.isSafeInteger(account.balance) || !Number.isSafeInteger(account.available) || account.available < 0 || account.available > account.balance) fail('账户可用余额异常，请核查原记录', 'INVALID_ACCOUNT_BALANCE', 409)
  return account
}
const cleanText = (value, max, label) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) fail(`${label}不完整或过长`); return value.trim() }

export function previewBirthdayPlan(profile, input = {}, now = Date.now()) {
  owner(profile); validNow(now)
  const contactName = cleanText(input.contactName, 40, '联系人姓名')
  const relationship = cleanText(input.relationship, 20, '与本人的关系')
  const eventDate = input.eventDate
  const eventStart = typeof eventDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? Date.parse(eventDate + 'T00:00:00+08:00') : NaN
  if (!Number.isFinite(eventStart) || dateKey(eventStart) !== eventDate || eventStart + DAY <= now || eventStart > now + 365 * DAY) fail('请提供今天至未来 365 天内的真实生日日期')
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 100000000) fail('预留金额须为 1 至 100,000,000 的整数分', 'INVALID_AMOUNT')
  const currency = input.currency ?? 'CNY'
  if (!['CNY', 'USD', 'HKD'].includes(currency)) fail('预留币种无效', 'CURRENCY_MISMATCH')
  const account = accountFor(profile, input.accountId, currency)
  const orderAt = eventStart - 2 * DAY + 9 * 3600000
  const monthStart = Date.parse(eventDate.slice(0, 7) + '-01T00:00:00+08:00')
  // For birthdays on the first two days, the review explicitly shows the earlier reserve date.
  const reserveAt = Math.min(monthStart, orderAt)
  return { contactName, relationship, eventDate, amountCents: input.amountCents, currency, accountId: account.id, reserveAt: new Date(reserveAt).toISOString(), orderAt: new Date(orderAt).toISOString(), expiresAt: new Date(eventStart + DAY).toISOString(), goods: ['flowers', 'cake'], timeZone: 'Asia/Shanghai', merchantConnected: false, notice: '预留只减少本币种可用余额，不扣账面余额。提前两天生成鲜花蛋糕待办，须另行确认；当前未接入商户，不会建立真实订单或自动购买。生日在月初时预留可能提前到上月，具体以核对时间为准。' }
}
function reserve(profile, plan, now) {
  if (plan.reservation.status === 'held') return true
  const account = accountFor(profile, plan.accountId, plan.currency)
  if (account.available < plan.amountCents) { plan.status = 'needs_funds'; plan.reservation.status = 'pending'; plan.lastError = 'INSUFFICIENT_FUNDS'; return false }
  account.available -= plan.amountCents
  plan.reservation = { status: 'held', amountCents: plan.amountCents, heldAt: new Date(now).toISOString(), releasedAt: null }
  plan.status = 'reserved'; plan.lastError = null
  return true
}
function release(profile, plan, now) {
  if (plan.reservation.status !== 'held') return false
  if (!Number.isSafeInteger(plan.reservation.amountCents) || plan.reservation.amountCents < 1 || plan.reservation.amountCents !== plan.amountCents) fail('原预留金额记录异常，保留原记录待核查', 'INVALID_RESERVATION', 409)
  const account = accountFor(profile, plan.accountId, plan.currency)
  const nextAvailable = account.available + plan.reservation.amountCents
  if (!Number.isSafeInteger(nextAvailable) || nextAvailable > account.balance) fail('预留解冻金额与原冻结记录不一致，保留原记录待核查', 'INVALID_RESERVATION', 409)
  account.available = nextAvailable
  plan.reservation.status = 'released'; plan.reservation.releasedAt = new Date(now).toISOString()
  return true
}
const publicPlan = plan => structuredClone(plan)
function lookup(profile, id) {
  const ownerId = owner(profile), plan = (profile.birthdayPlans ?? []).find(row => row.id === id && row.ownerId === ownerId)
  if (!plan) fail('生日计划不存在或不属于当前客户', 'BIRTHDAY_PLAN_NOT_FOUND', 404)
  return plan
}
export function createBirthdayPlan(profile, input = {}, now = Date.now()) {
  const ownerId = owner(profile); validNow(now)
  if (input.confirmed !== true) fail('请先核对并确认生日预留和订购待办', 'CONFIRMATION_REQUIRED')
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.requestId)) fail('缺少有效的计划请求编号')
  const previous = (profile.birthdayPlans ?? []).find(row => row.requestId === input.requestId)
  // A retry after the birthday must still return the original outcome, never re-reserve.
  const terms = previewBirthdayPlan(profile, input, previous ? Date.parse(previous.createdAt) : now)
  const fingerprint = JSON.stringify(terms)
  if (previous) { if (previous.ownerId !== ownerId || previous.fingerprint !== fingerprint) fail('请求编号已用于其他生日计划', 'IDEMPOTENCY_CONFLICT', 409); return publicPlan(previous) }
  if ((profile.birthdayPlans ?? []).filter(row => !['cancelled', 'expired', 'released'].includes(row.status)).length >= 30) fail('进行中的生日计划已达上限', 'PLAN_LIMIT', 429)
  const plan = { id: 'birthday-' + globalThis.crypto.randomUUID(), ownerId, requestId: input.requestId, fingerprint, ...terms, status: 'scheduled', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), reservation: { status: 'pending', amountCents: terms.amountCents, heldAt: null, releasedAt: null }, order: { status: 'planned', goods: [...terms.goods], dueAt: terms.orderAt, merchantOrderId: null, confirmedAt: null }, lastError: null }
  profile.birthdayPlans ??= []; profile.birthdayPlans.push(plan)
  advanceBirthdayPlans({ ...profile, birthdayPlans: [plan] }, now)
  return publicPlan(plan)
}
/** Caller must run within the same bank transaction as persistence. No new user authorization is inferred. */
export function advanceBirthdayPlans(profile, now = Date.now()) {
  const ownerId = owner(profile); validNow(now)
  const changed = []
  for (const plan of profile.birthdayPlans ?? []) {
    if (plan.ownerId !== ownerId) fail('生日计划客户归属异常', 'INVALID_PLAN_OWNER', 409)
    if (['cancelled', 'expired', 'released'].includes(plan.status)) continue
    const before = JSON.stringify(plan)
    if (now >= Date.parse(plan.expiresAt)) { release(profile, plan, now); plan.status = 'expired'; plan.order.status = 'expired' }
    else {
      if (now >= Date.parse(plan.reserveAt)) reserve(profile, plan, now)
      if (now >= Date.parse(plan.orderAt) && plan.order.status === 'planned') plan.order.status = 'awaiting_confirmation'
      if (plan.order.status === 'awaiting_confirmation' && plan.reservation.status === 'held') plan.status = 'awaiting_order'
    }
    if (JSON.stringify(plan) !== before) { plan.updatedAt = new Date(now).toISOString(); changed.push(publicPlan(plan)) }
  }
  return changed
}
export function listBirthdayPlans(profile) { const ownerId = owner(profile); return (profile.birthdayPlans ?? []).filter(plan => plan.ownerId === ownerId).map(publicPlan) }
export function cancelBirthdayPlan(profile, id, input = {}, now = Date.now()) {
  validNow(now); const plan = lookup(profile, id)
  if (input.confirmed !== true) fail('请先确认取消计划并释放预留', 'CONFIRMATION_REQUIRED')
  if (plan.status === 'cancelled') return publicPlan(plan)
  if (['expired', 'released'].includes(plan.status)) fail('计划已结束', 'PLAN_CLOSED', 409)
  release(profile, plan, now); plan.status = 'cancelled'; plan.order.status = 'cancelled'; plan.updatedAt = new Date(now).toISOString()
  return publicPlan(plan)
}
export function confirmBirthdayOrder(profile, id, input = {}, now = Date.now()) {
  validNow(now); const plan = lookup(profile, id)
  if (input.confirmed !== true) fail('请先确认订购待办', 'CONFIRMATION_REQUIRED')
  if (['cancelled', 'expired', 'released'].includes(plan.status) || now >= Date.parse(plan.expiresAt)) fail('计划已结束，不能确认订购', 'PLAN_CLOSED', 409)
  if (now < Date.parse(plan.orderAt)) fail('尚未到订购待办时间', 'ORDER_NOT_DUE', 409)
  if (plan.reservation.status !== 'held') fail('生日资金尚未预留成功，请先补足可用余额', 'RESERVATION_REQUIRED', 409)
  plan.order.status = 'awaiting_merchant_connection'; plan.order.confirmedAt ??= new Date(now).toISOString(); plan.status = 'awaiting_merchant'; plan.updatedAt = new Date(now).toISOString()
  return publicPlan(plan)
}
