/**
 * 招财猫 agent 演示服务：浏览器 ↔ agent 运行时之间的那一段。
 *
 * 它做四件事：
 *   1. **驱动 agent 运行时**（子进程 + stdio JSON-RPC，官方姿势）；
 *   2. 把会话事件流整理成 SSE，推给网页；
 *   3. **充当敏感操作的确认通道**：agent 插件把待确认事项 POST 到这里并挂住，
 *      等服务把用户在网页上的答复返回；
 *   4. **代为访问语音服务**（`/agent-api/asr`、`/agent-api/tts`）——密钥只在服务端，
 *      浏览器永远拿不到它。
 *
 * 为什么支付密码只到这里、不到 agent：agent 进程里跑的是模型与工具，
 * 它只需要知道"这个人验证通过了"，不需要也不应该拿到密码。
 * 所以浏览器把密码交给本服务校验，agent 侧只收到一张"已验证"的答复。
 *
 * 默认通过 bank-agent.mjs 绑定登录客户并访问独立 PostgreSQL HTTP 银行。
 * 旧演示工具仅由 LUCKYCAT_BANK_MODE=demo 显式启用。
 * 网页请求与 SSE 使用银行 Bearer，内部插件通道使用进程间随机口令。
 *
 * 用法：
 *   node bridge/demo-server.mjs
 *   LUCKYCAT_DEMO_PORT=8788 LUCKYCAT_PROVIDER=openrouter node bridge/demo-server.mjs
 *
 * 环境变量：
 *   LUCKYCAT_DEMO_PORT  监听端口，默认 8788
 *   LUCKYCAT_PROVIDER   模型路由，默认 openrouter
 *   LUCKYCAT_MODEL      模型名，默认 deepseek/deepseek-v4.1-flash-1017
 *   LUCKYCAT_FALLBACK_MODELS OpenRouter 备用模型，逗号分隔，按顺序尝试
 *   LUCKYCAT_BANK_URL  银行 HTTP 地址，默认 http://127.0.0.1:8080
 *   LUCKYCAT_BANK_MODE demo 才启用独立占位工具；默认 http
 *   LUCKYCAT_SESSION_DATABASE_URL AI 会话专用 PostgreSQL 角色连接
 *   LUCKYCAT_SESSION_DATA_KEY AI 会话独立持久密钥（Base64 编码的 32 字节）
 *   LUCKYCAT_IM_ENABLED=1 启用微信、企微客户私聊（默认关闭）
 *   LUCKYCAT_IM_PUBLIC_URL 银行 HTTPS 公网地址，用于绑定和确认链接
 *   LUCKYCAT_IM_DATA_KEY 可选独立 IM 密钥；默认从 AI 会话密钥派生
 *   LUCKYCAT_PG_MODULE_PATH 可选，已安装 pg 包的绝对路径
 *   LUCKYCAT_DEMO_PASSWORD 仅旧 demo 模式支付密码，默认 123456
 *   LUCKYCAT_DEMO_TOKEN    可选的访问口令；设了以后所有请求都要带
 *                          `x-luckycat-token` 头（演示服务默认只监听本机）
 *   LUCKYCAT_PATCHES       可选的额外 profile overlay（冒号或逗号分隔绝对路径），
 *                          用于端到端自检时改超时一类的参数
 *   LUCKYCAT_TTS_MODEL   TTS 模型，默认 qwen/qwen-audio-3.0-tts-plus
 *   LUCKYCAT_TTS_VOICE   TTS 音色，默认 longanlingxin（中文女声）
 *   LUCKYCAT_VOLC_API_KEY  豆包语音单 Key（新版，走 X-Api-Key）；设置后优先使用
 *   LUCKYCAT_VOLC_APP_ID / LUCKYCAT_VOLC_ACCESS_TOKEN  旧版火山凭据
 *                     （不设时退回 VOLC_APP_ID / VOLC_ACCESS_TOKEN；缺了就 502）
 *   LUCKYCAT_VOLC_RESOURCE 流式 TTS 资源，默认 seed-tts-2.0
 *   LUCKYCAT_VOLC_SPEAKER  流式 TTS 音色，默认 zh_female_xiaohe_uranus_bigtts
 *   LUCKYCAT_VOLC_SAMPLE_RATE 流式 TTS 采样率，默认 24000
 *   LUCKYCAT_ASR_MODEL   ASR 模型，默认 qwen/qwen3-asr-0.6b
 *   LUCKYCAT_DISABLE_VOICE=1 关掉语音接口（用来验证"没有语音能力时页面怎么退让"）
 */

import { createServer } from 'node:http'
import { projectModelRetry, modelFailureMessage } from './model-retry.mjs'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID, randomBytes } from 'node:crypto'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { projectToolResult } from './tool-result.mjs'
import { streamVolcTTS } from './volc-stream.mjs'
import { createDemoBank } from './demo-bank.mjs'
import { createBankAgent, bankError } from './bank-agent.mjs'
import { createStaffAgent } from './staff-agent.mjs'
import { STAFF_PROMPT } from './staff-prompt.mjs'
import { OPS_PROMPT } from './ops-prompt.mjs'
import { createOpsGate } from './ops-gate.mjs'
import { createClefReviewer } from './clef-reviewer.mjs'
import { OPS_NATIVE_TOOLS } from '../packages/ops-native/src/names.mjs'
import { createEventPolling } from './event-polling.mjs'
import { createAssistantStream } from './assistant-stream.mjs'
import { openSessionStore, legacyContext } from './session-store.mjs'
import { openImStore, migrateImBindingRevisions } from './im-store.mjs'
import { createImBank } from './im-bank.mjs'
import { createImChannels } from './im-channels.mjs'
import { createImHttp } from './im-http.mjs'
import { createBankReminders } from './bank-reminders.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STAFF_MODE = process.env.LUCKYCAT_AUDIENCE === 'staff'
const OPS_MODE = STAFF_MODE && process.env.LUCKYCAT_STAFF_MODE === 'ops'
const PROFILE = OPS_MODE ? 'staff-ops' : STAFF_MODE ? 'staff' : 'luckycat'
const serviceSkillContext = STAFF_MODE ? undefined : (await import('./service-skills.mjs')).serviceSkillContext
const OPS_WORKSPACE = resolve(process.env.LUCKYCAT_OPS_WORKSPACE ?? join(ROOT, '..'))

// 硬闸：DSH_HOME 只能是仓库内的 .dsh-home（与 bridge/run.mjs 同一口径）。
const home = join(ROOT, '.dsh-home')
if (!home.startsWith(ROOT)) throw new Error(`refusing DSH_HOME outside the repo: ${home}`)
process.env.DSH_HOME = home
// 独立于进程生命周期；测试可指向临时目录，生产目录须跨发布保留。
const SESSION_DIR = resolve(process.env.LUCKYCAT_SESSION_DIR ?? (OPS_MODE ? join(home, 'ops-context') : STAFF_MODE ? join(home, 'staff-context') : home))

const PORT = Number(process.env.LUCKYCAT_DEMO_PORT ?? (STAFF_MODE ? 8789 : 8788))
const PROVIDER = process.env.LUCKYCAT_PROVIDER ?? 'openrouter'
const MODEL = process.env.LUCKYCAT_MODEL ?? 'deepseek/deepseek-v4.1-flash-1017'
const DEMO_PASSWORD = process.env.LUCKYCAT_DEMO_PASSWORD ?? '123456'
const ACCESS_TOKEN = process.env.LUCKYCAT_DEMO_TOKEN ?? ''
// 默认连接独立 PostgreSQL 银行；旧演示工具只能显式启用。
const HTTP_BANK = process.env.LUCKYCAT_BANK_MODE !== 'demo'
if (STAFF_MODE && !HTTP_BANK) throw Error('员工助手必须连接真实员工 HTTP 接口')
if (HTTP_BANK) {
  const { checkPolicy } = await import(STAFF_MODE ? '../scripts/check-staff-tool-policy.mjs' : '../scripts/check-bank-tool-policy.mjs')
  checkPolicy(join(home, `profiles/${PROFILE}/cordis.patch.yml`))
}
process.env.LUCKYCAT_BANK_MODE = HTTP_BANK ? 'http' : 'demo'
const INTERNAL_TOKEN = randomBytes(32).toString('base64url')
process.env.LUCKYCAT_INTERNAL_TOKEN = INTERNAL_TOKEN
const controlDir = await mkdtemp(join(tmpdir(), 'luckycat-control-'))
process.env.LUCKYCAT_BANK_TOOL_URL = `http://127.0.0.1:${PORT}/internal/bank-tool`
process.env.LUCKYCAT_CONSENT_URL = `http://127.0.0.1:${PORT}/consent/challenge`
process.env.LUCKYCAT_QUESTION_URL = `http://127.0.0.1:${PORT}/agent-api/questions`
if (OPS_MODE) process.env.LUCKYCAT_OPS_GATE_URL = `http://127.0.0.1:${PORT}/internal/ops-tool`
if (STAFF_MODE) {
  process.env.LUCKYCAT_SYSTEM_PROMPT = OPS_MODE ? OPS_PROMPT : STAFF_PROMPT
  process.env.LUCKYCAT_SYSTEM_PROMPT_SUFFIX = OPS_MODE ? '只执行授权的技术维护；原生工具先经独立运维权限和 Clef 风险检查，高危或不确定时等待员工确认。' : '遵守本轮可信员工身份与权限，业务写入必须通过员工确认卡。客户身份核验由员工完成。'
} else if (HTTP_BANK) {
  process.env.LUCKYCAT_SYSTEM_PROMPT_SUFFIX ??= '只用中文办理业务。账户、余额、金额、产品和回执一律以当前客户的银行工具返回为准。需要信息时调用 ask_user_question，不得猜测账户或收款人，不得仅凭尾号转账。银行转账必须提供明确付款账户、完整收款账号、登记姓名和银行地区/代码；FPS 必须提供完整标识和明确收款币种，非账号方式的姓名及银行以登记解析为准，不得补猜掩码姓名。换汇金额按付款币种输入，核对报价有效期与收款金额。风险确认语句必须由客户本人提供。确认和支付密码由独立卡片收集，禁止索要密码或把密码写入工具参数。工具成功返回前不得声称操作成功。失败或受理中的业务要如实说明。卡号和 CVV 只在临时窗口展示，不要在对话中复述。只有客户提出转人工时才提交问题摘要；问题已明确时直接调用 bank_request_human_support，由专用确认卡收集授权，不要再用 ask_user_question 重复询问是否提交。缺少问题内容时才补问。创建工单需确认。创建成功只是等待受理，不代表已接通人工，不承诺服务时段或响应时间；告知返回的工单编号及助手 → 人工工单入口。不要透露模型名称或内部实现。'
}

/** 可选的额外 overlay（冒号或逗号分隔绝对路径），端到端自检用。 */
const PATCHES = (process.env.LUCKYCAT_PATCHES ?? '')
  .split(process.platform === 'win32' ? /,/ : /[:,]/)
  .map(entry => entry.trim())
  .filter(entry => entry !== '')
/** 一次确认最多等多久（毫秒）。超时即拒绝——与插件侧的超时是两道独立的闸。 */
const CONSENT_TIMEOUT_MS = Number(process.env.LUCKYCAT_CONSENT_TIMEOUT_MS ?? 180_000)
/** 请求体上限；防止有人往这里灌垃圾。 */
const MAX_BODY_BYTES = 256 * 1024

/* ------------------------------------------------------------------ 语音 */

/** 语音接口的开关（自检时可以用它验证"没有语音能力时页面怎么退让"）。 */
const VOICE_ENABLED = process.env.LUCKYCAT_DISABLE_VOICE !== '1'
const TTS_MODEL = process.env.LUCKYCAT_TTS_MODEL ?? 'qwen/qwen-audio-3.0-tts-plus'
const TTS_VOICE = process.env.LUCKYCAT_TTS_VOICE ?? 'longanlingxin'
const ASR_MODEL = process.env.LUCKYCAT_ASR_MODEL ?? 'qwen/qwen3-asr-0.6b'

/*
 * 流式 TTS（火山引擎语音技术）的配置。
 * 凭据只从这里来（环境变量），绝不打印、绝不入库：
 *   LUCKYCAT_VOLC_APP_ID / LUCKYCAT_VOLC_ACCESS_TOKEN（或直接 VOLC_APP_ID / VOLC_ACCESS_TOKEN）
 *   LUCKYCAT_VOLC_RESOURCE  → seed-tts-2.0（决定音色体系与计费）
 *   LUCKYCAT_VOLC_SPEAKER   → 实测 zh_female_xiaohe_uranus_bigtts 可配 seed-tts-2.0
 *   LUCKYCAT_VOLC_SAMPLE_RATE → 流式返回裸 PCM，采样率默认 24000
 */
const VOLC_API_KEY = process.env.LUCKYCAT_VOLC_API_KEY ?? process.env.VOLC_API_KEY ?? ''
const VOLC_APP_ID = process.env.LUCKYCAT_VOLC_APP_ID ?? process.env.VOLC_APP_ID ?? ''
const VOLC_ACCESS_TOKEN = process.env.LUCKYCAT_VOLC_ACCESS_TOKEN ?? process.env.VOLC_ACCESS_TOKEN ?? ''
const VOLC_RESOURCE = process.env.LUCKYCAT_VOLC_RESOURCE ?? 'seed-tts-2.0'
const VOLC_SPEAKER = process.env.LUCKYCAT_VOLC_SPEAKER ?? 'zh_female_xiaohe_uranus_bigtts'
const VOLC_SAMPLE_RATE = Number(process.env.LUCKYCAT_VOLC_SAMPLE_RATE ?? 24000)
/**
 * 语音请求体的上限，比普通接口大得多：一段 60 秒的 Opus 录音大约半兆，
 * base64 之后还要再涨三分之一。用通用的 256KB 会在录音稍长时直接被拒。
 */
const MAX_AUDIO_BYTES = 12 * 1024 * 1024
/**
 * 一条消息里图片的 base64 上限。
 *
 * 比 `MAX_BODY_BYTES`（256KB）大得多，因为图片本来就是几百 KB 起；
 * 但也不能不设——运行时那边的默认上限是单张 20MB，让这么长的 base64 走进来
 * 只是把失败推迟到更贵的地方。
 *
 * 注意配套的 **body 上限**：`/messages` 那条路由必须用
 * `MAX_IMAGE_BODY_BYTES` 去 `readBody`，不能用通用的 `MAX_BODY_BYTES`——
 * 否则超过 256KB 的图会在读 body 那一步就把连接掐掉（客户端看到的是
 * `ECONNRESET`，而不是下面那条清清楚楚的 413）。这是实测踩到的。
 */
/** 用户上传的图片放这里。**在 .dsh-home 下**（已被 gitignore），不混进仓库。 */
const UPLOAD_ROOT = join(SESSION_DIR, 'uploads')

/**
 * 账户目录名的白名单。
 *
 * 账户标识会**变成路径的一段**，所以绝不能直接拼进路径：
 * `accountId = '../../../etc'` 就能把图片写到外面去（路径穿越）。
 * 这里只放行字母数字和 `-` `_`，别的一律拒绝——不是"过滤掉危险字符"，
 * 而是**不匹配就拒绝**（过滤的思路永远会漏，白名单不会）。
 */
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * 取某个账户的上传目录。
 * @param accountId - 账户/用户标识，来自前端。
 * @returns 该账户的目录绝对路径。
 * @throws 标识不合法时抛错（调用方要转成 400，不能默默回退到公共目录——
 *   那样"隔离"就变成了"大家都写同一处"）。
 */
function accountUploadDir(accountId) {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error('账户标识不合法')
  }
  return join(UPLOAD_ROOT, accountId)
}

/**
 * 一次问询最多等多久。到点回**空答复**（不是"用户拒绝"，见 `/agent-api/questions` 的注释）。
 * 与插件侧的 `timeoutMs` 是两道独立的闸：插件那道先到的话，它会主动断开这个请求。
 */
const QUESTION_TIMEOUT_MS = Number(process.env.LUCKYCAT_QUESTION_TIMEOUT_MS ?? 180_000)
/** 一次最多问几道题（与插件侧 `MAX_QUESTIONS` 对齐）。 */
const MAX_QUESTIONS = 10
/** 图片单张的 base64 上限。 */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
/**
 * 带图消息的 **body** 上限（防洪闸），刻意**高于** `MAX_IMAGE_BYTES` 一倍。
 *
 * 两个上限管的是两件事，不能贴在一起：
 *   · `MAX_IMAGE_BYTES` 是**策略**上限 —— 超了回一条清清楚楚的 413；
 *   · 这个 body 上限是**防洪**闸 —— 超了直接掐连接（`req.destroy()`），
 *     连状态码都不给（对方很可能根本不是在正常发消息）。
 *
 * 第一版把防洪闸设成 `MAX_IMAGE_BYTES + 1MB`，结果测试发的 7MB 先撞上它、
 * 被掐成 `ECONNRESET`，那条 413 永远走不到——**策略上限形同虚设**。
 * 所以防洪闸要留出足够余量，让所有"只是图太大"的请求都能被完整读进来、
 * 然后由策略上限正式拒掉。
 */
const MAX_IMAGE_BODY_BYTES = MAX_IMAGE_BYTES * 2
/** 认得的图片格式。不在这个名单里就明确拒绝，不猜。 */
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
/** 语音上游一次最多等多久。实测 TTS/ASR 各约 2~3 秒，给足余量但必须有上限。 */
const VOICE_TIMEOUT_MS = 45_000
/** 一次合成最多念多少字：按字数计费，而且长回复念起来没完。 */
const TTS_MAX_CHARS = 600
/**
 * 一次录音最长多少秒。
 *
 * 不是为了省钱，是**上游的硬限制**：转录端点是"约 60 秒的处理时间"上限，
 * 超了会直接失败。所以录音端就要卡住，而不是等用户说了两分钟再报错。
 */
const VOICE_MAX_SECONDS = Number(process.env.LUCKYCAT_VOICE_MAX_SECONDS ?? 60)
/** 流式合成：总超时与帧间空闲超时。PCM 一帧通常几十到几百毫秒一帧，给足余量。 */
const TTS_STREAM_TIMEOUT_MS = Number(process.env.LUCKYCAT_TTS_STREAM_TIMEOUT_MS ?? 60_000)
const TTS_STREAM_IDLE_MS = Number(process.env.LUCKYCAT_TTS_STREAM_IDLE_MS ?? 15_000)

/**
 * 浏览器的录音 MIME 类型 → OpenRouter 要的格式名。
 *
 * 浏览器给的是一整串（`audio/webm;codecs=opus`），而 OpenRouter 只认那几个词。
 *
 * 不认识的**一律拒绝（415），不猜一个**。实测把这个宽容度量清楚了：
 *   · 格式名完全不存在（如 `definitely-not-real`）→ 上游 400；
 *   · 格式名**存在但写错**（webm 的字节标成 `mp3`）→ 上游照样正确转录，
 *     它是按容器内容嗅探的，不看你写的那个词。
 * 也就是说"猜错"不会立刻报错——这正是宁可拒绝也不猜的理由：这条路上一旦
 * 出问题就是静默的，而静默的错误比一个 415 难查得多。
 */
const AUDIO_FORMATS = new Map([
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/flac', 'flac'],
  ['audio/aac', 'aac'],
])

/**
 * 把浏览器给的 MIME 类型映射成 OpenRouter 的格式名。
 * @param mimeType - 例如 `audio/webm;codecs=opus`。
 * @returns 格式名；不认识时返回 undefined。
 */
function audioFormatOf(mimeType) {
  const base = String(mimeType ?? '').split(';')[0].trim().toLowerCase()
  return AUDIO_FORMATS.get(base)
}

/** 语音上游的地址（与 agent 用同一个 key）。 */
const OPENROUTER_BASE = (process.env.LUCKYCAT_OPENROUTER_BASE ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')

/**
 * 调一次语音上游。
 * @param path - 相对路径，例如 `/audio/speech`。
 * @param body - JSON 请求体。
 * @returns 上游的原始响应。
 */
async function callVoiceUpstream(path, body) {
  const key = process.env.OPENROUTER_API_KEY ?? ''
  if (key === '') throw new Error('服务端没有配置 OPENROUTER_API_KEY，语音不可用')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('语音上游超时')), VOICE_TIMEOUT_MS)
  try {
    return await fetch(`${OPENROUTER_BASE}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}


/* ------------------------------------------------------------------ 小工具 */

/**
 * 读请求体（有上限），返回字符串。
 * @param req - 请求。
 * @param maxBytes - 上限。默认是通用的 {@link MAX_BODY_BYTES}；
 *   语音那条路要传 {@link MAX_AUDIO_BYTES}（一段录音比一条消息大三个数量级）。
 * @returns 请求体文本。
 */
function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        rejectPromise(new Error(`请求体超过 ${maxBytes} 字节`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolvePromise(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', rejectPromise)
  })
}

/** 读 JSON 请求体；空体返回 {}。 */
async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  const text = await readBody(req, maxBytes)
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** 回一个 JSON 响应。 */
async function sendJson(res, status, payload) {
  if (persistenceFailureLogged) throw Object.assign(new Error('会话持久化服务不可用，请稍后重试'), { status: 503, code: 'SESSION_STORE_UNAVAILABLE' })
  await sessionStore?.flush()
  if (persistenceFailureLogged) throw Object.assign(new Error('会话持久化服务不可用，请稍后重试'), { status: 503, code: 'SESSION_STORE_UNAVAILABLE' })
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // 演示服务只给本机网页用；不允许被别的站点带着 cookie 调。
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 读一个路径参数（已 decode）。 */
function pathParts(pathname) {
  return pathname.split('/').filter(part => part !== '').map(part => decodeURIComponent(part))
}

/* ------------------------------------------------- 确认通道（agent → 用户） */

/**
 * 待确认事项表：challengeId → { challenge, resolve, reject, timer }。
 * 键是插件生成的随机 nonce，所以答复必须带上同一个 nonce 才会被接受。
 */
const pendingConsents = new Map()

/** 每个会话的 SSE 订阅者：sessionId → Set<res>。 */
const streams = new Map()
const eventPolling = createEventPolling()
let imBank, imChannels, imHttp, imReminders

/** 把一条 SSE 事件推给某个会话的所有订阅者。 */
let persistenceFailureLogged = false
function publish(sessionId, event) {
  const entry = sessions.get(sessionId)
  if (HTTP_BANK && entry) eventPolling.remember(entry, event)
  // 保留可重放事件，敏感卡信息仅发送一次且不进入缓冲。
  const replayable = event.type !== 'card-secret'
  let id
  if (HTTP_BANK && entry && replayable) {
    id = String(entry.eventSeq = (entry.eventSeq ?? 0) + 1)
    entry.events ??= []
    entry.events.push({ id, event })
    if (entry.events.length > 256) entry.events.shift()
  }
  const subscribers = [...(streams.get(sessionId) ?? [])]
  let frame, durable
  try {
    frame = `${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(event)}\n\n`
    durable = HTTP_BANK && entry ? replayable ? sessionStore.record(entry, event) : sessionStore.flush() : Promise.resolve()
  } catch {
    durable = Promise.reject(Object.assign(new Error('会话事件持久化失败'), { status: 503, code: 'SESSION_STORE_UNAVAILABLE' }))
  }
  const delivered = Promise.resolve(durable).then(() => {
    if (persistenceFailureLogged) throw Object.assign(new Error('会话持久化服务不可用'), { status: 503, code: 'SESSION_STORE_UNAVAILABLE' })
    imBank?.observe(sessionId, event)
    for (const res of subscribers) if (!res.writableEnded && !res.destroyed) {
      try { res.write(frame) } catch { streams.get(sessionId)?.delete(res) }
    }
  })
  // SDK event callbacks are synchronous. Never let an ignored publication Promise
  // become unhandled, and never send an event before PostgreSQL commits it.
  void delivered.catch(() => {
    if (!persistenceFailureLogged) { persistenceFailureLogged = true; console.warn('[demo-server] Session persistence unavailable; event streams closed') }
    for (const set of streams.values()) for (const response of set) { try { response.end() } catch {} }
    streams.clear()
  })
  return delivered
}

/** 广播给全部订阅者（用于 health/模型变更这类全局消息）。 */
function broadcast(event) {
  for (const sessionId of streams.keys()) publish(sessionId, event)
}

/** 结束一个待确认事项。 */
function settleConsent(challengeId, answer) {
  const entry = pendingConsents.get(challengeId)
  if (entry === undefined) return false
  pendingConsents.delete(challengeId)
  clearTimeout(entry.timer)
  const durable = publish(entry.challenge.sessionId, { type: 'consent-resolved', challengeId, decision: answer?.decision ?? 'timeout' })
  if (HTTP_BANK && answer?.decision !== 'approve') {
    if (OPS_MODE && OPS_NATIVE_TOOLS.includes(entry.challenge.toolName)) opsGate.forget(entry.challenge)
    else bankAgent.forget(entry.challenge)
  }
  void durable.then(() => entry.resolve(answer), () => {
    try { if (HTTP_BANK) {
      if (OPS_MODE && OPS_NATIVE_TOOLS.includes(entry.challenge.toolName)) opsGate.forget(entry.challenge)
      else bankAgent.forget(entry.challenge)
    } } catch {}
    entry.resolve({ decision: 'reject', challengeId })
  })
  return true
}

/* ------------------------------------------------- 提问通道（agent → 用户） */

/**
 * 待答复的问题表：questionId → { question, answers, resolve, timer }。
 *
 * 和确认通道**同一个形状**，但语义不同：确认是"这个操作能不能执行"（fail-closed），
 * 提问只是"收集信息"，答不上来不会放行任何东西。所以这里没有票据、没有验证。
 */
const pendingQuestions = new Map()

/** 问询 id：随机 nonce，答复必须带同一个才会被接受（防旧答复被重放给新问题）。 */
function newQuestionId() {
  return `q_${randomBytes(12).toString('hex')}`
}

/** 结束一次问询。 */
function settleQuestion(questionId, answer) {
  const entry = pendingQuestions.get(questionId)
  if (entry === undefined) return false
  pendingQuestions.delete(questionId)
  clearTimeout(entry.timer)
  const durable = publish(entry.sessionId, {
    type: 'question-resolved',
    questionId,
    answered: answer !== undefined,
  })
  void durable.then(() => entry.resolve(answer), () => entry.resolve(undefined))
  return true
}

/* --------------------------------------------------------- agent 运行时 */

/** 会话表：我们的 sessionId → { harness 会话句柄, 忙碌标志, 工具调用轨迹 }。 */
const sessions = new Map()
const sessionNamespace = OPS_MODE ? 'ops' : STAFF_MODE ? 'staff' : 'customer'
if (process.env.LUCKYCAT_SESSION_NAMESPACE && process.env.LUCKYCAT_SESSION_NAMESPACE !== sessionNamespace) throw new Error('Session namespace must match this bridge audience')
const sessionStore = HTTP_BANK ? await openSessionStore(process.env.LUCKYCAT_SESSION_DATABASE_URL, { namespace: sessionNamespace }) : null
if (sessionStore) for (const entry of await sessionStore.interrupted()) sessions.set(entry.id, entry)
const bankAgent = HTTP_BANK ? (STAFF_MODE ? createStaffAgent : createBankAgent)({ baseUrl: process.env.LUCKYCAT_BANK_URL ?? 'http://127.0.0.1:8080', sessions, publish, reminders: () => imReminders, ...(OPS_MODE ? { opsOnly: true, nativeTools: OPS_NATIVE_TOOLS } : {}) }) : null
const opsGate = OPS_MODE ? createOpsGate({ bankAgent, sessions, publish, review: createClefReviewer(), workspaceRoot: OPS_WORKSPACE, auditPath: join(SESSION_DIR, 'native-audit.jsonl') }) : null
for (const entry of sessions.values()) {
  if (entry.interrupted) {
    publish(entry.id, { type: 'session-restored', interrupted: true })
    publish(entry.id, { type: 'status', status: 'idle' })
    entry.interrupted = false
  }
  await sessionStore?.save(entry)
}
await sessionStore?.flush()

// 限制活动索引缓存，历史仍保存在磁盘；避免持久化后 50 段成为永久额度。
function makeSessionRoom(ownerId) {
  const full = () => sessions.size >= 1000 || [...sessions.values()].filter(e => e.ownerId === ownerId).length >= 50
  for (const [id, entry] of sessions) {
    if (!full()) return
    if (entry.busy || entry.stopTask || entry.requestRefs || streams.has(id)) continue
    if ([...sessions.values()].filter(e => e.ownerId === ownerId).length >= 50 && entry.ownerId !== ownerId) continue
    sessions.delete(id)
  }
  if (full()) throw bankError('同时打开的会话过多，请稍后重试', 429)
}

/** 共享的 harness（一个进程带多个会话）。 */
let harness
let harnessStarting
const activeTurns = new Set()
let shuttingDown = false

/** 从会话事件里抽出给网页看的东西。 */
function projectEvent(sessionId, event) {
  if (event.type === 'llm/retry' || event.type === 'llm/retry-started') return projectModelRetry(event)
  switch (event.type) {
    case 'tool/call':
      return {
        type: 'tool-call',
        callId: String(event.data.callId),
        name: event.data.name,
        // 参数原样给网页，让"要展示什么"由确认卡片决定（这里不做业务判断）。
        arguments: safeParse(event.data.arguments),
      }
    case 'tool/result': {
      return projectToolResult(event.data?.message)
    }
    case 'approval/asked':
      return { type: 'consent-asked', callId: String(event.data.callId ?? ''), toolName: event.data.toolName }
    case 'approval/decided':
      return { type: 'consent-decided', outcome: event.data.outcome }
    default:
      return undefined
  }
}

/** 解析工具参数 JSON；坏了就原样给出（不抛）。 */
function safeParse(text) {
  if (typeof text !== 'string') return text
  try {
    return JSON.parse(text)
  } catch {
    return { _unparsed: text }
  }
}

/** 确保 harness 已启动。 */
async function ensureHarness() {
  if (harnessStarting) return harnessStarting
  harnessStarting = (async () => {
    // SDK 0.1.6 只公开完成消息；用树外插件扩展通知，不修改运行时依赖。
    const streamPatch = join(controlDir, 'runtime.patch.yml')
    await mkdir(home, { recursive: true })
    await writeFile(streamPatch, JSON.stringify([
      { id: 'sessions', config: { root: join(SESSION_DIR, 'sessions'), compression: 'none' } },
      { id: 'attachment-local', config: { dshHome: SESSION_DIR } },
      { id: 'sdk-jsonrpc-server', disabled: true },
      { insert: [
        { id: 'luckycat-sdk-resume', name: join(ROOT, 'bridge/sdk-session-resume.mjs'), inject: ['sdkAppStartup', 'loader', 'agents', 'sessionPersistence'], config: { maxTokensAsSuccess: false } },
        { id: 'luckycat-assistant-stream', name: join(ROOT, 'bridge/assistant-stream-plugin.mjs') },
      ] },
    ]), { mode: 0o600 })
    // 当前适配器没有 extra_body 配置；仅给这个子进程加载请求适配层。
    const fallbackImport = new URL('./model-fallback-fetch.mjs', import.meta.url).href
    const fallbackEnv = PROVIDER === 'openrouter' && process.env.LUCKYCAT_FALLBACK_MODELS
      ? { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${fallbackImport}`.trim() }
      : undefined
    const candidate = new DeepSeekHarness({
      dshBin: join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), profile: PROFILE,
      provider: PROVIDER, model: MODEL, initializeTimeoutMs: 30_000,
      ...(OPS_MODE ? { processCwd: OPS_WORKSPACE } : {}),
      ...fallbackEnv === undefined ? {} : { env: fallbackEnv },
      patches: [streamPatch, ...PATCHES],
    })
    harness = candidate
    await candidate.start()
    return candidate
  })().catch(async error => {
    const failed = harness
    harnessStarting = undefined
    harness = undefined
    await failed?.close().catch(() => {})
    throw error
  })
  return harnessStarting
}

/**
 * 取或建一个会话。
 *
 * started 与可信客户归属持久化；运行时句柄在首次继续对话时从原生日志恢复。
 */
function sessionOf(sessionId) {
  let entry = sessions.get(sessionId)
  if (entry === undefined) {
    entry = { id: sessionId, busy: false, handle: undefined, started: false }
    sessions.set(sessionId, entry)
  }
  return entry
}

/**
 * 跑一轮对话：把事件推给 SSE，直到 agent 空闲。
 * 刻意**不** await 在 HTTP 处理器里——prompt 的语义是"入队"，与上游一致。
 */
async function runTurn(sessionId, input) {
  const entry = sessionOf(sessionId)
  if (entry.busy) {
    publish(sessionId, { type: 'error', message: '上一轮还在进行中，请等它结束。' })
    return
  }
  entry.busy = true
  entry.stopping = false
  entry.activity = { cancelled: false }
  if (OPS_MODE) entry.intent = typeof input === 'string' ? input : input.filter(b => b.type === 'text').map(b => b.text).join('\n')
  let lastFailure
  let retries = 0
  const assistantStream = createAssistantStream(sessionId, event => {
    if (event.type === 'assistant' || event.type === 'assistant-update') entry.retryProgress = undefined
    publish(sessionId, event)
  })
  entry.assistantStream = assistantStream
  try {
    await publish(sessionId, { type: 'status', status: 'running' })
    const active = await ensureHarness()
    if (entry.stopping) return
    entry.handle ??= active.session(sessionId)
    // 递提示词之前打上标记：这一步之后运行时里就有这个会话了。
    entry.started = true
    await sessionStore?.save(entry)
    let prompt = entry.legacyContext
      ? [{ type: 'text', text: entry.legacyContext }, ...(typeof input === 'string' ? [{ type: 'text', text: input }] : input)] : input
    if (STAFF_MODE) prompt = [{ type: 'text', text: await bankAgent.context(sessionId) }, ...(typeof prompt === 'string' ? [{ type: 'text', text: prompt }] : prompt)]
    const result = await entry.handle.run(prompt, {
      onNotification: (notification) => {
        if (notification.params.sessionId !== sessionId) return
        if (notification.method === 'luckycat.assistant-stream') {
          assistantStream.frame(notification.params.frame)
          return
        }
        if (notification.method !== 'session.event') return
        const event = notification.params.event
        if (event.type === 'turn/end' && event.data.reason?.kind === 'error') lastFailure = event.data.reason.error
        if (event.type === 'assistant/message') retries = 0
        const projected = event.type === 'assistant/message' || event.type === 'assistant/attempt'
          ? assistantStream.settle(event) : projectEvent(sessionId, event)
        if (projected?.type === 'model-retry') {
          entry.retryProgress = { ...entry.retryProgress, ...projected }
          retries = projected.attempt
          publish(sessionId, entry.retryProgress)
        } else if (projected !== undefined) {
          if (projected.type === 'tool-call' || projected.type === 'assistant') entry.retryProgress = undefined
          publish(sessionId, projected)
        }
      },
    })
    entry.legacyContext = undefined
    await sessionStore?.save(entry)
    if (!entry.stopping && (lastFailure || result.finalResponse.trim() === '')) {
      publish(sessionId, { type: 'error', message: modelFailureMessage(lastFailure, retries) })
    }
  } catch (error) {
    if (!entry.stopping) publish(sessionId, { type: 'error', message: `agent 运行失败：${error instanceof Error ? error.message : String(error)}` })
  } finally {
    assistantStream.close()
    if (entry.stopping) publish(sessionId, { type: 'stopped' })
    entry.assistantStream = undefined
    entry.retryProgress = undefined
    entry.busy = false
    entry.stopping = false
    await publish(sessionId, { type: 'status', status: 'idle' })
  }
}

/* ------------------------------------------------------------ HTTP 路由 */

/**
 * 占位银行后端的懒加载单例。
 *
 * 只在第一次收到 `/api/*` 时才去初始化：它要动态 import 前端的 TS，
 * 会拖慢启动；而大多数请求根本不碰银行数据。
 *
 * @returns 初始化好的后端；失败时返回 `null`（原因记在 [demoBankFailure]）。
 */
let demoBankPromise = null
let demoBankFailure = null
function demoBank() {
  if (demoBankPromise === null) {
    demoBankPromise = createDemoBank({
      stateFile: join(home, 'demo-bank-state.json'),
      // 从 framework 根开始向上找 app 源码与钩子（开发仓库与服务器布局不同，见 findAssetRoot）
      searchFrom: ROOT,
    })
      .then((bank) => {
        const stats = bank.stats()
        console.log(`[demo-server] 占位银行后端就绪：${stats.routes} 条路由，状态存 ${stats.stateFile}`)
        return bank
      })
      .catch((error) => {
        demoBankFailure = error instanceof Error ? error : new Error(String(error))
        console.warn(`[demo-server] 占位银行后端没起来（/api/* 会回 503）：${demoBankFailure.message}`)
        return null
      })
  }
  return demoBankPromise
}

const server = createServer((req, res) => {
  void handle(req, res).catch(async (error) => {
    if (!res.headersSent) {
      try { await sendJson(res, error?.status ?? 500, { error: error instanceof Error ? error.message : String(error), code: error?.code }) }
      catch { res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: '会话持久化服务不可用，请稍后重试', code: 'SESSION_STORE_UNAVAILABLE' })) }
    }
    else res.end()
  }).finally(() => { if (req.sessionEntry) req.sessionEntry.requestRefs -= 1 }).catch(() => { try { res.destroy() } catch {} })
})

async function handle(req, res) {
  if (shuttingDown) { await sendJson(res, 503, { error: '服务正在重启，请稍后重试' }); return }
  if (persistenceFailureLogged) throw Object.assign(new Error('会话持久化服务不可用，请稍后重试'), { status: 503, code: 'SESSION_STORE_UNAVAILABLE' })
  await sessionStore?.flush()
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const parts = pathParts(url.pathname)
  if (imHttp && await imHttp.handle(req, res, { pathname: url.pathname, readJson, sendJson })) return

  const internal = url.pathname === '/consent/challenge' || url.pathname === '/agent-api/questions' || url.pathname === '/internal/bank-tool' || url.pathname.startsWith('/internal/ops-tool/')
  if (HTTP_BANK && internal && req.headers['x-luckycat-internal'] !== INTERNAL_TOKEN) {
    throw bankError('内部通道禁止外部访问', 403, 'FORBIDDEN')
  }
  // 访问口令（可选）：设了就一律要带对，否则拒绝。
  if (!HTTP_BANK && !internal && ACCESS_TOKEN !== '' && req.headers['x-luckycat-token'] !== ACCESS_TOKEN) {
    await sendJson(res, 401, { error: '缺少或错误的 x-luckycat-token' })
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization,x-luckycat-token',
    })
    res.end()
    return
  }

  let identity
  if (HTTP_BANK && url.pathname.startsWith('/agent-api/') && !internal) {
    identity = await bankAgent.authenticate(req.headers.authorization)
    if (parts[1] === 'sessions' && parts[2]) {
      let entry = sessions.get(parts[2])
      if (!entry) {
        const stored = await sessionStore.get(parts[2])
        if (stored) {
          if (stored.ownerId !== identity.user.id) throw bankError('会话不存在或不属于当前账户', 404, 'NOT_FOUND')
          makeSessionRoom(identity.user.id)
          entry = stored
          sessions.set(entry.id, entry)
        }
      }
      // 旧版本未保存归属的会话不能凭 id 认领，网页可迁入自己的本地文字记录。
      if (!entry && req.method === 'GET' && parts.length === 3) {
        await sendJson(res, 200, { sessionId: parts[2], known: false, started: false, busy: false })
        return
      }
      if (entry) {
        req.sessionEntry = entry
        entry.requestRefs = (entry.requestRefs ?? 0) + 1
      }
      await bankAgent.owned(entry, identity)
    }
    if (parts[1] === 'consent' && parts[2]) {
      const pending = pendingConsents.get(parts[2])
      await bankAgent.owned(sessions.get(pending?.challenge.sessionId), identity)
    }
    if (parts[1] === 'questions' && parts[2]) {
      await bankAgent.owned(sessions.get(pendingQuestions.get(parts[2])?.sessionId), identity)
    }
  }
  if (HTTP_BANK && url.pathname === '/internal/bank-tool' && req.method === 'POST') {
    const result = await bankAgent.execute(await readJson(req))
    await sendJson(res, 200, result)
    return
  }
  if (imHttp && await imHttp.handle(req, res, { pathname: url.pathname, identity, readJson, sendJson })) return
  // 健康探测：网页据此决定走真 agent 还是回落固定话术。
  if (req.method === 'GET' && parts.join('/') === 'agent-api/health') {
    /*
     * 这个响应**不回模型名、厂商名、语音模型名**。
     *
     * 它是浏览器直接调的，用户在开发者工具里就能看到——"界面上不显示"
     * 挡不住这一步。所以隐藏要在**源头**做：这里只回"服务在不在"和
     * "有哪些能力"，模型与厂商只写进服务端启动日志（运维看得见，用户看不到）。
     *
     * 改这条路由时注意：`app/src/api/agent.ts` 的 `AgentHealth` 是配套的，
     * 加了字段要一起改；`tools/check-persona.mjs` 断言这个响应里
     * **不存在** `model` / `provider` 这类键。
     */
    await sendJson(res, 200, {
      ok: PROVIDER !== 'openrouter' || Boolean(process.env.OPENROUTER_API_KEY),
      bankDataSource: HTTP_BANK ? 'http' : 'demo',
      // 语音能力一并报出去：页面据此决定要不要显示「语音模式」，
      // 而不是等用户按下去才发现服务端没配。只报"有没有"，不报"用的哪个模型"。
      voice: VOICE_ENABLED && Boolean(process.env.OPENROUTER_API_KEY)
        ? { asr: true, tts: true, stream: Boolean(VOLC_API_KEY || (VOLC_APP_ID && VOLC_ACCESS_TOKEN)), maxSeconds: VOICE_MAX_SECONDS }
        : { asr: false, tts: false },
    })
    return
  }

  // 建会话
  if (req.method === 'POST' && parts.join('/') === 'agent-api/sessions') {
    const context = legacyContext((await readJson(req)).history)
    const sessionId = await createWebSession(identity, context)
    await sendJson(res, 200, { sessionId })
    return
  }

  // 问一个会话还在不在（网页恢复历史对话时用）。
  // 只读：**不会**顺手把它建出来，否则每个历史对话都被问成"还在"。
  if (req.method === 'GET' && parts.length === 3 && parts[0] === 'agent-api' && parts[1] === 'sessions') {
    const sessionId = parts[2]
    const entry = sessions.get(sessionId)
    await sendJson(res, 200, {
      sessionId,
      known: entry !== undefined,
      started: entry?.started === true,
      busy: entry?.busy === true,
    })
    return
  }

  // 仅停止目标会话；未提交的授权作废，已提交银行操作仍以银行回执为准。
  if (req.method === 'POST' && parts.length === 4 && parts[0] === 'agent-api' && parts[1] === 'sessions' && parts[3] === 'stop') {
    const entry = sessions.get(parts[2])
    if (!entry) throw bankError('会话不存在', 404)
    if (!entry.busy) { await sendJson(res, 200, { stopped: false }); return }
    if (entry.stopTask) { await entry.stopTask; await sendJson(res, 200, { stopped: true }); return }
    await stopSession(entry.id)
    await sendJson(res, 200, { stopped: true })
    return
  }

  // 发消息
  if (req.method === 'POST' && parts.length === 4 && parts[0] === 'agent-api' && parts[1] === 'sessions' && parts[3] === 'messages') {
    const sessionId = parts[2]
    if (sessions.get(sessionId)?.busy || sessions.get(sessionId)?.stopTask) throw bankError('上一轮还在进行中，请等它结束', 409)
    const body = await readJson(req, MAX_IMAGE_BODY_BYTES)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const image = body.image
    // 图片是选填的，但"文字和图片都空"没有意义
    if (text === '' && image === undefined) {
      await sendJson(res, 400, { error: 'text 不能为空' })
      return
    }
    if (STAFF_MODE && body.serviceIds !== undefined) throw bankError('工作人员助手不接受客户智能服务选择', 400)
    const skillPrefix = serviceSkillContext?.(body.serviceIds) ?? ''
    let blocks
    if (image !== undefined) {
      const data = typeof image?.data === 'string' ? image.data : ''
      const mimeType = typeof image?.mimeType === 'string' ? image.mimeType : ''
      if (data === '') {
        await sendJson(res, 400, { error: '图片内容为空' })
        return
      }
      if (data.length > MAX_IMAGE_BYTES) {
        await sendJson(res, 413, { error: `图片太大（上限 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB）` })
        return
      }
      if (!IMAGE_MIME_TYPES.has(mimeType)) {
        await sendJson(res, 415, { error: `不认识的图片格式：${mimeType}`, accepted: [...IMAGE_MIME_TYPES] })
        return
      }
      /*
       * 两件事都做，各管一头：
       *
       *   1) **内联图片块**进模型上下文 —— 这才是"真发给 agent"（A 方案）。
       *      模型直接看见像素，不需要任何工具去取。
       *   2) **落到本账户的上传目录** —— 审计留档 + 账户隔离。
       *
       * 之前只做了第 2 件，还叫 agent「用 read 工具读取它」——**这条是错的**：
       * `read` 是读文本的，读图是另一个工具 `read_image`。实测模型照办后
       * 拿到的是二进制乱码。改内联块之后就不存在这个错配。
       *
       * 内联块需要 `ctx.attachments` 才能登录（SDK 原文：`SDK image prompt
       * requires an attachment store`），所以 profile 里挂上了官方
       * `@deepseek-ai/dsh-attachment-local`。
       */
      const accountId = HTTP_BANK ? identity.user.id : typeof body.accountId === 'string' ? body.accountId : ''
      if (accountId === '') {
        await sendJson(res, 400, { error: '缺少 accountId（图片要按账户隔离存放）' })
        return
      }
      let dir
      try {
        dir = accountUploadDir(accountId)
      } catch {
        await sendJson(res, 400, { error: 'accountId 不合法' })
        return
      }
      await mkdir(dir, { recursive: true, mode: 0o700 })
      // 文件名用内容哈希：同一张图重复发不会堆一堆副本，也不怕同名覆盖
      const digest = createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex').slice(0, 16)
      const extension = mimeType.split('/')[1] ?? 'bin'
      const filePath = join(dir, `${digest}.${extension}`)
      await writeFile(filePath, Buffer.from(data, 'base64'), { mode: 0o600 })
      /*
       * 这里**不**写任何路径提示。写了会诱导模型去调 `read`/`read_image`，
       * 而图片已经内联在上下文里了；白名单也解释了这一点（只放行 read）。
       * 归档路径只进服务端日志，不进模型上下文。
       */
      console.log(`[demo-server] 图片已归档：${filePath}`)
      blocks = []
      if (text !== '' || skillPrefix) blocks.push({ type: 'text', text: skillPrefix + (text || '请帮我查看这张图片') })
      blocks.push({ type: 'image', data, mimeType })
    }
    if (sessionOf(sessionId).busy || sessions.get(sessionId).stopTask) throw bankError('上一轮还在进行中，请等它结束', 409)
    // 只有文字时仍然按字符串递——那是走熟了的路，没必要为图片把它改掉
    const turn = runTurn(sessionId, blocks ?? skillPrefix + text)
    activeTurns.add(turn)
    void turn.finally(() => activeTurns.delete(turn)).catch(() => { console.warn('[demo-server] Conversation stopped because session persistence is unavailable') })
    await sendJson(res, 202, { accepted: true })
    return
  }

  // 短请求事件通道：沿用上方银行登录与会话归属校验，不执行或重发消息。
  if (HTTP_BANK && req.method === 'GET' && parts.length === 4 && parts[0] === 'agent-api' && parts[1] === 'sessions' && parts[3] === 'events') {
    const sessionId = parts[2]
    const entry = sessions.get(sessionId)
    const initial = [{ type: 'hello', sessionId }]
    for (const { challenge } of pendingConsents.values()) {
      if (challenge.sessionId === sessionId) initial.push({ type: 'consent', challenge })
    }
    for (const { resolve, timer, ...question } of pendingQuestions.values()) {
      if (question.sessionId === sessionId) initial.push({ type: 'question', question })
    }
    initial.push({ type: 'status', status: entry.busy ? 'running' : 'idle' })
    if (entry.busy && entry.retryProgress) initial.push(entry.retryProgress)
    await sendJson(res, 200, eventPolling.read(entry, url.searchParams.get('after'), initial))
    return
  }

  // SSE 事件流
  if (req.method === 'GET' && parts.length === 4 && parts[0] === 'agent-api' && parts[1] === 'sessions' && parts[3] === 'stream') {
    const sessionId = parts[2]
    await sessionStore?.flush()
    if (persistenceFailureLogged) throw Object.assign(new Error('会话持久化服务不可用，请稍后重试'), { status: 503, code: 'SESSION_STORE_UNAVAILABLE' })
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
      // 关掉 nginx 一类中间层的缓冲，否则事件会被攒着不发。
      'x-accel-buffering': 'no',
    })
    const baseline = HTTP_BANK ? `id: ${sessions.get(sessionId).eventSeq ?? 0}\n` : ''
    // 部分代理攒满小响应才交给浏览器。注释填充不产生业务事件，旧版页面也能忽略。
    res.write(`:${' '.repeat(4096)}\n\n${baseline}data: ${JSON.stringify({ type: 'hello', sessionId })}\n\n`)
    if (HTTP_BANK) {
      const entry = sessions.get(sessionId)
      const cursor = Number(req.headers['last-event-id'] ?? 0)
      if (cursor > 0) {
        for (const item of entry.events ?? []) {
          if (Number(item.id) > cursor) res.write(`id: ${item.id}\ndata: ${JSON.stringify(item.event)}\n\n`)
        }
      } else {
        // 新页面已有本地消息存档，只恢复仍有效的交互卡片。
        for (const { challenge } of pendingConsents.values()) {
          if (challenge.sessionId === sessionId) res.write(`data: ${JSON.stringify({ type: 'consent', challenge })}\n\n`)
        }
        for (const pending of pendingQuestions.values()) {
          if (pending.sessionId === sessionId) {
            const { resolve, timer, ...question } = pending
            res.write(`data: ${JSON.stringify({ type: 'question', question })}\n\n`)
          }
        }
      }
      res.write(`data: ${JSON.stringify({ type: 'status', status: entry.busy ? 'running' : 'idle' })}\n\n`)
      if (entry.busy && entry.retryProgress) res.write(`data: ${JSON.stringify(entry.retryProgress)}\n\n`)
    }
    const subscribers = streams.get(sessionId) ?? new Set()
    subscribers.add(res)
    streams.set(sessionId, subscribers)
    // 心跳：让中间层与浏览器知道连接还活着。
    const beat = setInterval(() => {
      void (async () => {
        try {
          if (HTTP_BANK) await bankAgent.authenticate(req.headers.authorization)
          res.write(': ping\n\n')
        } catch { clearInterval(beat); res.end() }
      })()
    }, 10_000)
    req.on('close', () => {
      clearInterval(beat)
      subscribers.delete(res)
      if (subscribers.size === 0) streams.delete(sessionId)
    })
    return
  }

  // 用户对某个挑战的答复（浏览器 → 这里）
  if (req.method === 'POST' && parts.length === 3 && parts[0] === 'agent-api' && parts[1] === 'consent') {
    const challengeId = parts[2]
    const entry = pendingConsents.get(challengeId)
    if (entry === undefined) {
      await sendJson(res, 404, { error: '这个待确认事项不存在或已过期' })
      return
    }
    const body = await readJson(req)
    const decision = body.decision === 'approve' ? 'approve' : 'reject'
    if (decision === 'reject') {
      settleConsent(challengeId, { decision: 'reject', challengeId })
      await sendJson(res, 200, { ok: true, decision })
      return
    }
    if (HTTP_BANK) {
      if (OPS_MODE && OPS_NATIVE_TOOLS.includes(entry.challenge.toolName)) await opsGate.approve(entry.challenge)
      else await bankAgent.approve(entry.challenge, STAFF_MODE ? body.customerVerification : typeof body.paymentPassword === 'string' ? body.paymentPassword : '', body.riskAcknowledgement)
      const verification = entry.challenge.verification ? { method: 'payment-password', verified: true, ticket: `pw-${randomUUID()}` } : undefined
      settleConsent(challengeId, { decision: 'approve', challengeId, ...(verification ? { verification } : {}) })
      await sendJson(res, 200, { ok: true, decision })
      return
    }
    // 同意 → 校验支付密码。**需要验证的才要密码**；不需要的（只读查询）直接放行。
    const required = entry.challenge.verification
    if (required !== undefined) {
      if (required !== 'payment-password') {
        // 演示服务只实现支付密码；别的验证方式需要真实后端（短信网关/人脸核身）。
        settleConsent(challengeId, { decision: 'reject', challengeId })
        await sendJson(res, 501, { error: `演示服务不支持 ${required} 验证方式` })
        return
      }
      const password = typeof body.paymentPassword === 'string' ? body.paymentPassword : ''
      if (password !== DEMO_PASSWORD) {
        // 密码错**不**结算挑战：让用户可以再输一次（挑战本身仍有超时兜底）。
        await sendJson(res, 401, { error: '支付密码不正确' })
        return
      }
      settleConsent(challengeId, {
        decision: 'approve',
        challengeId,
        verification: {
          method: 'payment-password',
          verified: true,
          // 票据只带"验证通过"这件事与一个随机标识，**不含密码**。
          ticket: `pw-${randomUUID()}`,
        },
      })
      await sendJson(res, 200, { ok: true, decision, verified: true })
      return
    }
    settleConsent(challengeId, { decision: 'approve', challengeId })
    await sendJson(res, 200, { ok: true, decision })
    return
  }

  /* ------------------------------------------------------------ 提问通道 */

  /*
   * 提问通道（agent 插件 → 这里，长轮询）。
   *
   * 和 `/consent/challenge` 完全同形：插件把问题 POST 过来，这个请求**挂住**，
   * 我们通过 SSE 把卡片推给网页，等用户在卡片上答完再把这个响应写回去。
   * agent 那边的 `ask_user_question` 就是被这一个请求挂住的。
   *
   * 参数形状**在这里就校验**：插件侧也校验（`channel.ts` 的 `parseQuestions`），
   * 两边都查是刻意的——这条链上任何一侧单独失守都不该让一个畸形卡片出现在用户面前。
   */
  if (req.method === 'POST' && url.pathname === '/agent-api/questions') {
    const body = await readJson(req, MAX_BODY_BYTES)
    const questions = body.questions
    if (!Array.isArray(questions) || questions.length === 0) {
      await sendJson(res, 400, { error: 'questions 必须是非空数组' })
      return
    }
    if (questions.length > MAX_QUESTIONS) {
      await sendJson(res, 400, { error: `一次最多问 ${MAX_QUESTIONS} 道题` })
      return
    }
    // sessionId 决定这张卡片推给谁。插件从 agent 会话里取，缺了就没人能收到卡片——
    // 明确拒绝，而不是"挂住直到超时"（那样用户和模型都只会看到一个没头没尾的等待）。
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (sessionId === '') {
      await sendJson(res, 400, { error: '缺少 sessionId（不知道该把卡片推给哪个会话）' })
      return
    }
    if (HTTP_BANK) await bankAgent.current(sessionId)
    if (sessions.get(sessionId)?.activity?.cancelled) throw bankError('本轮已停止', 409)
    const questionId = newQuestionId()
    const now = Date.now()
    const pending = {
      questionId,
      sessionId,
      questions,
      createdAt: now,
      expiresAt: now + QUESTION_TIMEOUT_MS,
    }
    const answers = await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        pendingQuestions.delete(questionId)
        publish(sessionId, { type: 'question-resolved', questionId, answered: false })
        // 超时回的是**空答复**，不是"用户拒绝了"。
        // 这两件事对模型意义完全不同：拒绝是用户表了态，超时是用户没理。
        // 混为一谈会让模型对用户说"您拒绝了"，而用户其实什么都没点。
        resolvePromise(null)
      }, QUESTION_TIMEOUT_MS)
      // 插件侧放弃了等待（自身超时，或会话被取消）→ 立刻摘掉。
      // 与确认通道同一处坑：必须监听 `res`，`req` 的 'close' 在读完后就到了。
      const onClose = () => {
        if (res.writableEnded) return
        if (!pendingQuestions.has(questionId)) return
        clearTimeout(timer)
        pendingQuestions.delete(questionId)
        publish(sessionId, { type: 'question-resolved', questionId, answered: false })
        resolvePromise(null)
      }
      res.on('close', onClose)
      pendingQuestions.set(questionId, { ...pending, resolve: resolvePromise, timer })
      publish(sessionId, { type: 'question', question: pending })
    })
    if (!res.writableEnded && !res.destroyed) {
      // 超时/放弃时回 `{ answers: [] }`：插件会把它判成"没答"（见 parseAnswer 的
      // "每道题都必须有答复"），于是模型拿到一条明确的"用户没有回答"。
      await sendJson(res, 200, answers === null ? { answers: [] } : answers)
    }
    return
  }

  // 用户在卡片上的答复（浏览器 → 这里）
  if (req.method === 'POST' && parts.length === 4 && parts[0] === 'agent-api'
    && parts[1] === 'questions' && parts[3] === 'answer') {
    const questionId = parts[2]
    const entry = pendingQuestions.get(questionId)
    if (entry === undefined) {
      // 已经超时、已经被答复过、或者插件已经不等了。
      await sendJson(res, 404, { error: '这个问题不存在或已过期' })
      return
    }
    const body = await readJson(req, MAX_BODY_BYTES)
    if (!Array.isArray(body.answers)) {
      await sendJson(res, 400, { error: 'answers 必须是数组' })
      return
    }
    // 只做**形状**校验（内容合法性由插件侧 `parseAnswer` 把关，那里才知道
    // 每道题给过哪些选项）。但"每道题都要有答复"在这里也查一次：
    // 让用户看到 400 比让模型拿到半份答复好。
    const answered = new Set()
    for (const item of body.answers) {
      if (item === null || typeof item !== 'object') {
        await sendJson(res, 400, { error: 'answers 里有一项不是对象' })
        return
      }
      const id = typeof item.id === 'string' ? item.id : ''
      const asked = entry.questions.find(q => q.id === id)
      if (id === '' || asked === undefined) {
        await sendJson(res, 400, { error: `答复里有没问过的问题 id：${JSON.stringify(item.id)}` })
        return
      }
      const selected = item.selected
      if (!Array.isArray(selected) || selected.some(label => typeof label !== 'string')) {
        await sendJson(res, 400, { error: `答复「${id}」的 selected 不是字符串数组` })
        return
      }
      if ((asked.multiSelect ?? false) === false && selected.length > 1) {
        await sendJson(res, 400, { error: `「${id}」是单选，却收到了 ${selected.length} 个选项` })
        return
      }
      /*
       * **一道题必须有实质答复**：选了选项，或者自己写了非空白的字。
       *
       * 这条在插件侧（`channel.ts` 的 `parseAnswer`）也查一遍，这里再查是刻意的：
       * 不查的话，一个 `custom: "   "` 的空答复会被**当成有效答复结算掉**——
       * 问题关闭、模型收到一份什么都没说的答案，而用户在界面上看到的
       * 可能只是"提交没反应"。实测踩到：正是因为这个漏洞，紧跟在后面的
       * 正常答复会拿到 404（问题已经被空白答复消费了）。
       */
      const custom = typeof item.custom === 'string' ? item.custom : ''
      if (selected.length === 0 && custom.trim() === '') {
        await sendJson(res, 400, { error: `「${id}」这道题既没选也没填` })
        return
      }
      answered.add(id)
    }
    const missing = entry.questions.filter(q => !answered.has(q.id)).map(q => q.id)
    if (missing.length > 0) {
      await sendJson(res, 400, { error: `还有题目没答：${missing.join(', ')}` })
      return
    }
    settleQuestion(questionId, { answers: body.answers })
    await sendJson(res, 200, { ok: true })
    return
  }

  /* ---------------------------------------------------------------- 语音 */

  // 语音转文字：浏览器把录下来的音频整段发过来，这里换成文字还回去。
  //
  // 音频**不落盘、不留存**：只在内存里过一道就交给上游。银行场景里录音是敏感数据，
  // 而演示服务没有任何理由留着它。
  if (req.method === 'POST' && parts.join('/') === 'agent-api/asr') {
    if (!VOICE_ENABLED) {
      await sendJson(res, 503, { error: '这个演示服务没有开语音能力' })
      return
    }
    const body = await readJson(req, MAX_AUDIO_BYTES)
    const base64 = typeof body.audio === 'string' ? body.audio : ''
    if (base64 === '') {
      await sendJson(res, 400, { error: 'audio 不能为空（base64）' })
      return
    }
    const format = audioFormatOf(body.mimeType)
    if (format === undefined) {
      // 不猜格式：猜错的话上游会拿错误的解码方式解，可能返回一段"成功但乱码"的转录。
      await sendJson(res, 415, {
        error: `不认识的录音格式：${String(body.mimeType)}`,
        accepted: [...new Set(AUDIO_FORMATS.values())],
      })
      return
    }
    const upstream = await callVoiceUpstream('/audio/transcriptions', {
      model: ASR_MODEL,
      input_audio: { data: base64, format },
      // 中文场景固定传语言提示：短句子里靠自动检测容易飘。
      language: typeof body.language === 'string' ? body.language : 'zh',
    })
    const text = await upstream.text()
    if (!upstream.ok) {
      await sendJson(res, 502, { error: `转录失败（上游 ${upstream.status}）：${text.slice(0, 200)}` })
      return
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      await sendJson(res, 502, { error: '转录服务返回了非 JSON 内容' })
      return
    }
    await sendJson(res, 200, {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      seconds: parsed.usage?.seconds ?? null,
      cost: parsed.usage?.cost ?? null,
    })
    return
  }

  // 文字转语音（**流式**）：SSE 一帧一帧推裸 PCM，浏览器首帧到达就能出声，
  // 不用等整段合成完。事件形状见 design/P8-VOICE.md。
  if (req.method === 'POST' && parts.join('/') === 'agent-api/tts/stream') {
    if (!VOICE_ENABLED) {
      await sendJson(res, 503, { error: '这个演示服务没有开语音能力' })
      return
    }
    const body = await readJson(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (text === '') {
      await sendJson(res, 400, { error: 'text 不能为空' })
      return
    }
    // 与整段合成同一条截断规则：按字数计费，长回复也念不完。
    const spoken = text.length > TTS_MAX_CHARS ? text.slice(0, TTS_MAX_CHARS) : text
    const speaker = typeof body.voice === 'string' && body.voice !== '' ? body.voice : VOLC_SPEAKER

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-accel-buffering': 'no',
    })
    res.flushHeaders()
    // 先告诉浏览器这是什么格式，之后每个 audio 事件都是这个采样率的裸 PCM16
    res.write(`event: start\ndata: ${JSON.stringify({ format: 'pcm', sampleRate: VOLC_SAMPLE_RATE })}\n\n`)

    const ac = new AbortController()
    // 浏览器断开 → 掐掉上游，别让一次没人听的合成白烧钱
    // （用 res 的 close 并区分"正常回完"，跟确认通道同一套做法：req 的 close 在读完 body 后就来了）
    const onClose = () => {
      if (!res.writableEnded) ac.abort()
    }
    res.on('close', onClose)

    try {
      const stats = await streamVolcTTS({
        text: spoken,
        speaker,
        sampleRate: VOLC_SAMPLE_RATE,
        resourceId: VOLC_RESOURCE,
        apiKey: VOLC_API_KEY,
        appId: VOLC_APP_ID,
        accessToken: VOLC_ACCESS_TOKEN,
        onAudio: (buf) => {
          if (!res.writableEnded) res.write(`event: audio\ndata: ${buf.toString('base64')}\n\n`)
        },
        onEvent: (parsed, json) => {
          // 句起止：现在只做日志与未来字幕的素材，浏览器可以忽略
          if (!res.writableEnded && (parsed.event === 350 || parsed.event === 351)) {
            res.write(`event: sentence\ndata: ${JSON.stringify({ type: parsed.event === 350 ? 'start' : 'end', text: json?.text ?? '' })}\n\n`)
          }
        },
        signal: ac.signal,
        timeoutMs: TTS_STREAM_TIMEOUT_MS,
        idleMs: TTS_STREAM_IDLE_MS,
      })
      if (!res.writableEnded) {
        res.write(`event: end\ndata: ${JSON.stringify({ frames: stats.frames, bytes: stats.bytes, truncated: spoken.length < text.length })}\n\n`)
        res.end()
      }
    } catch (err) {
      if (res.writableEnded) return
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'aborted') {
        // 客户端自己断的：静默收场，不算失败
        res.end()
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
        res.end()
      }
    } finally {
      ac.abort()
      res.off('close', onClose)
    }
    return
  }

  // 文字转语音：直接回**原始音频字节**（不是 JSON），与上游一致。
  if (req.method === 'POST' && parts.join('/') === 'agent-api/tts') {
    if (!VOICE_ENABLED) {
      await sendJson(res, 503, { error: '这个演示服务没有开语音能力' })
      return
    }
    const body = await readJson(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (text === '') {
      await sendJson(res, 400, { error: 'text 不能为空' })
      return
    }
    // 按字数计费，长回复也念不完：截断而不是拒绝——用户要的是"听到要点"。
    const spoken = text.length > TTS_MAX_CHARS ? text.slice(0, TTS_MAX_CHARS) : text
    const upstream = await callVoiceUpstream('/audio/speech', {
      model: TTS_MODEL,
      input: spoken,
      voice: typeof body.voice === 'string' && body.voice !== '' ? body.voice : TTS_VOICE,
      response_format: 'mp3',
    })
    if (!upstream.ok) {
      const detail = await upstream.text()
      await sendJson(res, 502, { error: `合成失败（上游 ${upstream.status}）：${detail.slice(0, 200)}` })
      return
    }
    const audio = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(200, {
      'content-type': 'audio/mpeg',
      'content-length': audio.length,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      // 让页面知道念的是不是完整文本（被截断时好提示）。
      'x-luckycat-truncated': spoken.length < text.length ? '1' : '0',
    })
    res.end(audio)
    return
  }

  // 确认通道（agent 插件 → 这里，长轮询）
  if (OPS_MODE && req.method === 'POST' && url.pathname.startsWith('/internal/ops-tool/')) {
    const operation = parts[2]
    if (!['prepare', 'consume', 'result'].includes(operation)) throw bankError('未知运维检查接口', 404)
    await sendJson(res, 200, await opsGate[operation](await readJson(req)))
    return
  }
  if (req.method === 'POST' && url.pathname === '/consent/challenge') {
    let challenge = await readJson(req)
    if (OPS_MODE && OPS_NATIVE_TOOLS.includes(challenge.toolName)) challenge = await opsGate.challenge(challenge)
    else if (HTTP_BANK) challenge = await bankAgent.prepare(challenge)
    let imQueryAuthorized = false
    try { imQueryAuthorized = imBank && await imBank.authorizeQuery(challenge, bankAgent.approveRoutineQuery) }
    catch (error) { bankAgent.forget(challenge); throw error }
    if (imQueryAuthorized) {
      try { await publish(challenge.sessionId, { type: 'im-query-authorized', challengeId: challenge.challengeId, toolName: challenge.toolName }) }
      catch (error) { bankAgent.forget(challenge); throw error }
      await sendJson(res, 200, { decision: 'approve', challengeId: challenge.challengeId })
      return
    }
    if (typeof challenge.challengeId !== 'string' || challenge.challengeId === '') {
      await sendJson(res, 400, { error: 'challenge 缺少 challengeId' })
      return
    }
    const answer = await new Promise((resolvePromise) => {
      const id = challenge.challengeId
      const timer = setTimeout(() => {
        pendingConsents.delete(id)
        if (OPS_MODE && OPS_NATIVE_TOOLS.includes(challenge.toolName)) opsGate.forget(challenge)
        else if (HTTP_BANK) bankAgent.forget(challenge)
        publish(challenge.sessionId, { type: 'consent-resolved', challengeId: id, decision: 'timeout' })
        resolvePromise({ decision: 'reject', challengeId: id })
      }, CONSENT_TIMEOUT_MS)
      // 插件侧放弃了等待（自身超时，或会话被取消）→ 立刻把挑战摘掉。
      // 不做这一步的话，用户过一会儿再点"确认"会拿到 200，却什么都不会发生
      // ——因为 agent 早就不等了。这是实测踩到的。
      //
      // **必须监听 `res` 而不是 `req`**：请求体读完之后 `req` 的 'close' 早就发过了
      // （Node 的语义是"请求流已结束"，不是"对端断开"），挂在 req 上的清理永远不会触发。
      // `res` 的 'close' 在两处都会来，所以用 `writableEnded` 区分"正常回完"与"对端断了"。
      const onClose = () => {
        if (res.writableEnded) return
        if (!pendingConsents.has(id)) return
        clearTimeout(timer)
        pendingConsents.delete(id)
        if (OPS_MODE && OPS_NATIVE_TOOLS.includes(challenge.toolName)) opsGate.forget(challenge)
        else if (HTTP_BANK) bankAgent.forget(challenge)
        publish(challenge.sessionId, { type: 'consent-resolved', challengeId: id, decision: 'abandoned' })
        resolvePromise({ decision: 'reject', challengeId: id })
      }
      res.on('close', onClose)
      pendingConsents.set(id, { challenge, resolve: resolvePromise, timer })
      // 把挑战推给网页：这就是"展示交易信息"那一步。
      publish(challenge.sessionId, { type: 'consent', challenge })
    })
    // 客户端已经断开时不能再写响应（会抛写入已结束）。
    if (!res.writableEnded && !res.destroyed) await sendJson(res, 200, answer)
    return
  }

  // ── 占位银行后端（`/api/*`）──────────────────────────────────────────
  // 把前端那份 mock 挂到 HTTP 上，给安卓端（以及将来的真后端）提供银行数据。
  // 见 `bridge/demo-bank.mjs` 的说明。
  //
  // **懒加载 + fail-soft**：它要现场转译前端的 TS，失败的可能性是存在的
  // （app 源码没同步过去、typescript 没装…）。而 agent（`/agent-api/*`）才是
  // 这个服务的主业，**绝不能因为银行数据起不来就一起挂掉**，所以这里
  // 捕获失败、`/api/*` 回 503，其余接口照常。
  if (url.pathname.startsWith('/api/')) {
    if (HTTP_BANK) { await sendJson(res, 404, { error: '银行接口请使用独立银行服务' }); return }
    const bank = await demoBank()
    if (bank === null) {
      await sendJson(res, 503, {
        message: `占位银行后端不可用：${demoBankFailure?.message ?? '未知原因'}`,
        code: 'DEMO_BANK_UNAVAILABLE',
      })
      return
    }
    await bank.handle(req, res, url)
    return
  }

  await sendJson(res, 404, { error: `未知路径：${req.method} ${url.pathname}` })
}

async function createWebSession(identity, context) {
  if (HTTP_BANK) makeSessionRoom(identity.user.id)
  const sessionId = `web-${randomUUID()}`
  const entry = sessionOf(sessionId)
  if (identity) { entry.ownerId = identity.user.id; entry.bankToken = identity.token }
  entry.legacyContext = context
  await sessionStore?.save(entry)
  return sessionId
}

async function stopSession(sessionId) {
  const entry = sessions.get(sessionId)
  if (!entry?.busy) return
  if (entry.stopTask) return entry.stopTask
  entry.stopping = true
  entry.activity.cancelled = true
  entry.assistantStream?.stop()
  bankAgent?.forgetSession(entry.id)
  opsGate?.forgetSession(entry.id)
  entry.stopTask = (async () => {
    for (let i = 0; i < 100 && entry.busy; i++) {
      try {
        if ((await harness?.client.request('luckycat.cancel', { sessionId: entry.id, token: INTERNAL_TOKEN }, 2000))?.cancelled) break
      } catch { /* Runtime may still be starting. */ }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    for (const [id, pending] of pendingConsents) if (pending.challenge.sessionId === entry.id) settleConsent(id, { decision: 'reject', challengeId: id })
    for (const [id, pending] of pendingQuestions) if (pending.sessionId === entry.id) settleQuestion(id, undefined)
  })().finally(() => { entry.stopTask = undefined })
  return entry.stopTask
}

// IM 在客户演示（customer）与员工（staff）两套进程各自启用，互不共享 store；
// ops 运行时不开 IM。客户侧走微信/企微两条渠道，员工侧只用企微（运维先行创建机器人）。
if (!OPS_MODE && process.env.LUCKYCAT_IM_ENABLED === '1') {
  if (!HTTP_BANK) throw Error('IM requires the authenticated bank HTTP mode')
  const directory = join(SESSION_DIR, 'im')
  const store = await openImStore(join(directory, STAFF_MODE ? 'staff-bindings.enc.json' : 'bank-bindings.enc.json'), process.env.LUCKYCAT_IM_DATA_KEY ?? process.env.LUCKYCAT_SESSION_DATA_KEY)
  if (!STAFF_MODE && process.env.LUCKYCAT_IM_REMINDERS_ENABLED === '1') await migrateImBindingRevisions(store)
  imBank = createImBank({
    store, publicUrl: process.env.LUCKYCAT_IM_PUBLIC_URL ?? `http://127.0.0.1:${PORT}`,
    staff: STAFF_MODE, portalPath: STAFF_MODE ? '/staff/im' : undefined,
    createSession: identity => createWebSession(identity), current: id => bankAgent.current(id), cancel: stopSession,
    run: (id, text) => {
      const entry = sessions.get(id)
      if (!entry || entry.busy || entry.stopTask || shuttingDown) throw bankError('会话正在处理其他请求，请稍后重试', 409)
      const preamble = STAFF_MODE
        ? '【可信渠道：已绑定的企业微信私聊。按该员工的工作台权限办理；敏感操作仍须在员工页面授权。】\n'
        : '【可信渠道：已绑定的 IM 私聊。普通只读查询由服务端校验登录与归属后执行，不要求用户重复登录或点击查询确认；写操作与敏感卡信息仍须在银行页面授权。】\n'
      const turn = runTurn(id, preamble + (STAFF_MODE ? '' : serviceSkillContext(undefined)) + text)
      activeTurns.add(turn)
      void turn.finally(() => activeTurns.delete(turn)).catch(() => {})
      return turn
    },
    deliver: (route, text) => imChannels.deliver(route, text),
    onBindingChange: id => imReminders?.invalidateRoute(id),
  })
  imChannels = await createImChannels({ directory, credentials: store.credentials, harness: imBank.harness })
  imHttp = createImHttp({ bank: imBank, channels: imChannels, bankUrl: process.env.LUCKYCAT_BANK_URL ?? 'http://127.0.0.1:8080', reminders: () => imReminders, staff: STAFF_MODE })
  await imChannels.initialize()
  if (!STAFF_MODE && process.env.LUCKYCAT_IM_REMINDERS_ENABLED === '1') {
    imReminders = await createBankReminders({ directory: join(SESSION_DIR, 'bank-workbench'), routes: () => imBank.reminderRoutes(), ready: route => imChannels.reminderReady(route), deliver: (route, text, options) => imChannels.deliver(route, text, options) })
    imReminders.start()
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[demo-server] http://127.0.0.1:${PORT}`)
  console.log(`[demo-server] DSH_HOME=${home}`)
  console.log(`[demo-server] provider=${PROVIDER} model=${MODEL}`)
  if (ACCESS_TOKEN !== '') console.log('[demo-server] 已启用访问口令（x-luckycat-token）')
  if (imHttp) console.log(`[demo-server] IM 管理与银行确认入口：http://127.0.0.1:${PORT}/agent-api/im`)
})

/** 优雅退出：结束所有待确认事项与 SSE 连接，再关 harness。 */
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  eventPolling.close()
  bankAgent?.close()
  opsGate?.close()
  for (const entry of sessions.values()) if (entry.busy) {
    entry.stopping = true
    entry.activity.cancelled = true
    entry.assistantStream?.stop()
    publish(entry.id, { type: 'session-restored', interrupted: true })
  }
  for (const challengeId of pendingConsents.keys()) settleConsent(challengeId, { decision: 'reject', challengeId })
  for (const id of pendingQuestions.keys()) settleQuestion(id, undefined)
  for (const subscribers of streams.values()) {
    for (const res of subscribers) res.end()
  }
  streams.clear()
  server.close()
  try {
    await imReminders?.close()
    await imBank?.close()
    if (harness !== undefined) await harness.close()
    await Promise.allSettled(activeTurns)
    await imChannels?.close()
  } finally {
    try { await sessionStore?.close() }
    finally { await rm(controlDir, { recursive: true, force: true }) }
  }
}

const stopProcess = () => { void shutdown().then(() => process.exit(0), () => { console.error('[demo-server] Shutdown did not complete cleanly'); process.exit(1) }) }
process.on('SIGINT', stopProcess)
process.on('SIGTERM', stopProcess)
