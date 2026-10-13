import { useState } from 'react'
import { api, ApiError } from '@/api'
import type { IdentityStatus } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { AlertIcon, CheckIcon, EyeIcon, ShieldIcon, UserIcon } from '@/components/ui/icons'
import { formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'
import { cn } from '@/lib/cn'

const LEVEL: Record<IdentityStatus['level'], { label: string; tone: 'gold' | 'blue' | 'neutral' }> = {
  none: { label: '未认证', tone: 'neutral' },
  basic: { label: '基础认证', tone: 'blue' },
  verified: { label: '已认证', tone: 'gold' },
}

export function IdentityPage() {
  const toast = useToast()
  const identity = useAsync<IdentityStatus>(() => api.getIdentityStatus(), [])
  const [busy, setBusy] = useState<'ocr' | 'liveness' | null>(null)

  async function runOcr() {
    setBusy('ocr')
    try {
      await api.runIdentityOcr()
      toast.show('证件识别完成', 'success')
      identity.reload()
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '识别失败，请稍后重试', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function runLiveness() {
    setBusy('liveness')
    try {
      await api.runIdentityLiveness()
      toast.show('人脸核验通过', 'success')
      identity.reload()
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '核验失败，请稍后重试', 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!identity.data) return identity.error ? <DataUnavailable message={identity.error} onRetry={identity.reload} /> : <DataLoading />
  const data = identity.data
  const level = LEVEL[data.level]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">身份认证</h1>

      <Card className="float-up">
        <CardHeader title="认证状态" action={<Tag tone={level.tone}>{level.label}</Tag>} />
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <span className="grid size-14 shrink-0 place-items-center rounded-tile bg-gold-tint text-gold-deep">
            <ShieldIcon size={26} />
          </span>
          <dl className="flex min-w-[220px] flex-1 flex-col gap-3 text-[13px]">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">证件类型</dt>
              <dd className="text-ink">{data.idType}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">证件号码</dt>
              <dd className="num text-ink">{data.maskedIdNumber}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">人脸核验</dt>
              <dd className="flex items-center gap-1.5 text-ink">
                {data.livenessVerified ? <><CheckIcon size={15} className="text-blue" />已通过</> : '未完成'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">认证时间</dt>
              <dd className="num text-ink">{data.verifiedAt ? formatDate(data.verifiedAt) : '—'}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '80ms' }}>
        <CardHeader title="开户验证进度" />
        <ol className="mt-4 flex flex-col">
          {data.steps.map((step, index) => {
            const done = step.status === 'done'
            const active = step.status === 'active'
            return (
              <li key={step.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-chip', done ? 'bg-blue text-ink-invert' : active ? 'bg-gold text-ink-invert' : 'bg-sunk text-ink-mute')}>
                    {done ? <CheckIcon size={16} /> : <span className="num text-[13px]">{index + 1}</span>}
                  </span>
                  {index < data.steps.length - 1 && <span className={cn('my-1 w-px flex-1', done ? 'bg-blue-wash' : 'bg-line')} />}
                </div>
                <div className="min-w-0 flex-1 pb-5">
                  <p className="text-[15px] font-medium text-ink">{step.label}</p>
                  <p className="mt-0.5 text-[13px] text-ink-mute">{step.note}</p>
                  {step.completedAt && <p className="num mt-1 text-[12px] text-ink-mute">{formatDate(step.completedAt)} 完成</p>}
                </div>
              </li>
            )
          })}
        </ol>
      </Card>

      <Card className="float-up" style={{ animationDelay: '140ms' }}>
        <CardHeader title="证件识别信息" action={<Tag tone="neutral">OCR</Tag>} />
        {data.ocr ? (
          <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">姓名</dt>
              <dd className="text-ink">{data.ocr.holderName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">号码</dt>
              <dd className="num text-ink">{data.ocr.idNumber}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">出生日期</dt>
              <dd className="num text-ink">{data.ocr.birthDate}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">证件有效期</dt>
              <dd className="num text-ink">{data.ocr.expiryDate}</dd>
            </div>
            <div className="flex justify-between gap-4 sm:col-span-2">
              <dt className="text-ink-soft">住址</dt>
              <dd className="text-ink">{data.ocr.address}</dd>
            </div>
            <div className="flex justify-between gap-4 sm:col-span-2">
              <dt className="text-ink-soft">识别置信度</dt>
              <dd className="num text-ink">{Math.round(data.ocr.confidence * 100)}%</dd>
            </div>
          </dl>
        ) : (
          <div className="mt-4 flex flex-col items-start gap-4">
            <p className="flex items-start gap-2 text-[13px] text-ink-mute">
              <UserIcon size={16} className="mt-0.5 shrink-0" />
              还没有证件识别记录，上传证件照片后自动识别。
            </p>
            <Button variant="primary" size="sm" loading={busy === 'ocr'} onClick={() => void runOcr()}>上传并识别证件</Button>
          </div>
        )}
      </Card>

      <Card className="float-up" style={{ animationDelay: '200ms' }}>
        <CardHeader title="人脸活体核验" />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p className="flex items-start gap-2 text-[13px] text-ink-soft">
            <EyeIcon size={16} className="mt-0.5 shrink-0" />
            {data.livenessVerified ? '已完成人脸活体核验。' : '完成人脸活体核验后可提升账户权限。'}
          </p>
          {!data.livenessVerified && (
            <Button variant="primary" size="sm" loading={busy === 'liveness'} onClick={() => void runLiveness()}>开始人脸核验</Button>
          )}
        </div>
      </Card>

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-mute">
        <AlertIcon size={15} className="mt-0.5 shrink-0" />
        证件号码仅用于核验，界面一律脱敏展示；明文不落前端存储。演示环境按登记资料回填，真机需接入第三方核身服务。
      </p>
    </div>
  )
}
