/** Bounded, deterministic Chinese reminder times. All calendar arithmetic is Beijing time. */
const OFFSET = 8 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000
const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const NUMBER = '[0-9零〇一二两三四五六七八九十百千万亿]+'
const PERIOD = '凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里'
function integer(text) {
  if (/^\d+$/.test(text)) return Number(text)
  if (/^[零〇一二两三四五六七八九]$/.test(text)) return digits[text]
  if (!/^(?:十[一二三四五六七八九]?|[二两三四五六七八九]十[一二三四五六七八九]?|[一二两三四五六七八九]百(?:零[一二三四五六七八九]|[一二两三四五六七八九]十[一二三四五六七八九]?)?)$/.test(text)) return NaN
  let result = 0, current = 0
  for (const c of text) {
    if (c === '百' || c === '十') { result += (current || 1) * (c === '百' ? 100 : 10); current = 0 }
    else current = digits[c]
  }
  return result + current
}
const dateText = ms => new Date(ms + OFFSET).toISOString().slice(0, 10)
function calendar(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) throw Error('提醒日期不合法，请提供有效的年月日。')
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value) throw Error('提醒日期不合法，请提供有效的年月日。')
  return value
}
function hintDate(value) {
  if (value === undefined) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw Error('提醒日期格式无效，请重新提供日期。')
  return calendar(Number(match[1]), Number(match[2]), Number(match[3]))
}
function clockHour(hour, period) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw Error('提醒时刻不合法，请用 00:00 至 23:59。')
  if (!period) return hour
  if (['凌晨', '早上', '早晨', '上午'].includes(period)) {
    if (hour > 11) throw Error('上午时刻不明确，请用 24 小时制时间，例如 09:00 或 12:00。')
    return hour
  }
  if (period === '中午') {
    if (hour === 1) return 13
    if (hour < 11 || hour > 13) throw Error('中午时刻不明确，请用 24 小时制时间。')
    return hour
  }
  if (['晚上', '夜里', '傍晚'].includes(period)) {
    if (hour === 12) throw Error('晚上十二点的日期容易混淆，请明确日期并使用 00:00。')
    if ((hour >= 0 && hour < 6) || (hour >= 13 && hour < 18)) throw Error('夜间时刻与日期不明确，请明确日期并使用 24 小时制时间。')
  }
  if (hour >= 1 && hour <= 11) return hour + 12
  if (hour >= 12) return hour
  throw Error('提醒时刻不明确，请用具体日期和 24 小时制时间。')
}

export function parseReminderTime(text, { now = Date.now(), dateHint } = {}) {
  if (typeof text !== 'string' || text.length > 12000) throw Error('提醒内容无效。')
  now = now instanceof Date ? now.getTime() : now
  if (!Number.isFinite(now)) throw Error('当前时间无效。')
  const today = dateText(now), year = Number(today.slice(0, 4)), midnight = Date.parse(today + 'T00:00:00+08:00')
  const ranges = [], dates = [], times = [], relatives = []
  const overlaps = (start, end) => ranges.some(([a, b]) => start < b && end > a)
  const mark = match => { ranges.push([match.index, match.index + match[0].length]) }
  const remainder = () => {
    let value = text
    for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) value = value.slice(0, start) + value.slice(end)
    return value.replace(/\s+/g, ' ').trim()
  }
  let date = hintDate(dateHint), implicitPeriod
  const fail = (message, details = {}) => { const error = Object.assign(Error(message), details); if (date) error.date = date; error.remainder = remainder(); throw error }
  try {
    if (new RegExp(`(?:[-负]\\s*${NUMBER}|[0-9]+\\.[0-9]+)\\s*(?:个)?(?:分钟|分|小时|钟头)(?:以)?后`).test(text)) fail('提醒间隔须为正整数分钟或小时；半小时可直接写“半小时后”。')
    const relative = new RegExp(`(${NUMBER}|半)(?:个)?(分钟|分|小时|钟头)(?:以)?后`, 'g')
    for (const match of text.matchAll(relative)) {
      const count = match[1] === '半' ? 0.5 : integer(match[1])
      if ((!Number.isSafeInteger(count) && count !== 0.5) || count <= 0 || (match[1] === '半' && !['小时', '钟头'].includes(match[2]))) fail('提醒间隔须为正数分钟或小时。')
      relatives.push(now + count * (['小时', '钟头'].includes(match[2]) ? 3600000 : 60000)); mark(match)
    }
    for (const match of text.matchAll(/(\d{4})年\s*([0-9一二三四五六七八九十两]+)月\s*([0-9一二三四五六七八九十两]+)[日号]|(\d{4})-(\d{1,2})-(\d{1,2})/g)) {
      dates.push(calendar(Number(match[1] ?? match[4]), integer(match[2] ?? match[5]), integer(match[3] ?? match[6]))); mark(match)
    }
    for (const match of text.matchAll(/([0-9一二三四五六七八九十两]+)月\s*([0-9一二三四五六七八九十两]+)[日号]/g)) if (!overlaps(match.index, match.index + match[0].length)) {
      dates.push(calendar(year, integer(match[1]), integer(match[2]))); mark(match)
    }
    const offsets = { 今天: 0, 今日: 0, 今早: 0, 今晚: 0, 明天: 1, 明日: 1, 明早: 1, 明晚: 1, 后天: 2, 大后天: 3 }
    for (const match of text.matchAll(/大后天|后天|明天|今天|今日|明日|今晚|今早|明早|明晚/g)) {
      dates.push(dateText(midnight + offsets[match[0]] * DAY)); mark(match)
      if (match[0].endsWith('早')) implicitPeriod = '早上'
      if (match[0].endsWith('晚')) implicitPeriod = '晚上'
    }
    for (const match of text.matchAll(/(下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/g)) {
      const weekday = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[match[2]]
      const current = new Date(midnight + OFFSET).getUTCDay() || 7
      let offset = weekday - current
      if (match[1] === '下') offset += 7
      else if (!match[1] && offset < 0) offset += 7
      dates.push(dateText(midnight + offset * DAY)); mark(match)
    }
    if (new Set(dates).size > 1) fail('出现了多个不同日期，请明确只安排哪一天。')
    if (dates.length) date = dates[0]
    if (date && date < today && !relatives.length) fail('该提醒日期已过去，请明确未来的年月日。')

    // Remove calendar tokens without changing offsets: 星期一/日 must not block 上午/时刻 recognition.
    let clockSource = text
    for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) clockSource = clockSource.slice(0, start) + ' '.repeat(end - start) + clockSource.slice(end)
    if (new RegExp(`[-负]\\s*${NUMBER}(?:[点时]|[：:][0-9])`).test(clockSource)) fail('提醒时刻不能是负数，请提供有效的具体时间。')
    const colon = new RegExp(`(?<![0-9])(?:(${PERIOD})\\s*)?([0-9]{1,2})[：:]([0-9]{1,2})(?![0-9])`, 'g')
    for (const match of clockSource.matchAll(colon)) if (!overlaps(match.index, match.index + match[0].length)) {
      mark(match)
      const hour = clockHour(Number(match[2]), match[1] ?? implicitPeriod), minute = Number(match[3])
      if (minute > 59) fail('提醒分钟须在 00 至 59 之间。')
      times.push([hour, minute])
    }
    const point = new RegExp(`(?<![0-9零〇一二两三四五六七八九十百])(?:(${PERIOD})\\s*)?(${NUMBER})\\s*[点时](?:(半|一刻|三刻)|\\s*(${NUMBER})(?:\\s*分|(?=$|[^0-9零〇一二两三四五六七八九十百楼号元朵人个年月天])))?`, 'g')
    for (const match of clockSource.matchAll(point)) if (!overlaps(match.index, match.index + match[0].length)) {
      mark(match)
      const rawHour = integer(match[2]), period = match[1] ?? implicitPeriod
      if (!period && rawHour >= 1 && rawHour <= 12) fail('请说明上午、下午或晚上，或用 24 小时制时间，例如 09:00。', { ambiguousTime: match[0].trim() })
      const hour = clockHour(rawHour, period), minute = match[3] ? { 半: 30, 一刻: 15, 三刻: 45 }[match[3]] : match[4] ? integer(match[4]) : 0
      if (!Number.isInteger(minute) || minute > 59) fail('提醒分钟须在 00 至 59 之间。')
      times.push([hour, minute])
    }
    if (relatives.length > 1 || times.length > 1 || (relatives.length && (times.length || dates.length))) fail('出现了多个时间，请明确只安排哪一个时刻。')
    if (relatives.length) {
      const ms = Math.floor(relatives[0] / 1000) * 1000
      if (!Number.isSafeInteger(ms) || ms > 8.64e15) fail('提醒间隔过大，请提供有效的具体日期。')
      const dueAt = new Date(ms + OFFSET).toISOString().slice(0, 19) + '+08:00'
      return { date: dueAt.slice(0, 10), dueAt, remainder: remainder(), hasDate: true, hasTime: true }
    }
    if (!times.length) return { ...(date ? { date } : {}), remainder: remainder(), hasDate: Boolean(date), hasTime: false }
    date ??= today
    const [hour, minute] = times[0], dueAt = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`
    if (Date.parse(dueAt) <= now) fail('这个时刻已过去，请重新说明未来日期和时间。')
    return { date, dueAt, remainder: remainder(), hasDate: true, hasTime: true }
  } catch (error) {
    if (!error.remainder) error.remainder = remainder()
    if (date && !error.date) error.date = date
    throw error
  }
}
