import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '@/api'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { ChevronRightIcon } from '@/components/ui/icons'
import { ACCOUNT_OPENING_PLEDGE } from '@/lib/account-opening'
import { useSession } from '@/store/session-context'

const DEMO_ID = '310101199001011234'
const maskId = (v: string) => v.length === 18 ? `${v.slice(0, 3)}***********${v.slice(-4)}` : '待填写'
const maskPhone = (v: string) => v.length === 11 ? `${v.slice(0, 3)}****${v.slice(-4)}` : '待填写'

export function OpenAccountStandalone() {
  const navigate = useNavigate()
  const { acceptSession } = useSession()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [holderName, setHolderName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [faceTicket, setFaceTicket] = useState('')
  const [pledged, setPledged] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const passwordError = password.length > 0 && (password.length < 6 || password.length > 20)
  const confirmError = confirmPassword.length > 0 && confirmPassword !== password
  const canSend = /^1[3-9]\d{9}$/.test(phone) && !sending
  const canSubmit = canSend && password.length >= 6 && password.length <= 20 &&
    password === confirmPassword && holderName.trim().length > 0 && /^\d{17}[\dXx]$/.test(idNumber) &&
    smsCode.length === 6 && faceTicket.length > 0 &&
    pledged && confirmed && !submitting

  async function sendCode() {
    setSending(true); setError(null)
    try {
      const result = await api.sendSmsCode(phone)
      setDemoCode(result.demoCode ?? null)
      if (result.demoCode) setSmsCode(result.demoCode)
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : '验证码发送失败') }
    finally { setSending(false) }
  }

  async function verifyFace() {
    setVerifying(true); setError(null)
    try { setFaceTicket((await api.verifyIdentity('face')).ticket) }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '人脸核身失败') }
    finally { setVerifying(false) }
  }

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true); setError(null)
    try {
      const result = await api.register({
        phone, password, holderName: holderName.trim(), idNumber, smsCode,
        faceTicket,
        pledge: ACCOUNT_OPENING_PLEDGE,
      })
      acceptSession(result.token, result.user)
      navigate('/dashboard', { replace: true, state: { accountOpened: true } })
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : '注册开户失败，请稍后重试') }
    finally { setSubmitting(false) }
  }

  return <div className="min-h-svh bg-paper"><div className="mx-auto w-full max-w-[900px] px-4 py-7 sm:px-6 sm:py-10">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <Logo markClass="h-10 w-10" wordClass="text-[24px]" />
      <Link to="/login" className="inline-flex items-center text-[13px] font-medium text-gold-deep">已有账户？去登录 <ChevronRightIcon size={15} /></Link>
    </div>
    <header className="mb-7"><h1 className="text-[32px] font-bold tracking-[-0.02em] text-ink">注册并开通储蓄账户</h1><p className="mt-2 text-[14px] text-ink-soft">使用身份证、短信和人脸核身完成开户，无需已有银行卡或选择账户类别。</p></header>
    <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
      <div className="flex flex-col gap-5">
        <Card><CardHeader title="1. 基本资料与登录密码" /><div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="姓名" value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="请填写本人姓名" />
          <Field label="身份证号" value={idNumber} onChange={(e) => setIdNumber(e.target.value.trim().slice(0, 18))} placeholder={DEMO_ID} />
          <Field label="登录密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={passwordError ? '请输入 6-20 个字符' : undefined} />
          <Field label="确认登录密码" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} error={confirmError ? '两次输入的密码不一致' : undefined} />
        </div></Card>
        <Card><CardHeader title="2. 手机号与身份核验" /><div className="mt-5 flex flex-col gap-4">
          <Field label="手机号" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" />
          <Field label="短信验证码" value={smsCode} onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" trailing={<button type="button" disabled={!canSend} onClick={() => void sendCode()} className="text-[13px] font-medium text-gold-deep disabled:text-ink-mute">{sending ? '发送中…' : '获取验证码'}</button>} hint={demoCode ? `演示环境验证码：${demoCode}` : undefined} />
          <Button block variant={faceTicket ? 'secondary' : 'primary'} loading={verifying} disabled={faceTicket.length > 0} onClick={() => void verifyFace()}>{faceTicket ? '人脸核身已通过' : '开始人脸核身'}</Button>
        </div></Card>
      </div>
      <div className="flex flex-col gap-5"><Card className="bg-gold-tint"><CardHeader title="3. 开户确认" />
        <dl className="mt-5 flex flex-col gap-3 text-[14px]"><Row label="账户产品" value="储蓄账户" /><Row label="开户人" value={holderName.trim() || '待填写'} /><Row label="手机号" value={maskPhone(phone)} /><Row label="身份证" value={maskId(idNumber)} /></dl>
        <label className="mt-5 flex items-start gap-3 text-[12px] leading-relaxed text-ink-soft"><input type="checkbox" checked={pledged} onChange={(e) => setPledged(e.target.checked)} className="mt-1" /><span>{ACCOUNT_OPENING_PLEDGE}</span></label>
        <label className="mt-4 flex items-start gap-3 text-[13px] text-ink"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" /><span>我已核对上述开户信息，确认提交</span></label>
        {error && <p role="alert" className="mt-4 text-[13px] text-coral">{error}</p>}
        <Button block size="lg" variant="primary" className="mt-5" disabled={!canSubmit} loading={submitting} onClick={() => void submit()}>确认注册并开户</Button>
      </Card><p className="px-2 text-[12px] leading-relaxed text-ink-mute">开户成功后将自动登录。演示环境不会开立真实银行账户或产生资金变动。</p></div>
    </div>
  </div></div>
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-ink-soft">{label}</dt><dd className="num text-right text-ink">{value}</dd></div>
}
