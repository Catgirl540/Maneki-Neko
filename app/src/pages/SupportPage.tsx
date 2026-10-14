import { useState } from 'react'
import { api } from '@/api'
import { ChatWorkspace } from '@/components/agent/ChatWorkspace'
import { HumanSupportRequest, SupportTickets } from '@/components/support/HumanSupport'
import type { ChatItem } from '@/lib/agentSessions'
const fallback = { list: api.listSupportMessages, send: api.sendSupportMessage }

export function SupportPage() {
  const [requestOpen, setRequestOpen] = useState(false)
  const [ticketsOpen, setTicketsOpen] = useState(false)
  const [items, setItems] = useState<ChatItem[]>([])
  const [generation, setGeneration] = useState(0)
  const [ticketId, setTicketId] = useState<string>()
  return <>
    <ChatWorkspace fallback={fallback} humanSupport={{
      request: items => { setItems(items); setGeneration(value => value + 1); setRequestOpen(true) },
      view: () => { setTicketId(undefined); setTicketsOpen(true) },
    }} />
    <HumanSupportRequest key={generation} open={requestOpen} items={items} onClose={() => setRequestOpen(false)}
      onCreated={ticket => { setRequestOpen(false); setTicketId(ticket.ticketId); setTicketsOpen(true) }} />
    <SupportTickets key={ticketId ?? 'list'} open={ticketsOpen} initialId={ticketId} onClose={() => setTicketsOpen(false)} />
  </>
}
