/** 只读公网检查：子路径、资源类型、SPA 回落及同源代理。不登录、不调用模型。 */
import assert from 'node:assert/strict'

const base = new URL((process.env.BANK_BASE ?? 'http://120.48.123.112/bank/').replace(/\/?$/, '/'))
async function get(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) })
  const text = await response.text()
  return { response, text, type: response.headers.get('content-type') ?? '' }
}
try {
  const home = await get('')
  assert.equal(home.response.status, 200, '首页不可达')
  assert.match(home.type, /text\/html/, '首页类型不正确')
  const refs = [...home.text.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1])
  assert(refs.some(ref => ref.endsWith('.js')) && refs.some(ref => ref.endsWith('.css')), '首页缺少入口资源')
  for (const ref of refs) {
    const url = new URL(ref, base)
    assert(url.origin === base.origin && url.pathname.startsWith(base.pathname + 'assets/'), `资源未使用部署路径：${ref}`)
    const resource = await get(ref)
    assert.equal(resource.response.status, 200, `资源不可达：${ref}`)
    assert.match(resource.type, ref.endsWith('.js') ? /(?:javascript|ecmascript)/ : /text\/css/, `资源类型错误（可能返回了 HTML）：${ref}`)
  }
  console.log(`PASS 官网及 ${refs.length} 个入口资源路径、响应类型`)
  for (const path of ['login', 'dashboard', 'transfer', 'support', 'download']) {
    const page = await get(path)
    assert.equal(page.response.status, 200, `深链接不可达：${path}`)
    assert.equal(page.text, home.text, `深链接未返回同一网页入口：${path}`)
  }
  console.log('PASS 登录、账户、转账兼容路径、助手与下载页深链接回落')
  const manifest = await get('downloads/android.json')
  assert.equal(manifest.response.status, 200, '安装包元数据不可达')
  assert.match(manifest.type, /application\/json/, '安装包元数据返回了网页')
  const android = JSON.parse(manifest.text)
  assert.equal(android.packageName, 'com.moneymeow.bank')
  assert.match(android.sha256, /^[a-f0-9]{64}$/)
  assert.equal(android.fileName, `luckycat-android-${android.sha256.slice(0, 12)}.apk`)
  const apk = await fetch(new URL(`downloads/${android.fileName}`, base), {
    headers: { Range: 'bytes=0-3' }, signal: AbortSignal.timeout(15_000),
  })
  try {
    assert([200, 206].includes(apk.status), '安装包下载失败')
    assert.match(apk.headers.get('content-type') ?? '', /application\/(?:vnd\.android\.package-archive|octet-stream|zip)/, '下载入口返回了网页')
    if (apk.status === 206) assert.equal(apk.headers.get('content-range'), `bytes 0-3/${android.bytes}`)
    else assert.equal(Number(apk.headers.get('content-length')), android.bytes)
    const reader = apk.body.getReader()
    const chunks = []
    let length = 0
    try {
      while (length < 4) {
        const part = await reader.read()
        if (part.done) break
        chunks.push(part.value)
        length += part.value.length
      }
    } finally { await reader.cancel() }
    assert(Buffer.concat(chunks).subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), '安装包不是 APK/ZIP')
  } finally { await apk.body?.cancel().catch(() => {}) }
  console.log('PASS 安卓下载元数据、文件大小、响应类型与 APK 文件头')
  for (const path of ['api/accounts', 'agent-api/health']) {
    const result = await get(path)
    assert.equal(result.response.status, 401, `未登录接口应拒绝访问：${path}`)
    assert.match(result.type, /application\/json/, `接口代理返回了非 JSON：${path}`)
    assert.equal(typeof JSON.parse(result.text), 'object')
  }
  console.log('PASS 银行与 Agent 同源代理正常，未登录访问受保护')
} catch (error) {
  console.error(`FAIL ${error.message}`)
  process.exitCode = 1
}
