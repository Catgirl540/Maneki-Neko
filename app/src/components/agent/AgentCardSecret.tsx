import { useEffect, useState } from 'react'
import type { AgentEvent } from '../../api/agent'
import { Modal } from '../ui/Modal'

type Secret = Extract<AgentEvent, { type: 'card-secret' }>
/** 敏感卡信息只在内存临时窗口显示，不进入对话存档。 */
export function AgentCardSecret() {
  const [secret, setSecret] = useState<Secret | null>(null)
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<Secret>).detail
      if (detail.expiresAt > Date.now()) setSecret(detail)
    }
    window.addEventListener('luckycat:agent-card-secret', receive)
    return () => window.removeEventListener('luckycat:agent-card-secret', receive)
  }, [])
  useEffect(() => {
    if (!secret) return
    const hide = () => setSecret(null)
    const timer = window.setTimeout(hide, Math.max(0, secret.expiresAt - Date.now()))
    const visibility = () => { if (document.hidden) hide() }
    document.addEventListener('visibilitychange', visibility)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [secret])
  return <Modal open={secret !== null} onClose={() => setSecret(null)} title="卡安全信息" description="请勿分享卡安全信息。此窗口将在一分钟内自动关闭。">
    <div className="rounded-card bg-surface p-5">
      <p className="text-sm text-ink-muted">{secret?.field === 'cvv' ? 'CVV' : '完整卡号'}</p>
      <p className="mt-2 break-all font-mono text-2xl tracking-wider">{secret?.value}</p>
    </div>
  </Modal>
}
