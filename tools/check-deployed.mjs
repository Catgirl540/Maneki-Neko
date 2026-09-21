#!/usr/bin/env node
/**
 * 线上部署自检：**公网**那份是不是真的能用。
 *
 * 为什么单独有这个：`tools/deploy-bank.sh` 末尾的自检只看 HTTP 状态码，
 * 而"200"完全可能是"静态文件在、但 agent 连不上、回落成固定话术"——
 * 那正是上一版线上部署的状态（`VITE_AGENT_ENABLED=false`）。
 * 状态码看不出这件事，必须真的发一句话、真的收一次音频。
 *
 * 用法：
 *   node tools/check-deployed.mjs
 *   BANK_BASE=https://bank.waveflow.cn node tools/check-deployed.mjs
 *
 * 注意：
 *   · 会**真的调一次模型**（几厘钱）与**一次语音合成**，不是纯静态检查。
 *   · 会走一遍真实登录（手机号 + 密码 + 演示验证码）。
 *   · 打的是公网端点，受服务器 nginx 限流（每 IP 30r/m）约束，别循环刷。
 */
import { chromium } from 'playwright-core'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { login as loginWithCode } from './lib/session.mjs'

const BASE = (process.env.BANK_BASE ?? 'https://bank.waveflow.cn').replace(/\/$/, '')

let pass = 0
let fail = 0
const ok = (title) => { console.log(`PASS  ${title}`); pass += 1 }
const bad = (title, detail = '') => {
  console.log(`FAIL  ${title}${detail === '' ? '' : `\n      ${detail}`}`)
  fail += 1
}

async function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright')
  const dirs = (await readdir(cache)).filter((d) => d.startsWith('chromium-'))
  if (!dirs.length) throw new Error('没找到 playwright 的 chromium')
  return path.join(cache, dirs.sort().at(-1), 'chrome-linux64', 'chrome')
}

/** 带超时的 fetch，公网请求不能无限等。 */
async function get(url, init = {}, ms = 20_000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

console.log(`线上自检：${BASE}\n`)

// ── 1. 站点活着，而且给的是当前这份 bundle ──────────────────────────────
let entryHtml = ''
try {
  const res = await get(`${BASE}/`)
  entryHtml = await res.text()
  if (res.status === 200) ok('站点首页 200')
  else bad('站点首页状态码不对', `实际 ${res.status}`)

  const refs = [...entryHtml.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g)].map((m) => m[0])
  if (refs.length === 0) {
    bad('首页里找不到 assets 引用', '外壳 HTML 可能不是 Vite 产物')
  } else {
    const codes = await Promise.all(refs.map(async (r) => (await get(`${BASE}${r}`)).status))
    const allOk = codes.every((c) => c === 200)
    if (allOk) ok(`首页引用的 ${refs.length} 个资源都能下载`)
    else bad('有资源下载不到（发了新版但 assets 没传全？）', JSON.stringify(refs.map((r, i) => `${r}:${codes[i]}`)))
  }
} catch (e) {
  bad('站点首页请求失败', String(e))
}

// SPA 深链接必须回落，否则刷新子页就 404（最常见的上线事故）
try {
  const res = await get(`${BASE}/dashboard`)
  if (res.status === 200) ok('深链接 /dashboard 回落正常')
  else bad('深链接 /dashboard 没有回落', `实际 ${res.status}`)
} catch (e) {
  bad('深链接请求失败', String(e))
}

// ── 2. agent 端点真的在（而不是被 nginx 当成静态路径吃掉）────────────────
try {
  const res = await get(`${BASE}/agent-api/health`)
  const text = await res.text()
  const body = JSON.parse(text)
  if (res.status === 200 && body.ok === true) ok('agent 端点可达且 ok=true')
  else bad('agent 端点响应不对', `${res.status} ${text.slice(0, 160)}`)

  // P11：这个响应是浏览器/手机直接看到的，模型与厂商名不能出现在这里
  if (/"model"|"provider"/.test(text)) bad('health 里夹带了模型名/厂商名（违反 P11）', text.slice(0, 160))
  else ok('health 不夹带模型名/厂商名')

  if (body.voice?.tts === true && body.voice?.asr === true) ok('服务端如实报出语音能力')
  else bad('语音能力没报出来', text.slice(0, 160))
} catch (e) {
  bad('agent health 请求失败', String(e))
}

// ── 3. 语音流是真流式（首帧必须早于结束）────────────────────────────────
try {
  const res = await get(
    `${BASE}/agent-api/tts/stream`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '您好，请问您要办理什么业务呢？' }),
    },
    60_000,
  )
  const raw = await res.text()
  const events = [...raw.matchAll(/^event: (\w+)/gm)].map((m) => m[1])
  const audioCount = events.filter((e) => e === 'audio').length
  const hasStart = events.includes('start')
  const hasEnd = events.includes('end')

  if (hasStart && audioCount > 0 && hasEnd) ok(`语音流正常：start → audio×${audioCount} → end`)
  else bad('语音流事件不全', `events=${events.join(',') || '（空）'}`)
  // 这句是"真流式"的判据：没有任何音频帧就说明上游/代理有问题
  if (audioCount === 0) bad('一个音频帧都没有（合成失败或全被缓冲）')
} catch (e) {
  bad('语音流请求失败', String(e))
}

// ── 4. 浏览器里真的连上了 agent，而不是回落固定话术 ─────────────────────
const executablePath = await findChrome()
const browser = await chromium.launch({ executablePath })
try {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await loginWithCode(page, BASE, { to: '/support' })

  // 这条锚点是"前端认为 agent 可用"的证据：它由 /agent-api/health 的结果驱动。
  // 回落成固定话术时这个属性不会是 ready（那正是上一版线上的状态）。
  const ready = await page
    .locator('[data-agent-status="ready"]')
    .waitFor({ state: 'visible', timeout: 25_000 })
    .then(() => true)
    .catch(() => false)

  if (ready) ok('网页显示「已连接 agent」（不是回落固定话术）')
  else {
    const fallback = await page.locator('[data-agent-status]').first().getAttribute('data-agent-status').catch(() => null)
    bad('网页没有连上 agent', `页面上的 data-agent-status=${fallback ?? '（读不到）'}`)
  }

  if (ready) {
    // 真发一句，等助手回复。这一条才证明模型调用在服务器上真的通。
    await page.getByPlaceholder('描述你的需求', { exact: false }).fill('你好')
    await page.keyboard.press('Enter')

    const replied = await page
      .locator('[data-message-kind="assistant"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true)
      .catch(() => false)

    if (!replied) {
      bad('发了消息但没等到助手回复')
    } else {
      const texts = await page.locator('[data-message-kind="assistant"]').allInnerTexts()
      const reply = texts.map((t) => t.trim()).filter(Boolean).join(' ')
      if (reply.length > 0) ok(`助手真的回了话（${reply.length} 字）：${reply.slice(0, 60)}…`)
      else bad('助手气泡是空的')
    }
  }

  if (consoleErrors.length === 0) ok('页面没有 JS 运行时报错')
  else bad('页面有 JS 运行时报错', consoleErrors.slice(0, 3).join(' | '))
} catch (e) {
  bad('浏览器流程失败', String(e))
} finally {
  await browser.close()
}

console.log()
console.log(`线上自检：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
