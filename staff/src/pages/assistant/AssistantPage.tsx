import { useSession } from '@/store/session-context'
import { staffAgent, opsAgent } from '@/api/agent'
import { ChatWorkspace } from '../../../../app/src/components/agent/ChatWorkspace'
import { StaffConsentCard } from './StaffConsentCard'

/** 界面与客户端共用；身份、历史、业务确认仍由员工端拥有。 */
export function AssistantPage() {
  const { user } = useSession()
  if (!user) return null
  const owner = `staff.${user.role}.${user.id}`
  return <ChatWorkspace
    key={owner}
    client={user.role === 'ops' ? opsAgent : staffAgent}
    ownerId={user.id}
    historyOwnerId={owner}
    audience="staff"
    placeholder={user.role === 'ops' ? '描述需要排查的服务、日志或运维任务' : '描述需要查询的客户、工单或办理事项'}
    renderConsent={(pending, approve, reject) => <StaffConsentCard
      key={pending.challenge.challengeId} pending={pending} onApprove={approve} onReject={reject}
    />}
  />
}
