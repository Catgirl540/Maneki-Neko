import { useCallback, useEffect, useState } from 'react'
import { ImError, isImFeatureUnavailable, listImBindings, type ImBinding } from '@/api/im'
import { WeixinQrBinding } from './WeixinQrBinding'
import { Card, CardHeader } from '@/components/ui/Card'
import { Skeleton, Tag } from '@/components/ui/Segmented'
import { CheckIcon, ChatIcon, RefreshIcon, ShieldIcon } from '@/components/ui/icons'
import { Button } from '@/components/ui/Button'
import './im-page.css'

/**
 * 助手页的 IM 连接视图：状态卡 + 微信扫码卡 + 安全提示。
 * 绑定状态来自服务端，不缓存于组件内存；扫码尝试的断点续扫在 WeixinQrBinding 内部处理。
 */
export function ImConnectView() {
  const [bindings, setBindings] = useState<ImBinding[] | null>(null)
  const [error, setError] = useState<ImError | null>(null)
  const [loading, setLoading] = useState(true)
  const [rebinding, setRebinding] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setBindings(await listImBindings())
      setError(null)
    } catch (cause) {
      const failure = cause instanceof ImError ? cause : new ImError('连接状态暂时无法加载', 0)
      if (isImFeatureUnavailable(failure)) setBindings(null)
      setError(failure)
    } finally {
      setLoading(false)
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载即请求一次服务端绑定状态
  useEffect(() => { void load() }, [])

  const live = bindings?.filter(item => item.connected) ?? []
  const bound = live.length > 0
  const stale = (bindings?.length ?? 0) > 0 && !bound
  // 一个账户只绑一个微信：已连接就不再出二维码；未绑定、会话失效或主动换绑时才给扫码入口。
  const showQr = !loading && !error && (!bound || rebinding)
  return <div className="im-page flex flex-col gap-6">
    <Card className="im-status-card">
      <CardHeader title={<span className="im-section-title"><span className="im-section-icon"><ChatIcon size={18} /></span>连接状态</span>}
        action={bound ? <span className="im-status-actions"><Tag tone="gold">已连接</Tag><Button size="sm" variant="ghost" onClick={() => setRebinding(value => !value)}>{rebinding ? '取消换绑' : '换绑'}</Button></span> : loading ? null : <Tag tone="neutral">未连接</Tag>} />
      {loading && <Skeleton className="im-status-skeleton" />}
      {!loading && error && (
        <div className="im-status-error">
          <p className="text-[13px] text-ink-soft">{isImFeatureUnavailable(error) ? 'IM 连接服务未启用，请稍后重试或联系客服。' : error.message}</p>
          {!isImFeatureUnavailable(error) && <Button size="sm" variant="ghost" onClick={() => void load()}><RefreshIcon size={14} />重试</Button>}
        </div>
      )}
      {!loading && !error && (
        <div className="im-status-lines">
          {bound ? live.map(item => (
            <div key={item.id} className="im-status-line">
              <span className="im-status-mark is-live"><CheckIcon size={13} /></span>
              <span className="im-status-main">
                <b>{item.label || '微信私聊'}</b>
                <small>在微信私聊中查询、办理事务、接收日程提醒</small>
              </span>
            </div>
          )) : (
            <div className="im-status-line">
              <span className="im-status-mark"><ChatIcon size={13} /></span>
              <span className="im-status-main">
                <b>{stale ? '微信会话已失效' : '尚未连接微信'}</b>
                <small>{stale ? '原绑定仍在，重新扫码即可恢复私聊服务' : '扫描下方二维码，把银行助手带到微信私聊'}</small>
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
    {bound && rebinding && <p className="im-rebind-note">重新扫码并确认后，将替换当前绑定的微信。</p>}
    {showQr && <WeixinQrBinding onBound={async () => { setRebinding(false); await load() }} />}
    <p className="im-security-note"><ShieldIcon size={16} />银行登录密码、支付密码仅在银行页面填写；资金操作仍需单独确认。</p>
  </div>
}
