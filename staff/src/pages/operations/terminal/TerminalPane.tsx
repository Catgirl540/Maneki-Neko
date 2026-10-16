import { useEffect, useRef, useState, useImperativeHandle, type Ref } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { terminalApi, type TerminalSession } from '@/api/terminal'
import '@xterm/xterm/css/xterm.css'

export interface TerminalHandle { focus: () => void; clear: () => void; copy: () => Promise<boolean> }
export type TerminalStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'exited'
export interface TerminalTab { id: string; label: string; session?: TerminalSession; status: TerminalStatus }

export function TerminalPane({ tab, active, onStatus, onSession, onNew, onClose, ref }: {
  tab: TerminalTab; active: boolean; onStatus: (status: TerminalStatus) => void
  onSession: (session: TerminalSession) => void; onNew: () => void; onClose: () => void; ref?: Ref<TerminalHandle>
}) {
  const container = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const callbacks = useRef({ onStatus, onSession, onNew, onClose })
  useEffect(() => { callbacks.current = { onStatus, onSession, onNew, onClose } }, [onStatus, onSession, onNew, onClose])
  const sessionRef = useRef(tab.session)
  const cursorRef = useRef(0)
  const streamRef = useRef<AbortController | null>(null)
  const running = useRef(false)
  const mounted = useRef(false)
  const [error, setError] = useState('')
  const statusRef = useRef<TerminalStatus>('idle')
  useImperativeHandle(ref, () => ({
    focus: () => termRef.current?.focus(),
    clear: () => { termRef.current?.clear(); termRef.current?.focus() },
    copy: async () => { const text = termRef.current?.getSelection(); if (!text) return false; await navigator.clipboard.writeText(text); return true },
  }), [])

  useEffect(() => {
    mounted.current = true
    const term = new Terminal({
      cursorBlink: true, cursorStyle: 'block', fontFamily: "'DejaVu Sans Mono', 'Noto Sans Mono', 'Liberation Mono', monospace",
      fontSize: 13, lineHeight: 1.35, scrollback: 5000, allowProposedApi: false,
      theme: { background: '#1e1c24', foreground: '#ddd8e9', cursor: '#c4b5fd', selectionBackground: '#8b72d84d', black: '#28252f', red: '#ed829d', green: '#a8d4a2', yellow: '#e2c58d', blue: '#9dbeee', magenta: '#c2a2ec', cyan: '#99cbd2', white: '#ddd8e9', brightBlack: '#797282' },
      disableStdin: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container.current!)
    termRef.current = term; fitRef.current = fit
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true
      if (event.key.toLowerCase() === 't') { event.preventDefault(); callbacks.current.onNew(); return false }
      if (event.key.toLowerCase() === 'w') { event.preventDefault(); callbacks.current.onClose(); return false }
      return true
    })
    let input = '', flushing = false, timer: ReturnType<typeof setTimeout> | undefined
    async function flush() {
      timer = undefined
      const session = sessionRef.current
      if (flushing || !session || !input || statusRef.current !== 'connected') return
      let count = Math.min(input.length, 4096)
      if (count < input.length && /[\uD800-\uDBFF]/.test(input[count - 1])) count--
      const data = input.slice(0, count); input = input.slice(count); flushing = true
      try { await terminalApi.input(session.id, data) }
      catch {
        if (!mounted.current) return
        input = ''
        term.options.disableStdin = true; statusRef.current = 'disconnected'
        callbacks.current.onStatus('disconnected'); setError('输入未送达，连接已暂停，请重新连接。'); streamRef.current?.abort()
      } finally { flushing = false; if (mounted.current && input && statusRef.current === 'connected') timer = setTimeout(() => void flush(), 0) }
    }
    const listener = term.onData(data => { if (statusRef.current !== 'connected') return; input += data; if (!timer && !flushing) timer = setTimeout(() => void flush(), 16) })
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      if (!container.current?.clientWidth || !container.current.clientHeight) return
      fit.fit()
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => { const session = sessionRef.current; if (session && statusRef.current === 'connected') void terminalApi.resize(session.id, term.cols, term.rows).catch(() => {}) }, 100)
    })
    observer.observe(container.current!)
    return () => {
      mounted.current = false; streamRef.current?.abort(); observer.disconnect(); listener.dispose(); clearTimeout(timer); clearTimeout(resizeTimer)
      term.dispose(); termRef.current = null; fitRef.current = null
    }
  }, [])

  useEffect(() => {
    if (active && container.current?.clientWidth) { fitRef.current?.fit(); termRef.current?.focus() }
  }, [active])

  async function connect() {
    if (running.current) return
    running.current = true; setError(''); callbacks.current.onStatus('connecting'); statusRef.current = 'connecting'
    try {
      fitRef.current?.fit()
      const term = termRef.current!
      const session = sessionRef.current ?? await terminalApi.create({ cols: term.cols, rows: term.rows })
      if (!mounted.current) { if (!sessionRef.current) void terminalApi.close(session.id).catch(() => {}); return }
      sessionRef.current = session; callbacks.current.onSession(session)
      term.options.disableStdin = false; statusRef.current = 'connected'; callbacks.current.onStatus('connected')
      streamRef.current?.abort()
      const controller = new AbortController(); streamRef.current = controller
      term.focus()
      await terminalApi.events(session.id, cursorRef.current, controller.signal, (frame, cursor) => {
        cursorRef.current = cursor
        if (frame.type === 'output') term.write(frame.data)
        if (frame.type === 'gap') { term.reset(); term.writeln('\x1b[33m部分较早输出已超出保留范围。\x1b[0m') }
        if (frame.type === 'exit') { statusRef.current = 'exited'; term.options.disableStdin = true; callbacks.current.onStatus('exited'); term.writeln(`\r\n\x1b[90m进程已结束（${frame.code}）。\x1b[0m`); controller.abort() }
      })
      if (!controller.signal.aborted && mounted.current) throw new Error('终端连接已断开')
    } catch (e) {
      if (!mounted.current || (e instanceof DOMException && e.name === 'AbortError')) return
      termRef.current!.options.disableStdin = true; statusRef.current = 'disconnected'; callbacks.current.onStatus('disconnected')
      const status = e && typeof e === 'object' && 'status' in e ? e.status : null
      setError(status === 404 ? sessionRef.current ? '终端会话已失效，请关闭此标签并新建终端。' : '当前后端尚未启用终端服务。' : e instanceof Error ? e.message : '终端连接失败')
    } finally { running.current = false }
  }
  // Connection starts only from an explicit user action, never from a StrictMode effect.
  return <div role="tabpanel" id={`terminal-panel-${tab.id}`} aria-labelledby={`terminal-tab-${tab.id}`} hidden={!active} className="ops-terminal-pane">
    <div ref={container} className="ops-terminal-canvas" aria-label={`${tab.label}终端显示区`} />
    {tab.status !== 'connected' && <div className={`ops-terminal-connect ${tab.session ? 'has-session' : ''}`}>
      <strong>{tab.status === 'connecting' ? '正在连接…' : tab.status === 'exited' ? '终端进程已结束' : error ? '未连接' : '终端准备就绪'}</strong>
      <p role={error ? 'alert' : undefined}>{error || (tab.status === 'exited' ? '新建标签页以启动另一个终端。' : '连接后即可使用交互式 Shell。')}</p>
      {tab.status !== 'exited' && <button type="button" disabled={tab.status === 'connecting'} onClick={() => void connect()}>{tab.status === 'connecting' ? '连接中…' : error ? '重新连接' : '连接终端'}</button>}
    </div>}
  </div>
}
