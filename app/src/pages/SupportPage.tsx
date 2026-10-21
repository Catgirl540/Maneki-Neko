import { useState } from 'react'
import { api } from '@/api'
import type { MembershipOverview } from '@/api/types'
import { ChatWorkspace } from '@/components/agent/ChatWorkspace'
import { HumanSupportRequest, SupportTickets } from '@/components/support/HumanSupport'
import type { ChatItem } from '@/lib/agentSessions'
import type { WorkbenchOptions } from '@/components/agent/ChatWorkspace'
import { useAsync } from '@/lib/useAsync'
import { smartServices, type SmartServiceId } from '@/components/layout/services'
const fallback = { list: api.listSupportMessages, send: api.sendSupportMessage }
const listStaffNotices = () => api.listSupportMessages().then(history => history.filter(message => message.role === 'staff'))

export function SupportPage({ workbench, selectedServices = [], onSelectService, onClearServices }: {
  workbench?: WorkbenchOptions
  selectedServices?: SmartServiceId[]
  onSelectService?: (id: SmartServiceId) => void
  onClearServices?: () => void
}) {
  const [requestOpen, setRequestOpen] = useState(false)
  const [ticketsOpen, setTicketsOpen] = useState(false)
  const [items, setItems] = useState<ChatItem[]>([])
  const [generation, setGeneration] = useState(0)
  const [ticketId, setTicketId] = useState<string>()
  // 会员专属服务标识：整个工作台只拉一次会员概览，不随路由重复请求
  const membership = useAsync<MembershipOverview>(() => api.getMembership(), [])
  const ent = membership.data?.entitlements
  const memberBadges = [
    ...(ent?.dedicatedManager ? ['专属客户经理'] : []),
    ...(ent?.dedicatedAdvisor ? ['专属理财顾问'] : []),
  ]
  return <div className={workbench ? `workbench-assistant ${workbench.docked ? 'is-docked' : ''}` : 'contents'}>
    {workbench && !workbench.docked && <aside className="smart-services" aria-label="智能服务">
      <h2>智能服务</h2>
      <button type="button" className="smart-services-clear" aria-label="清除所有选择"
        disabled={selectedServices.length === 0} onClick={onClearServices}>清除全部</button>
      <div>{smartServices.map(({ id, label, Icon }) => <button key={id} type="button"
        aria-pressed={selectedServices.includes(id)} onClick={() => onSelectService?.(id)}>
        <span><Icon size={24} strokeWidth={2} /></span>{label}
      </button>)}</div>
    </aside>}
    <ChatWorkspace key="workspace" workbench={workbench} memberBadges={memberBadges} listMessages={workbench ? listStaffNotices : undefined} fallback={workbench ? undefined : fallback} humanSupport={{
      request: items => { setItems(items); setGeneration(value => value + 1); setRequestOpen(true) },
      view: () => { setTicketId(undefined); setTicketsOpen(true) },
    }} />
    <HumanSupportRequest key={generation} open={requestOpen} items={items} onClose={() => setRequestOpen(false)}
      onCreated={ticket => { setRequestOpen(false); setTicketId(ticket.ticketId); setTicketsOpen(true) }} />
    <SupportTickets key={ticketId ?? 'list'} open={ticketsOpen} initialId={ticketId} onClose={() => setTicketsOpen(false)} />
  </div>
}
