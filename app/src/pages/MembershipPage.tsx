import { useRef, useState } from 'react'
import { api, ApiError } from '@/api'
import type { MembershipOverview } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { CheckIcon, SparkleIcon } from '@/components/ui/icons'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'

export function MembershipPage() {
  const toast = useToast()
  const membership = useAsync<MembershipOverview>(() => api.getMembership(), [])
  const [busyId, setBusyId] = useState<string | null>(null)
  const writing = useRef(false)

  async function subscribe(planId: string, planName: string) {
    if (writing.current) return
    writing.current = true
    setBusyId(planId)
    try {
      const next = await api.subscribeMembership(planId)
      membership.setData(next)
      toast.show(`已保存「${planName}」订阅设置`, 'success')
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '开通失败，请稍后重试', 'error')
    } finally {
      writing.current = false
      setBusyId(null)
    }
  }

  async function cancel() {
    if (writing.current) return
    writing.current = true
    setBusyId('cancel')
    try {
      const next = await api.cancelMembership()
      membership.setData(next)
      toast.show('已关闭自动续费设置', 'success')
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '取消失败，请稍后重试', 'error')
    } finally {
      writing.current = false
      setBusyId(null)
    }
  }

  if (!membership.data) return membership.error ? <DataUnavailable message={membership.error} onRetry={membership.reload} /> : <DataLoading />
  const data = membership.data
  const active = data.current.status === 'active'

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">会员与订阅</h1>

      <Card className="float-up">
        <CardHeader
          title="当前会员"
          action={
            active ? <Tag tone="gold">已保存</Tag> : data.current.status === 'canceled' ? <Tag tone="neutral">已取消续费</Tag> : <Tag tone="neutral">普通会员</Tag>
          }
        />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[20px] font-semibold text-ink">{data.current.planName}</p>
            <p className="mt-1 text-[13px] text-ink-mute">
              {active && data.current.renewAt
                ? `订阅日期 ${formatDate(data.current.startedAt ?? data.current.renewAt)} · ¥${formatAmount(data.current.price)}/${data.current.period.replace('每', '')}`
                : data.current.status === 'canceled'
                  ? '自动续费设置已关闭'
                  : active ? '订阅设置已保存' : '尚未选择会员套餐'}
            </p>
          </div>
          {active && (
            <Button variant="secondary" size="sm" disabled={busyId !== null} loading={busyId === 'cancel'} onClick={() => void cancel()}>
              取消自动续费
            </Button>
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {data.plans.map((plan) => {
          const isCurrent = active && data.current.planId === plan.id
          return (
            <Card key={plan.id} className="float-up flex flex-col" style={{ animationDelay: '80ms' }}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[17px] font-semibold text-ink">{plan.name}</h2>
                {plan.highlight && <Tag tone="gold">推荐</Tag>}
              </div>
              <p className="mt-3">
                <span className="num text-[28px] font-bold text-ink">¥{formatAmount(plan.price)}</span>
                <span className="ml-1 text-[13px] text-ink-mute">/{plan.period.replace('每', '')}</span>
              </p>
              <ul className="mt-4 flex flex-1 flex-col gap-2">
                {plan.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-[14px] text-ink-soft">
                    <span className="mt-0.5 shrink-0 text-gold-deep"><CheckIcon size={16} /></span>
                    {perk}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {isCurrent ? (
                  <Button variant="secondary" block disabled>当前套餐</Button>
                ) : (
                  <Button variant="primary" block disabled={busyId !== null} loading={busyId === plan.id} onClick={() => void subscribe(plan.id, plan.name)}>
                    {active ? '更换为该套餐' : '选择套餐'}
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="float-up" style={{ animationDelay: '140ms' }}>
        <CardHeader title="订阅设置记录" action={<Tag tone="neutral">扣费与权益暂未开放</Tag>} />
        <div className="mt-3 divide-y divide-line">
          {data.records.map((record) => (
            <div key={record.id} className="flex items-center gap-4 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep">
                <SparkleIcon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">{record.label}</span>
                <span className="mt-0.5 block text-[13px] text-ink-mute">{formatDate(record.createdAt)}</span>
              </span>
              <span className="num shrink-0 text-[15px] font-semibold text-ink">
                {record.amount > 0 ? `套餐 ¥${formatAmount(record.amount)}` : '—'}
              </span>
            </div>
          ))}
          {data.records.length === 0 && <p className="py-8 text-center text-[13px] text-ink-mute">暂无订阅记录。</p>}
        </div>
      </Card>
    </div>
  )
}
