import { useEffect, useRef, useState } from 'react'
import { staffAgent, opsAgent, type StaffAgentEvent, type StaffConsent, type StaffQuestion } from '@/api/agent'
import { useSession } from '@/store/session-context'

const button = 'rounded-lg border border-[var(--color-line-strong)] px-3 py-2 text-sm hover:bg-[var(--color-gold-wash)] disabled:opacity-50'
const input = 'w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-3 text-sm'
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试'
interface Message { id: string; role: 'staff' | 'assistant'; text: string }

function ConsentCard({ challenge, resolve }: { challenge: StaffConsent; resolve: (decision: 'approve' | 'reject', verification?: { method: string; result: 'passed' }) => Promise<void> }) {
  const [checked, setChecked] = useState(false)
  const [method, setMethod] = useState('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const expired = now >= challenge.expiresAt
  async function submit(decision: 'approve' | 'reject') {
    setBusy(true); setError('')
    try { await resolve(decision, challenge.requiresCustomerVerification && decision === 'approve' ? { method, result: 'passed' } : undefined) }
    catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  return <section className="rounded-xl border border-[var(--color-gold)] bg-[var(--color-gold-tint)] p-4" aria-label="操作确认">
    <h3 className="mb-3 font-semibold">{challenge.kind} · 待确认</h3>
    <dl className="space-y-2 text-sm">{challenge.fields.map((f, i) => <div key={i} className="grid grid-cols-[100px_1fr] gap-3"><dt className="text-[var(--color-ink-mute)]">{f.label}</dt><dd className={`whitespace-pre-wrap break-all ${f.emphasis ? 'font-semibold' : ''}`}>{f.value}</dd></div>)}</dl>
    <p className="my-3 text-sm text-[var(--color-ink-soft)]">{challenge.consequence}</p>
    {challenge.requiresCustomerVerification && <div className="mb-3 space-y-3 rounded-lg bg-[var(--color-surface)] p-3">
      <label className="block text-sm">已完成的客户核验方式<select className={`${input} mt-2`} value={method} onChange={e => setMethod(e.target.value)} disabled={busy || expired}><option value="phone">电话核验</option><option value="sms">短信核验</option><option value="face">人脸核验</option></select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={busy || expired} />我已按业务流程完成客户身份核验，结果通过</label>
    </div>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <div className="flex items-center gap-3"><button className={button} disabled={busy || expired} onClick={() => void submit('reject')}>取消</button><button className={`${button} bg-[var(--color-gold-wash)] font-semibold`} disabled={busy || expired || (challenge.requiresCustomerVerification && !checked)} onClick={() => void submit('approve')}>确认{challenge.requiresCustomerVerification ? '并办理' : ''}</button><span className="text-xs text-[var(--color-ink-mute)]">{expired ? '已过期，请重新发起' : `${Math.ceil((challenge.expiresAt - now) / 1000)} 秒内有效`}</span></div>
  </section>
}

function QuestionCard({ question, answered, agent }: { question: StaffQuestion; answered: () => void; agent: typeof staffAgent }) {
  const [values, setValues] = useState<Record<string, { selected: string[]; custom: string }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const expired = now >= question.expiresAt
  async function submit() {
    setBusy(true); setError('')
    try { await agent.answer(question.questionId, question.questions.map(q => ({ id: q.id, selected: values[q.id]?.selected ?? [], custom: values[q.id]?.custom ?? '' }))); answered() }
    catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  return <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4" aria-label="补充信息">
    <h3 className="mb-3 font-semibold">请补充信息</h3>
    {question.questions.map(q => <fieldset key={q.id} className="mb-4" disabled={busy || expired}><legend className="mb-2 text-sm">{q.question}</legend>
      {q.options?.map(o => <label key={o.label} className="mb-2 flex items-center gap-2 text-sm"><input type={q.multiSelect ? 'checkbox' : 'radio'} name={q.id} checked={values[q.id]?.selected.includes(o.label) ?? false} onChange={e => setValues(v => ({ ...v, [q.id]: { custom: v[q.id]?.custom ?? '', selected: q.multiSelect ? e.target.checked ? [...(v[q.id]?.selected ?? []), o.label] : (v[q.id]?.selected ?? []).filter(x => x !== o.label) : [o.label] } }))} />{o.label}{o.description && <span className="text-[var(--color-ink-mute)]">{o.description}</span>}</label>)}
      <textarea aria-label={`${q.question} 补充回答`} className={input} value={values[q.id]?.custom ?? ''} placeholder="输入补充信息，请勿填写密码或验证码" onChange={e => setValues(v => ({ ...v, [q.id]: { selected: v[q.id]?.selected ?? [], custom: e.target.value } }))} />
    </fieldset>)}
    {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}<button className={button} disabled={busy || expired || question.questions.some(q => !values[q.id]?.selected.length && !values[q.id]?.custom.trim())} onClick={() => void submit()}>{expired ? '问题已过期' : '提交回答'}</button>
  </section>
}

export function AssistantPage() {
  const { user } = useSession()
  const [generation, setGeneration] = useState(0)
  return <AssistantConversation key={`${user?.id}:${generation}`} newConversation={() => setGeneration(g => g + 1)} />
}

function AssistantConversation({ newConversation }: { newConversation: () => void }) {
  const { user } = useSession()
  const agent = user?.role === 'ops' ? opsAgent : staffAgent
  const [sessionId, setSessionId] = useState('')
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [consents, setConsents] = useState<StaffConsent[]>([])
  const [questions, setQuestions] = useState<StaffQuestion[]>([])
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages, consents, questions])
  useEffect(() => {
    let disposed = false, id = '', cursor = '0'
    let timer: ReturnType<typeof setTimeout> | undefined
    function event(e: StaffAgentEvent) {
      if (e.type === 'status') setBusy(e.status === 'running')
      else if (e.type === 'stopped') { setBusy(false); setConsents([]); setQuestions([]) }
      else if (e.type === 'assistant' || e.type === 'assistant-update') setMessages(old => { const message = { id: e.messageId ?? crypto.randomUUID(), role: 'assistant' as const, text: e.text }; return old.some(m => m.id === message.id) ? old.map(m => m.id === message.id ? message : m) : [...old, message] })
      else if (e.type === 'assistant-reset') setMessages(old => old.filter(m => m.id !== e.messageId))
      else if (e.type === 'consent') setConsents(old => old.some(c => c.challengeId === e.challenge.challengeId) ? old : [...old, e.challenge])
      else if (e.type === 'consent-resolved') setConsents(old => old.filter(c => c.challengeId !== e.challengeId))
      else if (e.type === 'question') setQuestions(old => old.some(q => q.questionId === e.question.questionId) ? old : [...old, e.question])
      else if (e.type === 'question-resolved') setQuestions(old => old.filter(q => q.questionId !== e.questionId))
      else if (e.type === 'error') setError(e.message)
      else if (e.type === 'tool-result' && e.isError) setError(`操作未完成：${e.text.slice(0, 500)}`)
    }
    async function poll() {
      try {
        const result = await agent.events(id, cursor)
        if (disposed) return
        cursor = result.cursor; result.events.forEach(event)
      } catch (error) { if (!disposed) { setError(errorText(error)); setAvailable(false); return } }
      if (!disposed) timer = setTimeout(() => void poll(), 900)
    }
    async function start() {
      try {
        if (import.meta.env.VITE_USE_MOCK !== 'false') throw Error('工作人员助手需要连接本地业务后端，请启用 HTTP 模式')
        const health = await agent.health()
        if (!health.ok) throw Error('助手模型尚未配置，请先配置模型服务后重试')
        if (health.bankDataSource !== 'http') throw Error('助手未连接员工业务服务')
        if (disposed) return
        id = (await agent.create()).sessionId
        if (disposed) { void agent.stop(id).catch(() => {}); return }
        setSessionId(id); setAvailable(true); void poll()
      } catch (error) { if (!disposed) setError(errorText(error)) }
    }
    void start()
    return () => { disposed = true; clearTimeout(timer); if (id) void agent.stop(id).catch(() => {}) }
  }, [user?.id, agent])
  async function send() {
    if (!text.trim() || !sessionId || busy || sending || !available) return
    const content = text.trim(); setSending(true); setError('')
    try { await agent.send(sessionId, content); setMessages(old => [...old, { id: crypto.randomUUID(), role: 'staff', text: content }]); setText(''); setBusy(true) }
    catch (error) { setError(errorText(error)) } finally { setSending(false) }
  }
  const suggestions = user?.role === 'ops' ? ['查看当前服务健康情况和告警', '查看工作区目录和 README', '读取最近的银行服务日志'] : user?.role === 'supervisor' ? ['查看待处置记录', '查询当前转账阈值', '查看最近审计记录'] : ['查询待处理工单', '查找测试客户甲', '查询当前转账阈值']
  return <div className="mx-auto max-w-4xl">
    <div className="mb-5 flex items-center justify-between"><div><h1 className="text-xl font-semibold">工作人员助手</h1><p className="mt-1 text-sm text-[var(--color-ink-mute)]">{user?.role === 'ops' ? '监控、日志、文件维护和原生命令；高危或不确定操作需您确认' : '协助查询客户、处理工单和办理业务，提交前由您确认'}</p></div><button className={button} disabled={busy || sending} onClick={newConversation}>{available ? '新对话' : '重新连接'}</button></div>
    <div className="mb-4 flex flex-wrap gap-2">{suggestions.map(s => <button key={s} className={button} disabled={!available || busy} onClick={() => setText(s)}>{s}</button>)}</div>
    <div className="max-h-[60vh] min-h-64 space-y-4 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5" aria-live="polite">
      {!messages.length && <p className="text-sm text-[var(--color-ink-mute)]">{available ? user?.role === 'ops' ? '输入需要排查或维护的事项。确认操作前请核对工作区和完整参数。' : '输入要查询或办理的业务。涉及客户资料或业务变更时，请核对确认卡。' : error ? '助手尚未就绪，请查看连接提示后重试。' : '正在连接工作人员助手…'}</p>}
      {messages.map(m => <article key={m.id} className={`rounded-xl p-4 ${m.role === 'staff' ? 'ml-10 bg-[var(--color-gold-wash)]' : 'mr-10 bg-[var(--color-surface)]'}`}><div className="mb-1 text-xs text-[var(--color-ink-mute)]">{m.role === 'staff' ? '您' : '工作人员助手'}</div><p className="whitespace-pre-wrap break-words text-sm leading-7">{m.text}</p></article>)}
      {consents.map(c => <ConsentCard key={c.challengeId} challenge={c} resolve={async (decision, verification) => { await agent.consent(c.challengeId, decision, verification); setConsents(old => old.filter(item => item.challengeId !== c.challengeId)) }} />)}
      {questions.map(q => <QuestionCard key={q.questionId} question={q} agent={agent} answered={() => setQuestions(old => old.filter(item => item.questionId !== q.questionId))} />)}
      {busy && <p className="text-sm text-[var(--color-ink-mute)]">{consents.length ? '等待您确认操作' : questions.length ? '等待您补充信息' : '正在处理…'}</p>}<div ref={bottom} />
    </div>
    {error && <p role="alert" className="my-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <form onSubmit={e => { e.preventDefault(); void send() }} className="mt-4 space-y-3"><textarea aria-label="业务请求" className={input} rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="输入业务请求，请勿填写密码、验证码或完整卡号" disabled={!available || sending} maxLength={5000} />
      <div className="flex justify-end gap-3">{busy && <button type="button" className={button} onClick={() => void agent.stop(sessionId).catch(error => setError(errorText(error)))}>停止</button>}<button className={`${button} bg-[var(--color-gold-wash)] font-medium`} disabled={!available || busy || sending || !text.trim()}>发送</button></div>
    </form>
  </div>
}
