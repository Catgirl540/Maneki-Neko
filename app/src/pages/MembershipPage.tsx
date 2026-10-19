import { api } from '@/api'
import type { MembershipOverview } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { SparkleIcon } from '@/components/ui/icons'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'

const TIER_TAG: Record<string, 'neutral' | 'gold'> = {
  silver: 'neutral',
  gold: 'gold',
  platinum: 'gold',
  diamond: 'gold',
}

export function MembershipPage() {
  const membership = useAsync<MembershipOverview>(() => api.getMembership(), [])

  if (!membership.data) return membership.error ? <DataUnavailable message={membership.error} onRetry={membership.reload} /> : <DataLoading />
  const data = membership.data
  const ev = data.evaluation
  const waiversLeft = Math.max(0, data.benefits.cardFeeWaiversPerYear - data.benefits.cardFeeWaiversUsed)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">会员等级</h1>

      <Card className="float-up">
        <CardHeader
          title="当前等级"
          action={<Tag tone={TIER_TAG[data.tier] ?? 'neutral'}>{data.tierName}</Tag>}
        />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[24px] font-semibold text-ink">{data.tierName}</p>
            <p className="mt-1 text-[13px] text-ink-mute">
              {ev
                ? `${ev.for} 评定 · 上月日均储蓄资产 ¥${formatAmount(ev.avgAssets)}（覆盖 ${ev.coveredDays}/${ev.daysInMonth} 天）`
                : '开户即享白银会员；首次月度评定后按上月日均储蓄资产定级'}
            </p>
            {data.since && (
              <p className="mt-1 text-[13px] text-ink-mute">当前等级自 {formatDate(data.since)} 起生效</p>
            )}
          </div>
          <div className="text-right text-[13px] text-ink-mute">
            <p>下次评定：{formatDate(data.nextEvaluationAt)}</p>
            {data.nextTierName && data.upgradeGap !== null && (
              <p className="mt-1">
                距{data.nextTierName}还差日均资产
                <span className="num ml-1 font-semibold text-ink">¥{formatAmount(data.upgradeGap)}</span>
              </p>
            )}
            {data.nextTierName === null && <p className="mt-1">已是最高等级</p>}
          </div>
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '60ms' }}>
        <CardHeader title="本年度权益" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-field bg-sunk px-4 py-3.5">
            <p className="text-[13px] text-ink-soft">制卡 / 换卡费减免</p>
            <p className="num mt-1 text-[18px] font-semibold text-ink">
              {data.benefits.cardFeeWaiversPerYear === 0
                ? '白银档不含减免'
                : `剩余 ${waiversLeft} 次 / 每年 ${data.benefits.cardFeeWaiversPerYear} 次`}
            </p>
            <p className="mt-1 text-[12px] text-ink-mute">
              {data.benefits.cardFeeWaiversPerYear === 0
                ? '升级后按等级享受折扣或全免'
                : `已使用 ${data.benefits.cardFeeWaiversUsed} 次${data.benefits.includeShipping ? '，减免含寄送费' : '，寄送费另计'}`}
            </p>
          </div>
          <div className="rounded-field bg-sunk px-4 py-3.5">
            <p className="text-[13px] text-ink-soft">换汇点差</p>
            <p className="num mt-1 text-[18px] font-semibold text-ink">
              {data.benefits.fxFeeRate === 1 ? '标准点差' : `${Math.round(data.benefits.fxFeeRate * 10)} 折`}
            </p>
            <p className="mt-1 text-[12px] text-ink-mute">报价时已自动按等级折算</p>
          </div>
        </div>
        {data.benefits.plannedPerks.length > 0 && (
          <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">
            规划中：{data.benefits.plannedPerks.join('、')} —— 尚未开通，不计入当前权益。
          </p>
        )}
      </Card>

      {data.legacy && (
        <Card className="float-up" style={{ animationDelay: '100ms' }}>
          <CardHeader title="历史订阅记录" action={<Tag tone="neutral">旧月费套餐已停止办理</Tag>} />
          <div className="mt-3 text-[13px] leading-relaxed text-ink-mute">
            {data.legacy.current ? (
              <p>
                曾订阅「{data.legacy.current.planName}」，状态：{data.legacy.current.status === 'canceled' ? '已取消' : data.legacy.current.status === 'active' ? '已生效（不再续费）' : '无'}。
                会员等级体系上线后旧套餐不再收取费用，仅保留历史记录。
              </p>
            ) : (
              <p>无旧套餐订阅记录。</p>
            )}
          </div>
        </Card>
      )}

      <Card className="float-up" style={{ animationDelay: '140ms' }}>
        <CardHeader title="评级与权益记录" />
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
                {record.amount > 0 ? `省 ¥${formatAmount(record.amount)}` : '—'}
              </span>
            </div>
          ))}
          {data.records.length === 0 && <p className="py-8 text-center text-[13px] text-ink-mute">暂无评级或权益使用记录。</p>}
        </div>
      </Card>
    </div>
  )
}
