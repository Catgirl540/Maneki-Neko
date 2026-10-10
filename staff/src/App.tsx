import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/layout/AppShell'
import { LoginPage } from '@/layout/LoginPage'
import {
  ActionsPage,
  AuditPage,
  CustomersPage,
  WorkbenchPage,
} from '@/pages/PlaceholderPages'
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
    return <Navigate to={from ?? '/workbench'} replace />
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

export default function App() {
  return (
    <BrowserRouter>
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
          {/* 认不出的路径去工作台；没登录会被 RequireAuth 再送去登录页 */}
          <Route path="*" element={<Navigate to="/workbench" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  )
}
