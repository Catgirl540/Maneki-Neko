import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { serviceForPath, smartServices, type SmartServiceId } from './services'
import { SupportPage } from '@/pages/SupportPage'

/** 助手与输入草稿跨业务页面保活；只有业务内容随路由切换。 */
export function AppShell() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const home = pathname === '/dashboard' || pathname === '/support'
  const [serviceId, setServiceId] = useState<SmartServiceId>()
  const [focusRequest, setFocusRequest] = useState(0)
  const pageScroller = useRef<HTMLDivElement>(null)
  const service = home ? smartServices.find(item => item.id === serviceId) : serviceForPath(pathname)
  const flow = new URLSearchParams(search).get('flow')
  useEffect(() => {
    pageScroller.current?.scrollTo({ top: 0 })
    if (home && (flow === 'in' || flow === 'out')) navigate({ pathname: '/accounts', search }, { replace: true })
  }, [pathname, home, flow, search, navigate])

  function activate() {
    if (!home) {
      setServiceId(service?.id)
      navigate('/dashboard')
    }
  }

  return <div className={`app-shell workbench-shell ${home ? 'workbench-home' : 'workbench-business'}`}>
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <Sidebar />
    <div className="workbench-main">
      <TopBar />
      <main id="main-content" tabIndex={-1} className="workbench-main-content">
        <div ref={pageScroller} hidden={home} className="business-scroll">{!home && <div key={pathname} className="business-content"><Outlet /></div>}</div>
        <SupportPage workbench={{ docked: !home, task: service?.label, focusRequest,
          onActivate: activate, onClearTask: () => setServiceId(undefined),
        }} selectedService={serviceId} onSelectService={id => { setServiceId(id); setFocusRequest(value => value + 1) }} />
      </main>
    </div>
  </div>
}
