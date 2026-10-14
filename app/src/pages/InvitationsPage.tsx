import { api } from '@/api'
import type { InvitationsOverview } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { CheckIcon, CopyIcon, SparkleIcon, UsersIcon } from '@/components/ui/icons'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'

const STAGE: Record<string, { label: string; tone: 'gold' | 'blue' | 'neutral' }> = {
  registered: { label: '已注册', tone: 'neutral' },
  account_opened: { label: '已开户', tone: 'blue' },
  reward_earned: { label: '奖励达标', tone: 'gold' },
}

export function InvitationsPage() {
  const toast = useToast()
  const invites = useAsync<InvitationsOverview>(() => api.getInvitations(), [])

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.show(`已复制${label}`, 'success')
    } catch {
      toast.show('复制失败，请手动选择复制', 'error')
    }
  }

  if (!invites.data) return invites.error ? <DataUnavailable message={invites.error} onRetry={invites.reload} /> : <DataLoading />
  const data = invites.data

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">邀请与奖励</h1>

      <Card className="float-up">
        <CardHeader title="我的邀请码" action={<Tag tone="gold">累计已得 ¥{formatAmount(data.totalEarned)}</Tag>} />
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-field border border-line bg-sunk px-4 py-3">
            <span className="num flex-1 text-[22px] font-bold tracking-[0.08em] text-ink">{data.invite.code}</span>
            <Button variant="secondary" size="sm" icon={<CopyIcon size={16} />} onClick={() => void copy(data.invite.code, '邀请码')}>
              复制邀请码
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-field border border-line bg-surface px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">{data.invite.link}</span>
            <Button variant="ghost" size="sm" icon={<CopyIcon size={16} />} onClick={() => void copy(data.invite.link, '邀请链接')}>
              复制链接
            </Button>
          </div>
          <p className="text-[12px] text-ink-mute">好友通过你的链接或邀请码注册并开户后，双方都会获得奖励。</p>
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '80ms' }}>
        <CardHeader title="推荐进度" action={<span className="text-[13px] text-ink-mute">共 {data.friends.length} 位好友</span>} />
        <div className="mt-3 divide-y divide-line">
          {data.friends.map((friend) => {
            const stage = STAGE[friend.stage]
            return (
              <div key={friend.id} className="flex items-center gap-4 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep">
                  <UsersIcon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">{friend.name} · {friend.maskedPhone}</span>
                  <span className="mt-0.5 block text-[13px] text-ink-mute">{formatDate(friend.joinedAt)} 加入</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <Tag tone={stage.tone}>{stage.label}</Tag>
                  {friend.reward > 0 && <span className="num text-[15px] font-semibold text-ink">+¥{formatAmount(friend.reward)}</span>}
                </span>
              </div>
            )
          })}
          {data.friends.length === 0 && <p className="py-8 text-center text-[13px] text-ink-mute">还没有好友通过你的邀请加入。</p>}
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '160ms' }}>
        <CardHeader title="双方奖励与权益" />
        <div className="mt-3 divide-y divide-line">
          {data.rewards.map((reward) => (
            <div key={reward.id} className="flex items-start gap-4 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep">
                {reward.status === 'credited' ? <CheckIcon size={18} /> : <SparkleIcon size={18} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">{reward.title}</span>
                <span className="mt-0.5 block text-[13px] text-ink-mute">{reward.description}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <Tag tone={reward.status === 'credited' ? 'blue' : 'gold'}>{reward.status === 'credited' ? '已发放' : '待发放'}</Tag>
                <span className="num text-[15px] font-semibold text-ink">¥{formatAmount(reward.amount)}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
