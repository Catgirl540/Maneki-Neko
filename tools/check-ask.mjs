/**
 * 「模型问用户」的检查。
 *
 * 这条链有四段，**每一段都可能单独坏掉**，所以分四段测：
 *
 *   A. **服务端协议**（确定性）：卡片推送、答复回填、各种畸形输入被拒。
 *   B. **防钓鱼守卫**（确定性、离线）：不许用提问框索要凭据——这是本功能
 *      唯一的安全性质，也是最容易被忽略的一条（见下）。
 *   C. **真模型**（联网）：模型真的会用提问卡片，而不是在正文里问一句然后停下；
 *      以及我们的答复真的回到了模型手里。
 *   D. **界面**（浏览器）：卡片渲染出来、单选/多选/自由输入都能用、答完提交。
 *
 * ## 为什么 A 和 D 要用「注入的问询」而不是全靠模型
 *
 * 模型给什么题是它自己决定的——这次给单选、下次可能给多选。**靠模型来覆盖
 * 单选/多选/自由输入三条路，断言就会变成看运气**。所以 A 段与 D 段自己
 * 构造一道包含三种问法的问询，直接打进桥接；C 段才去验"模型会不会用"。
 *
 * ## 为什么「防钓鱼」是硬拦而不是提示词
 *
 * `ask_user_question` 弹出的是一个**用户会当真的输入框**。只要模型问一句
 * 「请把您的支付密码填在这里」，就有一个长得很正规的框在等他把密码打进去。
 * 人设里也写了不许问，但**人设是软的**——这一轮做"隐藏模型名"时已经实测过一次
 * （界面上藏得再好，问一句模型就自己说了）。凭据这件事后果是丢钱，所以放在代码里拦。
 *
 *   node tools/check-ask.mjs [baseUrl]
 */
import { chromium } from 'playwright-core'
import { login } from './lib/session.mjs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180'
const API = `${BASE}/agent-api`
/** 直连演示服务：A 段要自己扮演"插件"发问询，走代理没必要。 */
const API_DIRECT = process.env.LUCKCAT_AGENT_DIRECT ?? 'http://127.0.0.1:8788/agent-api'
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/* ───────────── B. 守卫（离线，直接测构建产物） ───────────── */

console.log('== B. 防钓鱼守卫（代码硬拦，不靠人设）==')
const ask = await import(path.join(ROOT, 'framework/packages/ask/lib/index.js')).catch((error) => {
  console.log(`      （导入构建产物失败：${error.message}）`)
  return null
})
if (ask === null) {
  report(false, 'B0 能加载 framework/packages/ask/lib/index.js（先跑 scripts/build.sh ask）')
} else {
  const blocked = [
    '请输入您的支付密码',
    '请填写短信验证码',
    '请把您的身份证号发给我',
    '请输入卡号',
    '为了核对身份，请在这里输入您的登录密码',
  ]
  for (const text of blocked) {
    report(
      ask.looksLikeCredentialRequest(text),
      `B1 拦下索要凭据：${JSON.stringify(text)}`,
    )
  }
  // 反过来：**银行该说的话不能被误拦**。只查凭据词的话这两句会被拦掉，
  // 而它们恰恰是正确的话。
  const allowed = [
    '请不要把密码告诉任何人',
    '您的支付密码不要发给客服',
    '请输入转账金额',
    '这笔转账的收款人是谁？',
  ]
  for (const text of allowed) {
    report(
      !ask.looksLikeCredentialRequest(text),
      `B2 不误拦正常提问：${JSON.stringify(text)}`,
    )
  }
  /*
   * 选项里出现凭据词——**这是故意不拦的**，得把边界钉住。
   *
   * 规则是"凭据词 + 索要动词同时命中"。而选项标签只是**用户会点的一个字符串**，
   * 它不会让用户把密码交出去：「银行卡号后四位」「我的支付密码」被点中时，
   * 回到模型的是这几个字本身，不是一个密码。
   *
   * 为什么必须承认这条边界：实测里模型给过「银行卡号后四位」这个选项
   * （用来确认收款账户），那是**正常且有用**的。按"只要出现凭据词就拦"来写，
   * 会把这条正常路径一起拦掉。
   *
   * 危险的是**让用户打字**：题目正文里索要凭据（B1 那批），
   * 或者题目在选项的掩护下要用户填（下面这条）。
   */
  {
    let threw = ''
    try {
      ask.assertQuestionsAllowed([{
        id: 'q1',
        question: '请选择一项',
        options: [{ label: '我的支付密码' }],
      }], [])
    } catch (error) { threw = error.code ?? 'UNKNOWN' }
    report(threw === '', 'B3 选项标签里单提凭据词**不**拦（用户点它不会泄漏密码；拦了会误伤「银行卡号后四位」这种正常选项）', [
      `实际：${threw || '（未拦，符合预期）'}`,
    ])
  }
  // 但题目借着选项的掩护要用户填凭据 → 必须拦
  {
    let threw = ''
    try {
      ask.assertQuestionsAllowed([{
        id: 'q1',
        question: '请选择一项，并在这里输入您的支付密码以便核对',
        options: [{ label: '确认' }],
      }], [])
    } catch (error) { threw = error.code ?? 'UNKNOWN' }
    report(threw === 'CREDENTIAL_REQUEST_BLOCKED', 'B3b 题目在选项掩护下索要凭据 → 拦下', [`实际：${threw || '（没拦）'}`])
  }
  // 追加规则生效
  {
    let threw = ''
    try {
      ask.assertQuestionsAllowed([{ id: 'q1', question: '请问您的星座是什么' }], ask.compileExtraRules(['星座']))
    } catch (error) { threw = error.code ?? 'UNKNOWN' }
    report(threw === 'FORBIDDEN_PATTERN', 'B4 部署方追加的禁止规则生效', [`实际：${threw || '（没拦）'}`])
  }
  // 非法正则在**加载期**就炸，而不是等第一次提问
  {
    let threw = ''
    try { ask.compileExtraRules(['[']) } catch (error) { threw = error.code ?? 'UNKNOWN' }
    report(threw === 'MISCONFIGURED', 'B5 非法正则加载期报错（不是等第一次提问才炸）', [`实际：${threw || '（没报）'}`])
  }
}

/* ───────────── A. 服务端协议（确定性） ───────────── */

console.log('\n== A. 服务端：推送 → 答复 → 回填 ==')

/** 打开一条 SSE，把事件收进数组。 */
async function openStream(sessionId) {
  const controller = new AbortController()
  const events = []
  const done = (async () => {
    try {
      const res = await fetch(`${API_DIRECT}/sessions/${encodeURIComponent(sessionId)}/stream`, { signal: controller.signal })
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
          try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* 忽略坏事件 */ }
        }
      }
    } catch { /* abort 的正常路径 */ }
  })()
  return { events, close: () => { controller.abort(); return done } }
}

/** 扮演插件：发一次问询，返回被挂住的那个 promise 与句柄。 */
function postQuestion(sessionId, questions) {
  const controller = new AbortController()
  const promise = fetch(`${API_DIRECT}/questions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, questions }),
    signal: controller.signal,
  }).then(async res => ({ status: res.status, body: await res.json().catch(() => ({})) }))
    .catch(() => ({ status: 0, body: {} }))
  return { promise, abort: () => { controller.abort() } }
}

function answerQuestion(questionId, answers) {
  return fetch(`${API_DIRECT}/questions/${encodeURIComponent(questionId)}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
}

/** 三段式问询：单选 + 多选 + 纯自由输入。 */
const THREE_WAY = [
  {
    id: 'single',
    question: '要转多少？',
    header: '金额',
    options: [{ label: '100 元' }, { label: '500 元' }],
    multiSelect: false,
  },
  {
    id: 'multi',
    question: '还想同时办哪些？',
    options: [{ label: '查余额' }, { label: '看流水' }, { label: '看理财' }],
    multiSelect: true,
  },
  { id: 'free', question: '备注写什么？' },
]

{
  const sessionId = `s-ask-a-${Date.now()}`
  const stream = await openStream(sessionId)
  await new Promise(r => setTimeout(r, 300))
  const held = postQuestion(sessionId, THREE_WAY)

  // A1 · 卡片真的推到了这个会话
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && !stream.events.some(e => e.type === 'question')) {
    await new Promise(r => setTimeout(r, 200))
  }
  const card = stream.events.find(e => e.type === 'question')
  report(card !== undefined && card.question.questions.length === 3, 'A1 问询通过 SSE 推给了对应会话', [
    card === undefined ? '（没收到 question 事件）' : `questionId=${card.question.questionId} 题数=${card.question.questions.length}`,
  ])

  if (card !== undefined) {
    const questionId = card.question.questionId

    // A2 · 答复里带没问过的 id → 400
    {
      const res = await answerQuestion(questionId, [
        { id: 'single', selected: ['100 元'] },
        { id: 'multi', selected: [] },
        { id: 'free', custom: 'x' },
        { id: '没问过的', selected: [] },
      ])
      report(res.status === 400, 'A2 答复里出现没问过的问题 id → 400', [`实际 ${res.status}`])
    }
    // A3 · 漏答一道 → 400（不能让模型以为用户对没答的题做了默认选择）
    {
      const res = await answerQuestion(questionId, [{ id: 'single', selected: ['100 元'] }])
      report(res.status === 400, 'A3 漏答题目 → 400', [`实际 ${res.status}`])
    }
    // A4 · 什么都没答的那道题 → 400
    {
      const res = await answerQuestion(questionId, [
        { id: 'single', selected: ['100 元'] },
        { id: 'multi', selected: [] },
        { id: 'free', custom: '   ' },
      ])
      report(res.status === 400, 'A4 某道题既没选也没填 → 400', [`实际 ${res.status}`])
    }

    // A5 · 正常答复：单选一个、多选两个、自由输入一段
    const answers = [
      { id: 'single', selected: ['500 元'] },
      { id: 'multi', selected: ['查余额', '看理财'] },
      { id: 'free', selected: [], custom: '房租，别写错' },
    ]
    const res = await answerQuestion(questionId, answers)
    report(res.status === 200, 'A5a 正常答复被接受（200）', [`实际 ${res.status}`])

    const settled = await held.promise
    const got = settled.body?.answers
    const identical = JSON.stringify(got) === JSON.stringify(answers)
    report(
      settled.status === 200 && identical,
      'A5b 被挂住的那个请求原样拿回了这三份答复（单选/多选/自由输入）',
      [`回来的是：${JSON.stringify(got)}`],
    )

    /*
     * A6 · 答复之后卡片从界面上消失（服务端要推 question-resolved）。
     *
     * **要轮询，不能立刻查**：服务端是先 publish 再 resolve 那个被挂住的请求，
     * 但读 SSE 的是另一条异步循环——`held.promise` 回来的时候，那一帧
     * 可能刚写进 socket、还没被解析出来。实测踩到过这个假失败。
     */
    {
      const d = Date.now() + 5_000
      while (Date.now() < d && !stream.events.some(e => e.type === 'question-resolved')) {
        await new Promise(r => setTimeout(r, 100))
      }
      const resolved = stream.events.find(e => e.type === 'question-resolved')
      report(resolved !== undefined && resolved.answered === true, 'A6 推了 question-resolved（answered=true）', [
        resolved === undefined ? '（没收到）' : JSON.stringify(resolved),
      ])
    }

    // A7 · 同一个问题不能答两次
    {
      const again = await answerQuestion(questionId, answers)
      report(again.status === 404, 'A7 同一个问询答复第二次 → 404', [`实际 ${again.status}`])
    }
  }
  await stream.close()
}

{
  // A8 · 畸形输入
  const noSession = await fetch(`${API_DIRECT}/questions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ questions: THREE_WAY }),
  })
  report(noSession.status === 400, 'A8 缺 sessionId → 400（不知道该推给谁，不挂住空等）', [`实际 ${noSession.status}`])

  const empty = await fetch(`${API_DIRECT}/questions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 's-x', questions: [] }),
  })
  report(empty.status === 400, 'A9 空 questions → 400', [`实际 ${empty.status}`])

  const tooMany = await fetch(`${API_DIRECT}/questions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 's-x', questions: Array.from({ length: 11 }, (_, i) => ({ id: `q${i}`, question: 'x' })) }),
  })
  report(tooMany.status === 400, 'A10 一次超过 10 道题 → 400', [`实际 ${tooMany.status}`])

  const unknown = await answerQuestion('q_不存在的', [{ id: 'a', selected: [] }])
  report(unknown.status === 404, 'A11 答复一个不存在的问询 → 404', [`实际 ${unknown.status}`])
}

{
  /*
   * A12 · 插件侧放弃等待之后，答复必须拿 404。
   *
   * 不查这一条的话，用户过一会儿再点"提交"会拿到 200，却什么都不会发生
   * ——因为 agent 早就不等了。这是确认通道那边实测踩到的同类坑。
   */
  const sessionId = `s-ask-abandon-${Date.now()}`
  const stream = await openStream(sessionId)
  await new Promise(r => setTimeout(r, 300))
  const held = postQuestion(sessionId, THREE_WAY)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && !stream.events.some(e => e.type === 'question')) {
    await new Promise(r => setTimeout(r, 200))
  }
  const questionId = stream.events.find(e => e.type === 'question')?.question.questionId
  held.abort()
  await new Promise(r => setTimeout(r, 800))
  const res = await answerQuestion(questionId, [
    { id: 'single', selected: ['100 元'] }, { id: 'multi', selected: ['查余额'] }, { id: 'free', custom: 'x' },
  ])
  report(res.status === 404, 'A12 插件放弃等待后再答复 → 404（不是假成功）', [`实际 ${res.status}`])
  await stream.close()
}

/* ───────────── C. 真模型会不会用卡片 ───────────── */

console.log('\n== C. 真模型：用卡片问，而不是在正文里问 ==')

{
  const sessionId = `s-ask-live-${Date.now()}`
  const stream = await openStream(sessionId)
  await new Promise(r => setTimeout(r, 400))
  await fetch(`${API_DIRECT}/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '我想转笔钱给朋友，但转多少、什么时候转都还没定。你先问问我再办。' }),
  })

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline && !stream.events.some(e => e.type === 'question')) {
    const error = stream.events.find(e => e.type === 'error')
    if (error !== undefined) break
    await new Promise(r => setTimeout(r, 800))
  }
  const card = stream.events.find(e => e.type === 'question')
  report(card !== undefined, 'C1 缺信息时，模型选择弹提问卡片（而不是在正文里问一句就停下）', [
    card === undefined
      ? `没弹卡片。助手说的是：${stream.events.filter(e => e.type === 'assistant').map(e => e.text).join(' / ').slice(0, 160)}`
      : card.question.questions.map(q => `${q.id}:${q.question}`).join(' | ').slice(0, 200),
  ])

  if (card !== undefined) {
    /*
     * C2 · 我们的答复真的回到了模型手里。
     *
     * 断言 `ask_user_question` 的**工具结果**里含有我们写的那段话：
     * `tool-ask-user` 把答复渲染成 JSON 当工具结果回给模型，
     * 所以这段字符串出现在工具结果里 = 模型确实收到了它。
     * 这个 token 是现造的，不可能靠巧合出现。
     *
     * 它必须放进**最后一道题**的 `custom`：模型给几道题由它决定
     * （实测见过 1 道、也见过 5 道），如果只给「下标 > 0 的题」写 token，
     * 模型只问一道的时候 token 就没进答案——这是实测踩到的假失败。
     */
    const nonce = `备注用-${Math.random().toString(36).slice(2, 8)}`
    const questions = card.question.questions
    const answers = questions.map((q, index) => {
      if (index === questions.length - 1) return { id: q.id, selected: [], custom: nonce }
      const options = q.options ?? []
      return {
        id: q.id,
        selected: options.length > 0 ? [options[0].label] : [],
        ...options.length === 0 ? { custom: '1000 元' } : {},
      }
    })

    // **先取快照再答复**：C3 要判"答复之后有没有进展"，
    // 快照取晚了会把 C2b 等待期间的事件算进来，于是永远等不到"新"事件。
    const beforeAnswer = stream.events.length

    const res = await answerQuestion(card.question.questionId, answers)
    report(res.status === 200, 'C2a 答复被接受（200）', [`实际 ${res.status}`])

    const d2 = Date.now() + 120_000
    while (Date.now() < d2) {
      if (stream.events.some(e => e.type === 'tool-result' && (e.text ?? '').includes(nonce))) break
      if (stream.events.some(e => e.type === 'error')) break
      await new Promise(r => setTimeout(r, 800))
    }
    const hit = stream.events.find(e => e.type === 'tool-result' && (e.text ?? '').includes(nonce))
    report(
      hit !== undefined,
      'C2b 我们填的答案出现在 ask_user_question 的工具结果里（答复真的回到了模型）',
      [`找的是 ${nonce}`],
    )

    /*
     * C3 · 拿到答复之后模型要**继续往下走**，不能卡死。
     *
     * 不能断言"这一轮结束（idle）"：实测里模型答完第一张卡之后**会再问一张**
     * （补充信息），这时候它既没 idle、也没卡死，而是在等用户。
     * 那正是这个功能该有的样子。
     *
     * 所以断言的是**有进展**：答复之后必须再出现新的 SSE 事件——
     * 新问题、新工具调用、新助手消息，或者真的结束了，四者之一都算。
     */
    const fresh = () => stream.events.slice(beforeAnswer).filter(e =>
      e.type === 'question' || e.type === 'tool-call' || e.type === 'assistant'
      || (e.type === 'status' && e.status === 'idle'))
    // **要等**：C2b 一命中工具结果就返回了，那一刻模型还没说下一句。
    const d3 = Date.now() + 90_000
    while (Date.now() < d3 && fresh().length === 0) {
      if (stream.events.slice(beforeAnswer).some(e => e.type === 'error')) break
      await new Promise(r => setTimeout(r, 500))
    }
    report(
      fresh().length > 0,
      'C3 拿到答复后模型继续往下走（再问一张 / 调工具 / 说话 / 结束，都算）',
      [`答复之后新增的事件：${fresh().map(e => e.type).join(',') || '（什么都没有，卡住了）'}`],
    )
    // 如果它又问了一张，别把那张卡挂着——后面还要用干净的会话。
    const followUp = stream.events.slice(beforeAnswer).find(e => e.type === 'question')
    if (followUp !== undefined) {
      await answerQuestion(followUp.question.questionId, followUp.question.questions.map(q => ({
        id: q.id, selected: [], custom: '先不办这个了',
      })))
    }
  }
  await stream.close()
}

/* ───────────── D. 界面 ───────────── */

console.log('\n== D. 界面：卡片、单选/多选/自由输入、提交 ==')

async function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const dirs = (await readdir(cache)).filter(d => d.startsWith('chromium-'))
  return path.join(cache, dirs.sort().at(-1), 'chrome-linux64', 'chrome')
}

const browser = await chromium.launch({ executablePath: await findChrome() })
try {
  const page = await browser.newPage()
  await login(page, BASE, { to: '/support' })

  /*
   * 拿到这一页正在用的会话 id：它自己发的 SSE 请求 URL 里就有。
   * 拿到之后我们就能**自己造一道题**打给它——这样单选/多选/自由输入
   * 三条路都能确定性地覆盖到，不用求模型这次给出什么样的题。
   */
  let pageSessionId = ''
  page.on('request', (request) => {
    const matched = request.url().match(/\/agent-api\/sessions\/([^/]+)\/stream/)
    if (matched !== null) pageSessionId = matched[1]
  })

  // 先发一句话，页面才会连上事件流（会话是懒创建的）。
  await page.getByPlaceholder(/描述你的需求/).fill('你好')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const waitId = Date.now() + 15_000
  while (Date.now() < waitId && pageSessionId === '') await new Promise(r => setTimeout(r, 200))
  report(pageSessionId !== '', 'D0 抓到了页面正在使用的会话 id', [`sessionId=${pageSessionId}`])

  const held = postQuestion(pageSessionId, THREE_WAY)
  const card = page.locator('[data-question-card]')
  await card.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
  report(await card.count() === 1, 'D1 提问卡片弹了出来')

  // D2 · 三种问法各自渲染对了控件
  {
    const single = page.locator('[data-question-id="single"]')
    const multi = page.locator('[data-question-id="multi"]')
    const free = page.locator('[data-question-id="free"]')
    const singleRadios = await single.locator('input[type="radio"]').count()
    const multiChecks = await multi.locator('input[type="checkbox"]').count()
    const freeOptions = await free.locator('input[type="radio"], input[type="checkbox"]').count()
    const freeCustom = await free.locator('[data-question-custom]').count()
    report(singleRadios === 3, 'D2 单选题渲染 2 个选项和自填 radio', [`实际 ${singleRadios}`])
    report(multiChecks === 4, 'D3 多选题渲染 3 个选项和自填 checkbox', [`实际 ${multiChecks}`])
    report(freeOptions === 0 && freeCustom === 1, 'D4 没给选项的那道题：没有选项，但有自由输入框', [
      `选项 ${freeOptions} 个，输入框 ${freeCustom} 个`,
    ])
  }

  // D5 · 没答完时提交是禁用的
  {
    const submit = page.getByRole('button', { name: '提交' })
    const before = await submit.isDisabled()
    report(before, 'D5 一道题都没答时，「提交」是禁用的')
  }

  // D6 · 答完三种问法 → 提交可用
  {
    await page.locator('[data-question-id="single"] label', { hasText: '500 元' }).click()
    await page.locator('[data-question-id="single"] [data-question-custom]').fill('600 元')
    report(await page.locator('[data-question-id="single"] input[type="radio"]:checked').count() === 1
      && await page.locator('[data-question-id="single"]').getByRole('radio', { name: '自己填写', exact: true }).isChecked(),
      'D6a 自填自动选中，先前单选项取消')
    await page.locator('[data-question-id="single"] label', { hasText: '500 元' }).click()
    await page.locator('[data-question-id="multi"] label', { hasText: '查余额' }).click()
    await page.locator('[data-question-id="multi"] label', { hasText: '看理财' }).click()
    await page.locator('[data-question-id="free"] [data-question-custom]').fill('房租')
    const submit = page.getByRole('button', { name: '提交' })
    report(await submit.isEnabled(), 'D6 三道题都答了之后，「提交」变为可用')
    await submit.click()
  }

  // D7 · 提交的答案原样到达服务端
  {
    const settled = await held.promise
    const answers = settled.body?.answers ?? []
    const single = answers.find(a => a.id === 'single')
    const multi = answers.find(a => a.id === 'multi')
    const free = answers.find(a => a.id === 'free')
    report(
      JSON.stringify(single?.selected) === JSON.stringify(['500 元'])
      && JSON.stringify([...(multi?.selected ?? [])].sort()) === JSON.stringify(['查余额', '看理财'])
      && single?.custom === undefined && free?.custom === '房租',
      'D7 界面提交的答案（单选 1 个 / 多选 2 个 / 自由输入）原样到达服务端',
      [`收到：${JSON.stringify(answers)}`],
    )
  }

  // D8 · 卡片收起来
  {
    await card.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
    report(await page.locator('[data-question-card]').count() === 0, 'D8 答复之后卡片从界面上收起来')
  }

  await page.close()
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\ncheck-ask: 全部通过' : `\ncheck-ask: ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
