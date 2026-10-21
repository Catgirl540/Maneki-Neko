import { useEffect, useState } from 'react'
import { startWeixinQr, getWeixinQr, verifyWeixinQr, cancelWeixinQr, confirmWeixinQr, type WeixinQr } from '@/api/im'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { CheckIcon, ChatIcon, PhoneIcon, RefreshIcon } from '@/components/ui/icons'

const labels: Record<string, string> = {
  starting: '正在生成二维码', pending: '请用本人微信扫码', scanned: '已扫码，请在微信中确认登录',
  needs_verification: '请填写微信扫码流程要求的验证码', connecting: '正在连接微信', connected: '微信已连接，请确认绑定银行账户',
  expired: '二维码已过期，请重新生成', failed: '微信连接未完成，请重新生成或稍后重试', cancelled: '本次扫码已取消',
}
const active = new Set(['starting', 'pending', 'scanned', 'needs_verification', 'connecting'])
export function WeixinQrBinding({ onBound }: { onBound: () => Promise<void> }) {
  const [qr, setQr] = useState<WeixinQr | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!qr || qr.binding) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [qr?.attemptId, qr?.binding]) // eslint-disable-line react-hooks/exhaustive-deps
  const expired = qr !== null && !qr.binding && qr.expiresAt <= now
  useEffect(() => {
    if (!qr || expired || !active.has(qr.status)) return
    let stopped = false
    const timer = window.setTimeout(() => {
      void getWeixinQr(qr.attemptId).then(value => { if (!stopped) setQr(value) }).catch(cause => {
        if (!stopped) { setError(cause instanceof Error ? cause.message : '扫码状态暂时无法读取'); setQr(value => value ? { ...value, status: 'failed' } : null) }
      })
    }, 3000)
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [qr, expired])
  async function act(work: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : '微信连接失败，请重试') }
    finally { setBusy(false) }
  }
  const finished = qr && (expired || ['failed', 'expired', 'cancelled'].includes(qr.status))
  const connected = qr?.status === 'connected' && !expired
  const step = qr?.binding ? 3 : finished ? 0 : connected ? 2 : qr ? 1 : 0
  return <Card className="im-connect-card float-up">
    <CardHeader title={<span className="im-section-title"><span className="im-section-icon"><ChatIcon size={18} /></span>微信扫码连接</span>}
      action={<span className="im-channel-label">微信 ClawBot</span>} />
    <div className="im-connect-body">
      <div className="im-connect-guide">
        <p className="im-connect-lead">把银行助手，带到微信里</p>
        <p className="im-description">连接本人微信，在私聊中查询、接收提醒，随时掌握需要关注的事。</p>
        <ol className="im-connect-steps" aria-label="微信连接步骤">
          {[
            ['生成二维码', '二维码直接显示在本页，5 分钟内有效'],
            ['微信扫码确认', '使用本人微信，按手机提示确认登录'],
            ['确认银行绑定', '核对后绑定当前账户，即可开始使用'],
          ].map(([title, description], index) => <li key={title} className={index < step ? 'is-complete' : index === step ? 'is-current' : ''} aria-current={index === step ? 'step' : undefined}>
            <span className="im-step-mark">{index < step ? <CheckIcon size={13} /> : index + 1}</span>
            <span><b>{title}</b><small>{description}</small></span>
          </li>)}
        </ol>
      </div>
      <div className="im-qr-panel">
        <div className={`im-qr-frame${qr?.binding ? ' is-bound' : ''}`}>
          {qr && !finished && !qr.binding && qr.status !== 'connected'
            ? <img src={qr.qrImage} alt="微信连接二维码" width={200} height={200} />
            : <div className="im-qr-placeholder">
              <span>{qr?.binding || connected ? <CheckIcon size={32} /> : finished ? <RefreshIcon size={30} /> : <PhoneIcon size={32} />}</span>
              <b>{qr?.binding ? '连接完成' : connected ? '微信已确认' : finished ? '重新连接微信' : '用微信扫一扫'}</b>
              <small>{qr?.binding ? '已绑定当前银行账户' : connected ? '请完成下方银行绑定确认' : finished ? '请生成新的连接二维码' : '点击下方按钮生成连接二维码'}</small>
            </div>}
        </div>
        {(!qr || finished) && <Button className="im-qr-generate" variant="ink" loading={busy} onClick={() => void act(async () => { setNow(Date.now()); setQr(await startWeixinQr()) })}>
          {qr ? '重新生成二维码' : '生成微信连接二维码'}
        </Button>}
        {qr && <>
          <p role="status" aria-live="polite" className="im-qr-status">{qr.binding ? '微信已绑定到当前银行账户' : expired ? labels.expired : qr.error?.message ?? labels[qr.status] ?? '正在读取扫码状态'}</p>
          {!finished && !qr.binding && <p className="im-qr-countdown">剩余 <span className="num">{Math.min(300, Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)))}</span> 秒 · 请勿分享二维码</p>}
          {!expired && active.has(qr.status) && <Button size="sm" variant="ghost" loading={busy} onClick={() => void act(async () => { setQr(await cancelWeixinQr(qr.attemptId)); setCode('') })}>取消扫码</Button>}
        </>}
      </div>
    </div>
    {qr && <>
      {!expired && qr.status === 'needs_verification' && <div className="mt-3 max-w-sm">
        <Field label="扫码验证码" value={code} autoComplete="one-time-code" maxLength={64} onChange={event => setCode(event.target.value)} />
        <p className="mt-1 text-[12px] text-ink-soft">填写微信扫码流程要求的验证码，请勿填写银行密码。</p>
        <Button className="mt-2" loading={busy} disabled={!code.trim()} onClick={() => void act(async () => { try { setQr(await verifyWeixinQr(qr.attemptId, code.trim())) } finally { setCode('') } })}>提交扫码验证码</Button>
      </div>}
      {!expired && qr.status === 'connected' && !qr.binding && <div className="im-confirm-panel">
        <p className="text-[13px] text-ink-soft">请确认本次扫码使用的是本人微信。确认后可在微信中办理本人查询及接收提醒；资金操作仍需单独确认。</p>
        <Button className="mt-3" variant="ink" loading={busy} onClick={() => void act(async () => {
          const binding = await confirmWeixinQr(qr.attemptId)
          setQr({ ...qr, binding }); await onBound()
        })}>确认绑定此微信到当前账户</Button>
      </div>}
      {qr.binding && <p className="im-confirm-panel text-[13px] text-ink-soft">现在去微信 ClawBot 私聊发送一条消息，即可开始查询或接收提醒。</p>}
    </>}
    {error && <p role="alert" className="mt-3 text-[13px] text-coral">{error}</p>}
  </Card>
}
