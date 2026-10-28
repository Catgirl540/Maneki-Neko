import { useState } from 'react'
import { api, ApiError } from '@/api'
import type { BankCard } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PinInput } from '@/components/ui/PinInput'
import { AlertIcon } from '@/components/ui/icons'

/**
 * 解锁卡安全码。
 *
 * 为什么安全码不跟着「眼睛」一起出
 * ------------------------------
 * 余额、卡号、有效期被看到是**隐私**问题；安全码被看到是**可以直接盗刷**的问题，
 * 两者不是一个量级。真实银行也没有把安全码摊在卡片列表里的 —— PCI DSS 明确要求
 * 授权后不得留存，界面要展示必须单独验身。
 *
 * 所以这个弹窗只做一件事：**验一次支付密码**（不是登录密码 —— 登录态泄露不等于能拿到安全码）。
 * 验过之后把安全码交给上层的显示状态并带上时限；到点自动重新锁上，
 * 「眼睛一直开着」不等于安全码永久可读。
 *
 * 顺序上先验身再看卡状态：反过来的话，密码不对的人也能从报错文案里探到卡的状态。
 */
export function CardSecretsModal({
  card,
  onClose,
  onUnlocked,
}: {
  card: BankCard
  onClose: () => void
  /** 验过支付密码后把卡号与安全码交回给展示它们的那一块（并带上可见时限） */
  onUnlocked: (pan: string, cvv: string, ttlSeconds: number) => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 密码类的错误要清空重输；「卡没寄到」这类跟密码无关，留着别让人白输一遍 */
  const passwordError = error && (error.includes('支付密码') || error.includes('6 位'))

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const secrets = await api.revealCardSecrets(card.id, password)
      onUnlocked(secrets.pan, secrets.cvv, secrets.revealSeconds)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '查看失败，请稍后重试')
      if (e instanceof ApiError && e.code === 'BAD_PAY_PASSWORD') setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="查看完整卡号与安全码"
      description={`${card.productName} · 尾号 ${card.last4}`}
      footer={
        <Button
          variant="primary"
          block
          loading={busy}
          disabled={password.length !== 6}
          onClick={() => void submit()}
        >
          验证并查看
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <PinInput
          label="支付密码"
          value={password}
          onChange={setPassword}
          disabled={busy}
          autoFocus
          error={passwordError ? (error ?? undefined) : undefined}
        />
        <p className="text-[12px] leading-relaxed text-ink-mute">
          完整卡号与安全码是持卡人验证信息，与卡面上的有效期不同，查看前需要单独验证支付密码。
          验证通过后 60 秒内显示，到点自动隐藏。连续输错 5 次会冻结账号，需联系工作人员解冻。
        </p>
        {error && !passwordError && (
          <p className="flex items-start gap-2 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
            <AlertIcon size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
