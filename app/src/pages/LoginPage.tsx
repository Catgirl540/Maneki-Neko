import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '@/api'
import { CatMark, Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ArrowRightIcon, EyeIcon, EyeOffIcon } from '@/components/ui/icons'
import { useSession } from '@/store/session-context'
import '@/styles/login.css'

/** 重发验证码的冷却秒数。 */
const RESEND_SECONDS = 60

export function LoginPage() {
  const { login } = useSession()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [passwordHelpOpen, setPasswordHelpOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [smsHint, setSmsHint] = useState<string | null>(null)

  // 倒计时。用 ref 存 timer 并在卸载时清掉，否则离开登录页之后它还在跑
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (cooldown <= 0) return
    timer.current = window.setTimeout(() => setCooldown((v) => v - 1), 1000)
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    }
  }, [cooldown])

  /**
   * 发验证码。**只校验手机号**，不要求先填密码——
   * 真实银行的短信登录也是这样：先证明你拿着这个号，再证明你知道密码。
   */
  async function onSendCode() {
    setError(null)
    setSending(true)
    try {
      const result = await api.sendSmsCode(phone.trim())
      setCooldown(RESEND_SECONDS)
      // 演示环境后端会把验证码回传（真后端不会），直接告诉用户，否则走不下去
      setSmsHint(
        result.demoCode === undefined
          ? '验证码已发送，请查看短信'
          : `演示环境验证码：${result.demoCode}（5 分钟内有效）`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '验证码发送失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(phone.trim(), password, smsCode.trim())
      // **不在这里导航**：登录成功后 `user` 变成非空，`LoginRoute` 会按记下来的
      // 来源页把我们送过去。两处都导航会互相覆盖（见 App.tsx 里 LoginRoute 的说明）。
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-layout">
      <div className="login-backdrop" aria-hidden="true">
        <span className="login-bubble login-bubble-one" />
        <span className="login-bubble login-bubble-two" />
        <span className="login-bubble login-bubble-three" />
        <span className="login-bubble login-bubble-four" />
      </div>
      <header className="login-header">
        <Link to="/" aria-label="招财猫银行首页" className="login-brand"><Logo /></Link>
        <a href={`${import.meta.env.BASE_URL}staff/login`} className="login-staff-link">
          工作人员登录<ArrowRightIcon size={15} />
        </a>
      </header>

      <main className="login-main">
        <section className="login-card" aria-labelledby="login-heading">
          <div className="login-card-content">
            <h1 id="login-heading">登录您的账户</h1>
            <form className="login-form" onSubmit={onSubmit} aria-describedby={error ? 'login-error' : undefined}>
              <div className="login-form-field">
                <Field label="手机号" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="请输入手机号" type="tel" inputMode="numeric" autoComplete="username" maxLength={11} required />
              </div>
              <div className="login-form-field">
                <div className="login-password-heading">
                  <label htmlFor="login-password">密码</label>
                  <button type="button" className="login-text-link" aria-expanded={passwordHelpOpen}
                    aria-controls="login-password-help" onClick={() => setPasswordHelpOpen(value => !value)}>忘记密码？</button>
                </div>
                <Field id="login-password" type={showPassword ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)} autoComplete="current-password" required
                  trailing={<button type="button" className="login-reveal" aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
                    {showPassword ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
                  </button>} />
                {passwordHelpOpen && <p id="login-password-help" role="status" className="login-help">当前演示版本暂不支持自助找回密码。</p>}
              </div>
              <div className="login-form-field">
                <Field label="短信验证码" value={smsCode}
                  onChange={e => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="请输入验证码" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required
                  trailing={<button type="button" onClick={() => void onSendCode()}
                    disabled={sending || cooldown > 0 || phone.trim().length !== 11} className="login-code-button">
                    {sending ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后重发` : '获取验证码'}
                  </button>} />
              </div>
              {smsHint !== null && <p role="status" className="login-sms-hint">{smsHint}</p>}
              {error !== null && <p id="login-error" role="alert" className="login-error">{error}</p>}
              <Button type="submit" variant="primary" block loading={loading} className="login-submit">登入</Button>
            </form>
          </div>
          <div className="login-card-footer">还没有账户？<Link to="/open-account">注册并开户<ArrowRightIcon size={14} /></Link></div>
        </section>
        <footer className="login-footer"><span>© MONEY MEOW BANK</span><Link to="/">返回首页</Link></footer>
      </main>
    </div>
  )
}

/** 供其他页面复用的猫头水印 */
export { CatMark }
