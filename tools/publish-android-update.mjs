#!/usr/bin/env node
/**
 * 发布安卓应用内更新到 Cloudflare R2（S3 兼容）。
 *
 * 做三件事：
 *  1. 把 `app-debug.apk` 上传到 `s3://<bucket>/android/app-<versionCode>.apk`
 *  2. 生成 `android/latest.json`（版本号、大小、sha256、下载地址）
 *  3. 因为桶没有公开域名，脚本会给 APK 与 manifest 各生成一个 7 天有效的
 *     预签名 URL，写进 `app/src/main/assets/update.json`，随应用一起打包。
 *
 * 用法：
 *   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
 *   AWS_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com \
 *   BUCKET_NAME=defaut node tools/publish-android-update.mjs [--notes "更新说明"]
 *
 * 备注：预签名 URL 最长 7 天（SigV4 限制）。生产环境应给桶配公开域名
 * （或让后端代理），届时把 assets/update.json 里的 url 换成固定地址即可，
 * 客户端逻辑不用改。
 */
import { createHash, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const appDir = path.join(root, 'android-app')
const apkPath = path.join(appDir, 'app/build/outputs/apk/debug/app-debug.apk')
const assetsDir = path.join(appDir, 'app/src/main/assets')
const gradlePath = path.join(appDir, 'app/build.gradle.kts')

const env = {
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_ENDPOINT_URL: (process.env.AWS_ENDPOINT_URL ?? '').replace(/\/$/, ''),
  BUCKET_NAME: process.env.BUCKET_NAME ?? 'defaut',
}
for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_ENDPOINT_URL']) {
  if (!env[key]) {
    console.error(`缺少环境变量 ${key}`)
    process.exit(2)
  }
}

const notesIndex = process.argv.indexOf('--notes')
const notes = notesIndex > -1 ? process.argv[notesIndex + 1] : '例行更新'

const gradle = readFileSync(gradlePath, 'utf8')
const versionCode = Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1] ?? 0)
const versionName = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1] ?? '0.0.0'
if (!versionCode) {
  console.error('无法从 build.gradle.kts 读取 versionCode')
  process.exit(2)
}

/**
 * 生成 7 天有效的预签名 GET 地址。
 * curl 没有暴露 presign，这里直接按 SigV4 规范算签名（不引第三方依赖）。
 */
function presign(objectKey) {
  const endpoint = new URL(env.AWS_ENDPOINT_URL)
  const host = endpoint.host
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const scope = `${day}/auto/s3/aws4_request`
  const canonicalUri = `/${env.BUCKET_NAME}/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.AWS_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '604800',
    'X-Amz-SignedHeaders': 'host',
  })
  const canonicalQuery = [...params.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join('&')
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n')
  const hmac = (key, value) => createHmac('sha256', key).update(value).digest()
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env.AWS_SECRET_ACCESS_KEY}`, day), 'auto'), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  return `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}


const apk = readFileSync(apkPath)
const sha256 = createHash('sha256').update(apk).digest('hex')
const key = `android/app-${versionCode}.apk`
const objectUrl = `${env.AWS_ENDPOINT_URL}/${env.BUCKET_NAME}/${key}`

/** 用 curl 的 SigV4 支持直接操作 S3 兼容接口，避免额外依赖。 */
function s3(args) {
  return execFileSync('curl', [
    '-sS',
    '--aws-sigv4', 'aws:amz:auto:s3',
    '--user', `${env.AWS_ACCESS_KEY_ID}:${env.AWS_SECRET_ACCESS_KEY}`,
    ...args,
  ], { encoding: 'utf8' })
}

console.log(`上传 ${path.relative(root, apkPath)}（${(apk.length / 1024 / 1024).toFixed(1)} MB）→ ${key}`)
const put = s3(['-X', 'PUT', '--upload-file', apkPath, '-H', 'Content-Type: application/vnd.android.package-archive', '-w', '%{http_code}', objectUrl])
if (!put.trim().endsWith('200')) {
  console.error('上传失败：', put.slice(0, 300))
  process.exit(1)
}

// 先给 APK 预签名，清单里带上它，旧版本客户端也能拿到最新下载地址
const apkUrlForManifest = presign(key)
const manifest = {
  versionCode,
  versionName,
  sha256,
  size: statSync(apkPath).size,
  key,
  apkUrl: apkUrlForManifest,
  notes,
  publishedAt: new Date().toISOString(),
}
const manifestKey = 'android/latest.json'
const tmpManifest = path.join(appDir, 'build/latest.json')
writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2))
console.log(`上传版本清单 → ${manifestKey}`)
const putManifest = s3(['-X', 'PUT', '--upload-file', tmpManifest, '-H', 'Content-Type: application/json', '-w', '%{http_code}', `${env.AWS_ENDPOINT_URL}/${env.BUCKET_NAME}/${manifestKey}`])
if (!putManifest.trim().endsWith('200')) {
  console.error('清单上传失败：', putManifest.slice(0, 300))
  process.exit(1)
}

// 配了公开域名就用稳定地址（推荐）；否则退回 7 天预签名
const publicBase = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '')
const apkUrl = publicBase ? `${publicBase}/${key}` : presign(key)
const manifestUrl = publicBase ? `${publicBase}/${manifestKey}` : presign(manifestKey)
if (!publicBase && (!apkUrl.includes('X-Amz-Signature') || !manifestUrl.includes('X-Amz-Signature'))) {
  console.error('预签名失败：请检查 AWS 凭据与端点')
  process.exit(1)
}
console.log(publicBase ? `使用公开域名：${publicBase}` : '未配置 PUBLIC_BASE_URL，使用 7 天预签名地址')

const bundled = {
  manifestUrl,
  apkUrl,
  versionCode,
  versionName,
  notes,
  expiresAt: publicBase ? null : new Date(Date.now() + 604800_000).toISOString(),
  publishedAt: manifest.publishedAt,
}
writeFileSync(path.join(assetsDir, 'update.json'), JSON.stringify(bundled, null, 2))
console.log('已写入 assets/update.json（含 7 天有效的预签名地址）')
console.log(`版本：${versionName} (${versionCode}) · sha256 ${sha256.slice(0, 12)}…`)
console.log(`APK：${apkUrl.slice(0, 96)}…`)
