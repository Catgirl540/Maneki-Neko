import './legacy-sqlite-fixture-disabled.mjs'
/** Opt-in, billable image/ASR/TTS smoke test. Only generated media and temporary bank data. */
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

if (!process.env.OPENROUTER_API_KEY) throw Error('请先配置进程环境 OPENROUTER_API_KEY')
const root = fileURLToPath(new URL('../', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'staff-media-live-'))
const children = []
let browser
const secrets = Object.entries(process.env).filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD/.test(name) && value?.length > 8).map(([, value]) => value)
const safe = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[已隐藏]'), String(value))
const free = async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port
}
const [bankPort, agentPort] = await Promise.all([free(), free()])
const bank = `http://127.0.0.1:${bankPort}`, agent = `http://127.0.0.1:${agentPort}`
const start = (file, env) => {
  const child = spawn(process.execPath, [join(root, file)], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] })
  // Keep error details in memory; never persist process credentials or upstream bodies.
  let stderr = ''; child.stderr.on('data', data => { stderr = (stderr + safe(data)).slice(-4000) })
  children.push(child); return () => stderr
}
const request = async (base, path, token, body) => {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json',
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw Error(safe(`${path}: HTTP ${response.status} ${await response.text()}`))
  return response
}
const api = async (...args) => (await request(...args)).json()
const ready = async (base, path, token, logs) => {
  for (let i = 0; i < 100; i++) {
    try { return await api(base, path, token) } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  throw Error(safe(`本地服务未就绪：${logs()}`))
}
try {
  const bankEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD/.test(name)))
  const bankLog = start('server/index.mjs', { ...bankEnv, BANK_PORT: String(bankPort), BANK_DB_FILE: join(dir, 'bank.sqlite'), BANK_STATE_FILE: join(dir, 'empty.json') })
  await ready(bank, '/health', null, bankLog)
  const staff = await api(bank, '/staff-api/login', null, { name: '王小明', password: '123456' })
  secrets.push(staff.token)
  const agentLog = start('framework/bridge/staff-server.mjs', { ...process.env,
    LUCKYCAT_DEMO_PORT: String(agentPort), LUCKYCAT_BANK_URL: bank,
    LUCKYCAT_PROVIDER: 'openrouter', LUCKYCAT_MODEL: process.env.LUCKYCAT_MODEL ?? 'qwen/qwen3.8-flash',
    LUCKYCAT_PATCHES: '', LUCKYCAT_FALLBACK_MODELS: '', LUCKYCAT_SESSION_DIR: join(dir, 'staff-context'),
  })
  const health = await ready(agent, '/agent-api/health', staff.token, agentLog)
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true })
  const page = await browser.newPage()
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 120
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 320, 120)
    ctx.fillStyle = 'black'; ctx.font = '80px sans-serif'; ctx.fillText('7314', 20, 90)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const { sessionId } = await api(agent, '/agent-api/sessions', staff.token, {})
  await api(agent, `/agent-api/sessions/${sessionId}/messages`, staff.token, {
    text: '这是本地虚拟验收图片，不涉及客户资料。图片中的四位工单编号是什么？仅回答编号，不要调用工具。', image: { data: image, mimeType: 'image/png' },
  })
  let cursor = '0', running = false, done = false, reply = ''
  for (let i = 0; i < 360 && !done; i++) {
    const events = await api(agent, `/agent-api/sessions/${sessionId}/events?after=${cursor}`, staff.token)
    cursor = events.cursor
    for (const event of events.events) {
      if (event.type === 'consent') {
        await api(agent, `/agent-api/consent/${event.challenge.challengeId}`, staff.token, { decision: 'reject' })
        throw Error('图片验收不应发起银行工具操作')
      }
      if (event.type === 'error') throw Error(safe(event.message))
      if (event.type === 'assistant') reply += event.text
      if (event.type === 'status') { if (event.status === 'running') running = true; else if (running) done = true }
    }
    if (!done) await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert(done, '真实视觉模型超时'); assert(reply.includes('7314'), '真实模型没有读出生成的工单编号')
  console.log('PASS 真实模型经员工桥接识别生成图片，无客户资料和业务工具调用')
  assert(health.voice?.stream, '没有配置流式语音凭据')
  const stream = await request(agent, '/agent-api/tts/stream', staff.token, { text: '查询工单' })
  const body = await stream.text()
  assert(!body.includes('event: error'), safe(body.slice(-300)))
  const frames = [...body.matchAll(/event: audio\r?\ndata: ([^\r\n]+)/g)].map(match => Buffer.from(match[1], 'base64'))
  assert(frames.length > 0, '真实 TTS 没有返回音频帧')
  assert(body.includes('event: end'), '真实 TTS 提前断流')
  const meta = JSON.parse(body.match(/event: start\r?\ndata: ([^\r\n]+)/)[1])
  const pcm = Buffer.concat(frames), header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(meta.sampleRate, 24); header.writeUInt32LE(meta.sampleRate * 2, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  console.log('PASS 真实流式 TTS 经员工鉴权返回 PCM 音频')
  const transcript = await api(agent, '/agent-api/asr', staff.token, { audio: Buffer.concat([header, pcm]).toString('base64'), mimeType: 'audio/wav', language: 'zh' })
  assert(/工单/.test(transcript.text), '真实 ASR 未识别生成的“查询工单”音频')
  console.log('PASS 真实 ASR 经员工鉴权识别合成的验收音频')
} catch (error) {
  console.error(safe(error instanceof Error ? error.message : error)); process.exitCode = 1
} finally {
  await browser?.close()
  for (const child of children.reverse()) { child.kill(); if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve)) }
  await rm(dir, { recursive: true, force: true })
}
