import { useEffect, useRef, useState } from 'react'
import { api } from '@/api'
import type { SupportTicket, SupportTicketDetail, SupportTicketPage, SupportTicketStatus } from '@/api/types'
import type { ChatItem } from '@/lib/agentSessions'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { redactSupportText, supportTranscript } from '../../../../shared/support.mjs'

const labels: Record<SupportTicketStatus, string> = { open: '等待受理', processing: '处理中', waiting: '待你补充', suspended: '已暂停', resolved: '已解决' }
const errorText = (error: unknown) => error instanceof Error ? error.message : '请求失败，请稍后重试'
const requestId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const inputClass = 'w-full rounded-field border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-gold disabled:bg-sunk'

/** Id stays bound to the submitted content across a failed request, preventing retry duplicates. */
function useRequestKey() {
  const current = useRef({ payload: '', id: '' })
  return (payload: string) => {
    if (current.current.payload !== payload || !current.current.id) current.current = { payload, id: requestId() }
    return current.current.id
  }
}

export function HumanSupportRequest({ open, items, onClose, onCreated }: {
  open: boolean; items: ChatItem[]; onClose: () => void; onCreated: (ticket: SupportTicket) => void
}) {
  const [reason, setReason] = useState('')
  const [include, setInclude] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const keyFor = useRequestKey()
  const transcript = supportTranscript(items.filter((item): item is Extract<ChatItem, { kind: 'user' | 'assistant' }> => item.kind === 'user' || item.kind === 'assistant'))
  async function submit() {
    if (!reason.trim() || busy) return
    setBusy(true); setError('')
    const value = { reason: redactSupportText(reason), ...(include ? { transcript } : {}) }
    try { onCreated(await api.requestHumanSupport({ ...value, requestId: keyFor(JSON.stringify(value)) })) }
    catch (error) { setError(errorText(error)) }
    finally { setBusy(false) }
  }
  return <Modal open={open} onClose={onClose} title="转人工" width="max-w-[640px]" closeDisabled={busy}
    description="提交后等待客服受理，可在人工工单查看回复。"
    footer={<><Button block onClick={onClose} disabled={busy}>取消</Button><Button block variant="primary" loading={busy} disabled={!reason.trim()} onClick={() => void submit()}>提交请求</Button></>}>
    <label className="block text-sm font-medium text-ink" htmlFor="human-reason">问题描述</label>
    <textarea id="human-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={4} disabled={busy}
      placeholder="描述遇到的问题，请勿填写密码或验证码" className={`${inputClass} mt-2 resize-y`} />
    {transcript.length > 0 && <div className="mt-4">
      <label className="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" checked={include} disabled={busy} onChange={e => setInclude(e.target.checked)} />附上当前对话文字（最近 20 条，不含图片）</label>
      {include && <details className="mt-3 text-sm text-ink-soft"><summary className="cursor-pointer">查看将发送的对话</summary>
        <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-field bg-sunk p-3">{transcript.map((item, i) => <p key={i} className="whitespace-pre-wrap break-words">{item.role === 'user' ? '你' : '助手'}：{item.text}</p>)}</div>
      </details>}
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-coral">{error}</p>}
  </Modal>
}

/** Poll the selected published case; cancel stale reads on close, switch or logout. */
export function SupportTickets({ open, initialId, onClose }: { open: boolean; initialId?: string; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const [list, setList] = useState<SupportTicketPage>()
  const [selected, setSelected] = useState(initialId)
  const [detail, setDetail] = useState<SupportTicketDetail>()
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const keyFor = useRequestKey()
  useEffect(() => {
    if (!open) return
    let disposed = false, loading = false
    async function load() {
      if (loading) return
      loading = true
      try {
        const [rows, current] = await Promise.all([api.listSupportTickets(page), selected ? api.getSupportTicket(selected) : undefined])
        if (disposed) return
        setList(rows); setDetail(current); setLoadError('')
      } catch (error) { if (!disposed) setLoadError(errorText(error)) }
      finally { loading = false }
    }
    void load()
    const timer = window.setInterval(() => { if (!document.hidden) void load() }, 3000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [open, page, selected, refresh])
  async function reply() {
    if (!selected || !draft.trim() || busy) return
    const text = redactSupportText(draft)
    setBusy(true); setError('')
    try {
      await api.replySupportTicket(selected, { text, requestId: keyFor(JSON.stringify({ id: selected, text })) })
      setDraft(''); setRefresh(value => value + 1)
    } catch (error) { setError(errorText(error)) }
    finally { setBusy(false) }
  }
  const current = detail?.ticketId === selected ? detail : undefined
  return <Modal open={open} onClose={onClose} title="人工工单" width="max-w-[760px]" closeDisabled={busy}>
    {(error || loadError) && <p role="alert" className="mb-3 rounded-field bg-coral-wash p-3 text-sm text-coral">{error || loadError}</p>}
    {selected ? <div>
      <Button size="sm" disabled={busy} onClick={() => { setSelected(undefined); setDraft(''); setError(''); setLoadError('') }}>返回工单列表</Button>
      {!current ? <p role="status" className="mt-4 text-sm text-ink-soft">正在加载…</p> : <>
        <div className="mt-4 rounded-field bg-sunk p-4">
          <p className="text-sm font-medium text-ink">{labels[current.status]}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{current.reason}</p>
          <p className="mt-2 break-all text-xs text-ink-mute">工单编号：{current.ticketId}</p>
        </div>
        <div aria-label="人工服务对话" className="my-4 max-h-[35dvh] space-y-3 overflow-y-auto overscroll-contain" aria-live="polite">
          {current.messages.length === 0 && <p className="py-3 text-sm text-ink-soft">已提交，等待客服受理。</p>}
          {current.messages.map(message => <div key={message.id} className={`rounded-field p-3 ${message.sender === 'customer' ? 'bg-gold-tint' : 'bg-sunk'}`}>
            <p className="text-xs text-ink-soft">{message.sender === 'customer' ? '你' : message.sender === 'staff' ? '人工客服' : '系统'} · {date(message.createdAt)}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{message.text}</p>
          </div>)}
        </div>
        {current.status === 'resolved' ? <p className="text-sm text-ink-soft">工单已解决。仍需帮助时，可重新提交转人工请求。</p> : <form onSubmit={e => { e.preventDefault(); void reply() }}>
          <label htmlFor="support-reply" className="mb-2 block text-sm text-ink">补充留言</label>
          <textarea id="support-reply" className={inputClass} value={draft} disabled={busy} maxLength={2000} rows={3} placeholder="请勿填写密码或验证码" onChange={e => setDraft(e.target.value)} />
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!draft.trim()} className="mt-3">发送留言</Button>
        </form>}
      </>}
    </div> : <div>
      {!list && !loadError && <p role="status" className="text-sm text-ink-soft">正在加载…</p>}
      {list?.items.length === 0 && <p className="py-8 text-center text-sm text-ink-soft">暂无人工工单</p>}
      <div className="max-h-[55dvh] space-y-2 overflow-y-auto">{list?.items.map(ticket => <button type="button" key={ticket.ticketId}
        className="block w-full rounded-field border border-line p-4 text-left hover:bg-sunk focus-visible:outline-gold"
        onClick={() => { setSelected(ticket.ticketId); setDraft(''); setError(''); setLoadError('') }}>
        <span className="block truncate text-sm font-medium text-ink">{ticket.reason}</span>
        <span className="mt-2 block text-xs text-ink-soft">{labels[ticket.status]} · {date(ticket.updatedAt)}</span>
      </button>)}</div>
      {list && list.total > list.size && <div className="mt-4 flex items-center justify-between">
        <Button size="sm" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
        <span className="text-xs text-ink-soft">第 {page} / {Math.ceil(list.total / list.size)} 页</span>
        <Button size="sm" disabled={page * list.size >= list.total} onClick={() => setPage(value => value + 1)}>下一页</Button>
      </div>}
    </div>}
  </Modal>
}
