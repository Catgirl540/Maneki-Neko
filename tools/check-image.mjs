/**
 * 发图功能的检查：从「用户选了一张图」到「助手真的看见了这张图」。
 *
 * 分两段，因为这条链上有两个**各自会独立出错**的地方：
 *
 *   A. **服务端**（`framework/bridge/demo-server.mjs`）
 *      校验、按账户隔离归档、以及最要紧的那条：图片真的进了模型上下文。
 *      这一段打的是 `/agent-api`（走 vite 代理，顺带验代理）。
 *   B. **界面**（`app/src/pages/SupportPage.tsx`）
 *      选图 → 预览 → 移除 → 发送 → 气泡里显示缩略图。
 *
 * 这一段的**核心断言**是 A5：发一张「上半红、下半蓝」的图，问助手什么颜色。
 * 它不可能靠巧合通过——只有像素真的到了模型那里才答得出来。
 * 之前那版把路径写进提示词、叫 agent 用 `read` 去读，而 `read` 是读文本的，
 * 模型拿到的是乱码；这条断言就是用来钉死那个回归的。
 *
 *   node tools/check-image.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { login } from './lib/session.mjs'
import { readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'
const API = `${BASE}/agent-api`
/**
 * 直连演示服务的地址。
 *
 * 为什么有的用例要绕开代理：vite 的 dev 代理对请求体有自己的上限，
 * 7MB 的 body 会被**代理**先挡掉（回 502），根本到不了服务端——
 * 那样测到的是"代理拒绝了大请求"，不是"服务端把过大的图拒了"。
 * 所以体积上限那条走直连。
 */
const API_DIRECT = process.env.LUCKCAT_AGENT_DIRECT ?? 'http://127.0.0.1:8788/agent-api'
/** 服务端归档目录（框架仓库内，gitignored）。 */
const UPLOAD_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'framework', '.dsh-home', 'uploads',
)
/**
 * 隔离检查用的两个账户。
 *
 * 用**专用的**账户名而不是演示账户 `u_0001`/`u_0002`：这条检查要断言
 * "A 目录里没有 B 传的内容"，而演示账户的目录里混着别的检查留下的文件，
 * 断言会变成看运气。专用账户只被这条检查写，内容完全可预测。
 */
const ACCOUNT_A = 'u_gate_iso_a'
const ACCOUNT_B = 'u_gate_iso_b'

async function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const dirs = (await readdir(cache)).filter((d) => d.startsWith('chromium-'))
  return path.join(cache, dirs.sort().at(-1), 'chrome-linux64', 'chrome')
}

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/** 造一张上下两色的 PNG（纯 Node，不依赖任何图像库）。 */
function makePng(top, bottom) {
  const size = 64
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0 // 每行的 filter type
    offset += 1
    const rgb = y < size / 2 ? top : bottom
    for (let x = 0; x < size; x += 1) {
      raw[offset] = rgb[0]
      raw[offset + 1] = rgb[1]
      raw[offset + 2] = rgb[2]
      offset += 3
    }
  }
  const chunk = (type, payload) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(payload.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), payload])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let crcTable
function crc32(buffer) {
  if (crcTable === undefined) {
    crcTable = []
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return crc ^ 0xffffffff
}

/** 打开一条 SSE，把事件收进数组，返回 {events, close}。 */
async function openStream(sessionId) {
  const controller = new AbortController()
  const events = []
  const done = (async () => {
    try {
      const res = await fetch(`${API}/sessions/${encodeURIComponent(sessionId)}/stream`, { signal: controller.signal })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done: finished } = await reader.read()
        if (finished) break
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const line = block.split('\n').find(l => l.startsWith('data:'))
          if (line === undefined) continue
          try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* 坏事件忽略 */ }
        }
      }
    } catch { /* abort 时的正常路径 */ }
  })()
  return { events, close: () => { controller.abort(); return done } }
}

/** 发一条消息。 */
function postMessage(sessionId, body, endpoint = API) {
  return fetch(`${endpoint}/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/* ─────────────────────────── A. 服务端 ─────────────────────────── */

const png = makePng([220, 30, 30], [30, 60, 220])
const pngBase64 = png.toString('base64')
/** 第二张图内容完全不同：用来验账户隔离（内容寻址下，不同内容 = 不同文件名）。 */
const pngOther = makePng([30, 200, 60], [230, 210, 40])
const pngPath = path.join(os.tmpdir(), 'luckycat-half-red-blue.png')
await writeFile(pngPath, png)
/** 归档文件名 = 内容哈希前 16 位 + 扩展名（和服务端同一套算法）。 */
const nameOf = (buffer) => `${createHash('sha256').update(buffer).digest('hex').slice(0, 16)}.png`

console.log('== A. 服务端：校验 → 归档 → 真的进模型 ==')

/*
 * **先清场**，否则隔离那两条断言是假的。
 *
 * 这是变异测试抓出来的：把服务端的账户隔离去掉之后，A6/A7 **照样通过**——
 * 因为上一次跑对了的那一轮把文件留在了 `uploads/u_gate_iso_a/` 里，
 * 断言读到的是**历史残留**而不是这一轮的结果。
 * 门禁必须自己保证前置状态，不能依赖"上次是对的"。
 */
for (const account of [ACCOUNT_A, ACCOUNT_B]) {
  await rm(path.join(UPLOAD_ROOT, account), { recursive: true, force: true })
}

{
  // A1 · 没有 accountId → 400（图片必须能归属到某个账户）
  const res = await postMessage('s-img-gate', { text: 'x', image: { data: pngBase64, mimeType: 'image/png' } })
  report(res.status === 400, 'A1 缺 accountId 被拒（400）', [`实际 ${res.status}`])
}
{
  // A2 · 路径穿越的 accountId → 400（这条挡的是「图片写到上传目录之外」）
  const res = await postMessage('s-img-gate', {
    text: 'x', image: { data: pngBase64, mimeType: 'image/png' }, accountId: '../../etc',
  })
  report(res.status === 400, 'A2 路径穿越的 accountId 被拒（400）', [`实际 ${res.status}`])
}
{
  // A3 · 不认识的类型 → 415，并且把认哪些告诉调用方
  const res = await postMessage('s-img-gate', {
    text: 'x', image: { data: pngBase64, mimeType: 'image/tiff' }, accountId: 'u_0001',
  })
  const body = await res.json().catch(() => ({}))
  report(
    res.status === 415 && Array.isArray(body.accepted) && body.accepted.includes('image/png'),
    'A3 不认识的图片类型被拒（415，并回报 accepted 列表）',
    [`实际 ${res.status} accepted=${JSON.stringify(body.accepted)}`],
  )
}
{
  /*
   * A4 · 太大 → 413。用 7MB 的假 base64 触发上限（服务端按 base64 长度判，不解码）。
   * 这条走**直连**：走代理的话先被 vite 挡成 502，测不到服务端自己的上限。
   */
  const huge = 'A'.repeat(7 * 1024 * 1024)
  const res = await postMessage('s-img-gate', {
    text: 'x', image: { data: huge, mimeType: 'image/png' }, accountId: 'u_0001',
  }, API_DIRECT)
  report(res.status === 413, 'A4 超过体积上限被拒（413，直连服务端）', [`实际 ${res.status}`])
}
{
  /*
   * A5 · **核心**：真发一张「上半红、下半蓝」的图，问助手颜色。
   * 只有像素真的进了模型上下文才答得出来。
   * 用一次性的会话 id，避免和别的检查互相污染上下文。
   */
  const session = `s-img-gate-${Date.now()}`
  const stream = await openStream(session)
  await new Promise(r => setTimeout(r, 400))
  const res = await postMessage(session, {
    text: '这张图上半部分和下半部分分别是什么颜色？只答颜色，不要解释。',
    image: { data: pngBase64, mimeType: 'image/png' },
    accountId: ACCOUNT_A,
  })
  report(res.status === 202, 'A5a 带图消息被接受（202）', [`实际 ${res.status}`])

  const deadline = Date.now() + 120_000
  let answer = ''
  while (Date.now() < deadline) {
    const assistant = stream.events.filter(e => e.type === 'assistant').map(e => e.text).join('\n')
    if (assistant !== '' && stream.events.some(e => e.type === 'status' && e.status === 'idle')) {
      answer = assistant
      break
    }
    const error = stream.events.find(e => e.type === 'error')
    if (error !== undefined) { answer = `[错误] ${error.message}`; break }
    await new Promise(r => setTimeout(r, 1000))
  }
  await stream.close()

  const saysRed = /红/.test(answer)
  const saysBlue = /蓝/.test(answer)
  report(
    saysRed && saysBlue,
    'A5b 助手答出了图里的红与蓝（图片真的到了模型）',
    [`回答：${answer.trim().slice(0, 120) || '(空)'}`],
  )
}
{
  // A6 · 归档：落在**本账户目录**里，权限 0600，文件名是内容哈希
  const expected = nameOf(png)
  const target = path.join(UPLOAD_ROOT, ACCOUNT_A, expected)
  const info = await stat(target).catch(() => undefined)
  const mode = info === undefined ? '' : (info.mode & 0o777).toString(8)
  report(
    info !== undefined && mode === '600',
    'A6 图片按内容哈希归档在本账户目录内，权限 0600',
    [`${ACCOUNT_A}/${expected} 权限 ${mode || '(不存在)'}`],
  )
}
{
  /*
   * A7 · 账户隔离：给**另一个账户**发一张**内容不同**的图，
   * 然后断言两个目录里各自只有自己那张、都没有对方那张。
   *
   * 第一版这条断言写错了：它拿同一个文件名的图片去比，而内容是寻址的，
   * 同一张图在两个目录里**本来就**同名——那样判"串号"是假失败。
   * 真正要钉的是"一个账户的目录里不会出现另一个账户传的内容"。
   */
  const expectedA = nameOf(png)
  const expectedB = nameOf(pngOther)
  const stream = await openStream(`s-img-gate-b-${Date.now()}`)
  await new Promise(r => setTimeout(r, 400))
  const res = await postMessage(`s-img-gate-b-${Date.now()}`, {
    text: '这张图什么颜色？一句话。',
    image: { data: pngOther.toString('base64'), mimeType: 'image/png' },
    accountId: ACCOUNT_B,
  })
  // 等归档落盘（服务端是写文件之后才入队的，202 时应当已经写完，这里留一点余量）
  await new Promise(r => setTimeout(r, 1500))
  await stream.close()

  const dirA = await readdir(path.join(UPLOAD_ROOT, ACCOUNT_A)).catch(() => [])
  const dirB = await readdir(path.join(UPLOAD_ROOT, ACCOUNT_B)).catch(() => [])
  const ok = res.status === 202
    && dirA.includes(expectedA) && !dirA.includes(expectedB)
    && dirB.includes(expectedB) && !dirB.includes(expectedA)
  report(ok, 'A7 两个账户各发不同的图：各自目录里只有自己那张，没有对方那张', [
    `A 目录含自己的=${dirA.includes(expectedA)} 含对方的=${dirA.includes(expectedB)}`,
    `B 目录含自己的=${dirB.includes(expectedB)} 含对方的=${dirB.includes(expectedA)}`,
  ])
}

/* ─────────────────────────── B. 界面 ─────────────────────────── */

console.log('\n== B. 界面：选图 → 预览 → 移除 → 发送 ==')

const browser = await chromium.launch({ executablePath: await findChrome() })
try {
  const page = await browser.newPage()
  await login(page, BASE, { to: '/support' })

  const attach = page.getByRole('button', { name: '发送图片' })
  // 等它真的渲染出来再数：`login` 回到 /support 的那一刻组件树还没铺完，
  // 直接 count() 会数到 0（这是实测踩到的假失败）。
  await attach.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
  report(await attach.count() === 1, 'B1 输入区有「发送图片」按钮', [`实际 ${await attach.count()} 个`])

  // B2 · 选图之后出现预览 + 敏感信息提示
  await page.locator('[data-image-input]').setInputFiles(pngPath)
  const preview = page.locator('[data-pending-image]')
  await preview.waitFor({ state: 'visible', timeout: 15_000 })
  const hint = await page.getByText('这张图会进助手的上下文').count()
  report(await preview.count() === 1, 'B2 选图之后出现预览缩略图')
  report(hint === 1, 'B3 预览条上有「图片会进助手上下文」的提示')

  // B4 · 能移除
  await page.getByRole('button', { name: '移除已选图片' }).click()
  await preview.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
  report(await page.locator('[data-pending-image]').count() === 0, 'B4 「移除」能把待发的图片清掉')

  // B5 · 真的发出去，用户气泡里出现图片
  await page.locator('[data-image-input]').setInputFiles(pngPath)
  await page.locator('[data-pending-image]').waitFor({ state: 'visible', timeout: 15_000 })
  // `exact: true` 必须加：默认是子串匹配，'发送' 会同时命中「发送图片」那个按钮。
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const sent = page.locator('[data-sent-image]')
  await sent.waitFor({ state: 'visible', timeout: 20_000 })
  report(await sent.count() === 1, 'B5 发送后用户气泡里显示了这张图')

  // B6 · 存档里存的是**缩略图**，不是原图：一张原图 base64 有 3 万多字节，
  //      存档总盘只有 2MB，存原图几张就撑爆，历史会开始整段丢。
  const stored = await page.evaluate(() => {
    const raw = window.localStorage.getItem('luckycat.agent.sessions.v1')
    return raw ?? ''
  })
  const thumbs = [...stored.matchAll(/"thumb":"(data:image\/[a-z]+;base64,[^"]*)"/g)].map(m => m[1])
  const biggest = thumbs.reduce((max, t) => Math.max(max, t.length), 0)
  report(
    thumbs.length >= 1 && biggest < 20_000,
    'B6 存档里存的是缩略图（小于 20KB），不是原图',
    [`缩略图 ${thumbs.length} 张，最大 ${biggest} 字节；存档总长 ${stored.length}`],
  )

  await page.close()
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\ncheck-image: 全部通过' : `\ncheck-image: ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
