import { api, ApiError } from '@/api'
import type { AutoDebit } from '@/api/types'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { Card, CardHeader } from '@/components/ui/Card'
import { CategoryIcon } from '@/components/ui/CategoryIcon'
import { EmptyState, Skeleton } from '@/components/ui/Segmented'
import { Row, Toggle } from '@/components/ui/Toggle'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'

export function AutoDebitsPage() {
  const toast = useToast()
  const autoDebits = useAsync<AutoDebit[]>(() => api.listAutoDebits(), [])
  async function toggleAutoDebit(item: AutoDebit, next: boolean) {
    const snapshot = autoDebits.data
    if (!snapshot) return
    autoDebits.setData(snapshot.map((a) => (a.id === item.id ? { ...a, enabled: next } : a)))
    try {
      await api.setAutoDebitEnabled(item.id, next)
      toast.show(next ? `已开启「${item.merchant}」自动扣款` : `已关闭「${item.merchant}」自动扣款`, 'success')
    } catch (err) {
      autoDebits.setData(snapshot)
      toast.show(err instanceof ApiError ? err.message : '操作失败，请稍后重试', 'error')
    }
  }

  if (autoDebits.error && !autoDebits.data) return <DataUnavailable message={autoDebits.error} onRetry={autoDebits.reload} />
  if (autoDebits.loading && !autoDebits.data) return <DataLoading />
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">自动扣款</h1>
      {/* 自动扣款 */}
      <Card className="float-up" style={{ animationDelay: '150ms' }}>
        <CardHeader
          title="已签约服务"
          action={<span className="text-[13px] text-ink-mute">共 {autoDebits.data?.length ?? 0} 项</span>}
        />
        <div className="mt-3 divide-y divide-line">
          {autoDebits.loading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="py-4">
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          {autoDebits.data?.map((item) => (
            <Row
              key={item.id}
              icon={<CategoryIcon category={item.category} />}
              title={item.merchant}
              description={`${item.cycle} · 下次扣款 ${formatDate(item.nextRunAt)}`}
              right={
                <span className="flex items-center gap-5">
                  <span className="num text-[15px] font-semibold text-ink">
                    ¥{formatAmount(item.amount)}
                  </span>
                  <Toggle
                    label={`${item.merchant} 自动扣款`}
                    checked={item.enabled}
                    onChange={(next) => void toggleAutoDebit(item, next)}
                  />
                </span>
              }
            />
          ))}
          {!autoDebits.loading && autoDebits.data?.length === 0 && (
            <EmptyState title="没有签约的自动扣款" />
          )}
        </div>
      </Card>

      <p className="text-[13px] text-ink-mute">订阅类扣款关停后，商户不会再次发起扣款；已产生的账单仍需支付。</p>
    </div>
  )
}
