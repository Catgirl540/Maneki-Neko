/**
 * 语音模式的浏览器检查。
 *
 * 覆盖的是**接线**：按下去有没有真的开始录、松开有没有真的发转录请求、
 * 转录出来的话有没有真的发进对话、回复有没有真的去合成并播放、
 * 打断按钮有没有用、服务端没开语音时按钮会不会出现。
 *
 * 刻意**不**做的事：
 *   · 不测识别准不准 —— 麦克风是 Chromium 的假设备（一段固定音调），
 *     真音频的往返在 `framework/scripts/e2e-consent.sh` 里用合成的语音测。
 *   · 不测合成音质 —— 那要人听。
 *
 * 所以这里把 `/asr` 用 route 换成固定回答：**接线**和**识别**是两件事，
 * 混在一起测的结果是两个都不稳。
 *
 * 需要两个服务在跑：
 *   1. agent 演示服务：node framework/bridge/demo-server.mjs
 *   2. 前端 dev server：cd app && npm run dev
 *
 *   node tools/check-voice.mjs
 *   node tools/check-voice.mjs --base http://127.0.0.1:5180
 */

import { chromium } from 'playwright-core'
import { login as loginWithCode, gotoInApp } from './lib/session.mjs'
import { startTtsFixture } from './lib/ttsFixture.mjs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const BASE = baseIndex >= 0 ? args[baseIndex + 1] : 'http://127.0.0.1:5180'

let failures = 0
const ok = (title) => console.log(`PASS  ${title}`)
const bad = (title, detail = '') => {
  failures += 1
  console.log(`FAIL  ${title}${detail === '' ? '' : `\n      ${detail}`}`)
}

async function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const dirs = (await readdir(cache)).filter((d) => d.startsWith('chromium-'))
  if (!dirs.length) throw new Error('没找到 playwright 的 chromium')
  return path.join(cache, dirs.sort().at(-1), 'chrome-linux64', 'chrome')
}

/** 注入登录态并清掉本地对话。 */
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.removeItem('luckycat.agent.sessions.v1')
    localStorage.removeItem('luckycat.ui.agentHistoryOpen')
  })
  /*
   * 登录态**不再写 localStorage**——现在只在内存里（见 app/src/lib/authToken.ts），
   * 所以这里走真实的登录流程：手机号 + 密码 + 短信验证码。
   * 上面那些 removeItem 仍然必要，而且**必须在登录之前**做：登录助手会直接
   * 把我们送到目标页，那之后这一页就已经读过一次本地记录了。
   */
  await loginWithCode(page, BASE, { to: '/support' })
}

/** 读进度条的位置；拿不到（比如刚播完收走）返回 null，不抛异常。 */
async function trackBox(track) {
  try {
    return await track.boundingBox({ timeout: 5_000 })
  } catch {
    return null
  }
}

/** 读流式播放器的状态（`window.__voicePlay`，见 `lib/streamPlayer.ts`）。 */
async function readPlay(page) {
  return await page.evaluate(() => {
    const p = window.__voicePlay
    return p === undefined ? null : {
      state: p.state,
      position: p.position,
      duration: p.duration,
      generation: p.generation,
      samples: p.samples,
      playing: p.playing,
    }
  })
}

/**
 * 预置一段**确定的**对话，然后重新登录进页面，返回那条助手消息的定位器。
 *
 * 为什么不用模型的真实回复：这一整段（波形、进度、缓存、停止、seek）要的是
 * **确定的文本**——模型每次说的话长短不一，实测踩到过"同一段文字念第二次"
 * 其实去合成了另一句话，看起来像缓存坏了。预置走的是应用自己的存档格式
 * （`luckycat.agent.sessions.v1`），没给测试开任何后门。
 */
async function seedAndOpen(page, text) {
  await page.evaluate((value) => {
    const now = Date.now()
    localStorage.setItem('luckycat.agent.sessions.v1', JSON.stringify([
      {
        id: 'c_seed0001',
        title: '预置对话',
        createdAt: now,
        updatedAt: now,
        items: [{ kind: 'assistant', id: 'm_seed1', text: value }],
      },
    ]))
  }, text)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await loginWithCode(page, BASE, { to: '/support' })
  await page.locator('[data-agent-status="ready"]').waitFor({ state: 'visible', timeout: 20_000 })
  const rows = page.locator('[data-message-kind="assistant"]')
  const id = await rows.last().getAttribute('data-message-id')
  return page.locator(`[data-message-id="${id}"]`)
}

/**
 * 把流式合成接到本地夹具上。
 *
 * 用 `route.continue` **换掉目标地址**（而不是 `fulfill` 一次性交回响应体）：
 * 只有让帧**一帧一帧**地到，才测得出"首帧先响、后面的慢慢来"。
 */
async function routeStream(page, fixture, query) {
  await page.unroute('**/agent-api/tts/stream')
  await page.route('**/agent-api/tts/stream', async (route) => {
    await route.continue({ url: `http://127.0.0.1:${fixture.port}/stream?${query}` })
  })
}

/** 读消息上那个播放器：柱子高度、已播（金色）柱子数、进度条数值。 */
const readPlayer = (page) => page.evaluate(() => {
  const svg = document.querySelector('[data-speech-wave]')
  // 用 data 锚点，不用 role/文案：进度条的角色是 slider，按 role 找会挂。
  const bar = document.querySelector('[data-speech-progress]')
  const rects = svg === null ? [] : [...svg.querySelectorAll('rect')]
  const heights = rects.map((r) => Number(r.getAttribute('height')))
  const third = Math.floor(heights.length / 3) || 1
  const avg = (list) => (list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length)
  return {
    bars: heights.length,
    head: avg(heights.slice(0, third)),
    tail: avg(heights.slice(-third)),
    played: rects.filter((r) => (r.getAttribute('fill') ?? '').includes('gold')).length,
    now: bar === null ? null : Number(bar.getAttribute('aria-valuenow')),
    max: bar === null ? null : Number(bar.getAttribute('aria-valuemax')),
    role: bar === null ? null : bar.getAttribute('role'),
    tabIndex: bar === null ? null : bar.getAttribute('tabindex'),
  }
})

const executablePath = await findChrome()
// 假麦克风：Chromium 会喂一段固定音调，够 MediaRecorder 产出真实数据。
// `--use-fake-ui-for-media-stream` 自动答应权限弹窗，否则无人值守的检查会卡住。
const browser = await chromium.launch({
  executablePath,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN',
  permissions: ['microphone'],
})

// 流式 TTS 的本地夹具（见 tools/lib/ttsFixture.mjs）：可控的帧节奏与错误注入
const fixture = await startTtsFixture()

try {
  const page = await context.newPage()
  await login(page)

  /*
   * 这次"说"的内容，提成常量：它同时在两处被用到——mock 的 /asr 返回值，
   * 和后面"转录结果进了对话"的断言。写成两个字面量的话，改一处忘一处，
   * 断言就会拿旧文案去页面上找（实测踩到）。
   */
  const TRANSCRIPT = '你好呀'

  /* ── 先把 /asr 换掉，让「说了什么」这件事变成确定的 -------------------- */
  let asrCalls = 0
  let asrBody = null
  await page.route('**/agent-api/asr', async (route) => {
    asrCalls += 1
    try {
      asrBody = JSON.parse(route.request().postData() ?? '{}')
    } catch {
      asrBody = null
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // 这句要**刻意避开页面上任何本来就会出现的文案**（页头提示、按钮标签…）：
      // 拿它们当断言目标的话，「气泡里出现了这句话」会因为页面上本来就有而空转通过。
      // 实测踩到：/asr 一次都没调，那条断言照样 PASS。
      // （原先这里写的是"不能是快捷问题里的那几条"，快捷问题条已经按要求去掉了，
      //   但这条规矩本身仍然成立。）
      /*
       * 转录文案**必须是一句不需要调敏感工具的话**。
       *
       * 这里原来写的是「帮我看看上个月的账单明细」，那条会触发查流水的敏感操作 →
       * 运行时弹出确认卡片把工具**挂住**；而助手在等确认期间不会产出任何文本。
       * 于是下面那句「等助手真的答一句」会一直等到超时，连带后面所有关于朗读的
       * 断言全挂（实测：14 PASS 之后一连串 FAIL）。
       *
       * 以前它没暴露，是因为模型在调工具前会先说一句「我查一下。」——
       * 那句过场话恰好成了"助手回复"。后来人设加了"不要说过场话再调工具"
       * （为了让语音播放器不再闪一下就没），这个夹具就站不住了。
       *
       * 语音门禁测的是**语音接线**（录音、转录、合成、波形、缓存），
       * 不该把确认流程拖进来——那是 e2e-consent.sh 与 check-agent 的事。
       * 所以换成一句不触发任何工具的话。
       */
      body: JSON.stringify({ text: TRANSCRIPT, seconds: 1.2 }),
    })
  })

  // 应用内换页：不必再整页重载一次（原先登录态是纯内存，整页加载会把它清掉）。
  await gotoInApp(page, '/support')
  await page.locator('[data-agent-status="ready"]').waitFor({ state: 'visible', timeout: 20_000 })

  // ── 1. 服务端说有能力，页面才显示开关
  const voiceToggle = page.getByRole('button', { name: '语音', exact: true })
  if (await voiceToggle.isVisible().catch(() => false)) {
    ok('服务端报出语音能力后，页面上出现「语音」开关')
  } else {
    bad('没有「语音」开关', '确认演示服务在跑，并且没有设 LUCKYCAT_DISABLE_VOICE=1')
  }

  const micBefore = await page.getByRole('button', { name: '按住说话' }).count()
  if (micBefore === 0) ok('没开语音模式时不显示麦克风按钮（不会误触）')
  else bad('没开语音模式就显示了麦克风按钮', `找到 ${micBefore} 个`)

  // ── 2. 打开语音模式
  await voiceToggle.click()
  await page.waitForTimeout(300)
  const mic = page.getByRole('button', { name: '按住说话' })
  if (await mic.isVisible().catch(() => false)) ok('打开语音模式后出现「按住说话」按钮')
  else bad('打开语音模式后没有麦克风按钮')

  const idleBar = await page.getByText('按住麦克风说话', { exact: false }).isVisible().catch(() => false)
  if (idleBar) ok('语音状态条出现了（麦克风开没开这件事一直看得见）')
  else bad('没有语音状态条')

  // ── 3. 按住 → 录；松开 → 发转录请求
  const box = await mic.boundingBox()
  if (box === null) {
    bad('拿不到麦克风按钮的位置，后面的按下/松开测不了')
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(1800)
    const recording = await page.getByText('正在录音', { exact: false }).isVisible().catch(() => false)
    if (recording) {
      ok('按下之后进入录音状态，状态条写明「正在录音」和已录秒数')
    } else {
      bad('按下之后没有进入录音状态')
    }

    await page.mouse.up()
    // 松开 → 转录（我们 route 掉了，所以很快）→ 发进对话
    await page.getByText(TRANSCRIPT, { exact: false }).first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => ok('松开之后：转录出来的话被发进了对话（气泡里能看到）'))
      .catch(() => bad('松开之后转录结果没有进入对话'))
  }

  if (asrCalls > 0) ok(`确实调了 /asr（${asrCalls} 次）`)
  else bad('根本没有调 /asr——录音没有真的送到服务端')

  // 请求体的形状：上游要裸 base64，而且必须带 MIME（服务端按它挑解码格式）
  if (asrBody === null) {
    bad('/asr 的请求体读不出来')
  } else {
    const audio = String(asrBody.audio ?? '')
    const mime = String(asrBody.mimeType ?? '')
    if (audio.length > 100 && !audio.startsWith('data:') && !audio.includes(',')) {
      ok(`请求体里的音频是裸 base64（${audio.length} 字符，没有 data: 前缀）`)
    } else {
      bad('音频不是裸 base64', `前 40 字符：${audio.slice(0, 40)}`)
    }
    if (mime.startsWith('audio/')) ok(`请求带上了录音 MIME（${mime}）`)
    else bad('请求没有带录音 MIME', `mimeType = ${JSON.stringify(mime)}`)
  }

  /*
   * **这里不再等模型的回复。**
   *
   * 语音门禁要验的是"语音接线"：录音、转录、合成、播放、缓存、跳转。
   * 这些事**一条助手消息就该能验**，而模型回不回、回什么、什么时候回是它自己的事
   * ——实测：上游抖动时 90 秒不出一句话，整段门禁跟着挂（16 PASS / 3 FAIL）。
   * 所以下面用应用自己的存档格式预置一条确定的助手消息（见 `seedAndOpen`），
   * 从此这一段不依赖模型：确定性、零成本，也不会再因为上游抖动闪失败。
   * 真实模型对话由 `check-agent` 与 `e2e-consent.sh` 负责。
   */

  /* ── 4. 真合成（**不走夹具**）────────────────────────────────────────
     流式那条路必须用真上游验一次：事件顺序、格式宣告、音频是不是真能解出 PCM。
     夹具只能验"接线"，验不了"上游真的会说话"——音频是二进制不是 JSON，
     这一步 mock 掉就等于没测。 */
  const realStream = await page.evaluate(async () => {
    const response = await fetch('/agent-api/tts/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '余额是一万两千元。' }),
    })
    if (!response.ok) return { status: response.status, error: (await response.text()).slice(0, 200) }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let frames = 0
    let bytes = 0
    let odd = false
    let start = null
    let ended = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const sep = buffer.indexOf('\n\n')
        if (sep === -1) break
        const block = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const lines = block.split('\n')
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? ''
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
        if (event === 'start') { try { start = JSON.parse(data) } catch { /* 坏元数据忽略 */ } }
        if (event === 'audio') {
          const raw = atob(data)
          if (raw.length % 2 !== 0) odd = true
          frames += 1
          bytes += raw.length
        }
        if (event === 'end') ended = true
        if (event === 'error') return { status: response.status, error: data.slice(0, 200) }
      }
    }
    return { status: response.status, frames, bytes, odd, start, ended }
  })
  if (realStream.error !== undefined) {
    bad('真上游流式合成失败', String(realStream.error))
  } else {
    if (realStream.frames >= 1 && realStream.bytes > 1000) {
      ok(`真上游流式合成回来了音频（${realStream.frames} 帧、${realStream.bytes} 字节 PCM）`)
    } else {
      bad('真上游没有回音频', JSON.stringify(realStream))
    }
    if (realStream.start?.format === 'pcm' && realStream.start?.sampleRate > 0) {
      ok(`服务端先宣告了格式与采样率（${realStream.start.format} / ${realStream.start.sampleRate}）`)
    } else {
      bad('没有先收到 start 事件', JSON.stringify(realStream.start))
    }
    if (realStream.odd === false) ok('每一帧都是完整的 PCM16（字节数都是偶数）')
    else bad('有帧的字节数是奇数（不是合法 PCM16）')
    if (realStream.ended === true) ok('收到 end 事件（会话正常收尾）')
    else bad('没收到 end 事件')
  }

  /* ── 5. 键盘也能按住说话 -------------------------------------------
     这一步**偶发失败过**（同一条代码，一次过、一次不过）。原因是它依赖焦点：
     焦点还没落到麦克风上就按空格，键盘事件跑到别处去了，于是"没进入录音状态"。
     所以先把"焦点真的在按钮上、按钮真的可用"等到，再按；按下之后也轮询等待状态，
     而不是 sleep 一个固定时长。 */
  await mic.focus()
  const focused = await page.evaluate(() => {
    const el = document.activeElement
    return el !== null && el.getAttribute('aria-label') === '按住说话' && !el.disabled
  })
  if (!focused) {
    bad('麦克风按钮拿不到焦点（键盘这一步做不下去）')
  } else {
    await page.keyboard.down(' ')
    let byKeyboard = false
    for (let i = 0; i < 20; i += 1) {
      if (await page.getByText('正在录音', { exact: false }).isVisible().catch(() => false)) {
        byKeyboard = true
        break
      }
      await page.waitForTimeout(150)
    }
    if (byKeyboard) ok('键盘按住空格也能录音（不只鼠标能用）')
    else bad('键盘按住空格没有进入录音状态')
  }
  await page.keyboard.up(' ')

  /* ── 6. 关掉模式要停干净 ------------------------------------------- */
  await page.waitForTimeout(500)
  await voiceToggle.click()
  await page.waitForTimeout(300)
  const micGone = await page.getByRole('button', { name: '按住说话' }).count()
  if (micGone === 0) ok('关掉语音模式后麦克风按钮消失')
  else bad('关掉语音模式后麦克风按钮还在')

  const barGone = await page.getByText('按住麦克风说话', { exact: false }).count()
  if (barGone === 0) ok('关掉语音模式后状态条也收起来了')
  else bad('关掉语音模式后状态条还在')

  /* ── 6b. 逐条朗读：关掉语音输入之后**仍然能听** ---------------------
     朗读和麦克风是两件事：麦克风开关关掉的是"我要说话"，不是"我要听"。
     消息上就有播放按钮，不需要先打开一个模式才能用——所以这一段在**关掉之后**做。
     消息用预置的（不依赖模型回复），合成走本地夹具。 */
  await routeStream(page, fixture, 'mode=normal&seconds=2&delay=0')
  const speakButton = (name) => page.locator(`button[aria-label="${name}"]`)
  const listenMsg = await seedAndOpen(page, '关掉语音输入之后，这句话仍然应该能听。')

  const speakCount = await speakButton('朗读这条回复').count()
  if (speakCount >= 1) {
    ok(`关掉语音输入后，助手回复上仍然有朗读按钮（${speakCount} 条）——听和说是两件事`)
  } else {
    bad('关掉语音输入之后朗读按钮也没了', '朗读被错误地和麦克风绑在了一起')
  }

  const idleSpeaking = await page.locator('button[aria-label="朗读这条回复"]').count()
  if (idleSpeaking >= 1) ok('没在念的时候按钮就是「朗读」（状态跟着真的音频走，不是一次性的）')
  else bad('一上来按钮就不是「朗读」')

  // 点**这一条**朗读：合成走夹具，很快进入播放状态
  let startedSpeaking = false
  try {
    await listenMsg.locator('button[aria-label="朗读这条回复"]').click()
    startedSpeaking = await listenMsg.locator('button[aria-label="停止朗读"]')
      .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)
  } catch {
    startedSpeaking = false
  }
  if (startedSpeaking) ok('点某一条的朗读，**那一条**的按钮变成「停止」（没有十条一起变）')
  else bad('点了朗读之后那一条没有进入朗读状态')

  // 同时只能有一条在念：别的消息上不该出现「停止」。
  const stopButtons = await speakButton('停止朗读').count()
  if (stopButtons <= 1) ok(`同时只有一条在念（页面上 ${stopButtons} 个「停止」）`)
  else bad('同时出现多个「停止」，说明朗读状态串了', `${stopButtons} 个`)

  let stoppedAgain = 0
  try {
    await listenMsg.locator('button[aria-label="停止朗读"]').click()
    await page.waitForTimeout(400)
    stoppedAgain = await listenMsg.locator('button[aria-label="朗读这条回复"]').count()
  } catch {
    stoppedAgain = 0
  }
  if (stoppedAgain === 1) ok('点「停止」能停下来，按钮回到「朗读」')
  else bad('点「停止」之后没有回到「朗读」')

  /* ── 6c. 波形与进度（确定性夹具：渐强 PCM 一帧一帧地送）───────────────
     这一段把流式合成接到本地夹具上，于是**文本与音频都是确定的**：
       · 整段文字**一次**请求（真流式由上游自己分句，不再逐句合成）
       · 波形必须来自音频（夹具是渐强的 → 柱子右高左低）
       · 总时长随帧增长、进度真的在走
     波形是在**整段合成完毕**后才算出来的（用户的取舍：不边收边算）。 */
  const SEED_TEXT = '好的。您的余额是八百元。要不要我帮您转出去？'
  let waveMsg = null
  {
    await routeStream(page, fixture, 'mode=normal&seconds=4&delay=0')
    const callsBefore = fixture.calls.length
    waveMsg = await seedAndOpen(page, SEED_TEXT)
    await waveMsg.locator('button[aria-label="朗读这条回复"]').click()

    for (let i = 0; i < 60 && fixture.calls.length === callsBefore; i += 1) await page.waitForTimeout(200)
    const call = fixture.calls[callsBefore]
    if (call === undefined) {
      bad('朗读没有请求流式合成', '夹具一次都没被调到')
    } else if (call.text === SEED_TEXT) {
      ok('整段文字一次请求（真流式由上游自己分句，不再逐句合成）')
    } else {
      bad('送给合成的文本和消息不一致', `请求=${JSON.stringify(call.text)} 期望=${JSON.stringify(SEED_TEXT)}`)
    }

    // 波形要等整段合成完（夹具的帧都到齐）才出现
    let wave = null
    for (let i = 0; i < 60; i += 1) {
      wave = await readPlayer(page)
      if (wave !== null && wave.bars > 0) break
      await page.waitForTimeout(200)
    }
    if (wave === null || wave.bars === 0) {
      bad('朗读时没有画出波形（整段合成完了也没算出来）')
    } else {
      ok(`整段合成完毕后画出了波形（${wave.bars} 根柱子）`)
      if (wave.tail > wave.head * 1.5) {
        ok(`波形来自音频本身：音频渐强，柱子也确实右高左低（左 ${wave.head.toFixed(1)} → 右 ${wave.tail.toFixed(1)}）`)
      } else {
        bad('波形和音频对不上（音频是渐强的，柱子却左右一样高）',
          `左三段均高 ${wave.head.toFixed(2)}、右三段均高 ${wave.tail.toFixed(2)}`)
      }
    }

    const play1 = await readPlay(page)
    if (play1 !== null && play1.duration > 3.5) {
      ok(`进度条认得出总时长（${play1.duration.toFixed(2)} 秒，夹具给的是 4 秒；aria-valuemax=${wave?.max}）`)
    } else {
      bad('进度条拿不到总时长', JSON.stringify(play1))
    }

    // 进度必须**真的在走**：等一会儿再看，位置与已播柱子数都该变大
    await page.waitForTimeout(1200)
    const play2 = await readPlay(page)
    const laterWave = await readPlayer(page)
    if (play1 !== null && play2 !== null && play2.position > play1.position) {
      ok(`进度在走（${play1.position.toFixed(2)}s → ${play2.position.toFixed(2)}s）`)
    } else {
      bad('进度没有前进', `${play1?.position} → ${play2?.position}`)
    }
    if (wave !== null && laterWave !== null && laterWave.played > wave.played) {
      ok(`波形上已播的那段在变长（${wave.played} → ${laterWave.played} 根变成金色）`)
    } else {
      bad('波形上的播放进度没有推进', `${wave?.played} → ${laterWave?.played}`)
    }

    // 停下来之后播放器要收走，不能留一个停在原地的进度条
    await page.locator('button[aria-label="停止朗读"]').first().click()
    await page.waitForTimeout(500)
    const goneAfterStop = await page.locator('[data-speech-wave]').count()
    if (goneAfterStop === 0) ok('停止之后播放器收走了（不留一条停住的进度条）')
    else bad('停止之后播放器还在', `还剩 ${goneAfterStop} 个`)
  }

  /* ── 6d. 同一段文字念第二次，**不该再去合成一遍** ────────────────────
     合成是按字数收费的。缓存命中时连波形都不该重算（它跟合成结果一起缓存）。 */
  {
    const beforeReplay = fixture.calls.length
    const replay = waveMsg.locator('button[aria-label="朗读这条回复"]')
    await replay.waitFor({ state: 'visible', timeout: 10_000 })
    await replay.click()
    await page.waitForTimeout(1200)
    if (fixture.calls.length === beforeReplay) {
      ok(`同一段文字念第二次没有重新合成（流式请求次数仍是 ${fixture.calls.length}）`)
    } else {
      bad('同一段文字被重复合成了（缓存没生效）',
        `${beforeReplay} → ${fixture.calls.length}；合成过的文本：${JSON.stringify(fixture.calls.map((c) => c.text.slice(0, 16)))}`)
    }
    const replayWave = await page.locator('[data-speech-wave]').count()
    if (replayWave >= 1) ok('缓存命中时波形也在（波形跟着合成结果一起缓存，不用重算）')
    else bad('缓存命中时没有波形')
    await page.locator('button[aria-label="停止朗读"]').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  /* ── 6e. 不能重叠播放：两次朗读同时在飞的时候，只能有一段响 ────────────
     用夹具的**帧延迟**造出"第一段还在合成"的窗口：不拖慢的话第二次点击会
     落在已经播起来之后，测不到那个竞态（实测踩到：不拖慢，把守卫删掉照样过）。
     换一段文本 + 重新加载，保证缓存是空的、这次真的走夹具。 */
  {
    await routeStream(page, fixture, 'mode=normal&seconds=1&delay=200')
    const overlapMsg = await seedAndOpen(page, `${SEED_TEXT}（重叠测试）`)
    const button = overlapMsg.locator('button[aria-label="朗读这条回复"]')
    await button.click().catch(() => {})
    await page.waitForTimeout(300)
    await button.click().catch(() => {})
    // 播放中逐次采样：只有一路在响的话，累计采样不会超过一段的量（1 秒 ≈ 24000）
    let sawPlaying = false
    let maxSamples = 0
    for (let i = 0; i < 40; i += 1) {
      const snapshot = await readPlay(page)
      if (snapshot !== null && snapshot.state === 'playing') {
        sawPlaying = true
        maxSamples = Math.max(maxSamples, snapshot.samples)
      }
      await page.waitForTimeout(100)
    }
    if (sawPlaying && maxSamples <= 24000 * 1.2) {
      ok(`两次朗读同时在飞时只有一路在响（峰值采样 ${maxSamples}，没有两段叠起来）`)
    } else {
      bad('出现了重叠播放', `见过在播=${sawPlaying}、峰值采样=${maxSamples}（一段约 24000）`)
    }
    await page.locator('button[aria-label="停止朗读"]').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  /* ── 6f. 取消播放**不是失败**，但真失败必须报 ─────────────────────────
     两条路都要验，少一条都不对：
       · 上游明确报错（error 事件）→ 必须说出来，否则用户只看到"没声音"；
       · 流还在飞的时候点停止 → 静默收拾，不许弹一行红字（那是用户自己取消的）。 */
  {
    const failCount = async () => await page.getByText('朗读失败', { exact: false }).count()

    // ① 真失败：夹具回 error 事件 → 必须报「朗读失败」
    await routeStream(page, fixture, 'mode=error')
    const errorMsg = await seedAndOpen(page, `${SEED_TEXT}（失败测试）`)
    await errorMsg.locator('button[aria-label="朗读这条回复"]').click().catch(() => {})
    await page.waitForTimeout(1800)
    if (await failCount() >= 1) {
      ok('上游明确报错时，界面必须说「朗读失败」——没有把所有错误一起吞掉')
    } else {
      bad('真失败被吞掉了', '上游回了 error 事件，界面却一句话都没有')
    }

    // ② 取消：帧很慢（流会一直开着），播起来之后点停止 → 静默
    /*
     * **换一张干净的页面**（重新预置 + 重载）：① 留下的那行「朗读失败」会跟着
     * 页面待在这儿，不隔离的话②量到的是①的残留——实测就是这么假失败的。
     */
    await routeStream(page, fixture, 'mode=normal&seconds=8&delay=800')
    const cancelMsg = await seedAndOpen(page, `${SEED_TEXT}（取消测试）`)
    await cancelMsg.locator('button[aria-label="朗读这条回复"]').click().catch(() => {})
    await page.waitForTimeout(900)
    const during = await readPlay(page)
    await page.locator('button[aria-label="停止朗读"]').first().click().catch(() => {})
    await page.waitForTimeout(800)
    const afterCancel = await readPlay(page)
    const errorsAfterCancel = await failCount()
    const errorText = errorsAfterCancel === 0
      ? ''
      : await page.getByText('朗读失败', { exact: false }).first().innerText().catch(() => '')
    if (errorsAfterCancel === 0 && (afterCancel === null || afterCancel.state === 'idle')) {
      ok(`流还在飞的时候点停止：静默收拾干净（取消前 ${during?.state ?? '?'}，不报错、播放器也停了）`)
    } else {
      bad('取消被当成了失败', `错误 ${errorsAfterCancel} 处（${errorText}）、取消后状态 ${JSON.stringify(afterCancel)}、取消前 ${JSON.stringify(during)}`)
    }

    // ③ 恢复之后还能正常念（错误状态不该卡住后续）
    await routeStream(page, fixture, 'mode=normal&seconds=2&delay=0')
    await errorMsg.locator('button[aria-label="朗读这条回复"]').click().catch(() => {})
    await page.waitForTimeout(1500)
    const recovered = await page.locator('[data-speech-wave]').count()
    if (recovered >= 1) ok('真失败之后还能正常念（错误状态没有卡住后续）')
    else bad('真失败之后念不了了', '点了朗读但播放器没出来')
    await page.locator('button[aria-label="停止朗读"]').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  /* ── 6g. 进度条能点、能拖、能用键盘跳 ───────────────────────────────
     用夹具的 **30 秒**音频（比键盘的 5 秒步长长得多，才测得出一按到底走没走）。
     流式播放只能跳到**已经缓冲**的范围，所以先等整段到齐再验跳转。 */
  {
    await routeStream(page, fixture, 'mode=normal&seconds=30&delay=0')
    const seekMsg = await seedAndOpen(page, `${SEED_TEXT}（跳转测试）`)
    await seekMsg.locator('button[aria-label="朗读这条回复"]').click().catch(() => {})
    const track = page.locator('[data-speech-progress]')
    await track.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})

    // 等整段缓冲完（30 秒；夹具秒回，帧到齐很快）
    let buffered = 0
    for (let i = 0; i < 80; i += 1) {
      const snapshot = await readPlay(page)
      buffered = snapshot?.duration ?? 0
      if (buffered >= 29.5) break
      await page.waitForTimeout(200)
    }

    const role = await track.getAttribute('role')
    if (role === 'slider') ok('进度条的角色是 slider（能操作的控件，不是只读的 progressbar）')
    else bad('进度条角色不对', `实际 role=${JSON.stringify(role)}`)

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-speech-progress]')
      return el !== null && el.getAttribute('aria-disabled') === 'false'
    }, null, { timeout: 10_000 }).catch(() => {})
    const tabIndex = await track.getAttribute('tabindex')
    const box = await track.boundingBox()
    if (box === null || buffered < 29.5) {
      bad('拿不到进度条的位置、或整段没缓冲完，跳转断言没法做', `box=${JSON.stringify(box)} 已缓冲=${buffered.toFixed(2)}s`)
    } else if (tabIndex !== '0') {
      bad('进度条不在 Tab 顺序里（键盘用户够不到）', `tabindex=${JSON.stringify(tabIndex)}`)
    } else {
      ok(`进度条在 Tab 顺序里，已缓冲 ${buffered.toFixed(2)} 秒`)

      /** 点在横向 `fraction` 处。 */
      const clickAt = async (fraction) => {
        await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)
        await page.waitForTimeout(150)
      }
      /** 当前播放位置（秒）。 */
      const at = async () => (await readPlay(page))?.position ?? -1

      // ① 点 20% 与 80%：位置必须跟着点走（±1.5 秒：还在播 + aria 取整）
      await clickAt(0.2)
      const low = await at()
      if (Math.abs(low - 30 * 0.2) < 1.5) ok(`点 20% 跳到 ${low.toFixed(2)}s（目标 ${(30 * 0.2).toFixed(2)}s）`)
      else bad('点 20% 没跳到对应位置', `实际 ${low.toFixed(2)}s，期望约 ${(30 * 0.2).toFixed(2)}s`)

      await clickAt(0.8)
      const high = await at()
      if (Math.abs(high - 30 * 0.8) < 1.5) ok(`点 80% 跳到 ${high.toFixed(2)}s（目标 ${(30 * 0.8).toFixed(2)}s）`)
      else bad('点 80% 没跳到对应位置', `实际 ${high.toFixed(2)}s，期望约 ${(30 * 0.8).toFixed(2)}s`)

      // ② 界面上的读数也要跟着走，不能只有声音跳了、进度条不动
      const nowAfterClick = Number(await track.getAttribute('aria-valuenow'))
      if (Number.isFinite(nowAfterClick) && Math.abs(nowAfterClick - high) < 2) {
        ok(`进度条的 aria-valuenow 跟着跳到 ${nowAfterClick}`)
      } else {
        bad('音频跳了但进度条读数没跟上', `aria-valuenow=${nowAfterClick}，音频在 ${high.toFixed(2)}s`)
      }

      // ③ 键盘：Home 回开头、← 往回退 5 秒
      await track.focus()
      await page.keyboard.press('Home')
      await page.waitForTimeout(150)
      const home = await at()
      if (home < 1.5) ok(`按 Home 回到开头（${home.toFixed(2)}s）`)
      else bad('Home 没有回到开头', `实际 ${home.toFixed(2)}s`)

      await clickAt(0.8)
      const beforeBack = await at()
      await track.focus()
      await page.keyboard.press('ArrowLeft')
      await page.waitForTimeout(200)
      const back = await at()
      if (back < beforeBack - 3.5) ok(`按 ← 往回退了 5 秒（${beforeBack.toFixed(2)}s → ${back.toFixed(2)}s）`)
      else bad('← 没有回退', `${beforeBack.toFixed(2)}s → ${back.toFixed(2)}s`)

      /*
       * ③b End：到末尾。
       *
       * **不能只查读数**：跳到末尾就是"当场播完" → 播放器被收走。
       * 要验的是可观测的结果：播放器消失。反过来说，End 没生效的话，
       * 声音还在 20 多秒处继续放、进度条不会消失。
       */
      await page.keyboard.press('End')
      const finished = await page.waitForFunction(
        () => document.querySelector('[data-speech-progress]') === null,
        null,
        { timeout: 3_000 },
      ).then(() => true).catch(() => false)
      if (finished) ok('按 End 跳到末尾（播完，播放器收走）')
      else bad('End 没有到末尾', '播放器还在，说明没跳到已缓冲的末尾')

      // ④ 拖：End 之后播放器收走了，重新起一段再拖
      await seekMsg.locator('button[aria-label="朗读这条回复"]').click().catch(() => {})
      let dragReady = await page.waitForFunction(() => {
        const el = document.querySelector('[data-speech-progress]')
        return el !== null && el.getAttribute('aria-disabled') === 'false'
      }, null, { timeout: 10_000 }).then(() => true).catch(() => false)
      if (!dragReady) {
        // 重播没起来就整页重来一次（换掉"上一段刚播完"留下的状态），还不行就报出来
        await seedAndOpen(page, `${SEED_TEXT}（跳转测试）`)
        await seekMsg.locator('button[aria-label="朗读这条回复"]').click().catch(() => {})
        dragReady = await page.waitForFunction(() => {
          const el = document.querySelector('[data-speech-progress]')
          return el !== null && el.getAttribute('aria-disabled') === 'false'
        }, null, { timeout: 15_000 }).then(() => true).catch(() => false)
      }
      const box2 = dragReady ? await trackBox(track) : null
      if (box2 === null) {
        const snapshot = await readPlay(page)
        const logs = await page.evaluate(() => (window.__voiceLogs ?? []).slice(-10))
        bad('拖动断言拿不到进度条位置（重播之后播放器没起来）', `${JSON.stringify(snapshot)}\n${logs.join('\n')}`)
      } else {
        ok('End 之后还能重新起播（一次念完不影响下一条）')
        await page.mouse.move(box2.x + box2.width * 0.9, box2.y + box2.height / 2)
        await page.mouse.down()
        await page.mouse.move(box2.x + box2.width * 0.15, box2.y + box2.height / 2, { steps: 8 })
        await page.mouse.up()
        await page.waitForTimeout(200)
        const dragged = await at()
        if (Math.abs(dragged - 30 * 0.15) < 1.5) ok(`拖到 15% 停在 ${dragged.toFixed(2)}s`)
        else bad('拖动没有生效', `实际 ${dragged.toFixed(2)}s，期望约 ${(30 * 0.15).toFixed(2)}s`)
      }
    }

    await seekMsg.locator('button[aria-label="停止朗读"]').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  /* ── 6h. **流式本身**：音频还没合成完，就已经在响了 ────────────────────
     这是整个功能的意义所在，也是"逐句合成"与"真流式"的分界线：
     夹具每帧延迟 200ms，于是流会开着好几秒。断言"进入播放状态时，
     那次请求还没结束"——如果实现变成"等整段合成完再播"，这一条必挂。 */
  {
    await routeStream(page, fixture, 'mode=normal&seconds=6&delay=200')
    const streamMsg = await seedAndOpen(page, `${SEED_TEXT}（流式测试）`)
    const beforeStream = fixture.calls.length
    await streamMsg.locator('button[aria-label="朗读这条回复"]').click().catch(() => {})
    let proof = false
    let detail = '一直没进入播放状态'
    for (let i = 0; i < 240; i += 1) {
      const snapshot = await readPlay(page)
      const liveCall = fixture.calls[beforeStream]
      if (snapshot !== null && snapshot.state === 'playing' && snapshot.position > 0) {
        const stillOpen = liveCall !== undefined && liveCall.endedAt === null
        detail = `流还没结束=${stillOpen}，已播 ${snapshot.position.toFixed(2)}s、已收采样 ${snapshot.samples}`
        if (stillOpen) { proof = true; break }
      }
      await page.waitForTimeout(50)
    }
    if (proof) {
      ok(`音频还没合成完就已经在响了（${detail}）——这就是"流式"：不等整段 TTS`)
    } else {
      bad('没观察到"流还没结束就出声"', detail)
    }
    await page.locator('button[aria-label="停止朗读"]').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  /* ── 7. 服务端没开语音时，开关**不该出现** ---------------------------
     这是"退让"那条路：不是显示了按钮再报错，而是根本不显示一个注定失败的东西。
     用 route 把 health 换掉即可，不用真起一个关掉语音的服务——
     （真起一个的路径由 e2e-voice.sh 用例 7 覆盖：那边验的是服务端行为。） */
  await page.unroute('**/agent-api/asr')
  await page.route('**/agent-api/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'openrouter',
        model: 'stub',
        sessions: 0,
        voice: { asr: false, tts: false },
      }),
    })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  // 刷新之后确保仍在登录态（登出过就补一次登录；没登出时这行是空操作）
  await login(page)
  await page.locator('[data-agent-status="ready"]').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(400)
  const toggleCount = await page.getByRole('button', { name: '语音', exact: true }).count()
  const micCount = await page.getByRole('button', { name: '按住说话' }).count()
  if (toggleCount === 0 && micCount === 0) {
    ok('服务端没开语音能力时，页面上不出现「语音」开关（不是显示了再报错）')
  } else {
    bad('服务端没开语音能力，页面还是显示了语音入口', `开关 ${toggleCount} 个、麦克风 ${micCount} 个`)
  }
} finally {
  await fixture.close()
  await browser.close()
}

console.log()
if (failures === 0) console.log('check-voice: 全部通过')
else console.log(`check-voice: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
