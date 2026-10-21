import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api, type Ticket } from '@/api'
import { useSession } from '@/store/session-context'
import { STATUS_CLASS, TICKET_STATUS_LABEL, formatTime } from '@/pages/tickets/labels'
import { PageHeader } from '@/components/PageHeader'
import { useStaffClock } from '@/layout/useStaffClock'
import { SupportCat } from '../../../../app/src/components/brand/WorkbenchBrand'
import { ReceiptIcon, UserIcon, ChatIcon, CheckIcon, UsersIcon, CardIcon, ShieldIcon, ChevronRightIcon, ArrowRightIcon, RefreshIcon } from '../../../../app/src/components/ui/icons'

/** 统计与队列均来自真实工单列表，沿用每 3 秒更新。 */
export function WorkbenchPage() {
  const { user } = useSession()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try { setTickets(await api.listTickets()); setLoaded(true); setError(null) }
    catch (e) { setError(e instanceof ApiError ? e.message : '工单列表加载失败，请稍后重试') }
  }, [])
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer) }, [refresh])
  const pending = tickets.filter(t => t.status === 'open')
  const mine = tickets.filter(t => (t.status === 'processing' || t.status === 'waiting') && t.assigneeId === user?.id)
  const now = useStaffClock()
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(now))
  const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好'
  const metrics = [
    { label: '待处理工单', value: pending.length, note: `其中 ${pending.filter(t => t.priority !== 'normal').length} 项优先`, to: '/tickets?status=open', Icon: ReceiptIcon },
    { label: '我的待办', value: mine.length, note: '由我负责的进行中工单', to: '/tickets?assignee=me', Icon: UserIcon },
    { label: '等待客户', value: tickets.filter(t => t.status === 'waiting').length, note: '等待客户补充信息', to: '/tickets?status=waiting', Icon: ChatIcon },
    { label: '已解决', value: tickets.filter(t => t.status === 'resolved').length, note: '当前工单列表中的已解决项', to: '/tickets?status=resolved', Icon: CheckIcon },
  ]

  return <div className="staff-page">
    <span className="staff-eyebrow">{greeting}，{user?.name}</span>
    <PageHeader title="工作台" description="从待办开始，跟进每一位客户。" actions={<><span className="staff-live">自动更新</span><button type="button" onClick={() => void refresh()} aria-label="刷新工作台"><RefreshIcon size={15} /></button></>} />
    {error && <div role="alert" className="mb-5 rounded-tile bg-coral-wash px-4 py-3 text-sm text-coral">{error}{loaded && ' · 当前保留上次结果'}</div>}
    <div className="staff-metrics">{metrics.map(({ label, value, note, to, Icon }) => <Link className="staff-metric" to={to} key={label}>
      <span>{label}<Icon size={18} /></span><strong>{loaded ? value : '—'}</strong><small>{loaded ? note : '正在读取工单'}</small>
    </Link>)}</div>
    <div className="staff-dashboard-grid">
      <section className="staff-table-wrap">
        <header className="staff-table-caption"><h2>最新待处理</h2><Link className="staff-button" to="/tickets">查看全部工单<ArrowRightIcon size={13} /></Link></header>
        <table className="staff-table"><thead><tr><th>客户与事由</th><th>状态</th><th>创建时间</th><th></th></tr></thead>
          <tbody>{pending.slice(0, 8).map(ticket => <tr key={ticket.ticketId}>
            <td><Link className="staff-ticket-link" to={`/tickets?ticket=${encodeURIComponent(ticket.ticketId)}`}><strong>{ticket.customerName ?? ticket.customerId}</strong><span>{ticket.reason}</span></Link></td>
            <td><span className={`rounded-full px-2 py-1 text-xs ${STATUS_CLASS[ticket.status]}`}>{TICKET_STATUS_LABEL[ticket.status]}</span>{ticket.priority === 'vip' ? <span className="ml-2 text-xs text-gold-deep">VIP</span> : ticket.priority === 'high' ? <span className="ml-2 text-xs text-coral">加急</span> : null}</td>
            <td className="text-xs text-ink-mute">{formatTime(ticket.createdAt)}</td>
            <td><Link className="staff-ticket-open" aria-label={`查看工单 ${ticket.ticketId}`} to={`/tickets?ticket=${encodeURIComponent(ticket.ticketId)}`}><ChevronRightIcon size={16} /></Link></td>
          </tr>)}{pending.length === 0 && <tr><td colSpan={4}><div className="staff-empty"><span><ReceiptIcon size={22} /></span><strong>{error ? '工单暂时无法加载' : loaded ? '暂无待处理工单' : '正在加载工单…'}</strong>{loaded && !error && <small>新工单到达后会自动出现在这里</small>}</div></td></tr>}</tbody>
        </table>
      </section>
      <aside>
        <section className="staff-shortcuts"><h2>常用功能</h2>{[
          { to: '/customers', label: '查询客户', note: '资料、账户与交易记录', Icon: UsersIcon },
          { to: '/actions', label: '办理卡片与代扣', note: '锁卡、限额和自动扣款', Icon: CardIcon },
          { to: '/approvals', label: '查看在途交易', note: '风险核对与业务处置', Icon: ShieldIcon },
        ].map(({ to, label, note, Icon }) => <Link key={to} to={to}><span><Icon size={19} /></span><span>{label}<small>{note}</small></span><ChevronRightIcon size={14} /></Link>)}</section>
        <section className="staff-dashboard-assistant"><SupportCat /><h2>让助手搭把手</h2><p>查询客户、梳理工单，协助办理业务。</p><Link className="staff-button staff-button-primary" to="/assistant">打开智能助手<ArrowRightIcon size={14} /></Link></section>
      </aside>
    </div>
  </div>
}
