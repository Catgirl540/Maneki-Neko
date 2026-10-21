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
  const home = pathname === '/assistant'
  const [serviceIds, setServiceIds] = useState<SmartServiceId[]>([])
  const [highlightTaskId, setHighlightTaskId] = useState<SmartServiceId>()
  const [focusRequest, setFocusRequest] = useState(0)
  const pageScroller = useRef<HTMLDivElement>(null)
  const service = serviceForPath(pathname, search)
  const services = home ? smartServices.filter(item => serviceIds.includes(item.id)) : service ? [service] : []
  const flow = new URLSearchParams(search).get('flow')
  useEffect(() => {
    pageScroller.current?.scrollTo({ top: 0 })
    if (home && (flow === 'in' || flow === 'out')) navigate({ pathname: '/accounts', search }, { replace: true })
  }, [pathname, home, flow, search, navigate])

  function activate() {
    if (!home) {
      if (service) setServiceIds(ids => ids.includes(service.id) ? ids : [...ids, service.id])
      navigate('/assistant')
    }
  }

  function toggleService(id: SmartServiceId) {
    if (serviceIds.includes(id)) {
      setServiceIds(ids => ids.filter(item => item !== id))
    } else {
      setServiceIds(ids => [...ids, id])
      setHighlightTaskId(id)
      setFocusRequest(value => value + 1)
    }
  }

  return <div className={`app-shell workbench-shell ${home ? 'workbench-home' : 'workbench-business'}`}>
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <Sidebar />
    <div className="workbench-main">
      <TopBar />
      <main id="main-content" tabIndex={-1} className="workbench-main-content">
        <div ref={pageScroller} hidden={home} className="business-scroll">{!home && <div key={pathname} className="business-content"><Outlet /></div>}</div>
        <SupportPage workbench={{ docked: !home, tasks: services, focusRequest, highlightTaskId,
          onActivate: activate, onClearTask: id => setServiceIds(ids => ids.filter(item => item !== id)),
          // 能力选择按会话隔离：新建对话后需重新选择。
          onNewConversation: () => setServiceIds([]),
        }} selectedServices={serviceIds} onSelectService={toggleService}
          onClearServices={() => { setServiceIds([]); setHighlightTaskId(undefined) }} />
      </main>
    </div>
  </div>
}
