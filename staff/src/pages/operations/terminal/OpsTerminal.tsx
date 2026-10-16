import { useEffect, useRef, useState } from 'react'
import { TerminalPane, type TerminalHandle, type TerminalTab, type TerminalStatus } from './TerminalPane'
import { terminalApi, type TerminalSession } from '@/api/terminal'
import { PlusIcon, CloseIcon, CopyIcon, TrashIcon, DeviceIcon } from '../../../../../app/src/components/ui/icons'
import './terminal.css'

const statusLabel: Record<TerminalStatus, string> = { idle: '未连接', connecting: '连接中', connected: '已连接', disconnected: '连接断开', exited: '进程结束' }
export function OpsTerminal({ visible }: { visible: boolean }) {
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: 'terminal-1', label: '终端 1', status: 'idle' }])
  const [activeId, setActiveId] = useState('terminal-1')
  const [maximized, setMaximized] = useState(false)
  const [notice, setNotice] = useState('')
  const nextId = useRef(2)
  const handles = useRef(new Map<string, TerminalHandle>())
  const currentTabs = useRef(tabs)
  useEffect(() => { currentTabs.current = tabs }, [tabs])
  useEffect(() => () => { currentTabs.current.forEach(tab => { if (tab.session) void terminalApi.close(tab.session.id).catch(() => {}) }) }, [])
  const active = tabs.find(tab => tab.id === activeId)
  function add() {
    const current = currentTabs.current
    if (current.length >= 8) return
    const index = nextId.current++
    const tab: TerminalTab = { id: `terminal-${index}`, label: `终端 ${index}`, status: 'idle' }
    const next = [...current, tab]; currentTabs.current = next; setTabs(next); setActiveId(tab.id)
  }
  function close(id: string) {
    const current = currentTabs.current
    const index = current.findIndex(tab => tab.id === id), tab = current[index]
    if (!tab) return
    if (tab.session) void terminalApi.close(tab.session.id).catch(() => {})
    const remaining = current.filter(item => item.id !== id)
    currentTabs.current = remaining
    setTabs(remaining)
    if (activeId === id) setActiveId(remaining[Math.min(index, remaining.length - 1)]?.id ?? '')
  }
  function update(id: string, value: Partial<TerminalTab>) { setTabs(items => items.map(tab => tab.id === id ? { ...tab, ...value } : tab)) }
  function navigateTab(event: React.KeyboardEvent, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    if (next >= 0) { event.preventDefault(); setActiveId(tabs[next].id); document.getElementById(`terminal-tab-${tabs[next].id}`)?.focus() }
  }

  return <section className={`ops-terminal ${maximized && visible ? 'is-maximized' : ''}`} aria-label="服务器终端">
    <header className="ops-terminal-titlebar">
      <DeviceIcon size={16} /><strong>{active?.session ? `${active.session.user}@${active.session.host}` : '服务器终端'}</strong><span>银行 / Agent 后端</span>
      <div className="ops-terminal-window-actions"><button type="button" onClick={add} disabled={tabs.length >= 8} aria-label="新建终端" title="新建终端 · Ctrl+Shift+T"><PlusIcon size={17} /></button><button type="button" onClick={() => setMaximized(value => !value)} aria-label={maximized ? '还原终端窗口' : '最大化终端'} title={maximized ? '还原' : '最大化'}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d={maximized ? 'M6 3h11v11M3 6h11v11H3z' : 'M4 8V4h4m4 0h4v4m0 4v4h-4m-4 0H4v-4'} /></svg></button></div>
    </header>
    <div className="ops-terminal-tabs" role="tablist" aria-label="终端标签页">{tabs.map((tab, index) => <div key={tab.id} className={`ops-terminal-tab ${tab.id === activeId ? 'is-active' : ''}`} role="presentation">
      <button type="button" role="tab" id={`terminal-tab-${tab.id}`} aria-controls={`terminal-panel-${tab.id}`} aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1} onKeyDown={event => navigateTab(event, index)} onClick={() => setActiveId(tab.id)}><i data-status={tab.status} aria-hidden="true" />{tab.label}</button>
      <button type="button" className="ops-terminal-tab-close" aria-label={`关闭${tab.label}`} title="关闭标签会结束该终端的进程" onClick={() => close(tab.id)}><CloseIcon size={12} /></button>
    </div>)}</div>
    <div className="ops-terminal-body">{tabs.map(tab => <TerminalPane key={tab.id} tab={tab} active={visible && activeId === tab.id} ref={handle => { if (handle) handles.current.set(tab.id, handle); else handles.current.delete(tab.id) }}
      onStatus={status => update(tab.id, { status })} onSession={(session: TerminalSession) => update(tab.id, { session })} onNew={add} onClose={() => close(tab.id)} />)}
      {!tabs.length && <div className="ops-terminal-empty"><DeviceIcon size={34} /><strong>打开一个终端开始工作</strong><button type="button" onClick={add}><PlusIcon size={15} />新建终端</button></div>}
    </div>
    <footer className="ops-terminal-status"><span><i data-status={active?.status ?? 'idle'} />{active ? statusLabel[active.status] : '没有打开的终端'}{active?.session && <small title="启动目录">{active.session.cwd}</small>}</span><output aria-live="polite">{notice}</output><div>
      <button type="button" disabled={!active} aria-label="复制终端选中内容" title="复制选中内容" onClick={async () => { try { setNotice(await handles.current.get(activeId)?.copy() ? '已复制' : '先选中要复制的内容') } catch { setNotice('复制失败，请使用系统复制快捷键') } }}><CopyIcon size={14} /></button>
      <button type="button" disabled={!active} aria-label="清屏" title="清屏" onClick={() => { handles.current.get(activeId)?.clear(); setNotice('已清屏') }}><TrashIcon size={14} /></button>
    </div></footer>
  </section>
}
