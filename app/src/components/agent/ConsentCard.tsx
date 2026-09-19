/**
 * 敏感操作确认卡片：**展示交易信息 → 用户确认 → 身份验证**，三件事在同一张卡上。
 *
 * 这张卡不是"礼貌地问一句"：它对应运行时里**已经挂住**的那次工具调用
 * （`tools/pre-execute` 返回 ask，工具尚未执行）。用户不回答，工具就一直不执行；
 * 回答"取消"或超时，工具**永远不会**执行。
 *
 * 支付密码只发给 agent 服务（演示环境里它代替银行后端做校验），
 * 不经过模型，也不进会话日志。
 *
 * 组件本身**不发请求**：只把用户的决定交回给父组件，保持"谁拥有状态谁负责副作用"。
 *
 * @module app/components/agent/ConsentCard
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { PinInput } from '@/components/ui/PinInput'
import { AlertIcon, CheckIcon, LockIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import type { PendingConsent } from '@/lib/useAgentChat'
import type { VerificationMethod } from '@/api/agent'

/** 验证方式的中文说法。 */
const METHOD_LABELS: Record<VerificationMethod, string> = {
  'payment-password': '支付密码',
  sms: '短信验证码',
  face: '人脸核身',
}

/** 把剩余时间说成「还剩 1 分 20 秒」。 */
function remainingText(expiresAt: number, now: number): string {
  const seconds = Math.ceil(Math.max(0, expiresAt - now) / 1000)
  if (seconds <= 0) return '已超时，需要重新发起'
  if (seconds < 60) return `还剩 ${seconds} 秒`
  return `还剩 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

export function ConsentCard({
  pending,
  onApprove,
  onReject,
}: {
  pending: PendingConsent
  /** 用户确认（可能带支付密码）。 */
  onApprove: (paymentPassword?: string) => void
  /** 用户取消。 */
  onReject: () => void
}) {
  const { challenge, submitting, error } = pending
  const needsVerification = challenge.verification !== undefined
  const [password, setPassword] = useState('')
  const [now, setNow] = useState(() => Date.now())

  // 倒计时：让用户知道这次确认不是无限期的（超时后 agent 就不等了）。
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [])

  const expired = now > challenge.expiresAt
  const verified = /^\d{6}$/.test(password)
  const canApprove = !submitting && !expired && (!needsVerification || verified)

  return (
    <div className="float-up rounded-card border border-gold bg-gold-wash/50 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-chip bg-gold text-ink">
          <LockIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">需要你确认：{challenge.kind}</p>
          <p className="mt-1 text-[13px] text-ink-soft">
            在你确认之前，这笔操作不会执行。请核对下面的信息。
          </p>
        </div>
      </div>

      {/* 交易信息：逐条列出来，而不是让用户凭对话猜。
          宽屏分两列，免得卡片比可视区还高——确认按钮掉到折叠线以下，
          用户就得先滚动才能点"确认"，那是会让人漏看信息的设计。 */}
      <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-field border border-line bg-line sm:grid-cols-2">
        {challenge.fields.map((field) => (
          <div key={field.label} className="flex items-baseline justify-between gap-4 bg-surface px-4 py-2.5">
            <dt className="shrink-0 text-[13px] text-ink-mute">{field.label}</dt>
            <dd
              className={cn(
                'min-w-0 text-right text-[14px] break-all',
                field.emphasis ? 'num font-semibold text-ink' : 'text-ink',
              )}
            >
              {field.value}
            </dd>
          </div>
        ))}
      </dl>

      {challenge.consequence !== undefined && (
        <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-soft">
          <AlertIcon size={14} className="mt-0.5 shrink-0 text-coral" />
          <span>{challenge.consequence}</span>
        </p>
      )}

      {/* 身份验证：需要验的时候才出现 */}
      {needsVerification && (
        <div className="mt-4 rounded-field border border-line bg-surface p-4">
          <p className="text-[13px] font-medium text-ink">
            身份验证 · 请输入{METHOD_LABELS[challenge.verification!]}
          </p>
          <p className="mt-1 text-[12px] text-ink-mute">
            只用于本次校验：不会进入对话记录，也不会发给模型。
          </p>
          <div className="mt-3">
            <PinInput
              value={password}
              onChange={setPassword}
              label="支付密码"
              autoFocus
              disabled={submitting || expired}
            />
          </div>
          {!expired && !verified && password.length > 0 && (
            <p className="mt-2 text-[12px] text-ink-mute">请输入 6 位数字支付密码。</p>
          )}
        </div>
      )}

      {error !== undefined && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-coral">
          <AlertIcon size={14} className="shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-ink-mute">{remainingText(challenge.expiresAt, now)}</span>
        <span className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={submitting} onClick={onReject}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!canApprove}
            loading={submitting}
            icon={<CheckIcon size={15} />}
            onClick={() => { onApprove(needsVerification ? password : undefined) }}
          >
            {needsVerification ? '确认并验证' : '确认'}
          </Button>
        </span>
      </div>
    </div>
  )
}
