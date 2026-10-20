import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeAutoDebits, validateReminderDays } from './autodebit-analysis.mjs'

const now = Date.parse('2026-10-19T17:00:00Z') // Shanghai Oct 20, 01:00
const contract = (id, extra = {}) => ({ id, merchant: '音乐会员', amount: 2500, cycle: '每月 20 日', enabled: true, nextRunAt: '2026-10-20', ...extra })

test('calendar window includes today, excludes its end, separates currencies and does not expand recurrence', () => {
  const sources = [contract('today'), contract('inside', { nextRunAt: '2026-10-26T16:00:00+08:00', currency: 'HKD', amount: 100 }),
    contract('end', { nextRunAt: '2026-10-27' }), contract('past', { nextRunAt: '2026-10-19' }),
    contract('disabled', { enabled: false }), contract('unknown', { nextRunAt: 'not-a-date' })]
  const snapshot = structuredClone(sources)
  const result = analyzeAutoDebits(sources, { days: 7 }, now)
  assert.deepEqual(result.window, { days: 7, startDateInclusive: '2026-10-20', endDateExclusive: '2026-10-27' })
  assert.deepEqual(result.upcomingAmountCentsByCurrency, { CNY: 2500, HKD: 100 })
  assert.deepEqual(result.counts, { upcoming: 2, 'past-date': 1, 'unknown-date': 1, disabled: 1, later: 1 })
  assert.equal(result.reminderCreated, false)
  assert.equal(result.items.find(item => item.id === 'today').daysUntil, 0)
  assert.deepEqual(sources, snapshot)
})

test('UTC timestamps are classified by Shanghai date and malformed dates stay unknown', () => {
  const values = ['2026-02-30', '2026-02-30T09:00:00Z', '2026-13-20', '10/20/2026', '2026-10-20T09:00:00', '', null]
  for (const nextRunAt of values) {
    const result = analyzeAutoDebits([contract('bad', { nextRunAt })], {}, now)
    assert.equal(result.items[0].status, 'unknown-date', String(nextRunAt))
    assert.deepEqual(result.upcomingAmountCentsByCurrency, {})
  }
  const result = analyzeAutoDebits([contract('utc', { nextRunAt: '2026-10-19T16:00:00Z' })], {}, now)
  assert.equal(result.items[0].status, 'upcoming')
  assert.equal(result.items[0].nextRunDate, '2026-10-20')
})

test('same merchant names are only potential overlaps, disabled contracts and different currencies excluded', () => {
  const result = analyzeAutoDebits([contract('a'), contract('b', { merchant: ' 音乐会员 ' }), contract('off', { enabled: false }), contract('usd', { currency: 'USD' })], {}, now)
  assert.deepEqual(result.possibleOverlapContractIds, [['a', 'b']])
  assert.match(result.notice, /同名合约仅提示核对/)
  assert.equal(result.items.length, 4)
})

test('empty lists report actual zero counts without inventing amounts or contracts', () => {
  const result = analyzeAutoDebits([], {}, now)
  assert.deepEqual(result.items, [])
  assert.deepEqual(result.upcomingAmountCentsByCurrency, {})
  assert(Object.values(result.counts).every(value => value === 0))
})

test('invalid windows, financial fields and duplicate IDs fail instead of reporting fabricated zero', () => {
  for (const days of [0, 1, 7.5, '7', 365, null]) assert.throws(() => validateReminderDays(days), /自然日/)
  for (const extra of [{ amount: NaN }, { amount: -1 }, { amount: 0.1 }, { currency: 'EUR' }, { currency: null }, { enabled: 'false' }, { id: '' }, { merchant: '' }]) {
    assert.throws(() => analyzeAutoDebits([contract('bad', extra)], {}, now), /数据|币种/)
  }
  assert.throws(() => analyzeAutoDebits([contract('same'), contract('same')], {}, now), /不唯一/)
  assert.throws(() => analyzeAutoDebits(null, {}, now), /不完整/)
  for (const timestamp of [NaN, Infinity, 1e16]) assert.throws(() => analyzeAutoDebits([], {}, timestamp), /查询时间/)
  assert.throws(() => analyzeAutoDebits([contract('a', { amount: Number.MAX_SAFE_INTEGER }), contract('b')], {}, now), /超出/)
})
