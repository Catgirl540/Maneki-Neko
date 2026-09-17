import { createContext, useContext } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastValue {
  show: (message: string, tone?: ToastTone) => void
}

export const ToastContext = createContext<ToastValue | null>(null)

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext)
  // 没挂 Provider 时降级为静默，避免因为一个提示把页面搞崩
  return ctx ?? { show: () => {} }
}