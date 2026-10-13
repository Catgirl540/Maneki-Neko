import { useEffect, useRef } from 'react'
import { api } from '@/api'
import type { TransactionRecord } from '@/api/types'

/** 只查询已提交的指令；失败时保留原状态，绝不重发转账。 */
export function usePendingTransaction(
  id: string | undefined,
  pending: boolean,
  onRecord: (record: TransactionRecord) => void,
) {
  const callback = useRef(onRecord)
  useEffect(() => { callback.current = onRecord }, [onRecord])
  useEffect(() => {
    if (!id || !pending) return
    const transactionId = id
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      let complete = false
      try {
        const record = await api.getTransaction(transactionId)
        if (cancelled) return
        complete = record.status !== 'pending'
        callback.current(record)
      } catch { /* 查询失败不能推断到账，稍后重试。 */ }
      if (!cancelled && !complete) timer = setTimeout(() => void refresh(), 2000)
    }
    timer = setTimeout(() => void refresh(), 1000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [id, pending])
}
