import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { ApiError } from '@/api'
import {
  claimImCode, isImUnavailable, listImBindings, previewImCode, revokeImBinding,
  type ImBinding, type ImCodePreview,
} from '@/api/im'
import { ChatIcon, CheckIcon, RefreshIcon } from '../../../../app/src/components/ui/icons'

/**
 * 企微通知（员工 IM）。
 * 流程：员工在企业微信里给机器人发任意消息 → 收到绑定码链接
 * （/staff/im#code=…）→ 本页核对来源并确认 → 私聊绑定到当前员工。
 * 绑定后客服工单、在途处置等提醒会投递到该私聊；在私聊里发消息即发起
 * 一次以本人工作台权限运行的助手任务。
 */

function readHashCode(): { code?: string; session?: string } {
  const hash = window.location.hash.replace(/^#/, '')
  const params = new URLSearchParams(hash)
  return { code: params.get('code') ?? undefined, session: params.get('session') ?? undefined }
}

export function ImPage() {
  const [bindings, setBindings] = useState<ImBinding[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sessionHint] = useState<string | null>(() => readHashCode().session ?? null)
  const [codeInput, setCodeInput] = useState(() => readHashCode().code ?? '')
  const [preview, setPreview] = useState<{ code: string; info: ImCodePreview } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setBindings(await listImBindings())
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('企微连接加载失败', 0))
    } finally {
      setLoaded(true)
    }
  }, [])

  // 拉远端数据的 effect：setState 都在 await 之后，不是同步级联渲染
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refresh() }, [refresh])

  // 机器人发来的绑定链接带 #code=，进页面自动核对来源，待员工确认。
  useEffect(() => {
    const code = readHashCode().code
    if (!code) return
    let cancelled = false
    previewImCode(code)
      .then(info => { if (!cancelled) setPreview({ code, info }) })
      .catch(e => { if (!cancelled) setNotice(e instanceof ApiError ? e.message : '绑定码核对失败') })
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    return () => { cancelled = true }
  }, [])

  async function doPreview() {
    const code = codeInput.trim()
    if (!code || busy) return
    setBusy(true); setNotice(null)
    try { setPreview({ code, info: await previewImCode(code) }) }
    catch (e) { setPreview(null); setNotice(e instanceof ApiError ? e.message : '绑定码核对失败') }
    finally { setBusy(false) }
  }

  async function doClaim() {
    if (!preview || busy) return
    setBusy(true); setNotice(null)
    try {
      await claimImCode(preview.code)
      setPreview(null); setCodeInput('')
      setNotice('已绑定企业微信私聊，工单与处置提醒会投递到这里。')
      await refresh()
    } catch (e) { setNotice(e instanceof ApiError ? e.message : '绑定失败，请重新获取绑定码') }
    finally { setBusy(false) }
  }

  async function doRevoke(id: string) {
    if (busy) return
    setBusy(true); setNotice(null)
    try { await revokeImBinding(id); await refresh() }
    catch (e) { setNotice(e instanceof ApiError ? e.message : '解除绑定失败') }
    finally { setBusy(false) }
  }

  if (loaded && error && isImUnavailable(error)) {
    return <div className="staff-page">
      <PageHeader title="企微通知" description="把工单与处置提醒推送到你的企业微信。" />
      <div className="staff-empty"><span><ChatIcon size={22} /></span><strong>企业微信通知尚未启用</strong><small>请联系运维开启 IM 服务后再回来绑定</small></div>
    </div>
  }

  return <div className="staff-page">
    <PageHeader title="企微通知" description="绑定企业微信私聊，接收工单与处置提醒，也可以直接在私聊里交代任务。" actions={<button type="button" onClick={() => void refresh()} aria-label="刷新"><RefreshIcon size={15} /></button>} />

    {error && <div role="alert" className="mb-4 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">{error.message}</div>}
    {notice && <div role="status" className="mb-4 rounded-[var(--radius-tile)] bg-[var(--color-gold-tint)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">{notice}</div>}
    {sessionHint && <div role="status" className="mb-4 rounded-[var(--radius-tile)] bg-[var(--color-gold-tint)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">企微中的任务仍在后台处理，结果会回复到私聊里；业务状态以工作台记录为准。</div>}

    <div className="staff-dashboard-grid">
      <section className="staff-table-wrap">
        <header className="staff-table-caption"><h2>已绑定的私聊</h2></header>
        <table className="staff-table"><thead><tr><th>连接</th><th>状态</th><th></th></tr></thead>
          <tbody>{bindings.map(b => <tr key={b.id}>
            <td>{b.label}</td>
            <td><span className={`rounded-full px-2 py-1 text-xs ${b.connected ? 'bg-[var(--color-gold-tint)] text-[var(--color-gold-deep)]' : 'bg-[var(--color-paper)] text-[var(--color-ink-mute)]'}`}>{b.connected ? '在线' : '已离线，请重新绑定'}</span></td>
            <td className="text-right"><button type="button" className="staff-button" disabled={busy} onClick={() => void doRevoke(b.id)}>解除绑定</button></td>
          </tr>)}{bindings.length === 0 && <tr><td colSpan={3}><div className="staff-empty"><span><ChatIcon size={22} /></span><strong>{loaded ? '还没有绑定任何私聊' : '正在加载…'}</strong><small>在企业微信里给机器人发一条消息，把收到的绑定码填到右侧</small></div></td></tr>}</tbody>
        </table>
      </section>

      <aside>
        <section className="staff-shortcuts"><h2>绑定新私聊</h2>
          <p className="px-1 pb-2 text-sm text-[var(--color-ink-mute)]">在企业微信里给机器人发任意消息，会收到一个十分钟有效的绑定码，粘贴到下面核对并确认。</p>
          <div className="flex gap-2 px-1 pb-3">
            <input value={codeInput} onChange={e => setCodeInput(e.target.value)} placeholder="绑定码" className="min-w-0 flex-1 rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 font-mono text-sm" />
            <button type="button" className="staff-button" disabled={busy || !codeInput.trim()} onClick={() => void doPreview()}>核对</button>
          </div>
          {preview && <div className="mx-1 mb-3 rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] p-3 text-sm">
            <p>即将绑定 <strong>{preview.info.label}</strong></p>
            <p className="mt-1 text-xs text-[var(--color-ink-mute)]">绑定码 {new Date(preview.info.expiresAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })} 前有效</p>
            <div className="mt-3 flex gap-2">
              <button type="button" className="staff-button staff-button-primary" disabled={busy} onClick={() => void doClaim()}><CheckIcon size={14} /> 确认绑定</button>
              <button type="button" className="staff-button" disabled={busy} onClick={() => setPreview(null)}>取消</button>
            </div>
          </div>}
        </section>
        <section className="staff-dashboard-assistant"><h2>绑定后怎么用</h2><p>工单分派、大额转账进入处置等提醒会推送到私聊；在私聊里直接发文字即可让助手按你的工作台权限办理，敏感操作仍以工作台页面为准。在<Link to="/tickets">工单中心</Link>查看待办。</p></section>
      </aside>
    </div>
  </div>
}
