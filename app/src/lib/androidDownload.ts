export interface AndroidDownload {
  schemaVersion: 1
  fileName: string
  versionName: string
  versionCode: number
  packageName: string
  minSdk: number
  bytes: number
  sha256: string
  debuggable: boolean
  abis: string[]
  /** 对象存储上的固定下载地址；缺省时回落到站内 downloads/。 */
  apkUrl?: string
}

/** 仅接受本站生成的 APK 元数据，不能把下载按钮指向外部地址或 SPA 页面。 */
export function parseAndroidDownload(value: unknown): AndroidDownload {
  if (!value || typeof value !== 'object') throw new Error('安装包信息暂不可用')
  const data = value as Record<string, unknown>
  if (data.schemaVersion !== 1 || data.packageName !== 'com.moneymeow.bank'
    || typeof data.fileName !== 'string' || !/^luckycat-android-[a-f0-9]{12}\.apk$/.test(data.fileName)
    || typeof data.versionName !== 'string' || !/^[\w.+-]{1,40}$/.test(data.versionName)
    || !Number.isSafeInteger(data.versionCode) || Number(data.versionCode) < 1
    || !Number.isSafeInteger(data.minSdk) || Number(data.minSdk) < 26
    || !Number.isSafeInteger(data.bytes) || Number(data.bytes) < 1024
    || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)
    || !data.fileName.includes(data.sha256.slice(0, 12))
    || typeof data.debuggable !== 'boolean'
    || !Array.isArray(data.abis) || !data.abis.length
    || !data.abis.every(abi => ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].includes(abi))
    || (data.apkUrl !== undefined
      && (typeof data.apkUrl !== 'string'
        || !/^https:\/\/[\w.-]+\/android\/app-\d+\.apk$/.test(data.apkUrl)))) {
    throw new Error('安装包信息暂不可用')
  }
  return data as unknown as AndroidDownload
}

export function androidRequirement(minSdk: number) {
  return minSdk === 26 ? 'Android 8.0 及以上' : `Android API ${minSdk} 及以上`
}
