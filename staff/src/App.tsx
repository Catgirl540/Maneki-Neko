import { ToastProvider } from '../../app/src/components/ui/Toast'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { OperationsPage } from '@/pages/operations/OperationsPage'
import { AssistantPage } from '@/pages/assistant/AssistantPage'
import { AppShell } from '@/layout/AppShell'
import { LoginPage } from '@/layout/LoginPage'
import { WorkbenchPage } from '@/pages/workbench/WorkbenchPage'
import { CustomersPage } from '@/pages/customers/CustomersPage'
import { ActionsPage } from '@/pages/actions/ActionsPage'
import { AuditPage } from '@/pages/audit/AuditPage'
import { ApprovalsPage } from '@/pages/approvals/ApprovalsPage'
import { TicketsPage } from '@/pages/tickets/TicketsPage'
import { RequireAuth, SessionProvider } from '@/store/session'
import { useSession } from '@/store/session-context'

/**
 * 登录页的入口。
 * **重定向只在这里做，登录页自己不跳**（照客户端 App.tsx 的教训写，别再踩一遍）：
 * 两处都跳会互相覆盖，`from`（来源页）会被吃掉。
 */
function LoginRoute() {
  const { user } = useSession()
  const location = useLocation()
  if (user) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={user.role === 'ops' ? '/operations' : from ?? '/workbench'} replace />
  }
  return <LoginPage />
}

/** 会计/主管才能进审计页：前端拦一道，后端接口还有一道 403（清单 §1） */
function RequireSupervisor({ children }: { children: React.ReactNode }) {
  const { user } = useSession()
  const location = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (user.role !== 'supervisor') return <Navigate to="/workbench" replace />
  return <>{children}</>
}

function RequireBusiness() {
  const { user } = useSession()
  return user?.role === 'ops' ? <Navigate to="/operations" replace /> : <Outlet />
}

function RequireOperations() {
  const { user } = useSession()
  return user?.role === 'ops' ? <OperationsPage /> : <Navigate to="/workbench" replace />
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/operations" element={<RequireOperations />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route element={<RequireBusiness />}>
            <Route path="/workbench" element={<WorkbenchPage />} />
            <Route path="/tickets" element={<TicketsPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/actions" element={<ActionsPage />} />
            <Route
              path="/audit"
              element={
                <RequireSupervisor>
                  <AuditPage />
                </RequireSupervisor>
              }
            />
            </Route>
          </Route>
          {/* 认不出的路径去工作台；没登录会被 RequireAuth 再送去登录页 */}
          <Route path="*" element={<Navigate to="/workbench" replace />} />
        </Routes>
      </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
