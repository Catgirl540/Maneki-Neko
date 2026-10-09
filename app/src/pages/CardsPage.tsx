import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '@/api'
import type { Account, BankCard, CardProduct, Cents } from '@/api/types'
import { BrandMark } from '@/components/brand/BrandMark'
import { CatMark } from '@/components/brand/Logo'
import {
  CardApplicationModal,
  type ApplicationMode,
} from '@/components/cards/CardApplicationModal'
import { CardSecretsModal } from '@/components/cards/CardSecretsModal'
import { useReveal } from '@/lib/useReveal'
import { RevealToggle } from '@/components/ui/Reveal'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, Skeleton, Tag } from '@/components/ui/Segmented'
import { Row, Toggle } from '@/components/ui/Toggle'
import { formatAddress } from '@/lib/address'
import { cn } from '@/lib/cn'
import { formatAmount } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'
import {
  AlertIcon,
  CreditCardPlusIcon,
  GlobalIcon,
  LockIcon,
  RefreshIcon,
  SlidersIcon,
  UnlockIcon,
} from '@/components/ui/icons'

const STATUS_META: Record<
  BankCard['status'],
  { label: string; tone: 'neutral' | 'gold' | 'blue' | 'coral' }
> = {
  active: { label: '使用中', tone: 'blue' },
  locked: { label: '已锁定', tone: 'coral' },
  pending: { label: '待激活', tone: 'gold' },
  replaced: { label: '已换卡', tone: 'neutral' },
}

const LIMIT_PRESETS: Cents[] = [200_000, 500_000, 1_000_000, 5_000_000]

export function CardsPage() {
  const toast = useToast()
  const { shown: balanceShown, toggle: toggleBalanceShown } = useReveal()
  const cards = useAsync<BankCard[]>(() => api.listCards(), [])
  const products = useAsync<CardProduct[]>(() => api.listCardProducts(), [])
  // 卡片要显示它绑的是哪个资金账户 —— 卡是支付工具，钱在账户里
  const accounts = useAsync<Account[]>(() => api.listAccounts(), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 正在查看安全码的卡；null 表示弹窗关闭 */
  const [secretsFor, setSecretsFor] = useState<BankCard | null>(null)
  /**
   * 已解锁的安全码，按卡记，**带时限**。
   * 放在页面而不是卡片组件里：解锁弹窗挂在页面上，而且切卡回来时这个状态不该丢。
   * 余额泄露是隐私，安全码泄露可以直接盗刷 —— 所以「眼睛一直开着」不等于安全码永久可读。
   */
  const [unlocked, setUnlocked] = useState<
    Record<string, { pan: string; cvv: string; expiresAt: number }>
  >({})
  /** 每秒推进一次，只用来让「安全码是否过期」在渲染期算得准 */
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 申卡 / 换卡共用同一个弹层；null 表示关闭。弹层只在打开时挂载，表单状态天然干净 */
  const [application, setApplication] = useState<{
    mode: ApplicationMode
    card?: BankCard
  } | null>(null)

  // 有解锁中的安全码时才走定时器；到点真把它们删掉，不是只遮住
  useEffect(() => {
    if (Object.keys(unlocked).length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setNowTick(now)
      setUnlocked((prev) => {
        const next = Object.fromEntries(
          Object.entries(prev).filter(([, e]) => now < e.expiresAt),
        )
        return Object.keys(next).length === Object.keys(prev).length ? prev : next
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [unlocked])

  /** 已解锁的卡号与安全码；过期即视为没解锁 */
  const unlockedFor = (id: string) => {
    const entry = unlocked[id]
    return entry && nowTick < entry.expiresAt ? entry : null
  }
  /**
   * 遮回安全码：把那个值**真清掉**，不是只把数字藏起来。
   *
   * 只清安全码、**不动完整卡号** —— 卡号归那只眼睛管，两者分开。
   * 顺手把卡号一起遮掉会让「点安全码隐藏」变成一个范围过大的操作。
   */
  const hideCardCvv = (id: string) => {
    setUnlocked((prev) => {
      const entry = prev[id]
      if (!entry || !entry.cvv) return prev
      return { ...prev, [id]: { ...entry, cvv: '' } }
    })
  }

  const unlockCard = (id: string, pan: string, cvv: string, ttlSeconds: number) => {
    setUnlocked((prev) => ({
      ...prev,
      [id]: { pan, cvv, expiresAt: Date.now() + ttlSeconds * 1000 },
    }))
    setNowTick(Date.now())
  }

  const list = cards.data ?? []
  const card = list.find((c) => c.id === selectedId) ?? list[0] ?? null

  /**
   * 乐观更新单张卡片：先改本地状态，接口返回后写回权威值，失败回滚。
   * 锁卡 / 支付开关 / 限额这类控件点一下就应当有反应，不能等一个来回。
   */
  async function applyCardChange(
    optimistic: (current: BankCard) => BankCard,
    call: () => Promise<BankCard>,
    successMessage?: string,
  ) {
    const snapshot = cards.data
    const current = card
    if (!snapshot || !current) return
    setBusy(true)
    setError(null)
    cards.setData(snapshot.map((c) => (c.id === current.id ? optimistic(c) : c)))
    try {
      const fresh = await call()
      cards.setData(snapshot.map((c) => (c.id === fresh.id ? fresh : c)))
      if (successMessage) toast.show(successMessage, 'success')
    } catch (err) {
      cards.setData(snapshot)
      const message = err instanceof ApiError ? err.message : '操作失败，请稍后重试'
      setError(message)
      toast.show(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <header className="float-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">
            银行卡
          </h1>
          <p className="mt-2 text-[14px] text-ink-mute">
            这里管理的是<strong className="font-medium text-ink-soft">卡</strong>
            （支付工具）；资金存在
            <Link to="/open-account" className="mx-0.5 font-medium text-gold-deep hover:text-ink">
              账户
            </Link>
            里，刷卡时从卡所绑定的账户扣款
          </p>
        </div>
        <Button
          variant="primary"
          icon={<CreditCardPlusIcon size={18} />}
          onClick={() => setApplication({ mode: 'open' })}
          disabled={busy || products.loading || products.data?.length === 0}
        >
          申请新卡
        </Button>
      </header>

      {cards.loading && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Skeleton className="h-60 rounded-card" />
          <Skeleton className="h-60 rounded-card" />
        </div>
      )}

      {!cards.loading && list.length === 0 && (
        <Card>
          <EmptyState
            title="还没有银行卡"
            description="卡是支付工具、账户才装钱 —— 先开立账户，再申请一张卡。"
            action={
              <Link to="/open-account">
                <Button>去开立账户</Button>
              </Link>
            }
          />
        </Card>
      )}

      {card && (
        <>
          {/* 卡片选择 */}
          <div className="float-up flex flex-wrap gap-2.5">
            {list.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  'inline-flex h-10 items-center gap-2 rounded-chip border px-4 text-[13px] transition-colors',
                  item.id === card.id
                    ? 'border-gold bg-gold-wash text-gold-deep'
                    : 'border-line text-ink-soft hover:border-line-strong',
                )}
              >
                尾号 {item.last4}
                <span className="text-ink-mute">·</span>
                {STATUS_META[item.status].label}
              </button>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            {/* 卡面 */}
            <div className="flex flex-col gap-5">
              <BankCardVisual
                // key 让切换卡片时重挂载：眼睛状态与已解锁的安全码不会串到另一张卡
                key={card.id}
                card={card}
                account={accounts.data?.find((a) => a.id === card.accountId) ?? null}
                pan={unlockedFor(card.id)?.pan ?? null}
                cvv={unlockedFor(card.id)?.cvv || null}
                onUnlockCvv={() => setSecretsFor(card)}
                onHideCvv={() => hideCardCvv(card.id)}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-line bg-sunk px-4 py-3 text-[13px]">
                <span className="text-ink-soft">此卡资金账户可用余额</span>
                <span className="flex items-center gap-2">
                  <strong className="num text-ink">{balanceShown
                    ? `¥${formatAmount(accounts.data?.find((a) => a.id === card.accountId)?.available ?? 0)}`
                    : '¥••••••'}</strong>
                  <RevealToggle shown={balanceShown} onToggle={toggleBalanceShown} />
                </span>
              </div>
              <Link to="/transfer" className="text-[13px] font-medium text-gold-deep hover:underline">
                在这些卡的账户间转账 →
              </Link>
              {error && (
                <p className="rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
                  {error}
                </p>
              )}
              <div className="flex gap-3">
                <Button
                  block
                  variant={card.status === 'locked' ? 'primary' : 'danger'}
                  loading={busy}
                  disabled={card.status === 'replaced' || card.status === 'pending'}
                  icon={card.status === 'locked' ? <UnlockIcon size={18} /> : <LockIcon size={18} />}
                  onClick={() => {
                    const locking = card.status !== 'locked'
                    void applyCardChange(
                      (c) => ({
                        ...c,
                        status: locking ? 'locked' : 'active',
                        ...(locking ? { onlinePayment: false, overseasPayment: false } : {}),
                      }),
                      () => api.setCardLock(card.id, locking),
                      locking ? '卡片已锁定，所有交易将被拦截' : '卡片已解锁',
                    )
                  }}
                >
                  {card.status === 'locked' ? '解锁卡片' : '立即锁卡'}
                </Button>
                <Button
                  block
                  icon={<RefreshIcon size={18} />}
                  disabled={busy || card.status === 'replaced'}
                  onClick={() => setApplication({ mode: 'replace', card })}
                >
                  换卡
                </Button>
              </div>
              <p className="flex items-start gap-2 text-[13px] text-ink-mute">
                <AlertIcon size={16} className="mt-0.5 shrink-0" />
                锁卡后所有线上与线下交易会被即时拦截，找回卡片后可随时解锁，无需换卡。
              </p>
            </div>

            {/* 设置 */}
            <Card className="float-up" style={{ animationDelay: '80ms' }}>
              <CardHeader
                title="交易设置"
                action={<Tag tone={STATUS_META[card.status].tone}>{STATUS_META[card.status].label}</Tag>}
              />

              <div className="mt-4 divide-y divide-line">
                <Row
                  icon={<SlidersIcon size={20} />}
                  title="线上支付"
                  description="网上购物、App 内支付"
                  right={
                    <Toggle
                      label="线上支付"
                      checked={card.onlinePayment}
                      disabled={busy || card.status !== 'active'}
                      onChange={(next) =>
                        void applyCardChange(
                          (c) => ({ ...c, onlinePayment: next }),
                          () => api.updateCardSettings(card.id, { onlinePayment: next }),
                          next ? '已开启线上支付' : '已关闭线上支付',
                        )
                      }
                    />
                  }
                />
                <Row
                  icon={<GlobalIcon size={20} />}
                  title="境外交易"
                  description="境外商户与外币结算"
                  right={
                    <Toggle
                      label="境外交易"
                      checked={card.overseasPayment}
                      disabled={busy || card.status !== 'active'}
                      onChange={(next) =>
                        void applyCardChange(
                          (c) => ({ ...c, overseasPayment: next }),
                          () => api.updateCardSettings(card.id, { overseasPayment: next }),
                          next ? '已开启境外交易' : '已关闭境外交易',
                        )
                      }
                    />
                  }
                />
                <div className="py-5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[15px] font-medium text-ink">单日限额</span>
                    <span className="num text-[15px] font-semibold text-ink">
                      ¥{formatAmount(card.dailyLimit)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {LIMIT_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={busy || card.status !== 'active'}
                        onClick={() =>
                          void applyCardChange(
                            (c) => ({ ...c, dailyLimit: preset }),
                            () => api.updateCardSettings(card.id, { dailyLimit: preset }),
                            `单日限额已调整为 ¥${formatAmount(preset)}`,
                          )
                        }
                        className={cn(
                          'h-9 rounded-chip border px-3.5 text-[13px] transition-colors disabled:opacity-50',
                          card.dailyLimit === preset
                            ? 'border-gold bg-gold-wash text-gold-deep'
                            : 'border-line text-ink-soft hover:border-gold hover:text-gold-deep',
                        )}
                      >
                        ¥{formatAmount(preset)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}

      {/* key 让每次换一张卡就重新挂载：上一位的密码与已取到的安全码不会留给下一位 */}
      {secretsFor && (
        <CardSecretsModal
          key={secretsFor.id}
          card={secretsFor}
          onClose={() => setSecretsFor(null)}
          onUnlocked={(pan, cvv, ttl) => unlockCard(secretsFor.id, pan, cvv, ttl)}
        />
      )}

      {application && (
        <CardApplicationModal
          mode={application.mode}
          card={application.card}
          products={products.data ?? []}
          onClose={() => setApplication(null)}
          onDone={(created) => {
            setSelectedId(created.id)
            setApplication(null)
            cards.reload()
            toast.show(
              created.issuingFee && created.shippingAddress
                ? `已支付 ¥${formatAmount(created.issuingFee)}，新卡将寄往 ${formatAddress(created.shippingAddress)}`
                : '新卡已提交申请',
              'success',
            )
          }}
        />
      )}

    </div>
  )
}

/** 卡面：纯色实心（无渐变），左上是品牌标，右下是卡号 */
function BankCardVisual({
  card,
  account,
  pan,
  cvv,
  onUnlockCvv,
  onHideCvv,
}: {
  card: BankCard
  account: Account | null
  /** 已解锁的完整卡号；null = 未解锁或已过期 */
  pan: string | null
  /** 已解锁的安全码；null = 未解锁或已过期 */
  cvv: string | null
  /** 请求解锁安全码：安全码要先验支付密码，不能跟着眼睛一起出 */
  onUnlockCvv: () => void
  /** 把已显示的安全码遮回去。**不需要认证** —— 验证是「看到」的门槛 */
  onHideCvv: () => void
}) {
  const dark = card.theme === 'ink'
  // 这张卡自己的眼睛：只管这张卡的卡号 / 有效期（安全码另需验密码，见下）
  const { shown, toggle } = useReveal()
  /**
   * 寄送中 / 已换发的卡取不到卡号与安全码，但按钮**不置灰** ——
   * 置灰的按钮点不动，服务端那句「卡还在寄送途中，收到并激活后才能查看」
   * 用户就永远看不到，只能对着一个灰按钮猜。让它可点，把原因说出来。
   */
  const cvvHint =
    card.status === 'pending'
      ? '卡还在寄送途中，收到并激活后才能查看'
      : card.status === 'replaced'
        ? '这张卡已换发，旧卡信息不再可用'
        : '验证支付密码后查看完整卡号与安全码'
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          'float-up flex aspect-[1.62/1] w-full max-w-[420px] flex-col justify-between rounded-card p-7',
          dark ? 'bg-ink text-ink-invert' : 'bg-gold text-ink',
          card.status === 'locked' && 'opacity-60',
        )}
      >
        <div className="flex items-start justify-between">
          <CatMark className="size-9" cutout={dark ? 'var(--color-ink)' : 'var(--color-gold)'} />
          <span className="flex items-center gap-2.5">
            <span className="text-[11px] tracking-[0.18em] uppercase opacity-80">
              {card.kind === 'debit' ? 'Debit' : 'Credit'}
            </span>
            <BrandMark network={card.network} tone={dark ? 'onDark' : 'onLight'} />
          </span>
        </div>

        <div>
          {/* 卡号默认连后四位一起遮住；眼睛在旁边，一键查看 / 隐藏 */}
          <div className="flex items-center gap-2">
            <p className="num text-[19px] tracking-[0.14em]">
              {!shown
                ? '•••• •••• •••• ••••'
                : pan
                  ? pan.replace(/(\d{4})(?=\d)/g, '$1 ')
                  : `•••• •••• •••• ${card.last4}`}
            </p>
            <RevealToggle
              shown={shown}
              onToggle={toggle}
              tone={dark ? 'onDark' : 'onLight'}
              className="size-6"
            />
          </div>
          <div className="mt-4 flex items-end justify-between gap-3 text-[12px] tracking-wide">
            <span className="truncate opacity-80">{card.cardholder}</span>
            <span className="flex shrink-0 items-end gap-4">
              <span className="flex flex-col items-end leading-tight">
                <span className="text-[9px] tracking-[0.16em] uppercase opacity-70">
                  Valid Thru
                </span>
                <span className="num opacity-80">{shown ? card.expiry : '••/••'}</span>
              </span>
              {/*
                安全码跟眼睛**不联动**：余额泄露是隐私，安全码泄露可以直接盗刷，
                所以它要先验一次支付密码，且解锁 60 秒后自动重新锁上。
              */}
              <span className="flex flex-col items-end leading-tight">
                <span className="text-[9px] tracking-[0.16em] uppercase opacity-70">CVV</span>
                {shown && cvv ? (
                  /*
                    露出来之后要能**再点一下遮回去**，而且**不需要再验一次密码**：
                    验证是「看到」的门槛，不是「不看」的门槛。只能等 60 秒自动遮，
                    在有人凑过来看屏幕的时候是来不及的 —— 那正是这个功能要解决的场景。
                  */
                  <button
                    type="button"
                    onClick={onHideCvv}
                    aria-label="隐藏安全码"
                    title="点击隐藏（无需验证）"
                    className="num tracking-[0.1em] underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100"
                  >
                    {cvv}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      // 一只眼管整张卡：点安全码就把卡面一起掀开，再验一次支付密码
                      if (!shown) toggle()
                      onUnlockCvv()
                    }}
                    aria-label="查看完整卡号与安全码"
                    title={cvvHint}
                    className="num tracking-[0.1em] underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100"
                  >
                    •••
                  </button>
                )}
              </span>
            </span>
          </div>
        </div>
      </div>
      <div>
        <p className="text-[13px] text-ink-soft">{card.productName}</p>
        <p className="num mt-1 text-[12px] text-ink-mute">
          {/* 资金账户号不遮：它是收款项，本来就该能直接读出来转给别人 */}
          {account
            ? `资金账户：${account.label} · ${account.accountNo}`
            : '资金账户：加载中…'}
        </p>
      </div>
      {card.status === 'pending' && card.shippingAddress && (
        <p className="text-[12px] leading-relaxed text-ink-mute">
          制卡中 · 将寄往 {card.shippingAddress.recipient} · {formatAddress(card.shippingAddress)}
        </p>
      )}
      {card.issuingFee ? (
        <p className="num text-[12px] text-ink-mute">
          已收制卡费用 ¥{formatAmount(card.issuingFee)}
        </p>
      ) : null}
    </div>
  )
}
