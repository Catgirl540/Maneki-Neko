import { useEffect, useState } from 'react'
import { startWeixinQr, getWeixinQr, verifyWeixinQr, cancelWeixinQr, confirmWeixinQr, type WeixinQr } from '@/api/im'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

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
  return <Card className="float-up">
    <CardHeader title="微信扫码连接" />
    <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">在本页生成二维码，用本人微信扫码并确认登录，再确认绑定当前银行账户。无需运维账号，也不用跳转其他页面。</p>
    {(!qr || finished) && <Button className="mt-4" variant="primary" loading={busy} onClick={() => void act(async () => { setNow(Date.now()); setQr(await startWeixinQr()) })}>
      {qr ? '重新生成二维码' : '生成微信连接二维码'}
    </Button>}
    {qr && <div className="mt-4 rounded-card border border-line bg-sunk/50 p-4">
      {!finished && !qr.binding && qr.status !== 'connected' && <img src={qr.qrImage} alt="微信连接二维码" width={208} height={208} className="max-w-full rounded-field bg-white p-2" />}
      <p role="status" className="mt-3 text-[14px] font-medium text-ink">{qr.binding ? '微信已绑定到当前银行账户' : expired ? labels.expired : qr.error?.message ?? labels[qr.status] ?? '正在读取扫码状态'}</p>
      {!finished && !qr.binding && <p className="mt-1 text-[12px] text-ink-mute">剩余 {Math.min(300, Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)))} 秒；请勿分享二维码。</p>}
      {!expired && qr.status === 'needs_verification' && <div className="mt-3 max-w-sm">
        <Field label="扫码验证码" value={code} autoComplete="one-time-code" maxLength={64} onChange={event => setCode(event.target.value)} />
        <p className="mt-1 text-[12px] text-ink-soft">只填写微信扫码流程要求的验证码，不要填写银行登录密码或支付密码。</p>
        <Button className="mt-2" loading={busy} disabled={!code.trim()} onClick={() => void act(async () => { try { setQr(await verifyWeixinQr(qr.attemptId, code.trim())) } finally { setCode('') } })}>提交扫码验证码</Button>
      </div>}
      {!expired && qr.status === 'connected' && !qr.binding && <div className="mt-3">
        <p className="text-[13px] text-ink-soft">请确认本次扫码使用的是本人微信。确认后可在微信中办理本人查询及接收提醒；资金操作仍需单独确认。</p>
        <Button className="mt-3" variant="primary" loading={busy} onClick={() => void act(async () => {
          const binding = await confirmWeixinQr(qr.attemptId)
          setQr({ ...qr, binding }); await onBound()
        })}>确认绑定此微信到当前账户</Button>
      </div>}
      {!expired && active.has(qr.status) && <Button className="mt-3" size="sm" loading={busy} onClick={() => void act(async () => { setQr(await cancelWeixinQr(qr.attemptId)); setCode('') })}>取消扫码</Button>}
      {qr.binding && <p className="mt-2 text-[13px] text-ink-soft">请在微信 ClawBot 私聊发送一条消息，建立本次登录的私聊上下文，然后即可查询或接收提醒。无需在微信发送密码。</p>}
    </div>}
    {error && <p role="alert" className="mt-3 text-[13px] text-coral">{error}</p>}
    <p className="mt-3 text-[12px] text-ink-mute">已有绑定码或需要连接企微私聊，可继续使用下方「私聊绑定」。</p>
  </Card>
}
