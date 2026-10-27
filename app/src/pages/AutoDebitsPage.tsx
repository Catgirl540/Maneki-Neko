import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '@/api'
import type { AutoDebit } from '@/api/types'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { Card, CardHeader } from '@/components/ui/Card'
import { CategoryIcon } from '@/components/ui/CategoryIcon'
import { EmptyState, Skeleton } from '@/components/ui/Segmented'
import { Row, Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ReminderManager } from '@/components/im/ReminderManager'
import { analyzeSubscriptionCandidates, renewalReminderDraft, type SubscriptionAnalysis } from '../../../shared/subscriptions.mjs'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'

export function AutoDebitsPage() {
  const toast = useToast()
  const autoDebits = useAsync<AutoDebit[]>(() => api.listAutoDebits(), [])
  const [renewal, setRenewal] = useState<ReturnType<typeof renewalReminderDraft> | null>(null)
  const [stop, setStop] = useState<AutoDebit | null>(null)
  const [changing, setChanging] = useState(false)
  const candidates = useAsync<SubscriptionAnalysis[]>(async () => {
    const accounts = await api.listAccounts()
    const partitions = [...new Map(accounts.flatMap(account => [account, ...(account.currencyBalances ?? [])]).map(account => [account.id, account])).values()]
    return Promise.all(partitions.map(async account => analyzeSubscriptionCandidates(account, await api.listTransactions(account.id, { page: 1, size: 200 }))))
  }, [])
  async function toggleAutoDebit(item: AutoDebit, next: boolean) {
    if (changing) return
    const snapshot = autoDebits.data
    if (!snapshot) return
    autoDebits.setData(snapshot.map((a) => (a.id === item.id ? { ...a, enabled: next } : a)))
    setChanging(true)
    try {
      await api.setAutoDebitEnabled(item.id, next)
      toast.show(next ? `已开启「${item.merchant}」自动扣款` : `已关闭「${item.merchant}」自动扣款`, 'success')
      setStop(null)
    } catch (err) {
      autoDebits.setData(snapshot)
      toast.show(err instanceof ApiError ? err.message : '操作失败，请稍后重试', 'error')
    } finally { setChanging(false) }
  }
  function reviewRenewal(item: AutoDebit) {
    try { setRenewal(renewalReminderDraft(item)) }
    catch (error) { toast.show(error instanceof Error ? error.message : '请先核对续费日期', 'error') }
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
                  <Button size="sm" variant="ghost" disabled={!item.enabled || changing} onClick={() => reviewRenewal(item)} aria-label={`设置「${item.merchant}」续费提醒`}>续费提醒</Button>
                  <Toggle
                    label={`${item.merchant} 自动扣款`}
                    checked={item.enabled}
                    onChange={(next) => { if (!changing) { if (next) void toggleAutoDebit(item, true); else setStop(item) } }}
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

      <Card className="subscription-candidates">
        <CardHeader title="流水中的订阅候选" action={<Button size="sm" variant="ghost" onClick={candidates.reload} disabled={candidates.loading || candidates.refreshing}>重新识别</Button>} />
        <p className="mt-3 text-[13px] text-ink-mute">分别核查每个币种第一页最多 200 条已入账流水。连续三个日期出现相同商户、金额和相近周期时列为候选，请向商户核对。</p>
        {candidates.loading && <p className="mt-4 text-[13px] text-ink-mute">正在核查流水…</p>}
        {candidates.error && <p role="alert" className="mt-4 text-[13px] text-coral">{candidates.error}，本次未取得完整识别结果。</p>}
        {candidates.data?.map(analysis => <section className="mt-4" key={analysis.accountId}>
          <h3 className="text-[14px] font-medium">{analysis.currency} · 已检查 {analysis.coverage.returnedCount} / {analysis.coverage.bankTotal} 条</h3>
          {analysis.coverage.truncated && <p className="mt-1 text-[12px] text-ink-mute">样本未覆盖全部流水，较早的订阅可能未识别。</p>}
          {analysis.candidates.length === 0 && <p className="mt-2 text-[13px] text-ink-mute">本次样本未发现符合规则的候选，不代表没有订阅。</p>}
          {analysis.candidates.map((candidate, index) => <div className="mt-3 rounded-field border border-line p-4" key={`${candidate.merchant}-${index}`}>
            <p className="text-[14px] font-medium">{candidate.merchant} · {candidate.currency} {formatAmount(candidate.amountCents)}</p>
            <p className="mt-1 text-[12px] text-ink-mute">疑似{({ weekly: '每周', monthly: '每月', annual: '每年' } as Record<string, string>)[candidate.cycle]}扣费；依据交易：{candidate.evidence.map(row => row.transactionId).join('、')}</p>
            <p className="mt-2 text-[12px] text-ink-mute">仅为核对线索；请在商户应用中查看、管理或取消订阅。</p>
          </div>)}
        </section>)}
      </Card>

      <p className="text-[13px] text-ink-mute">停用仅关闭本行此签约项目的自动扣款，不等于取消商户订阅；已产生的账单仍需另行处理，不会自动退款。</p>
      <Link to="/wealth/plans?tab=birthday" className="self-start text-[13px] text-ink-soft underline">管理生日预留与订购待办</Link>
      <Modal open={stop !== null} title="停用本行代扣" closeDisabled={changing} onClose={() => { if (!changing) setStop(null) }} footer={<><Button variant="ghost" disabled={changing} onClick={() => setStop(null)}>保留代扣</Button><Button variant="danger" disabled={changing} onClick={() => { if (stop) void toggleAutoDebit(stop, false) }}>确认停用</Button></>}>
        <p className="text-[14px]">确认停用「{stop?.merchant}」的本行自动扣款？商户订阅、已产生账单和退款仍需向商户另行办理。</p>
      </Modal>
      <Modal open={renewal !== null} title="续费提醒" width="max-w-[720px]" onClose={() => setRenewal(null)}>
        {renewal && <><p className="mb-4 text-[13px] text-ink-mute">按合约 {renewal.contractId} 的下一次扣款日 {renewal.nextRunDate}，建议提前 {renewal.leadDays} 天提醒。请核对后确认创建一次性提醒；后续周期需另行设置。</p><ReminderManager key={renewal.contractId} compact initialTitle={renewal.title} initialTime={renewal.time} /></>}
      </Modal>
    </div>
  )
}
