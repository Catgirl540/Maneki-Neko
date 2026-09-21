/**
 * HTTP 长轮询通道：把问题 POST 给部署方提供的服务，等它把用户的答复作为响应体返回。
 *
 * 与确认通道（`@luckycat/dsh-consent/channel`）**同一个形状**，但有两处刻意不同：
 *
 *   1. **没有验证票据**。提问不是敏感操作，用户点一下选项不需要验身份。
 *      真要验身份的是随后的那个操作，走的是确认闸门那一条路。
 *   2. **答复内容更自由**。确认只有"同意/拒绝"，而这里的答复是一组
 *      `{ id, selected[], custom? }`——`custom` 是用户自己打的字，
 *      所以这个响应体是**不可信输入**，必须逐字段校验（见 `parseAnswer`）。
 *
 * 安全取舍（写清楚，不假装更强）：本机回环用 http，其它地址强制 https。
 * 通道被当作**可信组件**——它拿到的答复就是用户的真实意思表示。
 *
 * @module @luckycat/dsh-ask/channel
 */

import { AskError } from './errors.ts'
import type { QuestionAnswer, QuestionAnswerItem, QuestionChannel, QuestionItem } from './types.ts'

/** 响应体最大读取字节数。用户自己打的字可能很长，但仍然要有上限。 */
export const MAX_RESPONSE_BYTES = 64 * 1024

/** 一道题最多允许多少个选项（防止模型塞进来一百个选项把界面撑爆）。 */
export const MAX_OPTIONS_PER_QUESTION = 20

/** 一次最多问多少道题。 */
export const MAX_QUESTIONS = 10

/** 自由输入的答案最长多少字符。 */
export const MAX_CUSTOM_CHARS = 2000

/** 判定一个地址是否允许作为通道地址：本机回环可用 http，其余必须 https。 */
export function assertAllowedEndpoint(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (error) {
    throw new AskError('MISCONFIGURED', `提问通道地址不是合法 URL：${url}`, { cause: error })
  }
  if (parsed.protocol === 'https:') return parsed
  if (parsed.protocol !== 'http:') {
    throw new AskError('ENDPOINT_NOT_ALLOWED', `提问通道只支持 https（本机回环可用 http），收到 ${parsed.protocol}`)
  }
  const host = parsed.hostname
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  if (!loopback) {
    throw new AskError('ENDPOINT_NOT_ALLOWED', `明文 http 只允许本机回环地址，收到 ${host}`)
  }
  return parsed
}

/** 把一道题收成安全形状；不合法的直接抛。 */
function parseQuestion(raw: unknown, index: number): QuestionItem {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', `第 ${index} 道题不是对象`)
  }
  const record = raw as Record<string, unknown>
  const id = record['id']
  const question = record['question']
  if (typeof id !== 'string' || id === '') {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', `第 ${index} 道题的 id 缺失或不是非空字符串`)
  }
  if (typeof question !== 'string' || question.trim() === '') {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', `题目 ${id} 的 question 缺失或为空`)
  }
  const optionsRaw = record['options']
  let options: QuestionItem['options']
  if (optionsRaw !== undefined) {
    if (!Array.isArray(optionsRaw)) {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', `题目 ${id} 的 options 不是数组`)
    }
    if (optionsRaw.length > MAX_OPTIONS_PER_QUESTION) {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', `题目 ${id} 的选项超过 ${MAX_OPTIONS_PER_QUESTION} 个`)
    }
    options = optionsRaw.map((option, optionIndex) => {
      if (option === null || typeof option !== 'object' || Array.isArray(option)) {
        throw new AskError('CHANNEL_MALFORMED_RESPONSE', `题目 ${id} 的第 ${optionIndex} 个选项不是对象`)
      }
      const entry = option as Record<string, unknown>
      const label = entry['label']
      if (typeof label !== 'string' || label === '') {
        throw new AskError('CHANNEL_MALFORMED_RESPONSE', `题目 ${id} 的第 ${optionIndex} 个选项没有 label`)
      }
      const description = entry['description']
      return {
        label,
        ...typeof description === 'string' && description !== '' ? { description } : {},
      }
    })
  }
  const header = record['header']
  const multiSelect = record['multiSelect']
  return {
    id,
    question,
    ...typeof header === 'string' && header !== '' ? { header } : {},
    ...options === undefined ? {} : { options },
    ...typeof multiSelect === 'boolean' ? { multiSelect } : {},
  }
}

/**
 * 校验并收窄一次问询的题目。
 *
 * **为什么这道校验必须在插件侧**：题目最终会在网页上变成卡片，
 * 而卡片是用户会当真的东西。畸形或超量的题目进来，最小的后果是界面被撑爆，
 * 最大的后果是渲染出一个骗人的表单。所以宁可这次问询失败。
 * @param raw - 来自模型的参数。
 * @returns 收窄后的题目。
 */
export function parseQuestions(raw: unknown): QuestionItem[] {
  if (!Array.isArray(raw)) {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', 'questions 不是数组')
  }
  if (raw.length === 0) {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', '一次至少要问一道题')
  }
  if (raw.length > MAX_QUESTIONS) {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', `一次最多问 ${MAX_QUESTIONS} 道题，收到 ${raw.length}`)
  }
  const questions = raw.map((item, index) => parseQuestion(item, index))
  const ids = new Set<string>()
  for (const question of questions) {
    if (ids.has(question.id)) {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', `问题 id 重复：${question.id}（答复无法对应到题目）`)
    }
    ids.add(question.id)
  }
  return questions
}

/**
 * 校验通道返回的答复。
 *
 * 这条路径上的答复是**不可信输入**（用户能自己打字），所以：
 *   · 题目 id 必须是我们问过的（防止答复里塞进一道没问过的题，
 *     那样模型会以为用户答了它没问的事）；
 *   · 单选题的 selected 不能超过一个；
 *   · selected 里的标签必须是该题给过的选项（防止前端被改之后塞进任意字符串）。
 * @param raw - 通道返回的 JSON。
 * @param asked - 我们问过的题目。
 * @returns 校验后的答复。
 */
export function parseAnswer(raw: unknown, asked: readonly QuestionItem[]): QuestionAnswer {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', '通道返回的不是一个 JSON 对象')
  }
  const answersRaw = (raw as Record<string, unknown>)['answers']
  if (!Array.isArray(answersRaw)) {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', '通道返回的 answers 不是数组')
  }
  const byId = new Map(asked.map(question => [question.id, question]))
  const answers: QuestionAnswerItem[] = []
  const seen = new Set<string>()
  for (const entry of answersRaw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', 'answers 里有一项不是对象')
    }
    const record = entry as Record<string, unknown>
    const id = record['id']
    if (typeof id !== 'string' || id === '') {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', 'answers 里有一项缺少 id')
    }
    const question = byId.get(id)
    if (question === undefined) {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', `答复里出现了没问过的问题 id：${id}`)
    }
    if (seen.has(id)) {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', `同一个问题被答了两次：${id}`)
    }
    seen.add(id)
    const selectedRaw = record['selected']
    if (!Array.isArray(selectedRaw) || selectedRaw.some(item => typeof item !== 'string')) {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', `问题 ${id} 的 selected 不是字符串数组`)
    }
    const selected = selectedRaw as string[]
    if ((question.multiSelect ?? false) === false && selected.length > 1) {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', `问题 ${id} 是单选，却收到了 ${selected.length} 个选项`)
    }
    const allowed = new Set((question.options ?? []).map(option => option.label))
    for (const label of selected) {
      if (!allowed.has(label)) {
        throw new AskError('CHANNEL_MALFORMED_RESPONSE', `问题 ${id} 的答复里出现了没给过的选项：${JSON.stringify(label)}`)
      }
    }
    const customRaw = record['custom']
    let custom: string | undefined
    if (customRaw !== undefined) {
      if (typeof customRaw !== 'string') {
        throw new AskError('CHANNEL_MALFORMED_RESPONSE', `问题 ${id} 的 custom 不是字符串`)
      }
      if (customRaw.length > MAX_CUSTOM_CHARS) {
        throw new AskError('CHANNEL_MALFORMED_RESPONSE', `问题 ${id} 的自由输入超过 ${MAX_CUSTOM_CHARS} 字`)
      }
      custom = customRaw
    }
    // 一道题必须有实质答复：选了选项，或者自己写了字。
    if (selected.length === 0 && (custom === undefined || custom.trim() === '')) {
      throw new AskError('CHANNEL_MALFORMED_RESPONSE', `问题 ${id} 什么都没答（既没选也没填）`)
    }
    answers.push({
      id,
      selected,
      ...custom === undefined ? {} : { custom },
    })
  }
  // 每一道问过的题都必须有答复：漏答一道，模型就会以为用户对那道题做了默认选择。
  const missing = asked.filter(question => !seen.has(question.id)).map(question => question.id)
  if (missing.length > 0) {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', `有题目没被答复：${missing.join(', ')}`)
  }
  return { answers }
}

/** 把 AbortSignal 与超时合成一个信号。 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new AskError('CHANNEL_TIMEOUT', `等用户答复超时（${timeoutMs} 毫秒）`))
  }, timeoutMs)
  const onAbort = (): void => { controller.abort(signal?.reason) }
  if (signal !== undefined) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/** 读响应体并解析；非 JSON（例如网关的 HTML 错误页）会被明确指出。 */
async function readAnswer(response: Response, asked: readonly QuestionItem[]): Promise<QuestionAnswer> {
  const text = await response.text()
  const excerpt = text.slice(0, 200).replace(/\s+/g, ' ')
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new AskError('CHANNEL_MALFORMED_RESPONSE', `提问通道返回体超过 ${MAX_RESPONSE_BYTES} 字节`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new AskError(
      'CHANNEL_MALFORMED_RESPONSE',
      `提问通道返回的不是合法 JSON（content-type=${response.headers.get('content-type') ?? '未声明'}，开头：${excerpt}）`,
      { cause: error },
    )
  }
  return parseAnswer(parsed, asked)
}

/**
 * 造一个 HTTP 长轮询通道。
 * @param options - 通道地址与超时。
 * @returns 可交给答复者使用的通道。
 */
export function createHttpPollChannel(options: { url: string; timeoutMs: number }): QuestionChannel {
  const endpoint = assertAllowedEndpoint(options.url)
  return {
    async ask(questions: QuestionItem[], sessionId: string, signal?: AbortSignal): Promise<QuestionAnswer> {
      const fused = withTimeout(signal, options.timeoutMs)
      try {
        let response: Response
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, questions }),
            signal: fused.signal,
            // 凭据不进通道：它只需要题目。
            redirect: 'error',
          })
        } catch (error) {
          // 主动中止（会话取消或超时）要原样抛出，别伪装成"连不上"。
          if (fused.signal.aborted) throw fused.signal.reason ?? error
          throw new AskError('CHANNEL_UNREACHABLE', `连不上提问通道 ${endpoint.origin}`, { cause: error })
        }
        if (!response.ok) {
          throw new AskError('CHANNEL_HTTP_STATUS', `提问通道返回 ${response.status} ${response.statusText}`)
        }
        return await readAnswer(response, questions)
      } finally {
        fused.dispose()
      }
    },
  }
}
