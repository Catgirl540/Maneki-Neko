import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { api, ApiError } from '@/api'
import type {
  AccountClass,
  AccountKind,
  AccountOpeningResult,
  AccountTier,
} from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { CheckIcon, ChevronRightIcon } from '@/components/ui/icons'
import { EmptyState, Skeleton, Tag } from '@/components/ui/Segmented'
import { useToast } from '@/components/ui/toast-context'
import { useSession } from '@/store/session-context'
import { formatBankAccount, maskBankAccount } from '@/lib/account'
import {
  ACCOUNT_MISUSE_PENALTY as PENALTY_TEXT,
  ACCOUNT_OPENING_PLEDGE as PLEDGE_TEXT,
} from '@/lib/account-opening'
import { cn } from '@/lib/cn'
import { formatAmount, maskAccountNo } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'

type Step = 1 | 2 | 3

const STEPS = [
  { id: 1, label: '选择账户' },
  { id: 2, label: '身份验证' },
  { id: 3, label: '完成' },
] as const

/** 可选的具体产品：类别 × 账户性质。Ⅰ 类只展示、不能选 */
const CHOICES: { tier: AccountClass; kind: AccountKind; title: string; blurb: string }[] = [
  { tier: 'II', kind: 'current', title: 'Ⅱ 类户 · 活期', blurb: '日常收支、买理财，最常用' },
  { tier: 'II', kind: 'savings', title: 'Ⅱ 类户 · 储蓄', blurb: '专款专用，年化 1.55%' },
  { tier: 'III', kind: 'current', title: 'Ⅲ 类户 · 零钱包', blurb: '小额高频支付，余额不超 2000 元' },
]

const DEMO_ID = '310101199001011234'

/**
 * 开户流程主体。
 *
 * `standalone` 决定它跑在两种场景里：
 *   · 登录前（登录页进入）：还没有账户的人在开户，手机号要自己填，完成后去登录
 *   · 登录后（侧栏「开户」进入）：已有客户再开一个 Ⅱ/Ⅲ 类户，手机号沿用登录手机号
 * 两种都是真实存在的场景，所以是同一个流程加一个开关，不是两份实现。
 */
function OpenAccountFlow({ standalone = false }: { standalone?: boolean }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useSession()
  const tiers = useAsync<AccountTier[]>(() => api.listAccountTiers(), [])

  const [step, setStep] = useState<Step>(1)
  const [tier, setTier] = useState<AccountClass>('II')
  const [kind, setKind] = useState<AccountKind>('current')

  const [holderName, setHolderName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [bindingCardNo, setBindingCardNo] = useState('')
  const [pledgeChecked, setPledgeChecked] = useState(false)
  const [faceTicket, setFaceTicket] = useState('')
  const [scanning, setScanning] = useState(false)

  const [cooldown, setCooldown] = useState(0)
  const [smsHint, setSmsHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<AccountOpeningResult | null>(null)

  const activeTier = tiers.data?.find((t) => t.tier === tier) ?? null
  const needsBinding = activeTier?.requiresBinding ?? true
  // 登录后沿用登录手机号；登录前由用户自己填
  const [phoneInput, setPhoneInput] = useState('')
  const phone = user?.phone ?? phoneInput

  /* 验证码倒计时。setState 只在 setInterval 回调里，不在 effect 体内同步调用 */
  const counting = cooldown > 0
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => setCooldown((v) => (v <= 1 ? 0 : v - 1)), 1000)
    return () => clearInterval(timer)
  }, [counting])

  async function sendCode() {
    setError(null)
    try {
      const res = await api.sendSmsCode(phone)
      setCooldown(60)
      // 演示环境后端会回传验证码，直接告诉用户；真后端不会下发
      setSmsHint(
        res.demoCode
          ? `演示环境验证码：${res.demoCode}（5 分钟内有效）`
          : '验证码已发送，请查看短信',
      )
      toast.show(`验证码已发送至 ${phone}`, 'success')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '验证码发送失败')
    }
  }

  async function scanFace() {
    setScanning(true)
    setError(null)
    try {
      // 复用安全中心的身份核身接口
      const { ticket } = await api.verifyIdentity('face')
      setFaceTicket(ticket)
      toast.show('人脸核身通过', 'success')
    } catch {
      setError('人脸核身失败，请重试')
    } finally {
      setScanning(false)
    }
  }

  async function submit() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await api.openAccount({
        tier,
        kind,
        holderName: holderName.trim(),
        idNumber: idNumber.trim(),
        smsCode,
        bindingCardNo: needsBinding ? bindingCardNo : undefined,
        faceTicket,
        // 勾选即视为确认；未勾选就送空值，服务端会按「未确认承诺」拦下
        pledge: pledgeChecked ? PLEDGE_TEXT : '',
      })
      setResult(res)
      setStep(3)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '开户失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <header className="float-up">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">开立账户</h1>
        <p className="mt-2 text-[14px] text-ink-mute">
          线上可开立 Ⅱ 类户与 Ⅲ 类户；Ⅰ 类户需本人持身份证到柜台面签
        </p>
      </header>

      {/* 步骤条 */}
      <ol className="float-up flex items-center gap-3">
        {STEPS.map((s, index) => {
          const active = step === s.id
          const done = step > s.id
          return (
            <li key={s.id} className="flex flex-1 items-center gap-3">
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-chip text-[14px] font-semibold transition-colors',
                  active && 'bg-gold text-ink',
                  done && 'bg-gold-wash text-gold-deep',
                  !active && !done && 'bg-sunk text-ink-mute',
                )}
              >
                {done ? <CheckIcon size={16} /> : s.id}
              </span>
              <span className={cn('text-[14px]', active ? 'font-medium text-ink' : 'text-ink-mute')}>
                {s.label}
              </span>
              {index < STEPS.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>

      {/* —— 第一步：选账户 —— */}
      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Card className="float-up">
            <CardHeader title="选择账户类别" />
            {tiers.loading ? (
              <div className="mt-4 flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {CHOICES.map((choice) => {
                  const meta = tiers.data?.find((t) => t.tier === choice.tier)
                  const active = tier === choice.tier && kind === choice.kind
                  return (
                    <button
                      key={choice.title}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setTier(choice.tier)
                        setKind(choice.kind)
                        setResult(null)
                      }}
                      className={cn(
                        'rounded-field border p-4 text-left transition-colors',
                        active ? 'border-gold bg-gold-tint' : 'border-line hover:border-line-strong',
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={cn(
                            'min-w-0 flex-1 text-[15px] font-medium',
                            active ? 'text-gold-deep' : 'text-ink',
                          )}
                        >
                          {choice.title}
                        </span>
                        <span className="num shrink-0 text-[12px] text-ink-mute">
                          余额 {meta?.limits[0]?.value ?? '—'}
                        </span>
                        {active && <CheckIcon size={18} className="shrink-0 text-gold-deep" />}
                      </span>
                      <span className="mt-1.5 block text-[13px] text-ink-soft">{choice.blurb}</span>
                      {meta && (
                        <span className="mt-2.5 block text-[12px] leading-relaxed text-ink-mute">
                          {meta.limits.map((l) => `${l.label}：${l.value}`).join('；')}
                        </span>
                      )}
                    </button>
                  )
                })}

                {/* Ⅰ 类户：真实存在但不能线上开，明确说清为什么 */}
                {tiers.data
                  ?.filter((t) => !t.online)
                  .map((t) => (
                    <div
                      key={t.tier}
                      className="rounded-field border border-dashed border-line-strong bg-sunk p-4"
                    >
                      <span className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 text-[15px] font-medium text-ink-mute">
                          {t.name}
                        </span>
                        <Tag tone="neutral">需柜面办理</Tag>
                      </span>
                      <span className="mt-1.5 block text-[13px] text-ink-soft">{t.summary}</span>
                      <span className="mt-2.5 block text-[12px] leading-relaxed text-ink-mute">
                        {t.offlineReason}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          <Card className="float-up h-fit" style={{ animationDelay: '60ms' }}>
            <CardHeader title="这类账户能做什么" />
            {activeTier ? (
              <>
                <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">{activeTier.summary}</p>
                <dl className="mt-5 flex flex-col gap-3.5 border-t border-line pt-5 text-[13px]">
                  {activeTier.limits.map((l) => (
                    <div key={l.label}>
                      <dt className="text-ink-mute">{l.label}</dt>
                      <dd className="num mt-1 text-[14px] leading-relaxed font-medium text-ink">
                        {l.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 border-t border-line pt-5">
                  <p className="text-[12px] text-ink-mute">可以办理</p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-ink-soft">
                    {activeTier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <CheckIcon size={14} className="mt-1 shrink-0 text-blue" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {activeTier.limitations.length > 0 && (
                    <>
                      <p className="mt-4 text-[12px] text-ink-mute">办不了</p>
                      <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-ink-soft">
                        {activeTier.limitations.map((f) => (
                          <li key={f} className="flex items-start gap-2">
                            <span className="mt-2 size-1.5 shrink-0 rounded-chip bg-coral" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                <Button
                  variant="primary"
                  block
                  className="mt-6"
                  onClick={() => setStep(2)}
                  disabled={tiers.loading}
                >
                  下一步
                </Button>
              </>
            ) : (
              <Skeleton className="mt-4 h-40 w-full" />
            )}
          </Card>
        </div>
      )}

      {/* —— 第二步：身份验证 —— */}
      {step === 2 && (
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Card className="float-up">
            <CardHeader title="身份信息" />
            <p className="mt-3 text-[13px] leading-relaxed text-ink-mute">
              按账户实名制要求，开户需核验本人身份。信息仅用于开户核验。
            </p>

            <div className="mt-5 flex flex-col gap-4">
              <Field
                label="姓名"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                placeholder="与身份证一致"
                autoComplete="name"
              />
              <Field
                label="身份证号"
                value={idNumber}
                inputMode="numeric"
                onChange={(e) =>
                  setIdNumber(e.target.value.replace(/[^\dXx]/g, '').slice(0, 18))
                }
                placeholder="18 位身份证号"
                hint={`演示环境可用 ${DEMO_ID}`}
              />
              {user ? (
                <Field
                  label="手机号"
                  value={phone}
                  readOnly
                  hint="沿用登录手机号，如需更换请先在安全中心修改"
                />
              ) : (
                <Field
                  label="手机号"
                  value={phoneInput}
                  inputMode="numeric"
                  onChange={(e) => setPhoneInput(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="请输入本人手机号，用于接收验证码"
                  hint="开户后即用这个手机号登录"
                />
              )}

              {/* 短信验证码 */}
              <div className="flex items-end gap-2.5">
                <div className="min-w-0 flex-1">
                  <Field
                    label="短信验证码"
                    value={smsCode}
                    inputMode="numeric"
                    onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6 位验证码"
                    hint={smsHint ?? undefined}
                  />
                </div>
                <Button
                  className="h-14 shrink-0"
                  onClick={() => void sendCode()}
                  disabled={counting || !phone}
                >
                  {counting ? `${cooldown}s 后重发` : '获取验证码'}
                </Button>
              </div>

              {/* 人脸核身 */}
              <div className="rounded-field border border-line px-4 py-4">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-ink">人脸核身</span>
                    <span className="mt-0.5 block text-[12px] text-ink-mute">
                      {faceTicket
                        ? '已通过核身'
                        : '开户需完成一次活体检测，确认为本人操作'}
                    </span>
                  </span>
                  {faceTicket ? (
                    <Tag tone="blue">已通过</Tag>
                  ) : (
                    <Button
                      size="sm"
                      loading={scanning}
                      onClick={() => void scanFace()}
                    >
                      开始核身
                    </Button>
                  )}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-ink-mute">
                  演示环境为模拟核身（直接返回通过票据），真实环境会调起活体检测。
                </p>
              </div>

              {/* 绑定本人 Ⅰ 类户 */}
              {needsBinding && (
                <Field
                  label="绑定本人 Ⅰ 类户卡号"
                  value={bindingCardNo}
                  inputMode="numeric"
                  onChange={(e) => setBindingCardNo(formatBankAccount(e.target.value))}
                  placeholder="请输入你本人名下的Ⅰ类户银行卡号"
                  hint={
                    bindingCardNo
                      ? maskBankAccount(bindingCardNo)
                      : 'Ⅱ / Ⅲ 类户需绑定本人已开立的 Ⅰ 类户完成身份核验'
                  }
                />
              )}
            </div>
          </Card>

          <Card className="float-up h-fit" style={{ animationDelay: '60ms' }}>
            <CardHeader title="开户确认" />
            <dl className="mt-5 flex flex-col gap-4 text-[14px]">
              <Row label="账户类别" value={activeTier?.name ?? '—'} />
              <Row label="账户性质" value={kind === 'savings' ? '储蓄账户' : '活期账户'} />
              <Row label="开户人" value={holderName.trim() || '—'} />
              <Row label="绑定手机号" value={phone || '—'} />
              <Row label="初始余额" value="¥0.00" />
            </dl>

            {/* 承诺：85 号文要求醒目告知惩戒措施并由客户确认 */}
            <div className="mt-6 rounded-field border border-coral-wash bg-coral-wash/40 px-4 py-4">
              <p className="text-[12px] font-medium text-coral">账户合规使用提示</p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{PENALTY_TEXT}</p>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={pledgeChecked}
                onChange={(e) => setPledgeChecked(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-gold)]"
              />
              <span className="text-[12px] leading-relaxed text-ink-soft">{PLEDGE_TEXT}</span>
            </label>

            {error && (
              <p className="mt-4 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
                {error}
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <Button block onClick={() => setStep(1)} disabled={submitting}>
                返回修改
              </Button>
              <Button
                block
                variant="primary"
                loading={submitting}
                disabled={!pledgeChecked}
                onClick={() => void submit()}
              >
                提交开户
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* —— 第三步：完成 —— */}
      {step === 3 && result && (
        <Card className="float-up mx-auto w-full max-w-[560px]">
          <div className="text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-chip bg-blue-wash text-blue">
              <CheckIcon size={30} />
            </span>
            <h2 className="mt-5 text-[22px] font-bold tracking-[-0.01em] text-ink">开户成功</h2>
            <p className="mt-2 text-[14px] text-ink-soft">
              {result.tier} 类户已开立，可以立即转入资金使用
            </p>
          </div>

          <dl className="mt-7 flex flex-col gap-3.5 border-t border-line pt-6 text-[14px]">
            <Row label="账户名称" value={result.account.label} />
            <Row label="账号" value={maskAccountNo(result.account.accountNo)} />
            <Row label="币种" value="人民币" />
            <Row label="余额" value={`¥${formatAmount(result.account.balance)}`} />
            <Row label="开户时间" value={result.openedAt.slice(0, 19).replace('T', ' ')} />
          </dl>

          <div className="mt-5 rounded-field bg-sunk px-4 py-3.5">
            <p className="text-[12px] font-medium text-ink">这个账户的限额</p>
            <ul className="mt-2.5 flex flex-col gap-2 text-[12px] leading-relaxed text-ink-soft">
              {result.limits.map((l) => (
                <li key={l.label} className="flex justify-between gap-4">
                  <span className="min-w-0 flex-1">{l.label}</span>
                  <span className="num shrink-0 text-right text-ink">{l.value}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">
            账户是装钱的地方。如果要刷实体卡消费，还需要到「银行卡」里用这个账户申请一张卡。
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            {standalone ? (
              <>
                <Button block className="flex-1" onClick={() => navigate('/login')}>
                  返回登录
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => navigate('/login')}
                >
                  去登录
                </Button>
              </>
            ) : (
              <>
                <Link to="/" className="flex-1">
                  <Button block>返回总览</Button>
                </Link>
                <Link to="/cards" className="flex-1">
                  <Button block>去申请银行卡</Button>
                </Link>
                <Button variant="primary" className="flex-1" onClick={() => navigate('/')}>
                  去转入资金
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

      {!tiers.loading && !tiers.data?.length && (
        <Card>
          <EmptyState title="暂时无法开户" description="账户类别信息加载失败，请稍后重试。" />
        </Card>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="num text-right text-ink">{value}</dd>
    </div>
  )
}

/**
 * 登录前进入：独立整页。
 * 开户是「还没有账户的人」要做的事，而登录页是这类人唯一能到达的地方 ——
 * 所以它必须能在没有登录态的情况下跑通。
 */
export function OpenAccountStandalone() {
  return (
    <div className="min-h-svh bg-paper">
      <div className="mx-auto w-full max-w-[880px] px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Logo markClass="h-10 w-10" wordClass="text-[24px]" />
          <Link
            to="/login"
            className="inline-flex items-center gap-0.5 text-[13px] font-medium text-gold-deep transition-colors hover:text-ink"
          >
            已有账户？去登录
            <ChevronRightIcon size={15} />
          </Link>
        </div>
        <OpenAccountFlow standalone />
      </div>
    </div>
  )
}
