import { useState } from 'react'
import { ApiError } from '@/api'
import { useSession } from '@/store/session-context'
import { WorkbenchBrand } from '../../../app/src/components/brand/WorkbenchBrand'
import { AlertIcon, ArrowLeftIcon, EyeIcon, EyeOffIcon, ArrowRightIcon } from '../../../app/src/components/ui/icons'

/** 登录跳转统一由 LoginRoute 处理，保留原始来源页与角色路由。 */
export function LoginPage() {
  const { login } = useSession()
  const [name, setName] = useState('王小明')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const customerHome = import.meta.env.BASE_URL.replace(/staff\/$/, '') || '/'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try { await login(name, password) }
    catch (err) { setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试') }
    finally { setBusy(false) }
  }

  return <>
    <div className="staff-demo"><AlertIcon size={12} />比赛演示作品 · 非真实银行</div>
    <div className="login-layout staff-login">
      <div className="login-backdrop" aria-hidden="true">{['one', 'two', 'three', 'four'].map(id => <span key={id} className={`login-bubble login-bubble-${id}`} />)}</div>
      <header className="login-header"><a href={customerHome} className="login-brand" aria-label="招财猫银行首页"><WorkbenchBrand /></a><a href={customerHome} className="login-staff-link"><ArrowLeftIcon size={14} />返回客户网站</a></header>
      <main className="login-main">
        <section className="login-card" aria-labelledby="staff-login-title">
          <div className="login-card-content">
            <span className="staff-login-eyebrow">工作人员工作空间</span>
            <h1 id="staff-login-title">登录工作人员账户</h1>
            <form className="login-form" onSubmit={submit}>
              <div><label htmlFor="staff-name">员工姓名</label><input id="staff-name" value={name} onChange={e => setName(e.target.value)} autoComplete="username" required /></div>
              <div><label htmlFor="staff-password">密码</label><div className="staff-login-password"><input id="staff-password" type={reveal ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /><button type="button" className="login-reveal" aria-label={reveal ? '隐藏密码' : '显示密码'} aria-pressed={reveal} onClick={() => setReveal(value => !value)}>{reveal ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}</button></div></div>
              {error && <p role="alert" className="login-error">{error}</p>}
              <button type="submit" disabled={busy} className="login-submit">{busy ? '登录中…' : '登录'}<ArrowRightIcon size={16} /></button>
            </form>
          </div>
          <div className="login-card-footer staff-login-help"><details><summary>工作人员账号</summary><p>请使用管理员分配的工作人员姓名和密码登录。<br />客服、主管及运维人员按各自角色办理业务。</p></details></div>
        </section>
        <footer className="login-footer"><span>© MONEY MEOW BANK</span><span>工作人员端</span></footer>
      </main>
    </div>
  </>
}
