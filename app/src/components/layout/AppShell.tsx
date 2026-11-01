import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { serviceForPath } from './services'
import { SupportPage } from '@/pages/SupportPage'
import { ImConnectView } from '@/components/im/ImConnectView'
import { BellIcon, ChatIcon } from '@/components/ui/icons'
import { listServices, type AgentService } from '@/api/agent'

/** 能力清单取不到时的重试节奏：先按 3/8/20 秒试三轮，之后在助手页每 30 秒再试一次。 */
const SERVICE_RETRY_DELAYS = [3_000, 8_000, 20_000]
const SERVICE_REFRESH_DELAY = 30_000

/** 助手与输入草稿跨业务页面保活；只有业务内容随路由切换。 */
export function AppShell() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const home = pathname === '/assistant'
  // IM 连接并入助手页：?view=im 或微信带过来的 #code=/#session= 直接打开 IM 面板。
  const imView = home && (new URLSearchParams(search).get('view') === 'im' || /[#&](code|session)=/.test(hash))
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [highlightTaskId, setHighlightTaskId] = useState<string>()
  const [focusRequest, setFocusRequest] = useState(0)
  // 能力清单来自后端（GET /agent-api/services）；null 表示还没取到。
  // 取不到就按空清单处理：不展示无法使用的入口，也不在客户端留一份本地副本。
  const [capabilities, setCapabilities] = useState<AgentService[] | null>(null)
  const [servicesAttempt, setServicesAttempt] = useState(0)
  const pageScroller = useRef<HTMLDivElement>(null)
  const pathServiceId = serviceForPath(pathname)
  const services = home
    ? (capabilities ?? []).filter(item => serviceIds.includes(item.id))
    : pathServiceId
      ? (capabilities ?? []).filter(item => item.id === pathServiceId)
      : []
  const flow = new URLSearchParams(search).get('flow')

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (attempt: number) => {
      try {
        const value = await listServices()
        if (!alive) return
        setCapabilities(value.services)
        // 后端删掉某个入口后，别再带着旧 id 发消息。
        setServiceIds(ids => ids.filter(id => value.services.some(service => service.id === id)))
      } catch {
        if (!alive) return
        if (attempt < SERVICE_RETRY_DELAYS.length) {
          timer = setTimeout(() => void load(attempt + 1), SERVICE_RETRY_DELAYS[attempt])
        } else {
          setCapabilities([])
        }
      }
    }
    void load(0)
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [servicesAttempt])

  // Agent 可能比网页晚起来。停在助手页且清单为空时，隔一段时间再试一次，不刷新页面。
  useEffect(() => {
    if (!home || capabilities === null || capabilities.length > 0) return
    const timer = setTimeout(() => setServicesAttempt(value => value + 1), SERVICE_REFRESH_DELAY)
    return () => clearTimeout(timer)
  }, [home, capabilities])

  // 助手回复里的站内链接以跳转卡片呈现；这里统一做 SPA 跳转并校验只允许站内路径。
  useEffect(() => {
    const go = (event: Event) => {
      const path = (event as CustomEvent).detail
      if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) navigate(path)
    }
    window.addEventListener('dsh:navigate', go)
    return () => window.removeEventListener('dsh:navigate', go)
  }, [navigate])

  useEffect(() => {
    pageScroller.current?.scrollTo({ top: 0 })
    if (home && (flow === 'in' || flow === 'out')) navigate({ pathname: '/accounts', search }, { replace: true })
  }, [pathname, home, flow, search, navigate])

  function activate() {
    if (!home) {
      if (pathServiceId) setServiceIds(ids => ids.includes(pathServiceId) ? ids : [...ids, pathServiceId])
      navigate('/assistant')
    }
  }

  function toggleService(id: string) {
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
            <div className="business-content"><ImConnectView /></div>
          </div>
        )}
        <SupportPage hidden={imView} workbench={{ docked: !home, tasks: services, focusRequest, highlightTaskId,
          onActivate: activate, onClearTask: id => setServiceIds(ids => ids.filter(item => item !== id)),
          // 能力选择按会话隔离：新建对话后需重新选择。
          onNewConversation: () => setServiceIds([]),
        }} services={capabilities ?? []} selectedServices={serviceIds} onSelectService={toggleService}
          onClearServices={() => { setServiceIds([]); setHighlightTaskId(undefined) }} />
      </main>
    </div>
  </div>
}
