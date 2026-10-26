import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { parseReminderTime as parse } from './reminder-time.mjs'
const now = Date.parse('2026-10-26T08:00:00+08:00')
test('Beijing date-only request preserves its title and requires a time, including follow-up hints', () => {
  const result = parse('提醒我明天买花给女朋友', { now })
  assert.deepEqual(result, { date: '2026-10-27', remainder: '提醒我买花给女朋友', hasDate: true, hasTime: false })
  assert.equal(parse('上午九点', { now, dateHint: result.date }).dueAt, '2026-10-27T09:00:00+08:00')
  assert.equal(parse('明天下午三点半提醒我买9朵花', { now }).dueAt, '2026-10-27T15:30:00+08:00')
  assert.equal(parse('明天下午三点半提醒我买9朵花', { now }).remainder, '提醒我买9朵花')
  assert.equal(parse('明天上午九点三十五买花', { now }).dueAt, '2026-10-27T09:35:00+08:00')
  assert.equal(parse('明天上午9点30买花', { now }).remainder, '买花')
  assert.equal(parse('明天上午9点买30朵花', { now }).dueAt, '2026-10-27T09:00:00+08:00')
  assert.equal(parse('明天上午9点30朵花', { now }).remainder, '30朵花')
})
test('Chinese clocks, explicit 24-hour times and relative durations have exact seconds', () => {
  for (const [text, clock] of [['明天上午九点一刻','09:15'],['明天晚上九点三刻','21:45'],['明天中午一点','13:00'],['明天上午十点二十分','10:20'],['明天09:05','09:05'],['明天19点','19:00'],['明晚八点','20:00']]) {
    assert.equal(parse(text, { now }).dueAt, `2026-10-27T${clock}:00+08:00`, text)
  }
  assert.equal(parse('十分钟后提醒我喝水', { now }).dueAt, '2026-10-26T08:10:00+08:00')
  assert.equal(parse('半小时后提醒我喝水', { now }).dueAt, '2026-10-26T08:30:00+08:00')
  assert.equal(parse('2小时后提醒我喝水', { now }).dueAt, '2026-10-26T10:00:00+08:00')
  assert.equal(parse('10分钟后', { now, dateHint: '2026-10-27' }).dueAt, '2026-10-26T08:10:00+08:00')
  assert.equal(parse('9朵花和20元预算', { now }).hasTime, false)
})
test('date arithmetic is independent of host timezone and handles weeks and calendar boundaries', () => {
  assert.equal(parse('明天00:30提醒我', { now: Date.parse('2026-12-31T23:00:00+08:00') }).dueAt, '2027-01-01T00:30:00+08:00')
  assert.equal(parse('后天上午九点', { now: Date.parse('2028-02-28T08:00:00+08:00') }).date, '2028-03-01')
  assert.equal(parse('下周一上午九点', { now }).date, '2026-11-02')
  assert.equal(parse('本周五上午九点', { now }).date, '2026-10-30')
  assert.equal(parse('周日上午九点', { now }).date, '2026-11-01')
  assert.equal(parse('2027年一月三十一日上午九点', { now }).dueAt, '2027-01-31T09:00:00+08:00')
  assert.equal(parse('2026-11-01 09:00', { now }).dueAt, '2026-11-01T09:00:00+08:00')
  assert.equal(parse('10月27日09:00', { now }).date, '2026-10-27')
})
test('ambiguous clocks retain determined date and remaining title for a private-chat clarification', () => {
  assert.throws(() => parse('明天9点提醒我买花', { now }), error => error.date === '2026-10-27' && error.remainder === '提醒我买花' && error.ambiguousTime === '9点' && /上午/.test(error.message))
  assert.throws(() => parse('明天晚上十二点提醒我', { now }), /日期容易混淆/)
  assert.throws(() => parse('明天晚上三点提醒我', { now }), /夜间时刻/)
  assert.throws(() => parse('明天晚上15:00提醒我', { now }), /夜间时刻/)
  assert.throws(() => parse('明天下午9点和后天上午8点提醒我', { now }), /多个不同日期/)
  assert.throws(() => parse('明天上午九点或者下午三点提醒我', { now }), /多个时间/)
  assert.throws(() => parse('明天30分钟后提醒我', { now }), /多个时间/)
})
test('invalid calendars and past times are rejected rather than silently shifted', () => {
  for (const text of ['2026年2月29日09:00', '13月1日09:00', '2026-04-31 09:00']) assert.throws(() => parse(text, { now }), /日期不合法/)
  assert.throws(() => parse('明天上午九点六十分', { now }), /分钟/)
  assert.throws(() => parse('明天25:00', { now }), /时刻/)
  assert.throws(() => parse('明天-19点', { now }), /负数/)
  assert.throws(() => parse('-1分钟后提醒我', { now }), /正整数/)
  assert.throws(() => parse('1.5小时后提醒我', { now }), /正整数/)
  assert.throws(() => parse('999999999999999999999小时后提醒我', { now }), /间隔/)
  assert.throws(() => parse('一千分钟后提醒我', { now }), /间隔/)
  assert.throws(() => parse('明天上午十十点提醒我', { now }), /时刻/)
  assert.throws(() => parse('今天07:30', { now }), /已过去/)
  assert.throws(() => parse('上午七点', { now }), /已过去/)
  assert.throws(() => parse('1月1日09:00', { now }), /日期已过去/)
  assert.equal(parse('上午九点', { now }).dueAt, '2026-10-26T09:00:00+08:00')
  assert.equal(parse('明天上午九点', { now: new Date(now) }).date, '2026-10-27')
  assert.throws(() => parse('上午九点', { now, dateHint: '2026-02-29' }), /日期不合法/)
})
test('UTC and New York processes produce the same Beijing schedule', () => {
  const module = new URL('./reminder-time.mjs', import.meta.url).href
  const source = `import { parseReminderTime } from ${JSON.stringify(module)};process.stdout.write(JSON.stringify(parseReminderTime('明天上午九点买花',{now:${now}})))`
  const output = ['UTC', 'America/New_York', 'Asia/Shanghai'].map(TZ => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TZ }, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr); return result.stdout
  })
  assert.equal(output[0], output[1]); assert.equal(output[0], output[2])
})
