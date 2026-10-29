/** 将 Android APK 及从 APK 读取的元数据放入官网静态目录；不上传、不连接银行。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const destination = path.join(root, 'app/public/downloads')
const archive = path.join(root, 'android-app/build/download-archive')
const manifest = path.join(destination, 'android.json')
const args = process.argv.slice(2)
assert(args.length <= 1, '用法：node tools/package-android-download.mjs [APK 路径 | --check]')
async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function check(data, base = destination) {
  assert.equal(data.schemaVersion, 1, '元数据版本错误')
  assert.equal(data.packageName, 'com.moneymeow.bank', '不是招财猫安装包')
  assert.match(data.versionName, /^[\w.+-]{1,40}$/)
  assert(Number.isSafeInteger(data.versionCode) && data.versionCode >= 1)
  assert(Number.isSafeInteger(data.minSdk) && data.minSdk >= 26)
  assert.equal(typeof data.debuggable, 'boolean')
  assert(data.releaseNotes === undefined || (typeof data.releaseNotes === 'string' && data.releaseNotes.length <= 2000), '更新说明太长或格式不正确')
  assert(Array.isArray(data.abis) && data.abis.length && data.abis.every(abi => ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].includes(abi)))
  assert.match(data.fileName, /^luckycat-android-[a-f0-9]{12}\.apk$/)
  assert.match(data.sha256, /^[a-f0-9]{64}$/)
  assert.equal(data.fileName, `luckycat-android-${data.sha256.slice(0, 12)}.apk`)
  let file = path.join(base, data.fileName)
  try {
    await stat(file)
  } catch (error) {
    // 对象存储发布时本地只保留回滚副本，构建检查仍要核对同一安装包。
    if (base !== destination || !data.apkUrl || error.code !== 'ENOENT') throw error
    file = path.join(archive, data.fileName)
  }
  const info = await stat(file)
  assert(info.isFile() && info.size > 1024 && info.size === data.bytes, 'APK 缺失或大小与元数据不符')
  const handle = await open(file)
  try {
    const magic = Buffer.alloc(4)
    await handle.read(magic, 0, 4, 0)
    assert(magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), '下载文件不是 APK/ZIP')
  } finally { await handle.close() }
  assert.equal(await sha256(file), data.sha256, 'APK 校验值不符，请重新准备安装包')
  console.log(`PASS 安卓下载：${data.versionName} (${data.versionCode})，${(data.bytes / 1024 / 1024).toFixed(1)} MB${data.debuggable ? '，调试版' : ''}`)
}

try {
  if (args[0] === '--check') {
    await check(JSON.parse(await readFile(manifest, 'utf8')))
  } else {
    const source = path.resolve(root, args[0] ?? 'android-app/app/build/outputs/apk/debug/app-debug.apk')
    await access(source)
    const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME ?? path.join(homedir(), 'Android/Sdk')
    const versions = (await readdir(path.join(sdk, 'build-tools'))).filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    assert(versions.length, '需要 Android SDK build-tools 来核对 APK')
    const buildTools = path.join(sdk, 'build-tools', versions.at(-1))
    const badging = execFileSync(path.join(buildTools, 'aapt'), ['dump', 'badging', source], { encoding: 'utf8' })
    execFileSync(path.join(buildTools, 'apksigner'), ['verify', source], { stdio: 'pipe' })
    const field = name => {
      const value = badging.match(new RegExp(`${name}='([^']+)'`))?.[1]
      assert(value, `APK 缺少 ${name}`)
      return value
    }
    const hash = await sha256(source)
    const releaseVersion = field('versionName')
    assert.match(releaseVersion, /^[\w.+-]{1,40}$/)
    let releaseNotes = ''
    try {
      releaseNotes = (await readFile(path.join(root, 'android-app/releases', `${releaseVersion}.md`), 'utf8')).replace(/^# [^\n]+\n/, '').trim()
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const data = {
      schemaVersion: 1,
      fileName: `luckycat-android-${hash.slice(0, 12)}.apk`,
      packageName: badging.match(/^package: name='([^']+)'/m)?.[1],
      versionName: releaseVersion, versionCode: Number(field('versionCode')),
      minSdk: Number(badging.match(/^sdkVersion:'(\d+)'/m)?.[1]),
      bytes: (await stat(source)).size, sha256: hash,
      debuggable: /^application-debuggable/m.test(badging),
      releaseNotes,
      // 无 native-code 的 APK 是纯 Kotlin/Java 包，跑在全部支持的 ABI 上
      abis: (() => {
        const native = [...(badging.match(/^native-code: (.+)$/m)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(match => match[1])
        return native.length ? native : ['arm64-v8a', 'armeabi-v7a', 'x86_64']
      })(),
    }
    assert.equal(data.packageName, 'com.moneymeow.bank', '拒绝发布其他应用的安装包')
    // 配了 PUBLIC_BASE_URL 时 APK 由对象存储托管，清单里只写固定地址。
    const publicBase = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '')
    const manifestData = publicBase
      ? { ...data, apkUrl: `${publicBase}/android/app-${data.versionCode}.apk` }
      : data
    await mkdir(destination, { recursive: true })
    await mkdir(archive, { recursive: true })
    if (publicBase) {
      // 本地只留回滚副本，不进 dist。
      await copyFile(source, path.join(archive, data.fileName))
    } else {
      const target = path.join(destination, data.fileName)
      await copyFile(source, target + '.tmp')
      await rename(target + '.tmp', target)
    }
    await check(manifestData, publicBase ? archive : destination)
    await writeFile(manifest + '.tmp', JSON.stringify(manifestData, null, 2) + '\n')
    await rename(manifest + '.tmp', manifest)
    // 旧包留在本机构建目录供回滚，不让每次网页构建携带所有历史 APK。
    for (const name of await readdir(destination)) {
      if (/^luckycat-android-[a-f0-9]{12}\.apk$/.test(name)) {
        await rename(path.join(destination, name), path.join(archive, name))
      }
    }
    console.log(publicBase
      ? `已写入下载清单，APK 由对象存储提供：${manifestData.apkUrl}`
      : '已准备官网静态下载文件，构建时会一并复制到 app/dist/downloads/')
  }
} catch (error) {
  console.error(`FAIL ${error.message}\n先构建 Android APK（android-app 的 :app:assembleDebug），再运行 npm --prefix app run prepare:android；不会生成无效下载链接。`)
  process.exitCode = 1
}
