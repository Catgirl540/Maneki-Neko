import { useState } from 'react'
import { api } from '@/api'
import type { MemberTier, MembershipOverview } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Tag } from '@/components/ui/Segmented'
import { Modal } from '@/components/ui/Modal'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { CheckIcon, SparkleIcon } from '@/components/ui/icons'
import { useToast } from '@/components/ui/toast-context'
import { formatDate, formatWan } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { MEMBER_TIERS, MEMBER_TIER_RULES, memberBenefits } from '../../../shared/membership.mjs'
import cardStandard from '@/assets/membership/member-standard.webp'
import cardGold from '@/assets/membership/member-gold.webp'
import cardPlatinum from '@/assets/membership/member-platinum.webp'
import cardDiamond from '@/assets/membership/member-diamond.webp'

const TIER_CARD: Record<MemberTier, string> = {
  standard: cardStandard,
  gold: cardGold,
  platinum: cardPlatinum,
  diamond: cardDiamond,
}

const TIER_TAG: Record<MemberTier, 'neutral' | 'gold'> = {
  standard: 'neutral',
  gold: 'gold',
  platinum: 'gold',
  diamond: 'gold',
}

/** 当前 AUM ÷ 下一档门槛；最高档固定 100% */
function ProgressBar({ ratio }: { ratio: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  return (
    <div
      className="mt-2 h-2 w-full overflow-hidden rounded-chip bg-sunk"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-chip bg-gold transition-[width] duration-[var(--duration-state)] ease-[var(--ease-out-soft)]"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/** 各等级门槛文案：普通档写「开户即享」，其余按万元展示 */
function thresholdLabel(tier: MemberTier): string {
  return tier === 'standard' ? '开户即享' : `≥ ${formatWan(MEMBER_TIER_RULES[tier].threshold)}`
}

export function MembershipPage() {
  const membership = useAsync<MembershipOverview>(() => api.getMembership(), [])
  const toast = useToast()
  const [loungeOpen, setLoungeOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!membership.data) return membership.error ? <DataUnavailable message={membership.error} onRetry={membership.reload} /> : <DataLoading />
  const data = membership.data
  const ev = data.evaluation
  const highest = data.nextTier === null || data.nextThreshold === null
  const ratio = highest ? 1 : Math.min(1, data.aum / (data.nextThreshold || 1))
  const gap = highest ? 0 : Math.max(0, (data.nextThreshold ?? 0) - data.aum)
  const nextLabel = data.nextTier ? MEMBER_TIER_RULES[data.nextTier].label : null

  async function redeemLounge() {
    setBusy(true)
    try {
      const next = await api.redeemLoungePass()
      membership.setData(next)
      setLoungeOpen(false)
      toast.show(`已核销 1 次贵宾厅，剩余 ${next.lounge.remaining} 次`)
    } catch (error) {
      toast.show(error instanceof Error ? error.message : '核销失败，请稍后重试', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">会员中心</h1>

      <Card className="float-up">
        <CardHeader
          title="当前等级"
          action={<Tag tone={TIER_TAG[data.tier] ?? 'neutral'}>{data.tierLabel}</Tag>}
        />
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <img
            src={TIER_CARD[data.tier]}
            alt={`${data.tierLabel}卡面`}
            className="aspect-[1.585/1] w-full max-w-[320px] shrink-0 rounded-card object-cover shadow-[0_18px_36px_-20px_rgba(6,27,49,0.55)]"
          />
          <div className="flex min-w-[260px] flex-1 flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[24px] font-semibold text-ink">{data.tierLabel}</p>
              <p className="mt-1 text-[13px] text-ink-mute">
                {ev
                  ? `${ev.for} 评定 · 上月日均 AUM ${formatWan(ev.avgAssets)}（覆盖 ${ev.coveredDays}/${ev.daysInMonth} 天）`
                  : '开户即享普通会员；首次月度评定后按上月日均 AUM 定级'}
              </p>
              {data.since && (
                <p className="mt-1 text-[13px] text-ink-mute">当前等级自 {formatDate(data.since)} 起生效</p>
              )}
            </div>
            <div className="text-right text-[13px] text-ink-mute">
              <p>
                当前月均 AUM
                <span className="num ml-1 font-semibold text-ink">{formatWan(data.aum)}</span>
              </p>
              {highest ? (
                <p className="mt-1">钻石会员 · 已是最高等级</p>
              ) : (
                <p className="mt-1">
                  距{nextLabel}还差
                  <span className="num ml-1 font-semibold text-ink">{formatWan(gap)}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        <ProgressBar ratio={ratio} />
        <p className="mt-1.5 text-[12px] text-ink-mute">
          {highest ? '进度 100%' : `进度按当前 AUM ÷ ${nextLabel}门槛计算（${Math.round(ratio * 100)}%）`}
        </p>

        {data.downgradeWarning && (
          <p role="status" className="mt-3 rounded-field bg-gold-wash px-4 py-3 text-[13px] text-gold-deep">
            {data.downgradeWarning}
          </p>
        )}
      </Card>

      <Card className="float-up" style={{ animationDelay: '60ms' }}>
        <CardHeader title="生效权益" action={<Tag tone="neutral">{data.tierLabel}</Tag>} />
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.benefits.map((benefit) => {
            const planned = benefit.includes('规划中')
            return (
              <li key={benefit} className="flex items-start gap-2.5 rounded-field bg-sunk px-4 py-3.5 text-[13px]">
                <span className={planned ? 'mt-0.5 text-ink-mute' : 'mt-0.5 text-gold-deep'}>
                  {planned ? <SparkleIcon size={15} /> : <CheckIcon size={15} />}
                </span>
                <span className={planned ? 'text-ink-mute' : 'text-ink'}>{benefit}</span>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">
          权益随等级递进：高等级含低等级全部权益。生日礼遇按产品规划暂缓，标注为「规划中」，不计入已生效权益。
        </p>
      </Card>

      <Card className="float-up" style={{ animationDelay: '100ms' }}>
        <CardHeader
          title="机场 / 高铁贵宾厅"
          action={<Tag tone={data.lounge.remaining > 0 ? 'gold' : 'neutral'}>{data.lounge.year} 年度</Tag>}
        />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="num text-[24px] font-semibold text-ink">
              {data.lounge.remaining}
              <span className="ml-1 text-[13px] font-normal text-ink-mute">次可用</span>
            </p>
            <p className="mt-1 text-[13px] text-ink-mute">
              每年 {data.lounge.perYear} 次，已核销 {data.lounge.used} 次；额度按自然年清零。
            </p>
            {data.lounge.perYear === 0 && (
              <p className="mt-1 text-[12px] text-ink-mute">白金及以上等级含贵宾厅额度，升级后自动生效。</p>
            )}
          </div>
          <Button
            variant="primary"
            disabled={data.lounge.remaining === 0}
            onClick={() => setLoungeOpen(true)}
          >
            核销一次
          </Button>
        </div>
        {data.lounge.remaining === 0 && (
          <p className="mt-3 text-[12px] text-ink-mute">
            {data.lounge.perYear === 0 ? '当前等级不含贵宾厅额度。' : '本年度额度已用完，次年 1 月 1 日自动恢复。'}
          </p>
        )}
      </Card>

      <Card className="float-up" style={{ animationDelay: '140ms' }}>
        <CardHeader title="各等级对比" />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-[12px] text-ink-mute">
              <tr className="border-b border-line">
                <th className="py-2.5 pr-4 font-medium">等级</th>
                <th className="py-2.5 pr-4 font-medium whitespace-nowrap">月均 AUM 门槛</th>
                <th className="py-2.5 font-medium">权益</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {MEMBER_TIERS.map((tier) => {
                const current = tier === data.tier
                return (
                  <tr key={tier} className={current ? 'bg-gold-wash/40' : undefined}>
                    <td className="py-3 pr-4 align-top whitespace-nowrap">
                      <span className="flex items-center gap-3">
                        <img
                          src={TIER_CARD[tier]}
                          alt={`${MEMBER_TIER_RULES[tier].label}卡面`}
                          className="aspect-[1.585/1] w-14 shrink-0 rounded-field object-cover"
                        />
                        <span className="flex items-center gap-2">
                          <span className={current ? 'font-semibold text-ink' : 'text-ink'}>{MEMBER_TIER_RULES[tier].label}</span>
                          {current && <Tag tone="gold">当前</Tag>}
                        </span>
                      </span>
                    </td>
                    <td className="num py-3 pr-4 align-top whitespace-nowrap text-ink-soft">{thresholdLabel(tier)}</td>
                    <td className="py-3 align-top text-ink-mute">
                      {memberBenefits(tier).filter((line) => line !== '基础银行服务').join(' · ') || '基础银行服务'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-ink-mute">
          评定规则：每月 1 号按上月日均 AUM 重算；升级即时生效，降级需连续 2 个评定周期未达标。
        </p>
      </Card>

      <Card className="float-up" style={{ animationDelay: '180ms' }}>
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
                {record.amount > 0 ? `省 ¥${(record.amount / 100).toFixed(2)}` : '—'}
              </span>
            </div>
          ))}
          {data.records.length === 0 && <p className="py-8 text-center text-[13px] text-ink-mute">暂无评级或权益使用记录。</p>}
        </div>
      </Card>

      <Modal
        open={loungeOpen}
        onClose={() => { if (!busy) setLoungeOpen(false) }}
        title="核销贵宾厅额度"
        description={`本次核销将使用 1 次机场 / 高铁贵宾厅额度，核销后本年度剩余 ${Math.max(0, data.lounge.remaining - 1)} 次。`}
        closeDisabled={busy}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setLoungeOpen(false)}>取消</Button>
            <Button variant="primary" loading={busy} onClick={redeemLounge}>确认核销</Button>
          </>
        }
      />
    </div>
  )
}
