import { useState } from 'react'
import { api } from '@/api'
import type { MembershipOverview } from '@/api/types'
import { ChatWorkspace } from '@/components/agent/ChatWorkspace'
import { HumanSupportRequest, SupportTickets } from '@/components/support/HumanSupport'
import type { ChatItem } from '@/lib/agentSessions'
import type { WorkbenchOptions } from '@/components/agent/ChatWorkspace'
import { useAsync } from '@/lib/useAsync'
import { serviceIcon } from '@/components/layout/services'
import type { AgentService } from '@/api/agent'
const fallback = { list: api.listSupportMessages, send: api.sendSupportMessage }
const listStaffNotices = () => api.listSupportMessages().then(history => history.filter(message => message.role === 'staff'))

export function SupportPage({ workbench, services = [], selectedServices = [], onSelectService, onClearServices, hidden = false }: {
  workbench?: WorkbenchOptions
  /** 后端下发的可用能力；没取到就是空数组，选择器随之隐藏。 */
  services?: AgentService[]
  selectedServices?: string[]
  onSelectService?: (id: string) => void
  onClearServices?: () => void
  /** 助手页切到 IM 视图时保留组件挂载（会话与草稿不丢），仅视觉隐藏。 */
  hidden?: boolean
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
  // 功能预选器放在输入框上方，不放左侧竖条：竖条紧挨主导航，读起来像第二套导航。
  // 不选也行——后端会按当前问题自动匹配并加载技能（service-skills.mjs）。
  const picker = workbench && !workbench.docked && services.length > 0 ? (
    <div className="service-picker" role="group" aria-label="要办的事">
      <div className="service-picker-hint">
        <span>要办的事（可选，不选则自动匹配）</span>
        <button type="button" className="service-picker-clear" disabled={selectedServices.length === 0} onClick={onClearServices}>清空</button>
      </div>
      <div className="service-picker-row">
        {services.map(({ id, label, description }) => {
          const Icon = serviceIcon(id)
          return <button key={id} type="button" className="service-picker-chip" title={description}
            aria-pressed={selectedServices.includes(id)} onClick={() => onSelectService?.(id)}>
            <Icon size={15} strokeWidth={2} />{label}
          </button>
        })}
      </div>
    </div>
  ) : undefined
  return <div className={workbench ? `workbench-assistant ${workbench.docked ? 'is-docked' : ''}` : 'contents'} hidden={hidden} style={hidden ? { display: 'none' } : undefined}>
    <ChatWorkspace key="workspace" workbench={picker && workbench ? { ...workbench, composerTop: picker } : workbench} memberBadges={memberBadges} listMessages={workbench ? listStaffNotices : undefined} fallback={workbench ? undefined : fallback} humanSupport={{
      request: items => { setItems(items); setGeneration(value => value + 1); setRequestOpen(true) },
      view: () => { setTicketId(undefined); setTicketsOpen(true) },
    }} />
    <HumanSupportRequest key={generation} open={requestOpen} items={items} onClose={() => setRequestOpen(false)}
      onCreated={ticket => { setRequestOpen(false); setTicketId(ticket.ticketId); setTicketsOpen(true) }} />
    <SupportTickets key={ticketId ?? 'list'} open={ticketsOpen} initialId={ticketId} onClose={() => setTicketsOpen(false)} />
  </div>
}
