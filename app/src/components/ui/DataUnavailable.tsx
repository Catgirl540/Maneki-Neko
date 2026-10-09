import { Button } from './Button'
import { Card } from './Card'
import { Skeleton } from './Segmented'

export function DataUnavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card role="alert" className="float-up">
      <h1 className="text-[22px] font-semibold text-ink">数据暂时无法加载</h1>
      <p className="mt-3 break-words text-[14px] text-ink-soft">{message}</p>
      <Button className="mt-5" onClick={onRetry}>重新加载</Button>
    </Card>
  )
}

export function DataLoading() {
  return <div role="status" aria-label="正在加载银行数据" className="space-y-6"><Skeleton className="h-9 w-40" /><Skeleton className="h-64 w-full rounded-card" /><Skeleton className="h-40 w-full rounded-card" /></div>
}
