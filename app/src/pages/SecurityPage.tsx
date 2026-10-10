import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/api'
import type { SecurityOverview } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { useResetOnOpen } from '@/lib/usePresence'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Skeleton, Tag } from '@/components/ui/Segmented'
import { Row, Toggle } from '@/components/ui/Toggle'
import {
  AlertIcon,
  CheckIcon,
  DeviceIcon,
  LockIcon,
  PhoneIcon,
  ShieldIcon,
  SlidersIcon,
} from '@/components/ui/icons'
import { formatDateTime, maskPhone } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'
import { useSession } from '@/store/session-context'

export function SecurityPage() {
  const toast = useToast()
  const { user, updateUser } = useSession()
  const overview = useAsync<SecurityOverview>(() => api.getSecurityOverview(), [])
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const score = overview.data?.score ?? 0
  const phone = user?.phone ?? ''

  /**
   * 乐观更新风控规则：开关立即响应，接口返回最新的安全评分后一次写回。
   * 失败回滚到点击前的快照。
   */
  async function toggleRule(id: string, label: string, next: boolean) {
    const snapshot = overview.data
    if (!snapshot) return
    overview.setData({
      ...snapshot,
      riskRules: snapshot.riskRules.map((r) => (r.id === id ? { ...r, enabled: next } : r)),
    })
    try {
      // 接口直接回最新总览（含重算后的评分与新增日志），省掉一次回查
      overview.setData(await api.setSecurityRule(id, next))
      toast.show(next ? `已开启「${label}」` : `已关闭「${label}」`, next ? 'success' : 'info')
    } catch (err) {
      overview.setData(snapshot)
      toast.show(err instanceof ApiError ? err.message : '操作失败，请稍后重试', 'error')
    }
  }

  const requests = [overview]
  const failed = requests.filter(state => state.error !== null && state.data === null)
  if (failed.length) return <DataUnavailable message={failed[0]!.error!} onRetry={() => failed.forEach(state => state.reload())} />
  if (requests.some(state => state.loading && state.data === null)) return <DataLoading />

  return (
    <div className="flex flex-col gap-7">
      <header className="float-up">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">
          安全中心
        </h1>
      </header>

      {notice && (
        <p className="float-up flex items-center gap-2 rounded-field bg-blue-wash px-4 py-3 text-[13px] text-blue">
          <CheckIcon size={16} />
          {notice}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.25fr]">
        {/* 安全评分 */}
        <Card className="float-up">
          <CardHeader title="账户安全评分" />
          {overview.loading ? (
            <Skeleton className="mt-6 h-32 w-full" />
          ) : (
            <>
              <div className="mt-6 flex items-end gap-3">
                <span className="num text-[56px] leading-none font-bold tracking-[-0.03em] text-ink">
                  {score}
                </span>
                <span className="mb-2 text-[15px] text-ink-mute">/ 100</span>
                <Tag tone="blue" className="mb-2.5 ml-auto">
                  {overview.data?.level}
                </Tag>
              </div>

              <div className="mt-5 h-2 w-full overflow-hidden rounded-chip bg-line">
                <div
                  className="h-full rounded-chip bg-gold transition-[width] duration-700"
                  style={{ width: `${score}%` }}
                />
              </div>

              <ul className="mt-6 flex flex-col gap-3 text-[13px] text-ink-soft">
                <li className="flex items-center gap-2">
                  <CheckIcon size={16} className="text-blue" />
                  实名身份已核验
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon size={16} className="text-blue" />
                  {overview.data?.riskRules.filter((r) => r.enabled).length ?? 0} 条风控规则已开启
                </li>
                <li className="flex items-center gap-2">
                  <AlertIcon size={16} className="text-gold-deep" />
                  {overview.data?.devices.length ?? 0} 台设备可访问此账户
                </li>
              </ul>
            </>
          )}
        </Card>

        {/* 安全设置 */}
        <Card className="float-up" style={{ animationDelay: '60ms' }}>
          <CardHeader title="安全设置" />
          <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
            登录手机号与登录密码是这个账户的两把钥匙。
            大额转账、开卡、理财申购等敏感操作会在
            <span className="font-medium text-ink">那一步</span>
            各自要求身份核验，不需要提前在这里做一次认证。
          </p>

          <div className="mt-5 divide-y divide-line">
            <Row
              icon={<PhoneIcon size={20} />}
              title="登录手机号"
              description={phone ? maskPhone(phone) : '—'}
              right={
                <Button size="sm" onClick={() => setPhoneOpen(true)}>
                  更换
                </Button>
              }
            />
            <Row
              icon={<LockIcon size={20} />}
              title="登录密码"
              description="修改后其他设备需要重新登录"
              right={
                <Button size="sm" onClick={() => setPasswordOpen(true)}>
                  修改
                </Button>
              }
            />
          </div>

          <p className="mt-5 inline-flex items-start gap-2 text-[13px] text-ink-mute">
            <ShieldIcon size={16} className="mt-0.5 shrink-0" />
            密码使用银行级加密存储，客服不会向你索取密码
          </p>
        </Card>
      </div>

      {/* 风控规则 */}
      <Card className="float-up" style={{ animationDelay: '120ms' }}>
        <CardHeader title="交易风控" action={<Tag tone="gold">实时生效</Tag>} />
        <div className="mt-3 divide-y divide-line">
          {overview.loading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="py-4">
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          {overview.data?.riskRules.map((rule) => (
            <Row
              key={rule.id}
              icon={<SlidersIcon size={20} />}
              title={rule.label}
              description={rule.description}
              right={
                <Toggle
                  label={rule.label}
                  checked={rule.enabled}
                  onChange={(next) => void toggleRule(rule.id, rule.label, next)}
                />
              }
            />
          ))}
        </div>
      </Card>

      {/* 登录设备 */}
      <Card className="float-up" style={{ animationDelay: '150ms' }}>
        <CardHeader title="登录设备" />
        <ul className="mt-3 divide-y divide-line">
          {overview.data?.devices.map((device) => (
            <li key={device.id} className="flex items-center gap-4 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-tile bg-sunk text-ink-soft">
                {device.name.includes('iPhone') || device.name.includes('iPad') ? (
                  <PhoneIcon size={20} />
                ) : (
                  <DeviceIcon size={20} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-ink">{device.name}</span>
                  {device.current && <Tag tone="blue">当前设备</Tag>}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-ink-mute">
                  {device.location} · {formatDateTime(device.lastActiveAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 安全日志 */}
      <Card className="float-up" style={{ animationDelay: '180ms' }}>
        <CardHeader title="安全日志" />
        <ul className="mt-3 divide-y divide-line">
          {overview.data?.logs.map((log) => (
            <li key={log.id} className="flex items-start gap-4 py-4">
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-chip ${
                  log.level === 'warn' ? 'bg-coral' : 'bg-blue'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">{log.action}</span>
                <span className="mt-0.5 block text-[13px] text-ink-mute">{log.detail}</span>
              </span>
              <span className="num shrink-0 text-[13px] text-ink-mute">
                {formatDateTime(log.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 弹层**常驻挂载**，靠 `open` 控制显隐 —— 不能写成 `{passwordOpen && <…/>}`。
          条件挂载的话组件是被父级直接卸载的，`Modal` 里的退场动画永远没机会播，
          关掉就是"啪"地一下没了。表单状态由下面的 key 负责重置。 */}
      <PasswordModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onDone={() => {
          setNotice('登录密码已更新，请在其他设备重新登录')
          overview.reload()
        }}
      />

      <PhoneModal
        open={phoneOpen}
        currentPhone={phone}
        onClose={() => setPhoneOpen(false)}
        onDone={(next) => {
          updateUser({ phone: next })
          setNotice(`登录手机号已更换为 ${maskPhone(next)}`)
          overview.reload()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------ 重置登录密码 */

function PasswordModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 弹层是常驻挂载的（为了退场动画），所以"重开时干净"要自己保证。
  useResetOnOpen(open, () => {
    setOldPassword('')
    setNewPassword('')
    setConfirm('')
    setError(null)
  })

  async function submit() {
    setError(null)
    if (newPassword !== confirm) return setError('两次输入的新密码不一致')
    setBusy(true)
    try {
      await api.changePassword(oldPassword, newPassword)
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="重置登录密码"
      description="输入当前密码，再设置新的登录密码。"
      footer={
        <>
          <Button block onClick={onClose}>
            取消
          </Button>
          <Button block variant="primary" loading={busy} onClick={() => void submit()}>
            确认修改
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field
          label="原密码"
          type="password"
          icon={<LockIcon size={20} />}
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          placeholder="请输入原密码"
        />
        <Field
          label="新密码"
          type="password"
          icon={<LockIcon size={20} />}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="至少 6 位"
        />
        <Field
          label="确认新密码"
          type="password"
          icon={<LockIcon size={20} />}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="再次输入新密码"
          error={error ?? undefined}
        />
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ 更换登录手机号 */

/**
 * 更换登录手机号。
 *
 * 手机号是找回密码与接收验证码的唯一凭证，换掉它等于换掉账户的钥匙 ——
 * 所以要求**人脸核身 + 新号短信验证**，而这两步恰好就是「身份认证」本该待的地方：
 * 它是敏感操作内部的一步，不是一个可以提前点掉的独立按钮。
 */
function PhoneModal({
  open,
  currentPhone,
  onClose,
  onDone,
}: {
  open: boolean
  currentPhone: string
  onClose: () => void
  onDone: (nextPhone: string) => void
}) {
  const toast = useToast()
  const [faceTicket, setFaceTicket] = useState('')
  const [scanning, setScanning] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [smsHint, setSmsHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 同上：人脸票据、验证码、倒计时都不能从上一次带过来。
  useResetOnOpen(open, () => {
    setFaceTicket('')
    setNewPhone('')
    setSmsCode('')
    setCooldown(0)
    setSmsHint(null)
    setError(null)
    setScanning(false)
  })

  const counting = cooldown > 0
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => setCooldown((v) => (v <= 1 ? 0 : v - 1)), 1000)
    return () => clearInterval(timer)
  }, [counting])

  const phoneReady = /^1[3-9]\d{9}$/.test(newPhone)
  const canSubmit = !!faceTicket && phoneReady && smsCode.length === 6

  async function scanFace() {
    setScanning(true)
    setError(null)
    try {
      const { ticket } = await api.verifyIdentity('face')
      setFaceTicket(ticket)
      toast.show('人脸核身通过', 'success')
    } catch {
      setError('人脸核身失败，请重试')
    } finally {
      setScanning(false)
    }
  }

  async function sendCode() {
    setError(null)
    try {
      // 验证码发往**新**手机号 —— 证明这个号确实是你的
      const res = await api.sendSmsCode(newPhone)
      setCooldown(60)
      setSmsHint(res.demoCode ? `演示环境验证码：${res.demoCode}` : '验证码已发送，请查看短信')
      toast.show(`验证码已发送至 ${maskPhone(newPhone)}`, 'success')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '验证码发送失败')
    }
  }

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const next = await api.changePhone({ newPhone, smsCode, faceTicket })
      onDone(next.phone)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '更换失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-[500px]"
      title="更换登录手机号"
      description={`当前登录手机号 ${maskPhone(currentPhone)}。更换后请用新号码登录。`}
      footer={
        <>
          <Button block onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            block
            variant="primary"
            loading={busy}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            确认更换
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* 第一步：核身。手机号是账户钥匙，换它必须先证明是本人 */}
        <div className="rounded-field border border-line px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink">
                1 · 人脸核身
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-mute">
                {faceTicket ? '已通过核身' : '更换手机号属高危操作，需先确认为本人'}
              </span>
            </span>
            {faceTicket ? (
              <Tag tone="blue">已通过</Tag>
            ) : (
              <Button size="sm" loading={scanning} onClick={() => void scanFace()}>
                开始核身
              </Button>
            )}
          </div>
        </div>

        {/* 第二步：新号 + 验证码 */}
        <div className={faceTicket ? undefined : 'pointer-events-none opacity-50'}>
          <p className="mb-3 text-[14px] font-medium text-ink">2 · 验证新手机号</p>
          <div className="flex flex-col gap-4">
            <Field
              label="新手机号"
              value={newPhone}
              inputMode="numeric"
              onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="请输入新的 11 位手机号"
            />
            <div className="flex items-end gap-2.5">
              <div className="min-w-0 flex-1">
                <Field
                  label="短信验证码"
                  value={smsCode}
                  inputMode="numeric"
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 位验证码"
                  hint={smsHint ?? '验证码将发送到新手机号'}
                />
              </div>
              <Button
                className="h-14 shrink-0"
                onClick={() => void sendCode()}
                disabled={counting || !phoneReady}
              >
                {counting ? `${cooldown}s 后重发` : '获取验证码'}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
            <AlertIcon size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <p className="text-[12px] leading-relaxed text-ink-mute">
          更换后，原手机号将无法用于登录与找回密码。此次变更会记入安全日志。
        </p>
      </div>
    </Modal>
  )
}
