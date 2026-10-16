import { useSession } from '@/store/session-context'
import { staffAgent, opsAgent } from '@/api/agent'
import { ChatWorkspace } from '../../../../app/src/components/agent/ChatWorkspace'
import { StaffConsentCard } from './StaffConsentCard'

const workbench = { docked: false, tasks: [], focusRequest: 0, onActivate: () => {}, onClearTask: () => {} }

/** 界面与客户端共用；身份、历史、业务确认仍由员工端拥有。 */
export function AssistantPage() {
  const { user } = useSession()
  if (!user) return null
  const owner = `staff.${user.role}.${user.id}`
  return <div className="staff-assistant-page">
    <div className="staff-assistant-heading"><span>{user.role === 'ops' ? '运维助手' : '工作人员助手'}</span><small>敏感操作需确认</small></div>
    <ChatWorkspace
    key={owner}
    client={user.role === 'ops' ? opsAgent : staffAgent}
    ownerId={user.id}
    historyOwnerId={owner}
    audience="staff"
    workbench={workbench}
    placeholder={user.role === 'ops' ? '描述需要排查的服务、日志或运维任务' : '描述需要查询的客户、工单或办理事项'}
    renderConsent={(pending, approve, reject) => <StaffConsentCard
      key={pending.challenge.challengeId} pending={pending} onApprove={approve} onReject={reject}
    />}
  /></div>
}
