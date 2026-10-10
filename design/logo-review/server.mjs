/**
 * 招财猫银行 · Logo 方案评审站（抖音式竖滑 feed）
 *
 * 静态页 + 接口：投票 / 按图评论 / 上传方案。零依赖，只用 node:http。
 * 数据落在服务器本地（默认 /var/lib/logo-review/），不进仓库。
 *
 * 环境变量：
 *   PORT                监听端口，默认 8091
 *   LOGO_REVIEW_DATA    数据文件路径，默认 /var/lib/logo-review/state.json
 *   LOGO_REVIEW_UPLOADS 上传目录，默认 /var/lib/logo-review/uploads
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = dirname(fileURLToPath(import.meta.url))
const IMG_DIR = join(ROOT, 'img')
const INDEX = join(ROOT, 'index.html')
const DATA = process.env.LOGO_REVIEW_DATA ?? '/var/lib/logo-review/state.json'
const UPLOADS = process.env.LOGO_REVIEW_UPLOADS ?? '/var/lib/logo-review/uploads'
const PORT = Number(process.env.PORT ?? 8091)
const MAX_UPLOAD = 6 * 1024 * 1024
const MAX_UPLOADS = 60

/** 内置候选：顺序即 feed 顺序。 */
const CANDIDATES = [
  { id: 'current', title: '当前线上版本', tag: '现状', file: 'current.svg' },
  { id: 'anime-cat', title: '二次元 · 招财猫', tag: '动漫 Q 版', file: 'anime-cat.webp' },
  { id: 'anime-neko-girl', title: '二次元 · 猫娘', tag: '动漫 Q 版', file: 'anime-neko-girl.webp' },
  { id: 'anime-cat-face', title: '二次元 · 猫脸标', tag: '动漫 Q 版', file: 'anime-cat-face.webp' },
  { id: 'mascot', title: '抬爪猫咪', tag: '极简扁平', file: 'mascot.webp' },
  { id: 'cat-head', title: '几何猫脸', tag: '极简扁平', file: 'cat-head.webp' },
  { id: 'cat-coin', title: '猫爪金币', tag: '极简扁平', file: 'cat-coin.webp' },
  { id: 'app-icon', title: 'App 图标（负空间）', tag: '应用图标', file: 'app-icon.webp' },
  { id: 'hy-1', title: '金像招财猫', tag: '腾讯 HY 3.5', file: 'hy-1.webp' },
  { id: 'hy-2', title: '新春招财', tag: '腾讯 HY 3.5', file: 'hy-2.webp' },
  { id: 'hy-3', title: '粉金猫徽', tag: '腾讯 HY 3.5', file: 'hy-3.webp' },
  { id: 'hy-4', title: '金线猫头 · 元宝', tag: '腾讯 HY 3.5', file: 'hy-4.webp' },
  { id: 'ming-1', title: '猫徽 · 完整锁定', tag: 'Ming 0.1 设计', file: 'ming-1.webp' },
  { id: 'ming-2', title: '蝴蝶结招财猫', tag: 'Ming 0.1 设计', file: 'ming-2.webp' },
  { id: 'ming-3', title: 'Q 版猫 · 粉', tag: 'Ming 0.1 设计', file: 'ming-3.webp' },
  { id: 'ming-4', title: '金色猫偶', tag: 'Ming 0.1 设计', file: 'ming-4.webp' },
]
const STATIC_IDS = new Set(CANDIDATES.map((c) => c.id))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
}

function sniffImage(buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  const head = buf.toString('utf8', 0, Math.min(buf.length, 256)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!doctype svg')) return 'svg'
  return null
}

let state = { votes: {}, comments: [], uploads: [] }
async function load() {
  try {
    if (existsSync(DATA)) {
      const p = JSON.parse(await readFile(DATA, 'utf8'))
      state = {
        votes: p.votes ?? {},
        comments: Array.isArray(p.comments) ? p.comments : [],
        uploads: Array.isArray(p.uploads) ? p.uploads : [],
      }
      // 兼容旧字段 choice -> candidateId
      state.comments = state.comments.map((c) => ({ ...c, candidateId: c.candidateId ?? c.choice ?? '' }))
    }
    state.uploads = state.uploads.filter((u) => existsSync(join(UPLOADS, u.file)))
  } catch (err) {
    console.error('[logo-review] 读取数据失败，用空状态启动：', err.message)
  }
}
let saving = Promise.resolve()
function save() {
  saving = saving.then(async () => {
    await mkdir(dirname(DATA), { recursive: true })
    await writeFile(DATA, JSON.stringify(state, null, 2))
  }).catch((e) => console.error('[logo-review] 保存失败：', e.message))
  return saving
}

const uploadCandidates = () =>
  state.uploads.map((u) => ({ id: u.id, title: u.title, tag: '网友上传', file: u.file, by: u.by, url: `/uploads/${u.file}` }))
const allCandidates = () => [...CANDIDATES, ...uploadCandidates()]
const isValidId = (id) => STATIC_IDS.has(id) || state.uploads.some((u) => u.id === id)
const commentCounts = () => {
  const m = {}
  for (const c of state.comments) m[c.candidateId] = (m[c.candidateId] ?? 0) + 1
  return m
}

const hits = new Map()
function rateLimited(ip, limit = 40, windowMs = 60_000) {
  const now = Date.now()
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
  arr.push(now); hits.set(ip, arr)
  return arr.length > limit
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers }); res.end(body)
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8' })
}
async function readRaw(req, limit) {
  let size = 0; const chunks = []
  for await (const c of req) {
    size += c.length; if (size > limit) throw new Error('too large'); chunks.push(c)
  }
  return Buffer.concat(chunks)
}
const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '')

await mkdir(UPLOADS, { recursive: true })
await load()

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '?'

  if (req.method === 'POST' && ['/api/vote', '/api/comment', '/api/upload'].includes(path)) {
    if (rateLimited(ip)) return json(res, 429, { error: '操作太频繁，歇一会再试' })
  }

  if (req.method === 'GET' && path === '/api/state') {
    return json(res, 200, { candidates: allCandidates(), votes: state.votes, commentCounts: commentCounts() })
  }

  // 某张图下的评论
  if (req.method === 'GET' && path === '/api/comments') {
    const id = clean(url.searchParams.get('id'), 64)
    if (!isValidId(id)) return json(res, 400, { error: '未知方案' })
    const list = state.comments.filter((c) => c.candidateId === id).slice(0, 200)
    return json(res, 200, { comments: list })
  }

  if (req.method === 'POST' && path === '/api/vote') {
    try {
      const body = JSON.parse((await readRaw(req, 4096)).toString('utf8') || '{}')
      const id = clean(body.id, 64)
      if (!isValidId(id)) return json(res, 400, { error: '未知方案' })
      state.votes[id] = (state.votes[id] ?? 0) + 1
      save()
      return json(res, 200, { ok: true, votes: state.votes })
    } catch { return json(res, 400, { error: '请求无效' }) }
  }

  // 评论必须挂在某张图上
  if (req.method === 'POST' && path === '/api/comment') {
    try {
      const body = JSON.parse((await readRaw(req, 16 * 1024)).toString('utf8') || '{}')
      const candidateId = clean(body.candidateId, 64)
      if (!isValidId(candidateId)) return json(res, 400, { error: '未知方案' })
      const text = clean(body.text, 1000)
      const name = clean(body.name, 40) || '匿名开发者'
      if (text.length < 2) return json(res, 400, { error: '多写两个字吧' })
      const comment = { id: randomUUID(), candidateId, name, text, at: new Date().toISOString() }
      state.comments.unshift(comment)
      if (state.comments.length > 1000) state.comments.length = 1000
      save()
      return json(res, 200, { ok: true, comment })
    } catch { return json(res, 400, { error: '请求无效或内容过大' }) }
  }

  if (req.method === 'POST' && path === '/api/upload') {
    if (state.uploads.length >= MAX_UPLOADS) return json(res, 429, { error: '上传名额已满' })
    let buf
    try { buf = await readRaw(req, MAX_UPLOAD) }
    catch { return json(res, 413, { error: `文件太大了（上限 ${MAX_UPLOAD / 1024 / 1024}MB）` }) }
    const ext = sniffImage(buf)
    if (ext === null) return json(res, 415, { error: '只认 PNG / JPG / GIF / WebP / SVG 图片' })
    const title = clean(url.searchParams.get('title'), 40) || '网友方案'
    const by = clean(url.searchParams.get('by'), 40) || '匿名开发者'
    const id = 'up_' + randomUUID().slice(0, 8)
    const file = `${id}.${ext}`
    await writeFile(join(UPLOADS, file), buf)
    state.uploads.push({ id, title, by, file, at: new Date().toISOString() })
    save()
    return json(res, 200, { ok: true, candidate: uploadCandidates().at(-1) })
  }

  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    return send(res, 200, await readFile(INDEX), { 'content-type': MIME['.html'] })
  }

  if (req.method === 'GET' && (path.startsWith('/img/') || path.startsWith('/uploads/'))) {
    const isUpload = path.startsWith('/uploads/')
    const base = isUpload ? UPLOADS : IMG_DIR
    const rel = normalize(decodeURIComponent(path.slice(isUpload ? 9 : 5))).replace(/^([.]{2}[\\/])+/, '')
    const file = join(base, rel)
    if (!file.startsWith(base) || !existsSync(file)) return send(res, 404, 'not found')
    const headers = {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=600',
      'x-content-type-options': 'nosniff',
    }
    if (isUpload) headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
    return send(res, 200, await readFile(file), headers)
  }

  send(res, 404, 'not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[logo-review] http://127.0.0.1:${PORT}  data=${DATA}  uploads=${UPLOADS}`)
})
