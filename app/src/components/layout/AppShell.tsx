import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { serviceForPath, smartServices, type SmartServiceId } from './services'
import { SupportPage } from '@/pages/SupportPage'
import { WeixinQrBinding } from '@/components/im/WeixinQrBinding'
import { BellIcon, ChatIcon, ShieldIcon } from '@/components/ui/icons'

/** 助手与输入草稿跨业务页面保活；只有业务内容随路由切换。 */
export function AppShell() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const home = pathname === '/assistant'
  // IM 连接并入助手页：?view=im 或微信带过来的 #code=/#session= 直接打开 IM 面板。
  const imView = home && (new URLSearchParams(search).get('view') === 'im' || /[#&](code|session)=/.test(hash))
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
        {home && (
          <div className="mb-3 flex w-fit gap-1 rounded-field border border-line bg-surface p-1" role="tablist" aria-label="助手视图">
            <button type="button" role="tab" aria-selected={!imView}
              onClick={() => navigate({ pathname: '/assistant' })}
              className={'inline-flex min-h-9 items-center gap-2 rounded-field px-4 text-[13px] font-medium ' + (!imView ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sunk')}>
              <ChatIcon size={15} />对话
            </button>
            <button type="button" role="tab" aria-selected={imView}
              onClick={() => navigate({ pathname: '/assistant', search: '?view=im', hash })}
              className={'inline-flex min-h-9 items-center gap-2 rounded-field px-4 text-[13px] font-medium ' + (imView ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sunk')}>
              <BellIcon size={15} />IM 连接
            </button>
          </div>
        )}
        {imView && (
          <div className="business-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="business-content">
              <div className="im-page flex flex-col gap-6">
                <WeixinQrBinding onBound={async () => {}} />
                <p className="im-security-note"><ShieldIcon size={16} />银行登录密码、支付密码仅在银行页面填写；资金操作仍需单独确认。</p>
              </div>
            </div>
          </div>
        )}
        <SupportPage hidden={imView} workbench={{ docked: !home, tasks: services, focusRequest, highlightTaskId,
          onActivate: activate, onClearTask: id => setServiceIds(ids => ids.filter(item => item !== id)),
          // 能力选择按会话隔离：新建对话后需重新选择。
          onNewConversation: () => setServiceIds([]),
        }} selectedServices={serviceIds} onSelectService={toggleService}
          onClearServices={() => { setServiceIds([]); setHighlightTaskId(undefined) }} />
      </main>
    </div>
  </div>
}
