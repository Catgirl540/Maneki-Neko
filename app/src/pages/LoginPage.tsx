import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '@/api'
import { CatMark, Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { BoltIcon, GlobalIcon, LockIcon, PhoneIcon, ShieldIcon } from '@/components/ui/icons'
import { useSession } from '@/store/session-context'
import { isMockMode } from '@/api'

export function LoginPage() {
  const { login } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [phone, setPhone] = useState('13800138000')
  const [password, setPassword] = useState('123456')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(phone.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh bg-paper">
      {/* 左：表单 */}
      <div className="flex w-full flex-col justify-center px-8 py-14 lg:w-[52%] lg:px-20">
        <div className="mx-auto w-full max-w-[380px]">
          <Logo markClass="h-10 w-10" wordClass="text-[26px]" />

          <h1 className="mt-14 text-[38px] leading-[1.15] font-bold tracking-[-0.02em] text-ink">
            欢迎回来
          </h1>
          <p className="mt-3 text-[15px] text-ink-soft">
            欢迎回到招财猫银行，安心开启每一天
          </p>

          <form className="mt-9 flex flex-col gap-5" onSubmit={onSubmit}>
            <Field
              label="手机号"
              icon={<PhoneIcon size={20} />}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="请输入 11 位手机号"
              inputMode="numeric"
              autoComplete="username"
            />
            <Field
              label="密码"
              icon={<LockIcon size={20} />}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
              error={error ?? undefined}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="shrink-0 text-ink-mute transition-colors hover:text-ink-soft"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    {showPassword ? (
                      <>
                        <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
                        <circle cx="12" cy="12" r="2.8" />
                      </>
                    ) : (
                      <>
                        <path d="M4 4.5 20 19.5" />
                        <path d="M9.6 7.1A9.7 9.7 0 0 1 12 6.8c6 0 9.5 5.2 9.5 5.2a17 17 0 0 1-3.1 3.5" />
                        <path d="M6.3 9A16.6 16.6 0 0 0 2.5 12s3.5 5.2 9.5 5.2c1.2 0 2.3-.2 3.3-.5" />
                        <path d="M10 10.3a2.8 2.8 0 0 0 3.9 3.9" />
                      </>
                    )}
                  </svg>
                </button>
              }
            />

            <Button type="submit" variant="primary" size="lg" block loading={loading}>
              登入
            </Button>

            <button
              type="button"
              className="self-center text-[14px] text-ink-soft transition-colors hover:text-ink"
            >
              忘记密码
            </button>
          </form>

          {isMockMode && (
            <p className="mt-9 border-t border-line pt-5 text-[13px] text-ink-mute">
              演示环境 · 任意 11 位手机号 + 密码 <span className="num text-ink-soft">123456</span>
              <span className="mt-1 block text-[12px] text-ink-mute">
                本作品为比赛演示用途，非真实银行，不提供任何金融服务，所有数据均为模拟
              </span>
            </p>
          )}

          {/* 开户不属于演示专属功能：没有账户的人本来就该从这里进 */}
          <p className="mt-5 text-center text-[13px] text-ink-mute">
            还没有账户？
            <Link
              to="/open-account"
              className="ml-1 font-medium text-gold-deep transition-colors hover:text-ink"
            >
              立即开户
            </Link>
          </p>

          <ul className="mt-6 flex flex-wrap gap-x-7 gap-y-2 text-[13px] text-ink-soft">
            <li className="inline-flex items-center gap-1.5">
              <ShieldIcon size={16} className="text-ink-mute" />
              安全保障
            </li>
            <li className="inline-flex items-center gap-1.5">
              <BoltIcon size={16} className="text-ink-mute" />
              便捷高效
            </li>
            <li className="inline-flex items-center gap-1.5">
              <GlobalIcon size={16} className="text-ink-mute" />
              随时随地
            </li>
          </ul>
        </div>
      </div>

      {/* 右：品牌插画面板 */}
      <div className="relative hidden overflow-hidden bg-blue-wash lg:block lg:w-[48%]">
        <div className="absolute inset-0 grid place-items-center">
          <svg viewBox="0 0 480 480" className="h-[min(70vh,560px)] w-auto" aria-hidden="true">
            {/* 背景几何 */}
            <circle cx="240" cy="228" r="168" fill="var(--color-blue)" opacity="0.16" />
            <circle cx="74" cy="376" r="46" fill="var(--color-blue)" opacity="0.12" />
            <circle cx="410" cy="104" r="30" fill="var(--color-gold)" opacity="0.24" />

            {/* 招财猫头 */}
            <path d="M148 186 L160 74 L238 142 Z" fill="#ffffff" />
            <path d="M312 186 L300 74 L222 142 Z" fill="#ffffff" />
            <path d="M166 176 L173 108 L222 152 Z" fill="var(--color-ink)" opacity="0.88" />
            <path d="M294 176 L287 108 L238 152 Z" fill="var(--color-ink)" opacity="0.88" />
            <circle cx="230" cy="250" r="106" fill="#ffffff" />

            {/* 五官 */}
            <circle cx="194" cy="238" r="14" fill="var(--color-ink)" />
            <circle cx="266" cy="238" r="14" fill="var(--color-ink)" />
            <path d="M230 266 L243 284 L217 284 Z" fill="var(--color-ink)" />
            <path
              d="M230 286 q-13 14 -26 2 M230 286 q13 14 26 2"
              stroke="var(--color-ink)"
              strokeWidth="5"
              strokeLinecap="round"
              fill="none"
            />
            <g stroke="var(--color-ink)" strokeWidth="7" strokeLinecap="round">
              <path d="M158 232 H92" />
              <path d="M156 258 H88" />
              <path d="M302 232 H368" />
              <path d="M304 258 H372" />
            </g>

            {/* 金币 */}
            <circle cx="336" cy="372" r="54" fill="var(--color-gold)" />
            <circle
              cx="336"
              cy="372"
              r="42"
              fill="none"
              stroke="var(--color-gold-deep)"
              strokeWidth="3.5"
            />
            <rect x="324" y="352" width="24" height="40" rx="5" fill="var(--color-gold-deep)" />

            {/* 星芒点缀 */}
            <path
              d="M124 118 l7 20 20 7 -20 7 -7 20 -7 -20 -20 -7 20 -7 z"
              fill="var(--color-gold)"
              opacity="0.55"
            />
          </svg>
        </div>

        <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-3 px-10 text-center">
          <p className="text-[30px] leading-[1.25] font-bold tracking-[-0.02em] text-ink">
            让每一份努力
            <br />
            都有回报
          </p>
          <p className="text-[14px] tracking-[0.18em] text-ink-soft">简单 · 安全 · 值得信赖</p>
        </div>
      </div>
    </div>
  )
}

/** 供其他页面复用的猫头水印 */
export { CatMark }