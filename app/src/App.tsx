import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { AccountLayout } from '@/components/layout/AccountLayout'
import { DemoWatermark } from '@/components/layout/DemoWatermark'
import { ScrollToTop } from '@/components/layout/ScrollToTop'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { ToastProvider } from '@/components/ui/Toast'
import { AnalysisPage } from '@/pages/AnalysisPage'
import { BillsPage } from '@/pages/BillsPage'
import { AutoDebitsPage } from '@/pages/AutoDebitsPage'
import { CardsPage } from '@/pages/CardsPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { LandingPage } from '@/pages/LandingPage'
import { DownloadPage } from '@/pages/DownloadPage'
import { LoginPage } from '@/pages/LoginPage'
import { OpenAccountStandalone } from '@/pages/OpenAccountPage'
import { SecurityPage } from '@/pages/SecurityPage'
import { SupportPage } from '@/pages/SupportPage'
import { SavingsPage } from '@/pages/SavingsPage'
import { InvitationsPage } from '@/pages/InvitationsPage'
import { MembershipPage } from '@/pages/MembershipPage'
import { ExchangePage } from '@/pages/ExchangePage'
import { IdentityPage } from '@/pages/IdentityPage'
import { CashflowPage } from '@/pages/CashflowPage'
import { CreditPage } from '@/pages/CreditPage'
import { CashManagementPage } from '@/pages/CashManagementPage'
import { InvestPage } from '@/pages/InvestPage'
import { InsurancePage } from '@/pages/InsurancePage'
import { TransactionDetailPage } from '@/pages/TransactionDetailPage'
import { WealthPage } from '@/pages/WealthPage'
import { SessionProvider, RequireAuth } from '@/store/session'
import { useSession } from '@/store/session-context'
import { clientDevice } from '@/lib/device'

/** 手机在登录态和业务页面挂载之前统一进入下载页，深链接同样适用。 */
function ClientEntry({ children }: { children: ReactNode }) {
  const device = clientDevice()
  const location = useLocation()
  if (device !== 'desktop' || /^\/download\/?$/.test(location.pathname)) {
    return (
      <Routes>
        <Route path="/download" element={<DownloadPage device={device} />} />
        <Route path="*" element={<Navigate to="/download" replace />} />
      </Routes>
    )
  }
  return <SessionProvider>{children}</SessionProvider>
}

/**
 * 登录页的入口。
 *
 * **重定向只在这里做，登录页自己不跳。** 两处都跳会互相覆盖：
 * 登录页 `navigate(from)` 与这里"已登录就送走"是同一个时刻的两个导航，
 * 谁后跑谁赢——实测的结果是永远落在 `/dashboard`，`from`（来源页）被吃掉，
 * 于是"登录后回到你刚才想去的页面"这件事从来没生效过。
 * （这个 bug 原来就在，只是当时两边都指向 `/`，看不出来。）
 */
function LoginRoute() {
  const { user } = useSession()
  const location = useLocation()
  if (user) {
    // 回到被守卫拦下来的那一页；没有来源时去总览（官网在 `/`，停在那儿等于没进去）
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/dashboard'} replace />
  }
  return <LoginPage />
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/* 路由切换要回到顶部，否则新页面会继承上一页的滚动位置 */}
      <ScrollToTop />
      <ToastProvider>
        <DemoWatermark />
        {/* 兜在最外层：任何页面渲染崩了都给一张能读的错误页，而不是白屏 */}
        <ErrorBoundary>
          <ClientEntry>
            <Routes>
              {/* 官网是公开的：它要回答「这是什么」，所以不能先拦一道登录 */}
              <Route path="/" element={<LandingPage />} />
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
                <Route element={<AccountLayout />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/cards" element={<CardsPage />} />
                  <Route path="/receiving" element={<Navigate to="/dashboard?flow=in" replace />} />
                  <Route path="/analysis" element={<BillsPage />} />
                  <Route path="/analysis/statistics" element={<AnalysisPage />} />
                  <Route path="/analysis/autodebits" element={<AutoDebitsPage />} />
                  <Route path="/dashboard/savings" element={<SavingsPage />} />
                  <Route path="/transactions/:id" element={<TransactionDetailPage />} />
                </Route>
                <Route path="/transfer" element={<Navigate to="/dashboard?flow=out" replace />} />
                <Route path="/wealth" element={<WealthPage />} />
                <Route path="/wealth/cash-management" element={<CashManagementPage />} />
                <Route path="/wealth/investments" element={<InvestPage />} />
                <Route path="/wealth/insurance" element={<InsurancePage />} />
                <Route path="/exchange" element={<ExchangePage />} />
                <Route path="/cashflow" element={<CashflowPage />} />
                <Route path="/credit" element={<CreditPage />} />
                <Route path="/security" element={<SecurityPage />} />
                <Route path="/security/identity" element={<IdentityPage />} />
                <Route path="/security/invitations" element={<InvitationsPage />} />
                <Route path="/security/membership" element={<MembershipPage />} />
                <Route path="/support" element={<SupportPage />} />
              </Route>
              {/* 认不出的路径回官网，而不是回总览：没登录的人落到总览只会被再弹去登录页 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ClientEntry>
        </ErrorBoundary>
      </ToastProvider>
    </BrowserRouter>
  )
}
