import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppIcon, Logo } from '@/components/brand/Logo'
import { DownloadIcon, ArrowLeftIcon, WalletIcon, PigIcon, SparkleIcon } from '@/components/ui/icons'
import { androidRequirement, parseAndroidDownload, type AndroidDownload } from '@/lib/androidDownload'
import type { ClientDevice } from '@/lib/device'
import '@/styles/download.css'

export function DownloadPage({ device }: { device: ClientDevice }) {
  const [download, setDownload] = useState<AndroidDownload | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mobile = device !== 'desktop'
  const base = import.meta.env.BASE_URL

  useEffect(() => {
    const abort = new AbortController()
    const timeout = window.setTimeout(() => abort.abort(), 10_000)
    let active = true
    void fetch(`${base}downloads/android.json`, { cache: 'no-store', signal: abort.signal })
      .then(async response => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('unavailable')
        return parseAndroidDownload(await response.json())
      })
      .then(data => { if (active) setDownload(data) })
      .catch(() => { if (active) setError(true) })
      .finally(() => window.clearTimeout(timeout))
    return () => { active = false; window.clearTimeout(timeout); abort.abort() }
  }, [base, attempt])

  return (
    <div className="android-download">
      <header className="download-header">
        <Logo markClass="h-9 w-9" wordClass="text-[21px]" />
        {!mobile && <Link to="/" className="download-back"><ArrowLeftIcon size={16} />返回官网</Link>}
      </header>
      <main id="download-main" className="download-main">
        <AppIcon className="download-app-icon text-gold" />
        <h1>招财猫安卓版</h1>
        <p className="download-lead">账户、理财和助手，随时随地使用。</p>
        <div className="download-features" aria-label="应用功能">
          <span><WalletIcon size={19} />账户</span>
          <span><PigIcon size={19} />理财</span>
          <span><SparkleIcon size={19} />助手</span>
        </div>

        {device === 'ios' && <p className="download-device-note">暂未提供 iOS 版。你可以在电脑上使用网页版。</p>}
        {device === 'other-phone' && <p className="download-device-note">此安装包适用于安卓手机，其他设备请在电脑上使用网页版。</p>}

        <section className="download-action" aria-label="安卓安装包" aria-busy={!download && !error}>
          {error ? (
            <div role="alert" className="download-error">
              <p>安装包暂时无法获取</p>
              <button type="button" onClick={() => { setError(false); setDownload(null); setAttempt(value => value + 1) }}>重新加载</button>
            </div>
          ) : download ? (
            <>
              <a className="download-button" href={`${base}downloads/${download.fileName}`} download={download.fileName}>
                <DownloadIcon size={21} />下载安卓版 APK
              </a>
              <p className="download-meta">
                {download.versionName}{download.debuggable ? ' 调试版' : ''} · {(download.bytes / 1024 / 1024).toFixed(1)} MB
              </p>
              <p className="download-meta">{androidRequirement(download.minSdk)}{download.abis.length > 1 ? '，通用安装包' : `，${download.abis[0]}`}</p>
              <details className="download-help">
                <summary>如何安装</summary>
                <p>下载后打开 APK，按系统提示允许当前浏览器安装应用。若微信内无法下载，请用手机浏览器打开此页面。</p>
                <p>已安装旧版时，更新需要使用相同签名的安装包。</p>
              </details>
              <details className="download-help download-checksum">
                <summary>查看安装包校验值</summary>
                <p>SHA-256</p><code>{download.sha256}</code>
              </details>
            </>
          ) : <p role="status" className="download-meta">正在获取安装包…</p>}
        </section>
      </main>
      <footer className="download-footer">luckycat BANK</footer>
    </div>
  )
}
