import { createAgentClient } from '../../../app/src/api/agent'
import { getStaffToken, setStaffToken } from './http/base'
import { isDemoStaff } from './environment'

export const STAFF_AUTH_EXPIRED_EVENT = 'luckycat:staff-auth-expired'

function client(baseUrl: string) {
  return createAgentClient({
    baseUrl: `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}${baseUrl}`,
    enabled: import.meta.env.VITE_USE_MOCK === 'false' && !isDemoStaff,
    getToken: getStaffToken,
    onUnauthorized: () => {
      setStaffToken(null)
      window.dispatchEvent(new Event(STAFF_AUTH_EXPIRED_EVENT))
    },
  })
}

export const staffAgent = client('/staff-agent-api')
export const opsAgent = client('/staff-ops-agent-api')
