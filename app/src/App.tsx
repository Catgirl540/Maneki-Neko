import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { DemoWatermark } from '@/components/layout/DemoWatermark'
import { ScrollToTop } from '@/components/layout/ScrollToTop'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { ToastProvider } from '@/components/ui/Toast'
import { AnalysisPage } from '@/pages/AnalysisPage'
import { CardsPage } from '@/pages/CardsPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'
import { OpenAccountStandalone } from '@/pages/OpenAccountPage'
import { SecurityPage } from '@/pages/SecurityPage'
import { SupportPage } from '@/pages/SupportPage'
import { TransactionDetailPage } from '@/pages/TransactionDetailPage'
import { TransferPage } from '@/pages/TransferPage'
import { WealthPage } from '@/pages/WealthPage'
import { SessionProvider, RequireAuth } from '@/store/session'
import { useSession } from '@/store/session-context'

function LoginRoute() {
  const { user } = useSession()
  if (user) return <Navigate to="/" replace />
  return <LoginPage />
}

export default function App() {
  return (
    <BrowserRouter>
      {/* 路由切换要回到顶部，否则新页面会继承上一页的滚动位置 */}
      <ScrollToTop />
      <ToastProvider>
        <SessionProvider>
          {/* 兜在最外层：任何页面渲染崩了都给一张能读的错误页，而不是白屏 */}
          <ErrorBoundary>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              {/* 开户不需要登录态：还没有账户的人正是从登录页过来的 */}
              <Route path="/open-account" element={<OpenAccountStandalone />} />
              <Route
                element={
                  <RequireAuth>
                    <AppShell />
                  </RequireAuth>
                }
              >
                <Route path="/" element={<DashboardPage />} />
                {/* 交易详情（电子回单）：从任意流水行点进来 */}
                <Route path="/transactions/:id" element={<TransactionDetailPage />} />
                <Route path="/transfer" element={<TransferPage />} />
                <Route path="/cards" element={<CardsPage />} />
                <Route path="/analysis" element={<AnalysisPage />} />
                <Route path="/wealth" element={<WealthPage />} />
                <Route path="/security" element={<SecurityPage />} />
                <Route path="/support" element={<SupportPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </SessionProvider>
        {/* 挂在路由之外：登录页、开户页这些没有应用外壳的页面也要有 */}
        <DemoWatermark />
      </ToastProvider>
    </BrowserRouter>
  )
}