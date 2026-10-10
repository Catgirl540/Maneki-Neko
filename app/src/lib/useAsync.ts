import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api'

interface AsyncState<T> {
  data: T | null
  /** 首次加载：还没有任何数据可显示，页面可以出骨架屏 */
  loading: boolean
  /** 后台刷新：已有数据，界面继续显示旧值，只是转个加载指示 */
  refreshing: boolean
  error: string | null
}

/**
 * 数据请求 hook。
 *
 * 关键行为：**stale-while-revalidate**。
 * 重新拉取时如果已有数据，就保留旧数据显示，只把 refreshing 置位；
 * 只有「手上一条数据都没有」时才算 loading。
 * 这样任何写操作后的 reload 都不会再把列表打回骨架屏（否则每点一次开关
 * 整块列表都会闪一下，观感上就是「卡一下」）。
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
): AsyncState<T> & { reload: () => void; setData: (next: T) => void } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    refreshing: false,
    error: null,
  })
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false
    setState((prev) =>
      prev.data === null
        ? { ...prev, loading: true, error: null }
        : { ...prev, refreshing: true, error: null },
    )

    fnRef
      .current()
      .then((data) => {
        if (!cancelled) {
          setState({ data, loading: false, refreshing: false, error: null })
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof ApiError ? err.message : '网络异常，请稍后重试'
        // 刷新失败时保留旧数据，不要因为一次抖动就把界面清空
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: message,
        }))
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  useEffect(() => {
    window.addEventListener('luckycat:bank-updated', reload)
    return () => window.removeEventListener('luckycat:bank-updated', reload)
  }, [reload])

  /** 本地直接写入（乐观更新 / 接口已返回最新值时可省掉一次回查） */
  const setData = useCallback((next: T) => {
    setState({ data: next, loading: false, refreshing: false, error: null })
  }, [])

  return { ...state, reload, setData }
}