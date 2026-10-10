import { useCallback, useSyncExternalStore } from 'react'

/** 同步 CSS 断点，用于窄屏弹窗与桌面内联面板的切换。 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(query)
    media.addEventListener('change', notify)
    return () => media.removeEventListener('change', notify)
  }, [query])
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
