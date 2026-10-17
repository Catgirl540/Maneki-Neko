import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/api'
import type { Account, BankCard, CardProduct, Cents } from '@/api/types'
import { BrandMark } from '@/components/brand/BrandMark'
import { WorkbenchBrand } from '@/components/brand/WorkbenchBrand'
import {
  CardApplicationModal,
  type ApplicationMode,
} from '@/components/cards/CardApplicationModal'
import { CardSecretsModal } from '@/components/cards/CardSecretsModal'
import { useReveal } from '@/lib/useReveal'
import { RevealToggle } from '@/components/ui/Reveal'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Card } from '@/components/ui/Card'
import { EmptyState, Skeleton, Tag } from '@/components/ui/Segmented'
import { Row, Toggle } from '@/components/ui/Toggle'
import { formatAddress } from '@/lib/address'
import { CURRENCY_SYMBOL, formatAmount, formatCurrency } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'
import {
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

/** 按卡种统一卡面与卡堆配色，不随选中状态、锁卡状态改变。 */
function cardColorClass(card: BankCard) {
  if (card.productName.includes('星享')) return 'card-color-navy'
  if (card.network === 'unionpay') return 'card-color-jade'
  if (/全球|global/i.test(card.productName)) return 'card-color-violet'
  return card.theme === 'ink' ? 'card-color-navy' : 'card-color-violet'
}

export function CardsPage() {
  const toast = useToast()
  const { shown: balanceShown, toggle: toggleBalanceShown } = useReveal()
  const cards = useAsync<BankCard[]>(() => api.listCards(), [])
  const products = useAsync<CardProduct[]>(() => api.listCardProducts(), [])
  // 卡片要显示它绑的是哪个资金账户 —— 卡是支付工具，钱在账户里
  const accounts = useAsync<Account[]>(() => api.listAccounts(), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const walletRef = useRef<HTMLElement>(null)
  const previousCardRects = useRef(new Map<string, DOMRect>())
  const cardAnimations = useRef<Animation[]>([])
  /** 正在查看安全码的卡；null 表示弹窗关闭 */
  const [secretsFor, setSecretsFor] = useState<BankCard | null>(null)
  const [deliveryFor, setDeliveryFor] = useState<BankCard | null>(null)
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
  const linkedAccount = accounts.data?.find(account => account.id === card?.accountId)

  // 同一张卡在展示位和卡堆之间平移；不缩放、不弹跳，也不复制卡片安全信息。
  useLayoutEffect(() => {
    const previous = previousCardRects.current
    previousCardRects.current = new Map()
    if (!previous.size) return
    walletRef.current?.querySelector<HTMLElement>('.card-stack-front')?.focus({ preventScroll: true })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    walletRef.current?.querySelectorAll<HTMLElement>('[data-wallet-card]').forEach(element => {
      const from = previous.get(element.dataset.walletCard!)
      if (!from) return
      const to = element.getBoundingClientRect()
      const x = from.left - to.left
      const y = from.top - to.top
      if (!x && !y) return
      cardAnimations.current.push(element.animate([
        { transform: `translate(${x}px, ${y}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration: 340, easing: 'cubic-bezier(.22, 1, .36, 1)' }))
    })
  }, [card?.id])

  useEffect(() => () => cardAnimations.current.forEach(animation => animation.cancel()), [])

  function selectCard(id: string) {
    if (busy || id === card?.id) return
    const rects = new Map<string, DOMRect>()
    walletRef.current?.querySelectorAll<HTMLElement>('[data-wallet-card]').forEach(element => {
      rects.set(element.dataset.walletCard!, element.getBoundingClientRect())
    })
    cardAnimations.current.forEach(animation => animation.cancel())
    cardAnimations.current = []
    previousCardRects.current = rects
    setSelectedId(id)
  }

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

  const requests = [cards, products, accounts]
  const failed = requests.filter(state => state.error !== null && state.data === null)
  if (failed.length) return <DataUnavailable message={failed[0]!.error!} onRetry={() => failed.forEach(state => state.reload())} />
  if (requests.some(state => state.loading && state.data === null)) return <DataLoading />

  return (
    <div className="cards-page flex flex-col gap-5">
      <header className="float-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">
            银行卡
          </h1>
        </div>
        <Button
          variant="primary"
          size="sm"
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
          <EmptyState title="还没有银行卡" />
        </Card>
      )}

      {card && (
        <div className="cards-workspace">
          <section ref={walletRef} className="card-wallet" aria-label="我的银行卡">
            <div className="card-wallet-heading"><h2>当前卡片</h2><span>{list.length} 张</span></div>
            <div key={card.id} data-wallet-card={card.id} className="card-stack-front" tabIndex={-1} aria-label={`当前卡片：${card.productName}`}>
              <BankCardVisual card={card}
                pan={unlockedFor(card.id)?.pan ?? null} cvv={unlockedFor(card.id)?.cvv || null}
                onUnlockCvv={() => setSecretsFor(card)} onHideCvv={() => hideCardCvv(card.id)} />
            </div>
            {list.length > 1 && <div className="card-wallet-pile">
              <div className="card-wallet-heading"><h2>其他银行卡</h2><span>{list.length - 1} 张</span></div>
              <div className="card-stack" style={{ paddingBottom: Math.max(0, list.length - 2) * 64 }}>
                {list.filter(item => item.id !== card.id).map((item, index) => (
                  <button key={item.id} data-wallet-card={item.id} type="button"
                    aria-label={`${item.productName} 尾号 ${item.last4} · ${STATUS_META[item.status].label}`}
                    disabled={busy} onClick={() => selectCard(item.id)}
                    style={{ top: index * 64, zIndex: index + 1 }}
                    className={`card-stack-back ${cardColorClass(item)}`}>
                    <strong title={item.productName}>{item.productName}</strong>
                    <small>尾号 {item.last4} · {STATUS_META[item.status].label}</small>
                    <span className="card-stack-brand"><WorkbenchBrand compact /><BrandMark network={item.network} tone="onDark" /></span>
                  </button>
                ))}
              </div>
            </div>}
          </section>

          <section className="card-management" aria-label="当前卡片管理">
            <header className="card-management-heading">
              <h2>{card.productName}</h2>
              <Tag tone={STATUS_META[card.status].tone}>{STATUS_META[card.status].label}</Tag>
            </header>
            <div className="card-overview">
              <div className="card-account-details">
                <dl>
                  <div><dt>资金账户</dt><dd>{linkedAccount?.label ?? '—'}<small>{linkedAccount ? `尾号 ${linkedAccount.accountNo.slice(-4)} · ${linkedAccount.currency}` : ''}</small></dd></div>
                  <div><dt>可用余额</dt><dd className="card-available-balance"><strong className="num">{linkedAccount
                    ? balanceShown ? formatCurrency(linkedAccount.available, linkedAccount.currency) : `${CURRENCY_SYMBOL[linkedAccount.currency]}••••••`
                    : '—'}</strong><RevealToggle shown={balanceShown} onToggle={toggleBalanceShown} /></dd></div>
                </dl>
                <div className="card-management-actions">
                  <Button size="sm" variant={card.status === 'locked' ? 'primary' : 'secondary'} loading={busy}
                    disabled={card.status === 'replaced' || card.status === 'pending'}
                    icon={card.status === 'locked' ? <UnlockIcon size={16} /> : <LockIcon size={16} />}
                    onClick={() => {
                      const locking = card.status !== 'locked'
                      void applyCardChange(c => ({ ...c, status: locking ? 'locked' : 'active',
                        ...(locking ? { onlinePayment: false, overseasPayment: false } : {}),
                      }), () => api.setCardLock(card.id, locking), locking ? '卡片已锁定，所有交易将被拦截' : '卡片已解锁')
                    }}>{card.status === 'locked' ? '解锁卡片' : '立即锁卡'}</Button>
                  <Button size="sm" icon={<RefreshIcon size={16} />} disabled={busy || card.status === 'replaced'}
                    onClick={() => setApplication({ mode: 'replace', card })}>换卡</Button>
                  {(card.shippingAddress || card.issuingFee) && <Button size="sm" variant="ghost" onClick={() => setDeliveryFor(card)}>寄送信息</Button>}
                </div>
              </div>
            </div>
            {error && <p role="alert" className="rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">{error}</p>}

            <section className="card-payment-settings" aria-label="交易设置">
              <h3>交易设置</h3>
              <div className="card-settings-grid">
                <div className="card-payment-switches">
                  <Row icon={<SlidersIcon size={19} />} title="线上支付" description="网上购物、App 内支付"
                    right={<Toggle label="线上支付" checked={card.onlinePayment} disabled={busy || card.status !== 'active'}
                      onChange={next => void applyCardChange(c => ({ ...c, onlinePayment: next }),
                        () => api.updateCardSettings(card.id, { onlinePayment: next }), next ? '已开启线上支付' : '已关闭线上支付')} />} />
                  <Row icon={<GlobalIcon size={19} />} title="境外交易" description="境外商户与外币结算"
                    right={<Toggle label="境外交易" checked={card.overseasPayment} disabled={busy || card.status !== 'active'}
                      onChange={next => void applyCardChange(c => ({ ...c, overseasPayment: next }),
                        () => api.updateCardSettings(card.id, { overseasPayment: next }), next ? '已开启境外交易' : '已关闭境外交易')} />} />
                </div>
                <div className="card-daily-limit">
                  <span>单日限额</span><strong className="num">¥{formatAmount(card.dailyLimit)}</strong>
                  <div role="group" aria-label="单日限额">
                    {LIMIT_PRESETS.map(preset => <button key={preset} type="button" disabled={busy || card.status !== 'active'}
                      aria-pressed={card.dailyLimit === preset}
                      onClick={() => void applyCardChange(c => ({ ...c, dailyLimit: preset }),
                        () => api.updateCardSettings(card.id, { dailyLimit: preset }), `单日限额已调整为 ¥${formatAmount(preset)}`)}>
                      ¥{formatAmount(preset)}
                    </button>)}
                  </div>
                </div>
              </div>
            </section>
          </section>
        </div>
      )}

      <Modal open={deliveryFor !== null} onClose={() => setDeliveryFor(null)} title="寄送信息">
        {deliveryFor && <dl className="space-y-5 text-[14px]">
          <div><dt className="text-[12px] text-ink-mute">银行卡</dt><dd className="mt-1">{deliveryFor.productName} · 尾号 {deliveryFor.last4}</dd></div>
          {deliveryFor.shippingAddress && <>
            <div><dt className="text-[12px] text-ink-mute">收件人</dt><dd className="mt-1">{deliveryFor.shippingAddress.recipient}</dd></div>
            <div><dt className="text-[12px] text-ink-mute">寄送地址</dt><dd className="mt-1">{formatAddress(deliveryFor.shippingAddress)}</dd></div>
          </>}
          {deliveryFor.issuingFee ? <div><dt className="text-[12px] text-ink-mute">已收制卡费用</dt><dd className="num mt-1">¥{formatAmount(deliveryFor.issuingFee)}</dd></div> : null}
        </dl>}
      </Modal>

      {/* 切卡时重挂载安全信息弹窗，不沿用上一张卡的验证状态。 */}
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
  pan,
  cvv,
  onUnlockCvv,
  onHideCvv,
}: {
  card: BankCard
  /** 已解锁的完整卡号；null = 未解锁或已过期 */
  pan: string | null
  /** 已解锁的安全码；null = 未解锁或已过期 */
  cvv: string | null
  /** 请求解锁安全码：安全码要先验支付密码，不能跟着眼睛一起出 */
  onUnlockCvv: () => void
  /** 把已显示的安全码遮回去。**不需要认证** —— 验证是「看到」的门槛 */
  onHideCvv: () => void
}) {
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
        className={`bank-card-face flex aspect-[1.62/1] w-full flex-col justify-between rounded-card p-5 ${cardColorClass(card)}`}
      >
        <div className="card-face-heading">
          <WorkbenchBrand compact />
          <span className="card-face-name"><strong title={card.productName}>{card.productName}</strong><small>尾号 {card.last4} · {STATUS_META[card.status].label}</small></span>
          <BrandMark network={card.network} tone="onDark" />
        </div>

        <div>
          {/* 卡号默认连后四位一起遮住；眼睛在旁边，一键查看 / 隐藏 */}
          <div className="flex items-center gap-2">
            <p data-card-number className="num text-[18px] tracking-[0.08em]">
              {!shown
                ? '•••• •••• •••• ••••'
                : pan
                  ? pan.replace(/(\d{4})(?=\d)/g, '$1 ')
                  : `•••• •••• •••• ${card.last4}`}
            </p>
            <RevealToggle
              shown={shown}
              onToggle={toggle}
              tone="onDark"
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

    </div>
  )
}
