/**
 * HTTP 长轮询通道：把挑战 POST 给部署方提供的确认服务，等它把用户的答复作为响应体返回。
 *
 * 为什么是长轮询而不是别的：
 *   - 浏览器那一侧本来就只能靠后端推；后端用一个**普通 HTTP 请求**挂住，
 *     等用户在网页上点完再返回，前端不需要 WebSocket，演示服务也不需要。
 *   - agent 进程**不碰**支付密码：密码只到确认服务，回到 agent 的只有一张
 *     「已验证」的票据（见 types.ts 的 ConsentAnswer.verification）。
 *
 * 安全上的取舍（写清楚，不假装更强）：本机回环地址用 http，其它地址强制 https。
 * 通道本身被当作**可信组件**——它拿到的答复就是用户的真实意思表示，
 * 所以这里不做答复签名。nonce（challengeId）只用来防"旧答复被重放给新操作"。
 *
 * @module @luckycat/dsh-consent/channel
 */

import { ConsentError } from './errors.ts'
import type { ConsentAnswer, ConsentChallenge, ConsentChannel, VerificationMethod } from './types.ts'

/** 响应体最大读取字节数；防止通道返回一个巨大的东西把我们撑爆。 */
export const MAX_RESPONSE_BYTES = 64 * 1024

/** 判定一个地址是否允许作为通道地址：本机回环可用 http，其余必须 https。 */
export function assertAllowedEndpoint(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (error) {
    throw new ConsentError('MISCONFIGURED', `确认通道地址不是合法 URL：${url}`, { cause: error })
  }
  if (parsed.protocol === 'https:') return parsed
  if (parsed.protocol !== 'http:') {
    throw new ConsentError('ENDPOINT_NOT_ALLOWED', `确认通道只支持 https（本机回环可用 http），收到 ${parsed.protocol}`)
  }
  const host = parsed.hostname
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  if (!loopback) {
    throw new ConsentError('ENDPOINT_NOT_ALLOWED', `明文 http 只允许本机回环地址，收到 ${host}`)
  }
  return parsed
}

/** 从任意 JSON 里读出答复；形状不对就抛 CHANNEL_MALFORMED_RESPONSE。 */
export function parseAnswer(raw: unknown): ConsentAnswer {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConsentError('CHANNEL_MALFORMED_RESPONSE', '确认通道返回的不是一个 JSON 对象')
  }
  const record = raw as Record<string, unknown>
  const decision = record['decision']
  if (decision !== 'approve' && decision !== 'reject') {
    throw new ConsentError('CHANNEL_MALFORMED_RESPONSE', `确认通道返回的 decision 非法：${JSON.stringify(decision)}`)
  }
  const challengeId = record['challengeId']
  if (typeof challengeId !== 'string' || challengeId === '') {
    throw new ConsentError('CHANNEL_MALFORMED_RESPONSE', '确认通道返回的 challengeId 缺失或不是非空字符串')
  }
  const verification = record['verification']
  let parsedVerification: ConsentAnswer['verification']
  if (verification !== undefined) {
    if (verification === null || typeof verification !== 'object' || Array.isArray(verification)) {
      throw new ConsentError('CHANNEL_MALFORMED_RESPONSE', '确认通道返回的 verification 不是对象')
    }
    const entry = verification as Record<string, unknown>
    const method = entry['method']
    if (method !== 'payment-password' && method !== 'sms' && method !== 'face') {
      throw new ConsentError('CHANNEL_MALFORMED_RESPONSE', `确认通道返回的 verification.method 非法：${JSON.stringify(method)}`)
    }
    const ticket = entry['ticket']
    parsedVerification = {
      method: method as VerificationMethod,
      verified: entry['verified'] === true,
      ...typeof ticket === 'string' && ticket !== '' ? { ticket } : {},
    }
  }
  return {
    decision,
    challengeId,
    ...parsedVerification === undefined ? {} : { verification: parsedVerification },
  }
}

/** 读响应体并解析；非 JSON（例如网关的 HTML 错误页）会被明确指出。 */
async function readAnswer(response: Response): Promise<ConsentAnswer> {
  const text = await response.text()
  const excerpt = text.slice(0, 200).replace(/\s+/g, ' ')
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ConsentError('CHANNEL_MALFORMED_RESPONSE', `确认通道返回体超过 ${MAX_RESPONSE_BYTES} 字节`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ConsentError(
      'CHANNEL_MALFORMED_RESPONSE',
      `确认通道返回的不是合法 JSON（content-type=${response.headers.get('content-type') ?? '未声明'}，开头：${excerpt}）`,
      { cause: error },
    )
  }
  return parseAnswer(parsed)
}

/** 把 AbortSignal 与超时合成一个信号。 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new ConsentError('CHANNEL_TIMEOUT', `等待用户确认超时（${timeoutMs} 毫秒）`))
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

/**
 * 造一个 HTTP 长轮询通道。
 * @param options - 通道地址与超时。
 * @returns 可交给闸门使用的通道。
 */
export function createHttpPollChannel(options: { url: string; timeoutMs: number }): ConsentChannel {
  const endpoint = assertAllowedEndpoint(options.url)
  return {
    async ask(challenge: ConsentChallenge, signal?: AbortSignal): Promise<ConsentAnswer> {
      const fused = withTimeout(signal, options.timeoutMs)
      try {
        let response: Response
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(process.env.LUCKYCAT_INTERNAL_TOKEN ? { 'x-luckycat-internal': process.env.LUCKYCAT_INTERNAL_TOKEN } : {}) },
            body: JSON.stringify(challenge),
            signal: fused.signal,
            // 凭据不进确认服务：它只需要挑战本身。
            redirect: 'error',
          })
        } catch (error) {
          // 主动中止（会话取消或超时）要原样抛出，别伪装成"连不上"。
          if (fused.signal.aborted) throw fused.signal.reason ?? error
          throw new ConsentError('CHANNEL_UNREACHABLE', `连不上确认通道 ${endpoint.origin}`, { cause: error })
        }
        if (!response.ok) {
          throw new ConsentError('CHANNEL_HTTP_STATUS', `确认通道返回 ${response.status} ${response.statusText}`)
        }
        return await readAnswer(response)
      } finally {
        fused.dispose()
      }
    },
  }
}
