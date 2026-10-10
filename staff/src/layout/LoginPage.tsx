import { useState } from 'react'
import { ApiError } from '@/api'
import { useSession } from '@/store/session-context'

/**
 * 员工登录页（独立于客户登录，清单 §1）。演示账号：王小明/123456、李主管/123456。
 * **登录成功后本页不跳转**——重定向只在 App.tsx 的 LoginRoute 做（照客户端的教训：
 * 两处都跳会互相覆盖，来源页被吃掉）。
 */
export function LoginPage() {
  const { login } = useSession()
  const [name, setName] = useState('王小明')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(name, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-paper)]">
      <form
        onSubmit={submit}
        className="w-90 rounded-[var(--radius-card)] bg-[var(--color-surface)] border border-[var(--color-line)] p-8 space-y-4"
      >
        <div>
          <div className="text-xl font-semibold text-[var(--color-ink)]">工作人员端</div>
          <div className="text-sm text-[var(--color-ink-mute)]">招财猫银行 · 员工登录</div>
        </div>

        <label className="block">
          <span className="text-sm text-[var(--color-ink-soft)]">员工姓名</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-sm text-[var(--color-ink-soft)]">密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-2"
          />
        </label>

        {error && (
          <div className="rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-3 py-2 text-sm text-[var(--color-coral)]">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-[var(--radius-field)] bg-[var(--color-gold)] py-2.5 font-medium text-white hover:bg-[var(--color-gold-deep)] disabled:opacity-60"
        >
          {busy ? '登录中…' : '登录'}
        </button>

        <div className="text-xs text-[var(--color-ink-mute)] leading-5">
          演示账号：王小明（客服）/ 李主管（主管），密码均为 123456
        </div>
      </form>
    </div>
  )
}
