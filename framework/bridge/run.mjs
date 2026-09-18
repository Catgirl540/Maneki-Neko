/**
 * luckycat 后端桥的最小雏形（P1 种子）。
 *
 * 作用：以子进程 + stdio JSON-RPC 驱动 luckycat profile（官方姿势），
 * 发一句提示、打印模型回答。DSH_HOME 由本脚本强制指向仓库内的 .dsh-home，
 * 绝不使用用户的 ~/.dsh。
 *
 * 用法：
 *   node bridge/run.mjs "你的问题"
 *   LUCKYCAT_PROVIDER=local LUCKYCAT_MODEL=qwen3.8-9b-q4 node bridge/run.mjs "..."
 *
 * 环境变量：
 *   OPENROUTER_API_KEY / LOCAL_API_KEY —— 由 profile 的 apiKeyEnv 引用，脚本不打印它们
 *   LUCKYCAT_PROVIDER  默认 openrouter
 *   LUCKYCAT_MODEL     默认 inclusionai/ling-3.0-flash-vl:free（2026-09-17 实测 3.2s 可用）
 */

import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 硬闸：DSH_HOME 只能是仓库内的 .dsh-home。
const home = join(ROOT, '.dsh-home')
if (!home.startsWith(ROOT)) throw new Error(`refusing DSH_HOME outside the repo: ${home}`)
process.env.DSH_HOME = home

const prompt = process.argv.slice(2).join(' ') || '用一句话自我介绍。'
const provider = process.env.LUCKYCAT_PROVIDER ?? 'openrouter'
const model = process.env.LUCKYCAT_MODEL ?? 'inclusionai/ling-3.0-flash-vl:free'
// 可选的额外 overlay（冒号或逗号分隔），用于挂自检插件。
const patches = (process.env.LUCKYCAT_PATCHES ?? '')
  .split(/[:,]/)
  .map(entry => entry.trim())
  .filter(entry => entry !== '')

console.log(`[bridge] provider=${provider} model=${model}`)
console.log(`[bridge] DSH_HOME=${home}`)
if (patches.length > 0) console.log(`[bridge] patches=${patches.join(',')}`)

const harness = new DeepSeekHarness({
  dshBin: join(ROOT, 'node_modules', '.bin', 'dsh'),
  profile: 'luckycat',
  provider,
  model,
  initializeTimeoutMs: 30_000,
  ...patches.length === 0 ? {} : { patches },
})

try {
  const started = Date.now()
  const result = await harness.run(prompt)
  console.log(`[bridge] 用时 ${((Date.now() - started) / 1000).toFixed(1)}s  session=${result.sessionId}`)

  if (result.finalResponse.trim() === '') {
    // 空回复最常见的成因是上游失败：DSH 把失败尝试记成 assistant/attempt
    // （有 finish.reason.kind === 'error'），而不是 assistant/message。
    // 这里把原因捞出来，避免"静默输出空字符串"。
    const failure = lastAttemptFailure(result.events)
    console.error('[bridge] 模型没有产出可见文本。')
    console.error(failure === undefined ? '[bridge] 日志里也没有失败原因（异常）' : `[bridge] 失败原因: ${failure}`)
    process.exitCode = 2
  } else {
    console.log('--- assistant ---')
    console.log(result.finalResponse)
  }
  console.log(`--- events: ${result.events.length} ---`)
} finally {
  await harness.close()
}

/** 从会话事件里取出最后一次 assistant/attempt 的错误原因。 */
function lastAttemptFailure(events) {
  let found
  for (const event of events) {
    if (event?.type !== 'assistant/attempt') continue
    for (const entry of event.data?.stream ?? []) {
      const reason = entry?.chunk?.reason
      if (entry?.chunk?.type === 'finish' && reason?.kind === 'error') {
        found = reason.failure?.message ?? JSON.stringify(reason)
      }
    }
  }
  return found
}