import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '@/api'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PinInput } from '@/components/ui/PinInput'
import { ChevronRightIcon } from '@/components/ui/icons'
import { ACCOUNT_OPENING_PLEDGE } from '@/lib/account-opening'
import { generateDemoIdentity, type DemoIdentity } from '@/lib/demo-id'
import { isValidLoginPassword, LOGIN_PASSWORD_REQUIREMENTS } from '../../../shared/password-policy.mjs'
import { useSession } from '@/store/session-context'
import '@/styles/open-account.css'

const maskId = (v: string) => v.length === 18 ? `${v.slice(0, 3)}***********${v.slice(-4)}` : '待填写'
const maskPhone = (v: string) => v.length === 11 ? `${v.slice(0, 3)}****${v.slice(-4)}` : '待填写'

/**
 * 演示身份证卡面（人像面）：左个人信息、右人像、底部证件号码。
 * 演示环境没有摄像头——「拍摄」生成一张虚构但版式正规的证件。
 */
function DemoIdCard({ identity }: { identity: DemoIdentity }) {
  const rows: [string, string][] = [
    ['出 生', identity.birthDate],
    ['住 址', identity.address],
  ]
  return (
    <div className="relative aspect-[1.585/1] w-full overflow-hidden rounded-card border border-[#b9ccd9] bg-gradient-to-br from-[#eef4f8] via-[#e2edf4] to-[#d3e2ec] text-[#2c3e50] shadow-[0_10px_24px_-14px_rgba(6,27,49,0.45)]">
      {/* 淡化底纹：真实证件的扭索纹用斜线网格示意 */}
      <div className="absolute inset-0 opacity-[0.35]" style={{ backgroundImage: 'repeating-linear-gradient(115deg, transparent 0 6px, #ffffff70 6px 7px), repeating-linear-gradient(-65deg, transparent 0 9px, #c7d8e455 9px 10px)' }} />
      <div className="relative flex h-full flex-col p-[4%]">
        <div className="flex flex-1 gap-[3%]">
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div className="min-w-0">
              <span className="text-[9px] tracking-wide text-[#6b7d8d]">姓 名</span>
              <p className="mt-0.5 truncate text-[11.5px] font-medium leading-tight text-[#22303d]">{identity.name}</p>
            </div>
            {/* 真证件同行两个字段：性别 | 民族 */}
            <div className="grid grid-cols-2 gap-1">
              {([['性 别', identity.gender], ['民 族', identity.ethnicity]] as const).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <span className="text-[9px] tracking-wide text-[#6b7d8d]">{label}</span>
                  <p className="mt-0.5 truncate text-[11.5px] font-medium leading-tight text-[#22303d]">{value}</p>
                </div>
              ))}
            </div>
            {rows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <span className="text-[9px] tracking-wide text-[#6b7d8d]">{label}</span>
                <p className="mt-0.5 truncate text-[11.5px] font-medium leading-tight text-[#22303d]">{value}</p>
              </div>
            ))}
          </div>
          {/* 人像：证件照占位剪影，撑满信息区高度（真证照片与信息行同边界） */}
          <div className="flex w-[27%] shrink-0 items-center justify-center rounded-[4px] border border-[#c3d2de] bg-[#d9e4ec] p-[5%]">
            <svg viewBox="0 0 64 64" className="h-auto w-full text-[#9db2c2]" fill="currentColor" aria-hidden>
              <circle cx="32" cy="23" r="12" />
              <path d="M10 56c0-12 9.8-19 22-19s22 7 22 19v4H10z" />
            </svg>
          </div>
        </div>
        <div className="mt-[1.5%] border-t border-[#c3d2de] pt-[1.5%]">
          <span className="text-[9px] tracking-wide text-[#6b7d8d]">公民身份号码</span>
          <p className="num mt-0.5 text-[13px] font-semibold tracking-[0.08em] text-[#1b2836]">{identity.idNumber}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * 演示身份证卡面（国徽面）：左国徽、右上证件名称、下签发机关与有效期限。
 * 国徽为金色线条示意图案，不与真实国徽一致。
 */
function DemoIdEmblemCard({ identity }: { identity: DemoIdentity }) {
  return (
    <div className="relative aspect-[1.585/1] w-full overflow-hidden rounded-card border border-[#b9ccd9] bg-gradient-to-br from-[#eef4f8] via-[#e2edf4] to-[#d3e2ec] text-[#2c3e50] shadow-[0_10px_24px_-14px_rgba(6,27,49,0.45)]">
      <div className="absolute inset-0 opacity-[0.35]" style={{ backgroundImage: 'repeating-linear-gradient(115deg, transparent 0 6px, #ffffff70 6px 7px), repeating-linear-gradient(-65deg, transparent 0 9px, #c7d8e455 9px 10px)' }} />
      <div className="relative flex h-full flex-col p-[4.5%]">
        <p className="text-right text-[10px] font-semibold tracking-[0.14em] text-[#22303d]">中华人民共和国居民身份证</p>
        <div className="flex flex-1 items-stretch gap-[4%] pt-[2%]">
          {/* 国徽示意：外环 + 五星的抽象金色线稿 */}
          <div className="flex w-[32%] shrink-0 items-center justify-center">
            <svg viewBox="0 0 72 72" className="h-auto w-[86%] text-[#a8834e]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="36" cy="36" r="30" strokeWidth="2.5" />
              <circle cx="36" cy="36" r="24" strokeDasharray="3 4" strokeWidth="1.4" />
              <path fill="currentColor" stroke="none" d="M36 18l3.6 7.3 8 .9-5.9 5.4 1.6 7.9L36 35.4l-7.3 4.1 1.6-7.9-5.9-5.4 8-.9z" />
              <circle cx="22" cy="30" r="2" fill="currentColor" stroke="none" />
              <circle cx="50" cy="30" r="2" fill="currentColor" stroke="none" />
              <circle cx="25" cy="46" r="2" fill="currentColor" stroke="none" />
              <circle cx="47" cy="46" r="2" fill="currentColor" stroke="none" />
              <path d="M18 52q18 9 36 0" strokeWidth="1.6" />
            </svg>
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-end gap-[6%] pb-[2%]">
            <div className="min-w-0">
              <span className="text-[9px] tracking-wide text-[#6b7d8d]">签发机关</span>
              <p className="mt-0.5 truncate text-[11px] font-medium leading-tight text-[#22303d]">{identity.issueAuthority}</p>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] tracking-wide text-[#6b7d8d]">有效期限</span>
              <p className="num mt-0.5 truncate text-[11px] font-medium leading-tight text-[#22303d]">{identity.validPeriod}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 拍摄流程的取景框：虚线 + 四角标记，idle/scanning 两态 */
function ScanFrame({ phase, side }: { phase: 'idle' | 'shooting' | 'reading' | 'done'; side: string }) {
  const corner = 'absolute h-4 w-4 border-[#8fa9bd]'
  return (
    <div className="relative grid aspect-[1.585/1] w-full place-items-center rounded-card border-2 border-dashed border-[#b3c6d4] bg-sunk/60">
      <span className={`${corner} left-2 top-2 border-l-2 border-t-2`} />
      <span className={`${corner} right-2 top-2 border-r-2 border-t-2`} />
      <span className={`${corner} bottom-2 left-2 border-b-2 border-l-2`} />
      <span className={`${corner} bottom-2 right-2 border-b-2 border-r-2`} />
      {phase === 'idle' ? (
        <p className="px-4 text-center text-[12px] leading-relaxed text-ink-mute">
          请将身份证{side}置于框内<br />演示环境点击下方按钮生成演示证件
        </p>
      ) : (
        <>
          {/* 扫描线：铺满框内，css 中线金条随 translateY 往返 */}
          <div className="absolute inset-x-3 top-3 bottom-3 overflow-hidden rounded-[4px]">
            <div className="id-scan-line absolute inset-0" />
          </div>
          <p className="relative text-[12px] font-medium text-ink-soft">{phase === 'shooting' ? '拍摄中…' : '正在识别证件信息…'}</p>
        </>
      )}
    </div>
  )
}

export function OpenAccountStandalone() {
  const navigate = useNavigate()
  const { acceptSession } = useSession()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [holderName, setHolderName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [paymentPassword, setPaymentPassword] = useState('')
  const [confirmPaymentPassword, setConfirmPaymentPassword] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [faceTicket, setFaceTicket] = useState('')
  const [pledged, setPledged] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [demoCode, setDemoCode] = useState<string | null>(null)
  // 证件采集：人像面与国徽面各自走 idle → shooting（拍摄中）→ reading（识别中）→ done（已出证），两面齐全才能开户
  const [frontPhase, setFrontPhase] = useState<'idle' | 'shooting' | 'reading' | 'done'>('idle')
  const [backPhase, setBackPhase] = useState<'idle' | 'shooting' | 'reading' | 'done'>('idle')
  const [demoId, setDemoId] = useState<DemoIdentity | null>(null)
  const idTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const passwordError = password.length > 0 && !isValidLoginPassword(password)
  const confirmError = confirmPassword.length > 0 && confirmPassword !== password
  const canSend = /^1[3-9]\d{9}$/.test(phone) && !sending
  const paymentPasswordError = confirmPaymentPassword.length > 0 && confirmPaymentPassword !== paymentPassword
  const canSubmit = canSend && isValidLoginPassword(password) &&
    password === confirmPassword &&
    /^\d{6}$/.test(paymentPassword) && paymentPassword === confirmPaymentPassword &&
    holderName.trim().length > 0 && /^\d{17}[\dXx]$/.test(idNumber) &&
    // 身份证两面均为必传项
    frontPhase === 'done' && backPhase === 'done' && demoId !== null &&
    smsCode.length === 6 && faceTicket.length > 0 &&
    pledged && confirmed && !submitting

  useEffect(() => () => { idTimers.current.forEach(clearTimeout) }, [])

  /** 演示证件采集：装模作样地「拍摄 → 识别」。两面共用同一份虚构证件数据，先拍哪面都行。 */
  function shootId(side: 'front' | 'back') {
    const phase = side === 'front' ? frontPhase : backPhase
    if (phase === 'shooting' || phase === 'reading') return
    const setPhase = side === 'front' ? setFrontPhase : setBackPhase
    setError(null)
    setPhase('shooting')
    idTimers.current.push(setTimeout(() => setPhase('reading'), 900))
    idTimers.current.push(setTimeout(() => {
      const identity = demoId ?? generateDemoIdentity()
      setDemoId(identity)
      if (side === 'front') {
        // 人像面 OCR 出姓名与证件号，供开户人核对
        setHolderName(identity.name)
        setIdNumber(identity.idNumber)
      }
      setPhase('done')
    }, 1800))
  }

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
        phone, password, paymentPassword, holderName: holderName.trim(), idNumber, smsCode,
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
    <header className="mb-7"><h1 className="text-[32px] font-bold tracking-[-0.02em] text-ink">注册并开通储蓄账户</h1></header>
    <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
      <div className="flex flex-col gap-5">
        <Card><CardHeader title="1. 手机号与登录密码" /><div className="mt-5 flex flex-col gap-4">
          <Field label="手机号" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" />
          <Field label="短信验证码" value={smsCode} onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" trailing={<button type="button" disabled={!canSend} onClick={() => void sendCode()} className="text-[13px] font-medium text-gold-deep disabled:text-ink-mute">{sending ? '发送中…' : '获取验证码'}</button>} hint={demoCode ? `演示环境验证码：${demoCode}` : undefined} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="登录密码" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={LOGIN_PASSWORD_REQUIREMENTS} error={passwordError ? LOGIN_PASSWORD_REQUIREMENTS : undefined} />
            <Field label="确认登录密码" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} error={confirmError ? '两次输入的密码不一致' : undefined} />
          </div>
        </div></Card>
        <Card><CardHeader title="2. 上传身份证" />
        <p className="mt-3 text-[12px] leading-relaxed text-ink-mute">请拍摄二代居民身份证人像面与国徽面，两面均为必传项；影像用于开户实名核验。</p>
        <div className="mt-4 flex flex-col gap-5">
          {(['front', 'back'] as const).map((side) => {
            const phase = side === 'front' ? frontPhase : backPhase
            const label = side === 'front' ? '人像面' : '国徽面'
            return (
              <div key={side}>
                <p className="mb-2 text-[13px] font-medium text-ink-soft">{label}{phase === 'done' && <span className="ml-2 text-[11px] font-normal text-[#2f8f5b]">已上传</span>}</p>
                {phase === 'done' && demoId ? (
                  side === 'front' ? <DemoIdCard identity={demoId} /> : <DemoIdEmblemCard identity={demoId} />
                ) : (
                  <ScanFrame phase={phase} side={label} />
                )}
                <Button block className="mt-3" variant={phase === 'done' ? 'secondary' : 'primary'}
                  loading={phase === 'shooting' || phase === 'reading'}
                  disabled={phase === 'shooting' || phase === 'reading'} onClick={() => shootId(side)}>
                  {phase === 'done' ? '重新拍摄' : phase === 'idle' ? `拍摄${label}（演示）` : phase === 'shooting' ? '拍摄中…' : '识别中…'}
                </Button>
              </div>
            )
          })}
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-3 text-[13px] font-medium text-ink-soft">证件识别结果</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="姓名" value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="上传人像面后识别" />
            <Field label="身份证号" value={idNumber} onChange={(e) => setIdNumber(e.target.value.trim().slice(0, 18))} placeholder="上传人像面后识别" />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-mute">请核对识别结果，与证件不一致之处可手动修正；开户后姓名与证件号不可自行修改。</p>
        </div></Card>
        <Card><CardHeader title="3. 人脸核身" /><div className="mt-5 flex flex-col gap-4">
          <p className="text-[12px] leading-relaxed text-ink-mute">请本人正对屏幕完成活体检测。演示环境不会调用真实摄像头。</p>
          <Button block variant={faceTicket ? 'secondary' : 'primary'} loading={verifying} disabled={faceTicket.length > 0} onClick={() => void verifyFace()}>{faceTicket ? '人脸核身已通过' : '开始人脸核身'}</Button>
        </div></Card>
        <Card><CardHeader title="4. 设置支付密码" /><div className="mt-5 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <PinInput label="支付密码" value={paymentPassword} onChange={setPaymentPassword} />
            <PinInput label="确认支付密码" value={confirmPaymentPassword} onChange={setConfirmPaymentPassword} error={paymentPasswordError ? '两次输入的支付密码不一致' : undefined} />
          </div>
          <p className="text-[12px] leading-relaxed text-ink-mute">支付密码为 6 位数字，用于转账、办卡等敏感操作，请勿与登录密码相同。连续输错 5 次会冻结账号，需联系工作人员解冻。</p>
        </div></Card>
      </div>
      <div className="flex flex-col gap-5"><Card className="bg-gold-tint"><CardHeader title="5. 开户确认" />
        <dl className="mt-5 flex flex-col gap-3 text-[14px]"><Row label="账户产品" value="储蓄账户" /><Row label="开户人" value={holderName.trim() || '待填写'} /><Row label="手机号" value={maskPhone(phone)} /><Row label="身份证" value={maskId(idNumber)} /><Row label="证件有效期" value={demoId ? demoId.validPeriod : '待上传'} /></dl>
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
