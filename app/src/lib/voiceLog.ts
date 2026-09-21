/**
 * 朗读链路的诊断日志。
 *
 * 为什么值得专门开一个模块：这条链上的故障**几乎都发生在几毫秒的窗口里**
 * （`play()` 还没 resolve 就被取消、音频加载失败立刻 `ended`、
 * 自动播报连续触发把上一条掐掉）。事后从界面上只能看到"播放器闪了一下"，
 * 分不清是哪一种。而 `stopSpeaking` 有**四个**调用方（停止按钮、下一条自动播报、
 * 按下麦克风、组件卸载），不打出来源就只能靠猜——这一轮已经猜错过一次了。
 *
 * 口径：
 *   · 一律 `console.log`，前缀 `[voice]`，方便在控制台里 `filter` 出这一段。
 *   · **默认常开**。演示环境里出问题时，用户按 F12 复制一段就能定位；
 *     关掉它省下的那点性能，远不如"出问题时要能看见"重要。
 *   · 只打**结构**（哪一步、谁调的、错误名），不打正文内容——
 *     朗读的文本是银行对话，不该整段进控制台。所以文本只打长度和前 12 个字。
 *
 * @module app/lib/voiceLog
 */

/** 日志前缀；在控制台里按它过滤。 */
export const VOICE_LOG_PREFIX = '[voice]'

/** 时间戳：`+123ms` 这种相对量比绝对时间好读，故障都是一连串的。 */
const started = (typeof performance === 'undefined' ? Date : performance).now()

/** 最近多少条留在内存里（给"一条命令复制走"用）。 */
const KEEP = 400

/**
 * 内存里留一份最近日志。
 *
 * 为什么不让用户去控制台里翻：控制台会被别的输出（React 警告、网络错误）冲散，
 * 手工框选还容易漏行。留一份环形的、只有朗读链路的，用户在控制台里敲一句
 *
 *     copy(window.__voiceLogs.join('\n'))
 *
 * 就整段进了剪贴板（`copy` 是 Chrome/Edge 控制台自带的）。
 * 挂在 `window` 上是**故意的**：这是排查用的一次性入口，不是应用 API。
 */
function remember(line: string): void {
  if (typeof window === 'undefined') return
  const holder = window as unknown as { __voiceLogs?: string[] }
  holder.__voiceLogs ??= []
  holder.__voiceLogs.push(line)
  if (holder.__voiceLogs.length > KEEP) holder.__voiceLogs.splice(0, holder.__voiceLogs.length - KEEP)
}

/** 打一条朗读链路日志。 */
export function voiceLog(...args: unknown[]): void {
  const at = Math.round((typeof performance === 'undefined' ? Date : performance).now() - started)
  const line = `${VOICE_LOG_PREFIX} +${at}ms ${args.map(render).join(' ')}`
  remember(line)
  console.log(line)
}

/** 把参数渲染成一行文本（对象走 JSON，避免控制台里被折叠成 `{…}` 看不见内容）。 */
function render(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * 取调用栈里第一个"不在 useVoice / voiceLog 内部"的帧。
 *
 * 用来回答**"是谁取消了这次播放"**。`Error.stack` 的格式各家浏览器不同，
 * 这里只做保守的字符串匹配：拿不到就返回 `'?'`，绝不因为解析失败而抛错。
 * @param skip - 跳过几个内部帧。
 * @returns 形如 `SupportPage.tsx:108` 的短标识。
 */
export function callerFrame(skip = 2): string {
  const stack = new Error().stack
  if (typeof stack !== 'string') return '?'
  const lines = stack.split('\n').slice(1)
  const interesting = lines.filter(line =>
    !line.includes('voiceLog') && !line.includes('/voiceLog'))
  const line = interesting[skip] ?? interesting[0]
  if (line === undefined) return '?'
  // 常见两种格式：`at fn (url:line:col)` 与 `at url:line:col`
  const matched = line.match(/([^/\\()\s]+):(\d+):(\d+)/)
  return matched === null ? line.trim().slice(0, 60) : `${matched[1]}:${matched[2]}`
}

/** 文本摘要：只留长度和前 12 个字，正文不进控制台。 */
export function preview(text: string): string {
  const head = text.slice(0, 12).replace(/\s+/g, ' ')
  return `${text.length} 字「${head}${text.length > 12 ? '…' : ''}」`
}
