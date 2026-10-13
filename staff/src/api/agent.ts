import { get, post } from './http/base'

export interface StaffConsent {
  challengeId: string
  kind: string
  fields: Array<{ label: string; value: string; emphasis?: boolean }>
  consequence?: string
  requiresCustomerVerification?: boolean
  expiresAt: number
}
export interface StaffQuestion {
  questionId: string
  expiresAt: number
  questions: Array<{ id: string; question: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }>
}
export type StaffAgentEvent =
  | { type: 'status'; status: 'running' | 'idle' }
  | { type: 'assistant' | 'assistant-update'; messageId?: string; text: string }
  | { type: 'assistant-reset'; messageId: string }
  | { type: 'consent'; challenge: StaffConsent }
  | { type: 'consent-resolved'; challengeId: string; decision: string }
  | { type: 'question'; question: StaffQuestion }
  | { type: 'question-resolved'; questionId: string }
  | { type: 'error'; message: string }
  | { type: 'tool-result'; callId: string; isError: boolean; text: string }
  | { type: 'hello' | 'stopped' | 'bank-updated' | 'tool-call' }

function createClient(root: string) { return {
  health: () => get<{ ok: boolean; bankDataSource: string }>(`${root}/health`),
  create: () => post<{ sessionId: string }>(`${root}/sessions`, {}),
  send: (id: string, text: string) => post(`${root}/sessions/${encodeURIComponent(id)}/messages`, { text }),
  stop: (id: string) => post(`${root}/sessions/${encodeURIComponent(id)}/stop`, {}),
  events: (id: string, cursor: string) => get<{ cursor: string; events: StaffAgentEvent[] }>(`${root}/sessions/${encodeURIComponent(id)}/events?after=${encodeURIComponent(cursor)}`),
  consent: (id: string, decision: 'approve' | 'reject', customerVerification?: { method: string; result: 'passed' }) => post(`${root}/consent/${encodeURIComponent(id)}`, { decision, ...(customerVerification ? { customerVerification } : {}) }),
  answer: (id: string, answers: Array<{ id: string; selected: string[]; custom?: string }>) => post(`${root}/questions/${encodeURIComponent(id)}/answer`, { answers }),
}
}
export const staffAgent = createClient('/staff-agent-api')
export const opsAgent = createClient('/staff-ops-agent-api')
