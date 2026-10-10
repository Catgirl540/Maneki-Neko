import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { DemoWatermark } from '@/components/layout/DemoWatermark'
import { ScrollToTop } from '@/components/layout/ScrollToTop'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { ToastProvider } from '@/components/ui/Toast'
import { AnalysisPage } from '@/pages/AnalysisPage'
import { CardsPage } from '@/pages/CardsPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { LandingPage } from '@/pages/LandingPage'
import { LoginPage } from '@/pages/LoginPage'
import { OpenAccountStandalone } from '@/pages/OpenAccountPage'
import { SecurityPage } from '@/pages/SecurityPage'
import { SupportPage } from '@/pages/SupportPage'
import { TransactionDetailPage } from '@/pages/TransactionDetailPage'
import { TransferPage } from '@/pages/TransferPage'
import { WealthPage } from '@/pages/WealthPage'
import { SessionProvider, RequireAuth } from '@/store/session'
import { useSession } from '@/store/session-context'

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
        <SessionProvider>
          <DemoWatermark />
          {/* 兜在最外层：任何页面渲染崩了都给一张能读的错误页，而不是白屏 */}
          <ErrorBoundary>
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
                {/* 总览从 `/` 挪到了 `/dashboard`：`/` 让给官网（见 LandingPage 的说明） */}
                <Route path="/dashboard" element={<DashboardPage />} />
                {/* 交易详情（电子回单）：从任意流水行点进来 */}
                <Route path="/transactions/:id" element={<TransactionDetailPage />} />
                <Route path="/transfer" element={<TransferPage />} />
                <Route path="/cards" element={<CardsPage />} />
                <Route path="/analysis" element={<AnalysisPage />} />
                <Route path="/wealth" element={<WealthPage />} />
                <Route path="/security" element={<SecurityPage />} />
                <Route path="/support" element={<SupportPage />} />
              </Route>
              {/* 认不出的路径回官网，而不是回总览：没登录的人落到总览只会被再弹去登录页 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
