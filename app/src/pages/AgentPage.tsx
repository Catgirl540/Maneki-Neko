import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '@/api'
import type { BankCard } from '@/api/types'
import { CatMark } from '@/components/brand/Logo'
import { formatMoney } from '@/lib/format'
import { ArrowRightIcon, SendIcon, SparkleIcon } from '@/components/ui/icons'

type Entry = { id: number; role: 'user' | 'agent'; text: string; action?: { label: string; to: string } }
type Pending = { kind: 'lock' | 'debit'; id: string; label: string }
const EXAMPLES = ['给陈嘉禾转 200 元', '分析我这个月的账单', '比较低风险理财产品', '我的卡丢了，帮我锁卡', '取消一个自动扣款']

export function AgentPage() {
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, role: 'agent', text: '你好，我是招财猫 AI 助手。说出你想完成的事，我会读取当前演示账户的数据，规划下一步，并在执行敏感操作前请你确认。' }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), [entries, pending])
  function add(role: Entry['role'], text: string, action?: Entry['action']) {
    setEntries((items) => [...items, { id: nextId.current++, role, text, action }])
  }

  async function respond(raw: string) {
    const text = raw.trim()
    if (!text || busy) return
    add('user', text)
    setInput('')
    setPending(null)
    setBusy(true)
    try {
      if (/转账|转给|给.+转|汇款|汇给/.test(text)) {
        const payees = await api.listPayees()
        const payee = payees.find((item) => text.toLowerCase().includes(item.name.toLowerCase()))
        const amount = text.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块)/)
        if (!payee) {
          add('agent', '请说出常用收款人的姓名和金额，例如“给陈嘉禾转 200 元”。陌生收款人可以到转账页手动填写。', { label: '查看转账', to: '/transfer' })
        } else if (!amount || Number(amount[1]) <= 0) {
          add('agent', '找到常用收款人' + payee.name + '。请补充金额，例如“给' + payee.name + '转 200 元”。')
        } else {
          const query = new URLSearchParams({ agentPayee: payee.id, agentAmount: amount[1] })
          add('agent', '已识别收款人 ' + payee.name + ' 和金额 ¥' + Number(amount[1]).toFixed(2) + '。我会预填转账信息；请在转账页核对收款账户、手续费与到账金额后亲自确认付款。', { label: '核对转账', to: '/transfer?' + query.toString() })
        }
      } else if (/账单|支出|消费|花了|财务分析|异常交易/.test(text)) {
        const data = await api.getSpending()
        const top = data.categories.slice(0, 3).map((item) => item.label + ' ' + formatMoney(item.amount)).join('、')
        const change = Math.abs(data.monthOverMonth * 100).toFixed(1)
        add('agent', data.month + ' 的支出共 ' + formatMoney(data.total) + '，比上月' + (data.monthOverMonth >= 0 ? '增加' : '减少') + ' ' + change + '%。主要类别是' + (top || '暂无分类数据') + '。你可以查看逐笔流水、筛选交易并导出账单。这里的汇总不能单独证明某笔交易异常。', { label: '查看账单与流水', to: '/analysis' })
      } else if (/理财|产品|收益|风险评估|申购|赎回/.test(text)) {
        const products = await api.listWealthProducts()
        const lowRisk = /低风险|稳健|保守/.test(text)
        const options = (lowRisk ? products.filter((item) => item.risk === 'R1' || item.risk === 'R2') : products).slice(0, 3)
        const summary = options.map((item) => item.name + '（' + item.risk + '、' + item.term + '、' + formatMoney(item.minAmount) + '起）').join('；')
        add('agent', (lowRisk ? '按较低风险筛选，' : '') + '可比较的产品有：' + (summary || '暂无符合条件的产品') + '。理财产品不保本，业绩比较基准不代表未来收益。请先查看完整披露并完成风险评估；申购或赎回需要你在产品页确认。', { label: '比较产品', to: '/wealth' })
      } else if (/丢卡|卡丢|挂失|锁卡|冻结卡|交易限制/.test(text)) {
        const cards = await api.listCards()
        const card = pickCard(cards, text)
        if (!card) add('agent', '没有找到可锁定的银行卡。请到银行卡页核对卡片状态。', { label: '查看银行卡', to: '/cards' })
        else {
          setPending({ kind: 'lock', id: card.id, label: card.productName + ' · 尾号 ' + card.last4 })
          add('agent', '已找到' + card.productName + '，尾号 ' + card.last4 + '。锁卡后这张卡将无法继续交易。请核对卡片并确认；如卡片已遗失，也请留意近期交易。')
        }
      } else if (/自动扣款|订阅|代扣|续费/.test(text)) {
        const active = (await api.listAutoDebits()).filter((item) => item.enabled)
        const target = active.find((item) => text.includes(item.merchant))
        if (/取消|关闭|停用|停止/.test(text) && target) {
          setPending({ kind: 'debit', id: target.id, label: target.merchant + ' · ' + formatMoney(target.amount) + ' / ' + target.cycle })
          add('agent', '找到' + target.merchant + '的自动扣款，金额 ' + formatMoney(target.amount) + '，周期 ' + target.cycle + '。确认后将关闭银行侧自动扣款；商户订阅是否终止，请再到商户核对。')
        } else {
          add('agent', '当前启用的自动扣款：' + (active.map((item) => item.merchant + ' ' + formatMoney(item.amount)).join('、') || '暂无') + '。如需关闭，请说“取消' + (active[0]?.merchant ?? '某项') + '自动扣款”，我会在执行前再次请你确认。', { label: '管理自动扣款', to: '/analysis' })
        }
      } else {
        add('agent', '我可以帮你准备转账、分析账单、比较理财产品、锁定银行卡和管理自动扣款。请直接说出具体需求，例如“给陈嘉禾转 200 元”。')
      }
    } catch (error) {
      add('agent', error instanceof ApiError ? error.message : '暂时无法读取账户数据，请稍后重试。')
    } finally { setBusy(false) }
  }

  async function confirm() {
    if (!pending || busy) return
    const task = pending
    setPending(null)
    setBusy(true)
    try {
      if (task.kind === 'lock') {
        await api.setCardLock(task.id, true)
        add('agent', task.label + '已锁定。请在银行卡页查看最新状态，并核对最近交易。', { label: '查看银行卡', to: '/cards' })
      } else {
        await api.setAutoDebitEnabled(task.id, false)
        add('agent', task.label + '的银行侧自动扣款已关闭。请再向商户确认订阅状态。', { label: '查看扣款管理', to: '/analysis' })
      }
    } catch (error) {
      add('agent', error instanceof ApiError ? error.message : '操作未完成，请稍后重试。')
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-[1080px] space-y-6">
      <header className="rounded-card bg-ink px-6 py-6 text-ink-invert md:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-chip bg-gold"><CatMark className="size-7 text-ink" cutout="var(--color-gold)" /></span>
          <div><p className="flex items-center gap-2 text-[13px] text-gold"><SparkleIcon size={15} /> AI BANKING AGENT</p><h1 className="text-[27px] font-bold leading-tight">招财猫 AI 助手</h1></div>
        </div>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section className="flex min-h-[580px] flex-col overflow-hidden rounded-card border border-line bg-surface" aria-label="与 AI 助手对话">
          <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="font-semibold text-ink">对话</h2><p className="text-[13px] text-ink-mute">演示环境 · 基于意图识别与模拟账户数据</p></div><span className="rounded-chip bg-gold-tint px-3 py-1 text-[12px] text-gold-deep">可执行任务</span></div>
          <div className="min-h-[320px] flex-1 space-y-5 overflow-y-auto px-5 py-6" aria-live="polite">
            {entries.map((item) => (
              <div key={item.id} className={'flex gap-3 ' + (item.role === 'user' ? 'justify-end' : '')}>
                {item.role === 'agent' && <span className="grid size-8 shrink-0 place-items-center rounded-chip bg-gold-wash"><CatMark className="size-5 text-gold-deep" cutout="var(--color-gold-wash)" /></span>}
                <div className="max-w-[88%] space-y-2">
                  <div className={'whitespace-pre-wrap rounded-card px-4 py-3 text-[15px] leading-relaxed ' + (item.role === 'user' ? 'bg-ink text-white' : 'bg-sunk text-ink')}>{item.text}</div>
                  {item.action && <Link className="inline-flex min-h-10 items-center gap-2 rounded-field bg-gold px-4 text-[14px] font-medium text-ink hover:bg-gold-deep hover:text-white" to={item.action.to}>{item.action.label}<ArrowRightIcon size={16} /></Link>}
                </div>
              </div>
            ))}
            {busy && <p className="pl-11 text-[14px] text-ink-mute">正在处理…</p>}
            {pending && <div className="ml-11 rounded-card border border-gold bg-gold-tint p-4"><p className="text-[14px] font-semibold text-ink">请确认操作</p><p className="mt-1 text-[14px] text-ink-soft">{pending.kind === 'lock' ? '锁定银行卡' : '关闭自动扣款'}：{pending.label}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void confirm()} className="min-h-10 rounded-field bg-ink px-4 text-[14px] text-white disabled:opacity-50">确认执行</button><button type="button" onClick={() => { setPending(null); add('agent', '已取消，本次没有更改账户设置。') }} className="min-h-10 rounded-field border border-line-strong px-4 text-[14px] text-ink">取消</button></div></div>}
            <div ref={bottom} />
          </div>
          <form className="flex gap-2 border-t border-line p-4" onSubmit={(event) => { event.preventDefault(); void respond(input) }}><label htmlFor="agent-input" className="sr-only">输入金融需求</label><input id="agent-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：分析我这个月的账单" className="min-w-0 flex-1 rounded-field border border-line-strong bg-white px-4 py-3 text-[15px] text-ink outline-none focus:border-gold" /><button type="submit" disabled={busy || !input.trim()} aria-label="发送需求" className="grid size-12 shrink-0 place-items-center rounded-field bg-gold text-ink disabled:opacity-40"><SendIcon size={19} /></button></form>
        </section>
        <aside className="space-y-5"><div className="rounded-card border border-line bg-surface p-5"><h2 className="text-[16px] font-semibold text-ink">试试这样说</h2><div className="mt-4 space-y-2">{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => void respond(example)} disabled={busy} className="w-full rounded-field border border-line px-3 py-3 text-left text-[14px] leading-snug text-ink-soft transition-colors hover:border-gold hover:bg-gold-tint hover:text-ink disabled:opacity-50">{example}</button>)}</div></div><div className="rounded-card border border-line bg-sunk p-5 text-[14px] leading-relaxed text-ink-soft"><h2 className="font-semibold text-ink">操作说明</h2><p className="mt-2">转账由助手预填，付款仍需你在转账页核对并确认。锁卡和关闭自动扣款会先弹出确认。理财信息仅供比较，不构成投资建议。</p></div></aside>
      </div>
    </div>
  )
}
function pickCard(cards: BankCard[], text: string): BankCard | undefined {
  const mentioned = cards.find((card) => text.includes(card.last4))
  if (mentioned) return mentioned.status === 'active' ? mentioned : undefined
  return cards.find((card) => card.status === 'active')
}