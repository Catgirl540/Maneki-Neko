import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '@/api'
import type {
  Account,
  Bank,
  BankRegion,
  CardBinResolution,
  Cents,
  Currency,
  FpsMethod,
  FpsResolveResult,
  Payee,
  TransferChannel,
  TransferQuote,
  TransferRecipientResult,
  TransferResult,
  TransactionRecord,
  TransferScope,
  User,
} from '@/api/types'
import { BankPicker } from '@/components/ui/BankPicker'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/Segmented'
import { AlertIcon, CheckIcon, UsersIcon } from '@/components/ui/icons'
import {
  FPS_CURRENCIES,
  FPS_METHOD_LABEL,
  FPS_METHOD_PLACEHOLDER,
  CARD_BIN_LENGTH,
  digitsOnly,
  formatBankAccount,
  formatFpsValue,
  maskBankAccount,
  maskFpsValue,
  validateBankAccount,
  validateFpsValue,
} from '@/lib/account'
import { cn } from '@/lib/cn'
import {
  CURRENCY_LABEL,
  CURRENCY_SYMBOL,
  formatCurrency,
  formatDate,
  formatRate,
} from '@/lib/format'
import { currencyBalances } from '@/lib/currencyBalances'
import { parseAmountInput } from '@/lib/amountInput'
import { RevealToggle } from '@/components/ui/Reveal'
import { useToast } from '@/components/ui/toast-context'
import { useReveal } from '@/lib/useReveal'
import { useAsync } from '@/lib/useAsync'
import { usePendingTransaction } from '@/lib/usePendingTransaction'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { PaymentPlans } from '@/components/account/PaymentPlans'
import { searchPayees } from '../../../shared/payee-search.mjs'

const TRANSFER_TABS = [
  { value: 'instant', label: '即时转账' },
  { value: 'scheduled', label: '定时转账' },
  { value: 'split', label: 'AA 收款' },
  { value: 'payable', label: 'AA 付款' },
] as const
type TransferTab = typeof TRANSFER_TABS[number]['value']

/** 独立任务页复用已有转账引擎，报价、核验与支付确认保持一致。 */
export function TransferPage() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<TransferTab>('instant')
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  return <div className="page-stack transfer-task-page">
    <PageHeader title="转账与支付" actions={<>
      <Link to="/spend" className="service-link">模拟消费</Link>
      <Link to="/accounts?flow=in" className="service-link">收款与转入</Link>
    </>} />
    <Card className="transfer-task-panel">
      <div className="mb-6 border-b border-line">
        <div role="tablist" aria-label="转账服务" className="flex flex-wrap gap-x-7 gap-y-1">
          {TRANSFER_TABS.map((item, index) => (
            <button
              key={item.value}
              ref={(element) => { tabRefs.current[index] = element }}
              type="button"
              role="tab"
              id={`transfer-tab-${item.value}`}
              aria-controls={`transfer-panel-${item.value}`}
              aria-selected={tab === item.value}
              tabIndex={tab === item.value ? 0 : -1}
              disabled={busy}
              onClick={() => setTab(item.value)}
              onKeyDown={(event) => {
                if (busy) return
                const next = event.key === 'ArrowRight' ? (index + 1) % TRANSFER_TABS.length
                  : event.key === 'ArrowLeft' ? (index + TRANSFER_TABS.length - 1) % TRANSFER_TABS.length
                    : event.key === 'Home' ? 0 : event.key === 'End' ? TRANSFER_TABS.length - 1 : -1
                if (next < 0) return
                event.preventDefault()
                setTab(TRANSFER_TABS[next].value)
                tabRefs.current[next]?.focus()
              }}
              className={cn(
                'border-b-2 px-0.5 pb-3 text-[14px] font-medium transition-colors disabled:cursor-wait disabled:opacity-60',
                tab === item.value ? 'border-gold text-gold-deep' : 'border-transparent text-ink-soft hover:text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div id="transfer-panel-instant" role="tabpanel" aria-labelledby="transfer-tab-instant" hidden={tab !== 'instant'}>
        <TransferForm onClose={() => navigate('/accounts')} onUpdate={() => window.dispatchEvent(new Event('luckycat:bank-updated'))} onBusyChange={setBusy} />
      </div>
      <div id="transfer-panel-scheduled" role="tabpanel" aria-labelledby="transfer-tab-scheduled" hidden={tab !== 'scheduled'}>
        {tab === 'scheduled' && <div className="mx-auto w-full max-w-[860px]"><PaymentPlans tab="scheduled" onBusyChange={setBusy} /></div>}
      </div>
      <div id="transfer-panel-split" role="tabpanel" aria-labelledby="transfer-tab-split" hidden={tab !== 'split'}>
        {tab === 'split' && <div className="mx-auto w-full max-w-[860px]"><PaymentPlans tab="split" onBusyChange={setBusy} /></div>}
      </div>
      <div id="transfer-panel-payable" role="tabpanel" aria-labelledby="transfer-tab-payable" hidden={tab !== 'payable'}>
        {tab === 'payable' && <div className="mx-auto w-full max-w-[860px]"><PaymentPlans tab="payable" onBusyChange={setBusy} /></div>}
      </div>
    </Card>
    {busy && <p role="status" className="text-[13px] text-ink-soft">正在处理，请稍候…</p>}
  </div>
}

type Step = 1 | 2 | 3 | 4

const STEPS = [
  { id: 1, label: '付款' },
  { id: 2, label: '收款' },
  { id: 3, label: '确认' },
  { id: 4, label: '完成' },
] as const

const FPS_METHODS: { value: FpsMethod; label: string }[] = [
  { value: 'account', label: '收款账户' },
  { value: 'mobile', label: '手机号' },
  { value: 'email', label: '电邮' },
  { value: 'fpsid', label: 'FPS ID' },
]

/** 银行账户通道的到账币种：同一资金账户下的三种记账分区 */
const PAYEE_CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'CNY', label: '人民币' },
  { value: 'USD', label: '美元' },
  { value: 'HKD', label: '港币' },
]

export function TransferForm({ onClose, onUpdate, onBusyChange }: {
  onClose: () => void
  onUpdate: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const toast = useToast()
  // 这一块余额自己一只眼睛，不跟别处联动
  const { shown, toggle: toggleShown } = useReveal()
  const [step, setStep] = useState<Step>(1)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => { content.current?.closest('[role=dialog]')?.scrollTo({ top: 0 }) }, [step])
  const [channel, setChannel] = useState<TransferChannel>('bank')
  const [scope, setScope] = useState<TransferScope>('domestic')

  /**
   * 收款银行：**按市场各记一份**（内地 / 香港）。
   * 市场本身由转账方向推导（见 activeBankRegion），所以不需要「切换时清空重选」——
   * 境内↔境外、银行通道↔转数快，只是换一个槽位。搜索词同理各记一份。
   */
  const [bankSelection, setBankSelection] = useState<Record<BankRegion, string>>({
    CN: 'LCB',
    HK: '012',
  })
  // 银行账户通道
  const [accountNo, setAccountNo] = useState('')
  const [payeeName, setPayeeName] = useState('')

  // 转数快 / 跨境支付通通道
  const [fpsMethod, setFpsMethod] = useState<FpsMethod>('account')
  const [fpsValue, setFpsValue] = useState('')
  const [fpsCurrency, setFpsCurrency] = useState<Currency>('HKD')
  const [fpsAddress, setFpsAddress] = useState('')
  const [resolved, setResolved] = useState<FpsResolveResult | null>(null)
  const [resolving, setResolving] = useState(false)
  const [checkingRecipient, setCheckingRecipient] = useState(false)
  const [recipientCheck, setRecipientCheck] = useState<TransferRecipientResult | null>(null)

  const [amountText, setAmountText] = useState('')
  const [receiveText, setReceiveText] = useState('')
  const [amountSide, setAmountSide] = useState<'pay' | 'receive'>('pay')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /** 支付密码只用于本次提交，返回修改或转账成功后立即清空 */
  const [paymentPassword, setPaymentPassword] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState<TransferResult | null>(null)
  const [resultRecord, setResultRecord] = useState<TransactionRecord | null>(null)
  const resultStatus = resultRecord?.status ?? result?.settlementStatus ?? 'success'
  const resultPendingReason = resultRecord ? resultRecord.pendingReason : result?.pendingReason
  /** 在途倒计时用的本地时钟；只有 result 在途时才跳（§9） */
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [recalling, setRecalling] = useState(false)
  const [quoteState, setQuoteState] = useState<{ key: string; quote: TransferQuote | null } | null>(null)
  const [reverseQuote, setReverseQuote] = useState<{ key: string; amount: Cents | null; expiresAt: number } | null>(null)
  /** 换汇报价过期后自增，触发重新询价 */
  const [quoteNonce, setQuoteNonce] = useState(0)
  /** 收到报价的**本地**时刻：锁价从这里起算，避免客户端与服务端的时钟偏差 */
  const [quoteReceivedAt, setQuoteReceivedAt] = useState(0)
  /** 每秒推进一次的「现在」，只用来渲染倒计时 */
  const [nowTick, setNowTick] = useState(0)
  /**
   * 卡 BIN 反查结果，连同「这次结果是按哪个前缀查的」一起存。
   * 存前缀是为了让结果**自己失效**：用户改了前 6 位，这个结果就不再对应，
   * 渲染期直接判定为无效 —— 不需要再用一个 effect 去 setState 清空它。
   */
  const [binProbe, setBinProbe] = useState<{
    key: string
    result: CardBinResolution
  } | null>(null)

  const accounts = useAsync<Account[]>(() => api.listAccounts(), [])
  const profile = useAsync<User>(() => api.profile(), [])
  const banks = useAsync<Bank[]>(() => api.listBanks(), [])
  const payees = useAsync<Payee[]>(() => api.listPayees(), [])

  // 付款分区：同一资金账户下的币种余额；默认人民币，没有就第一个
  const balances = useMemo(() => currencyBalances(accounts.data ?? []), [accounts.data])
  const [fromBalanceId, setFromBalanceId] = useState('')
  const account =
    balances.find((row) => row.id === fromBalanceId) ??
    balances.find((row) => row.currency === 'CNY') ??
    balances[0] ??
    null
  const payCurrency: Currency = account?.currency ?? 'CNY'
  const [destCurrency, setDestCurrency] = useState<Currency>('CNY')
  const isFps = channel === 'fps'

  /** 转数快走香港通道 */
  const effectiveScope: TransferScope = isFps ? 'overseas' : scope
  /**
   * 收款银行的市场由转账方向决定，不让用户自由切：
   * 转数快是香港清算网络、境外汇款收款行在香港，境内转账则是内地银行。
   * 让用户能切反而会切出「境内转账选一家香港银行」这种矛盾状态。
   */
  const activeBankRegion: BankRegion = effectiveScope === 'overseas' ? 'HK' : 'CN'
  const activeBankCode = bankSelection[activeBankRegion]
  /**
   * 收款行的最新值，只给卡 BIN 的异步回调比对用。
   * 直接读 activeBankCode 会把它拖进 effect 的依赖里，于是「识别出银行 → 切银行 →
   * 依赖变了 → 再查一次」，白白多打一次请求。
   */
  const bankCodeRef = useRef(activeBankCode)
  useEffect(() => {
    bankCodeRef.current = activeBankCode
  }, [activeBankCode])
  const isFpsAccount = isFps && fpsMethod === 'account'

  /** 转数快用自己的收款币种选择；银行账户通道用到账币种（默认＝付款币种） */
  const quoteCurrency: Currency = isFps ? fpsCurrency : destCurrency
  const fromAccountId = account?.id ?? ''
  const receiveAmount = parseAmountInput(receiveText)
  const reverseKey = JSON.stringify([fromAccountId, channel, effectiveScope, activeBankCode, activeBankRegion, payCurrency, quoteCurrency, receiveAmount, quoteNonce])
  const needsReverse = amountSide === 'receive' && quoteCurrency !== payCurrency && (receiveAmount ?? 0) > 0

  // 用付款方向的报价反算，不能拿反向汇率代替（两者点差不同）。
  useEffect(() => {
    if (!needsReverse || !fromAccountId || receiveAmount === null) return
    let cancelled = false
    const timer = setTimeout(() => {
      api.quoteTransfer({
        fromAccountId,
        channel,
        scope: effectiveScope,
        amount: 10000,
        bankCode: activeBankCode,
        bankRegion: activeBankRegion,
        payeeCurrency: quoteCurrency,
      }).then((q) => {
        if (cancelled) return
        const rate = q.fx?.rate
        if (!rate || !Number.isFinite(rate) || rate <= 0) {
          setReverseQuote({ key: reverseKey, amount: null, expiresAt: Infinity })
          return
        }
        const closest = Math.max(1, Math.round(receiveAmount / rate))
        if (!Number.isSafeInteger(closest)) {
          setReverseQuote({ key: reverseKey, amount: null, expiresAt: Infinity })
          return
        }
        const candidates = [closest, closest - 1, closest + 1].filter((value) => value > 0 && Number.isSafeInteger(value))
        const calculated = candidates.reduce((best, value) =>
          Math.abs(Math.round(value * rate) - receiveAmount) < Math.abs(Math.round(best * rate) - receiveAmount) ? value : best,
        closest)
        setReverseQuote({ key: reverseKey, amount: calculated, expiresAt: Date.now() + q.fx!.quoteTtlSeconds * 1000 })
      }).catch(() => {
        if (!cancelled) setReverseQuote({ key: reverseKey, amount: null, expiresAt: Infinity })
      })
    }, 220)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [needsReverse, fromAccountId, channel, effectiveScope, activeBankCode, activeBankRegion, quoteCurrency, receiveAmount, reverseKey])

  const reverseReady = !needsReverse || (reverseQuote?.key === reverseKey && nowTick < reverseQuote.expiresAt)
  useEffect(() => {
    if (!needsReverse || reverseQuote?.key !== reverseKey || !Number.isFinite(reverseQuote.expiresAt)) return
    const timer = setTimeout(() => {
      setNowTick(Date.now())
      setQuoteNonce((n) => n + 1)
    }, Math.max(0, reverseQuote.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [needsReverse, reverseKey, reverseQuote])
  const parsedAmount = amountSide === 'pay'
    ? parseAmountInput(amountText)
    : needsReverse
      ? (reverseReady ? reverseQuote?.amount ?? null : null)
      : receiveAmount
  const amount: Cents = parsedAmount ?? 0
  const paymentInput = amountSide === 'pay' ? amountText
    : parsedAmount === null ? '' : `${Math.floor(parsedAmount / 100)}.${String(parsedAmount % 100).padStart(2, '0')}`
  const quoteKey = JSON.stringify([fromAccountId, channel, effectiveScope, amount, activeBankCode, activeBankRegion, quoteCurrency, quoteNonce])

  /* 报价：账户 / 通道 / 金额 / 币种 / 银行变化时向后端询价。
     quoteNonce 由「换汇锁价过期」推进 —— 过期必须重新询价，不能拿旧汇率成交。 */
  useEffect(() => {
    if (amount <= 0 || !fromAccountId) return
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .quoteTransfer({
          fromAccountId,
          channel,
          scope: effectiveScope,
          amount,
          bankCode: activeBankCode,
          bankRegion: activeBankRegion,
          payeeCurrency: quoteCurrency,
        })
        .then((q) => {
          if (cancelled) return
          setQuoteState({ key: quoteKey, quote: q })
          // 两个都在这一个回调里落定，倒计时首帧就是准的，不会闪一下
          setQuoteReceivedAt(Date.now())
          setNowTick(Date.now())
        })
        .catch(() => {
          if (!cancelled) setQuoteState({ key: quoteKey, quote: null })
        })
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    fromAccountId,
    channel,
    effectiveScope,
    amount,
    activeBankCode,
    activeBankRegion,
    quoteCurrency,
    quoteNonce,
    quoteKey,
  ])

  // 任何询价参数变化时，旧报价立即失效，不展示旧的到账金额。
  const matchedQuote = amount > 0 && quoteState?.key === quoteKey ? quoteState.quote : null
  const quote = matchedQuote?.fx && nowTick >= quoteReceivedAt + matchedQuote.fx.quoteTtlSeconds * 1000
    ? null : matchedQuote
  const fx = quote?.fx ?? null
  const quoteFailed = amount > 0 && quoteState?.key === quoteKey &&
    (!quoteState.quote || (quoteCurrency !== payCurrency && !quoteState.quote.fx))
  const receiveInput = amountSide === 'receive' ? receiveText
    : amount <= 0 ? ''
      : quoteCurrency === payCurrency ? amountText
        : fx ? `${Math.floor(fx.toAmount / 100)}.${String(fx.toAmount % 100).padStart(2, '0')}` : ''

  /* 倒计时在渲染期推导，不在 effect 里同步 setState */
  const quoteSecondsLeft =
    fx && quoteReceivedAt > 0
      ? Math.max(0, Math.ceil((quoteReceivedAt + fx.quoteTtlSeconds * 1000 - nowTick) / 1000))
      : 0

  /**
   * 换汇锁价倒计时 + 到期自动重新询价。
   * 汇率是时效性数据：过期必须重新询价，不能让用户拿旧汇率成交。
   * setState 只出现在 setInterval 回调里，effect 体内不做同步更新。
   */
  useEffect(() => {
    if (!fx || quoteReceivedAt <= 0) return
    const deadline = quoteReceivedAt + fx.quoteTtlSeconds * 1000
    let renewed = false
    const timer = setInterval(() => {
      setNowTick(Date.now())
      if (renewed || Date.now() < deadline) return
      renewed = true
      setQuoteNonce((n) => n + 1)
      toast.show('换汇报价已过期，已按最新汇率重新询价，请核对到账金额', 'info')
    }, 1000)
    return () => clearInterval(timer)
  }, [fx, quoteReceivedAt, toast])

  const selectedBank = useMemo(
    // 3 位清算代码两地会撞号，所以必须成对查
    () => banks.data?.find((b) => b.code === activeBankCode && b.region === activeBankRegion) ?? null,
    [banks.data, activeBankCode, activeBankRegion],
  )

  /** 历史收款人：按 lastUsedAt 排序，按当前通道过滤取前 4 */
  const quickPayees = useMemo(
    () => (payees.data ?? []).filter((p) => p.channel === channel).slice(0, 4),
    [payees.data, channel],
  )
  /** 「全部」弹层里的完整列表：同一通道、不截断 */
  const [payeeKeyword, setPayeeKeyword] = useState('')
  const [editingPayee, setEditingPayee] = useState<{ id: string; remark: string } | null>(null)
  const channelPayees = useMemo(
    () => searchPayees(payees.data ?? [], payeeKeyword).filter((p) => p.channel === channel),
    [payees.data, channel, payeeKeyword],
  )
  const [payeesOpen, setPayeesOpen] = useState(false)
  const [deletingPayeeId, setDeletingPayeeId] = useState<string | null>(null)

  const fee = quote?.fee ?? 0
  const total = amount + fee
  const remaining = account ? account.available - total : 0

  const etaText =
    quote?.etaText ??
    (isFps
      ? '预计 5 秒内到账'
      : scope === 'overseas'
        ? '预计 1 个工作日到账'
        : activeBankCode === 'LCB'
          ? '实时到账'
          : '预计 2 小时内到账')

  /**
   * 位数还不到 BIN 长度时不算错：「6222」「622202」都是半截号段。
   * 尤其是选定收款行后**自动补全的那 6 位** —— 那是功能给的，不该一上来就标红。
   */
  const accountDigits = digitsOnly(accountNo)
  const accountError =
    accountNo && accountDigits.length > CARD_BIN_LENGTH ? validateBankAccount(accountNo) : null
  const fpsValueError = fpsValue ? validateFpsValue(fpsMethod, fpsValue) : null
  const insufficient = account !== null && amount > 0 && total > account.available
  const overLimit = quote !== null && amount > quote.singleLimit

  /* ---------------------------------------------------------- 卡 BIN 识别 */
  /**
   * 只有「银行账户」通道输的才是卡号；转数快那侧收的是手机号 / 电邮 / FPS ID。
   * 香港方向的收款账号是**银行账户号**，本身不含机构标识，没有 BIN 可查 ——
   * 这正是香港转账必须手选收款行的原因。
   */
  const binKey = isFps ? '' : accountDigits.slice(0, CARD_BIN_LENGTH)
  /** 结果只在仍对应当前输入时才算数 */
  const binHit = binProbe && binProbe.key === binKey ? binProbe.result : null
  /** 「已凑满 6 位但还没有结果」＝ 正在查。不用额外的 loading state */
  const binChecking = binKey.length === CARD_BIN_LENGTH && binHit === null
  /** 前缀不属于任何已收录银行 —— 这才是用户说的「不支持该银行」 */
  const binUnsupported = binHit?.status === 'unsupported'

  /**
   * 输满 6 位就把发卡行查出来。防抖 + cancelled：卡号是一位一位敲的，
   * 不防抖会打一串无用请求；不取消则可能让先发的慢响应盖掉后发的快响应。
   */
  useEffect(() => {
    if (binKey.length !== CARD_BIN_LENGTH) return
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .resolveCardBin({ digits: accountDigits, region: activeBankRegion })
        .then((result) => {
          if (cancelled) return
          setBinProbe({ key: binKey, result })
          // 以卡号为准把收款行切过去。比对用 ref，避免把 activeBankCode 放进 deps
          // 导致「切完银行又多发一次查询」
          if (result.status === 'matched' && result.bank.code !== bankCodeRef.current) {
            setBankSelection((prev) => ({ ...prev, [activeBankRegion]: result.bank.code }))
            toast.show(
              `已按卡号前 ${CARD_BIN_LENGTH} 位把收款银行识别为${result.bank.name}`,
              'info',
            )
          }
        })
        .catch(() => {
          /* 查询失败就保持「识别中」，不编一个结果出来 */
        })
    }, 320)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [binKey, accountDigits, activeBankRegion, toast])

  /** 摘要 / 回执展示的收款标识 */
  const identifier = isFps
    ? fpsValue
      ? maskFpsValue(fpsMethod, fpsValue)
      : '—'
    : accountNo
      ? maskBankAccount(accountNo)
      : '—'

  /**
   * 收款账户下方的提示：识别状态优先，其次才是常规回显。
   * 本行（招财猫银行）有自己的账号前缀（8820…），走的是同一条识别路径，不再单独开分支 ——
   * 单独开分支的后果是「选中本行时没有前缀可补」，从别家切过来会留着别家的号段。
   */
  const accountHint = !isFps
    ? activeBankRegion === 'HK'
        ? '香港的银行账户号不含发卡行信息，请在上方手动选择收款银行'
        : binChecking
          ? `正在识别发卡行（号段 ${binKey}）…`
          : binHit?.status === 'matched'
            ? `已识别发卡行：${binHit.bank.name}（号段 ${binHit.bin}）`
            : binUnsupported
              ? `号段 ${binKey} 未收录，仅支持内地 19 家银行的借记卡`
              : accountNo && !accountError
                ? `${selectedBank?.name ?? ''} · ${maskBankAccount(accountNo)}`
                : `输入卡号前 ${CARD_BIN_LENGTH} 位，自动识别发卡行`
    : undefined

  /** 卡号前缀不属于任何已收录银行时的字段级报错 */
  const binError = binUnsupported
    ? `暂不支持该银行：号段 ${binKey} 未收录，请核对卡号`
    : undefined

  /**
   * 选收款行。记进对应市场的槽位（境内↔境外、银行通道↔转数快 只是换槽位，不用重选），
   * 顺带把**卡号前缀补全**成该行的常用号段 —— 用户已输的后半段保留，
   * 这样「先选银行再输卡号」只需要敲后 13 位。
   *
   * 只有内地卡有 BIN：香港方向收的是银行账户号，不含机构标识。
   */
  function selectBank(bank: Bank) {
    setNowTick(Date.now())
    setBankSelection((prev) => ({ ...prev, [bank.region]: bank.code }))
    if (bank.region !== 'CN' || isFps || !bank.primaryBin) return
    setAccountNo(formatBankAccount(bank.primaryBin + digitsOnly(accountNo).slice(CARD_BIN_LENGTH)))
  }

  function switchChannel(next: TransferChannel) {
    setNowTick(Date.now())
    setChannel(next)
    setError(null)
    setResolved(null)
  }

  function pickBalance(id: string) {
    setNowTick(Date.now())
    setFromBalanceId(id)
    setError(null)
  }

  function switchFpsMethod(next: FpsMethod) {
    setFpsMethod(next)
    setFpsValue('')
    setResolved(null)
    setError(null)
  }

  function applyPayee(p: Payee) {
    setChannel(p.channel)
    setResolved(null)
    setError(null)
    if (p.channel === 'fps') {
      const method = p.fpsMethod ?? 'mobile'
      setFpsMethod(method)
      if (p.bankCode) setBankSelection((prev) => ({ ...prev, HK: p.bankCode as string }))
      setFpsCurrency(p.payeeCurrency ?? 'HKD')
      setFpsValue(formatFpsValue(method, (method === 'account' ? p.accountNo : p.fpsId) ?? ''))
      setPayeeName(method === 'account' ? p.name : '')
    } else {
      const region = p.bankRegion ?? (p.scope === 'overseas' ? 'HK' : 'CN')
      if (p.bankCode) setBankSelection((prev) => ({ ...prev, [region]: p.bankCode as string }))
      setScope(p.scope)
      setAccountNo(formatBankAccount(p.accountNo ?? ''))
      setPayeeName(p.name)
    }
  }

  /** 历史收款人管理：点行直接套用，行尾删除从收款人簿移除 */
  async function removePayee(p: Payee) {
    if (deletingPayeeId) return
    setDeletingPayeeId(p.id)
    try {
      await api.deletePayee(p.id)
      toast.show(`已删除收款人 ${p.name}`, 'info')
      payees.reload()
    } catch (error) {
      toast.show(error instanceof Error ? error.message : '删除失败，请稍后重试', 'error')
    } finally {
      setDeletingPayeeId(null)
    }
  }

  function amountProblem(): string | null {
    const source = amountSide === 'pay' ? amountText : receiveText
    const input = parseAmountInput(source)
    if (input === null && source.trim()) return '请输入有效转账金额，最多两位小数'
    if (!input) return '请输入转账金额'
    if (needsReverse && !reverseReady) return '正在计算付款金额，请稍候'
    if (needsReverse && reverseQuote && Date.now() >= reverseQuote.expiresAt) return '报价已过期，请等待重新报价'
    if (parsedAmount === null || amount <= 0) return '无法计算付款金额，请调整金额后重试'
    if (quoteCurrency !== payCurrency && !fx) {
      return quoteFailed ? '换汇报价暂不可用，请调整金额或币种后重试' : '正在获取换汇报价，请稍候'
    }
    if (fx && Date.now() >= quoteReceivedAt + fx.quoteTtlSeconds * 1000) return '报价已过期，请等待重新报价'
    return null
  }

  function goToRecipient() {
    setError(null)
    const problem = amountProblem()
    if (problem) {
      setError(problem)
      return
    }
    if (overLimit && quote) {
      setError(`单笔上限 ${formatCurrency(quote.singleLimit, payCurrency)}，请调整金额或分多笔转出`)
      return
    }
    if (insufficient) {
      setError('账户可用余额不足')
      return
    }
    setStep(2)
  }

  /**
   * 第二步 → 第三步（信息确认）。
   * 转数快标识方式在这一步向中央登记册解析收款人姓名 —— 与真实流程一致：
   * 姓名不是用户填的，是系统查出来给用户核对的。
   */
  async function goReview() {
    setConfirmOpen(false)
    setError(null)
    setResolved(null)
    setRecipientCheck(null)
    const problem = amountProblem()
    if (problem) {
      setError(problem)
      return
    }

    if (isFps) {
      if (fpsMethod === 'account') {
        const err = validateFpsValue('account', fpsValue)
        if (err) {
          setError(err)
          return
        }
        if (!payeeName.trim()) {
          setError('请输入收款户名')
          return
        }
      } else {
        const err = validateFpsValue(fpsMethod, fpsValue)
        if (err) {
          setError(err)
          return
        }
        setResolving(true)
        try {
          const res = await api.resolveFps(fpsMethod, fpsValue)
          if (!res.registered) {
            setError(res.reason ?? '该标识未登记转数快')
            return
          }
          setResolved(res)
        } catch {
          setError('转数快查询失败，请稍后重试')
          return
        } finally {
          setResolving(false)
        }
      }
    } else {
      if (!payeeName.trim()) {
        setError('请填写收款人姓名')
        return
      }
      const err = validateBankAccount(accountNo)
      if (err) {
        setError(err)
        return
      }
      // 卡号前缀不认识就到此为止：与其让用户填完金额和收款人再失败，
      // 不如现在就说清楚这家银行不在支持范围内
      if (binUnsupported) {
        setError(
          `暂不支持该银行：卡号前 ${CARD_BIN_LENGTH} 位 ${binKey} 不在已收录的号段内，请核对卡号`,
        )
        return
      }
    }

    if (overLimit && quote) {
      setError(`单笔上限 ${formatCurrency(quote.singleLimit, payCurrency)}，请调整金额或分多笔转出`)
      return
    }
    if (insufficient) {
      setError('账户可用余额不足')
      return
    }
    if (!isFps) {
      setCheckingRecipient(true)
      try {
        const checked = await api.resolveTransferRecipient({
          bankCode: activeBankCode,
          bankRegion: activeBankRegion,
          accountOrCardNo: accountNo,
          payeeName,
        })
        setRecipientCheck(checked)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '收款账户核验失败，请稍后重试')
        return
      } finally {
        setCheckingRecipient(false)
      }
    }
    setStep(3)
  }

  /** 最终落库的收款人姓名：标识方式下取系统解析结果 */
  const finalPayeeName = isFps && fpsMethod !== 'account' ? (resolved?.name ?? '') : payeeName

  async function doSubmit() {
    if (!account) return
    const problem = amountProblem()
    if (problem) { setError(problem); return }
    if (!/^\d{6}$/.test(paymentPassword)) {
      setError('请输入 6 位数字支付密码')
      return
    }
    setSubmitting(true)
    onBusyChange(true)
    setError(null)
    try {
      const res = await api.submitTransfer({
        fromAccountId: account.id,
        channel,
        scope: effectiveScope,
        payeeName: finalPayeeName,
        amount,
        memo: memo.trim(),
        paymentPassword,
        payeeBankCode: activeBankCode,
        payeeBankRegion: activeBankRegion,
        // 到账币种：银行通道与付款币种相同时后端不产生换汇；不同则按报价折算
        payeeCurrency: quoteCurrency,
        ...(isFps
          ? {
              fpsMethod,
              payeeAddress: fpsAddress.trim() || undefined,
              ...(isFpsAccount
                ? { payeeAccountNo: fpsValue.trim() }
                : { fpsId: fpsMethod === 'email' ? fpsValue.trim() : digitsOnly(fpsValue) }),
            }
          : { payeeAccountNo: digitsOnly(accountNo) }),
      })
      setResult(res)
      setResultRecord(null)
      setPaymentPassword('')
      setConfirmOpen(false)
      setStep(4)
      onUpdate()
      accounts.reload()
      payees.reload()
    } catch (err) {
      setPaymentPassword('')
      setConfirmOpen(false)
      setError(err instanceof ApiError ? err.message : '转账失败，请稍后重试')
    } finally {
      setSubmitting(false)
      onBusyChange(false)
    }
  }

  function reset() {
    setStep(1)
    setConfirmOpen(false)
    setAmountText('')
    setReceiveText('')
    setAmountSide('pay')
    setPayeeName('')
    setFpsValue('')
    setMemo('')
    setResolved(null)
    setResult(null)
    setResultRecord(null)
    setPaymentPassword('')
    setError(null)
    setRecalling(false)
  }

  /**
   * 撤销在途转账（§9.3）：只解冻可用余额，指令从未执行过、不发生扣款。
   * 窗口到点自动到账后就撤不了了。
   */
  async function doRecall() {
    if (!result) return
    setRecalling(true)
    onBusyChange(true)
    setError(null)
    try {
      const r = await api.recallTransfer(result.transactionId)
      toast.show(r.memo)
      onUpdate()
      setResult(null)
      setStep(1)
      accounts.reload()
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '撤销失败，请稍后重试')
    } finally {
      setRecalling(false)
      onBusyChange(false)
    }
  }

  usePendingTransaction(result?.transactionId, resultStatus === 'pending', (record) => {
    setResultRecord(record)
    if (record.status !== 'pending') {
      onUpdate()
      accounts.reload()
      payees.reload()
    }
  })

  // 倒计时只作展示，最终状态必须由银行查询确认。
  useEffect(() => {
    if (!result?.holdUntil || resultStatus !== 'pending') return
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [result?.holdUntil, resultStatus])

  const requests = [accounts, profile, banks, payees]
  const failed = requests.filter(state => state.error !== null && state.data === null)
  if (failed.length) return <DataUnavailable message={failed[0]!.error!} onRetry={() => failed.forEach(state => state.reload())} />
  if (requests.some(state => state.loading && state.data === null)) return <DataLoading />

  return (
    <div ref={content} className="page-stack">
      {/* 步骤条 */}
      <ol className="float-up flex items-center gap-1 sm:gap-3">
        {STEPS.map((s, index) => {
          const active = step === s.id
          const done = step > s.id
          return (
            <li key={s.id} aria-current={active ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-3">
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-chip text-[14px] font-semibold transition-colors sm:size-9',
                  active && 'bg-gold text-ink',
                  done && 'bg-gold-wash text-gold-deep',
                  !active && !done && 'bg-sunk text-ink-mute',
                )}
              >
                {done ? <CheckIcon size={16} /> : s.id}
              </span>
              <span className={cn('whitespace-nowrap text-[12px] sm:text-[14px]', active ? 'font-medium text-ink' : 'text-ink-mute')}>
                {s.label}
              </span>
              {index < STEPS.length - 1 && (
                <span className="h-px flex-1 bg-line" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>

      {step === 1 && (
        <div className="float-up mx-auto w-full max-w-[560px]">
          <Card padded={false} className="border-0 shadow-none">
            <p className="mb-3 text-[13px] font-medium text-ink-soft">转账方式</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChannelCard
                active={!isFps}
                title="银行账户转账"
                badge="境内免手续费"
                onClick={() => switchChannel('bank')}
              />
              <ChannelCard
                active={isFps}
                title="转数快 / 跨境支付通"
                badge="实时到账 · 免手续费"
                onClick={() => switchChannel('fps')}
              />
            </div>

            <div className="mt-7 space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium text-ink-soft">付款金额</span>
                  <span className="num text-[12px] text-ink-mute">付款账户 · 尾号 {balances[0]?.accountNo.slice(-4)}</span>
                </div>
                <div className="flex min-w-0 items-center rounded-field border border-line bg-surface focus-within:border-gold">
                  <input
                    value={paymentInput}
                    onChange={(e) => { setNowTick(Date.now()); setAmountSide('pay'); setAmountText(e.target.value); setError(null) }}
                    inputMode="decimal"
                    placeholder={needsReverse && !reverseReady ? '正在计算…' : '0.00'}
                    aria-label="转账金额"
                    className="num h-16 min-w-0 flex-1 bg-transparent px-4 text-[24px] font-semibold text-ink outline-none placeholder:text-line-strong"
                  />
                  <select
                    aria-label="付款币种"
                    value={account?.id ?? ''}
                    onChange={(e) => pickBalance(e.target.value)}
                    className="h-10 max-w-[45%] shrink-0 cursor-pointer border-l border-line bg-transparent px-3 text-[13px] font-medium text-ink outline-none"
                  >
                    {balances.map((row) => <option key={row.id} value={row.id}>{row.currency} · {CURRENCY_LABEL[row.currency]}</option>)}
                  </select>
                </div>
                <p className="num mt-2 text-[12px] text-ink-mute">
                  可用 {formatCurrency(account?.available ?? 0, payCurrency)}
                  {balances.length === 1 && (
                    <span className="ml-2 font-sans">
                      只有{CURRENCY_LABEL[payCurrency]}余额，
                      <Link to="/exchange" className="text-gold-deep hover:text-gold">换汇</Link>后可用其他币种付款
                    </span>
                  )}
                </p>
              </div>

              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-soft">收款金额</p>
                <div className="flex min-w-0 items-center rounded-field border border-line bg-surface focus-within:border-gold">
                  <input
                    value={receiveInput}
                    onChange={(e) => { setNowTick(Date.now()); setAmountSide('receive'); setReceiveText(e.target.value); setError(null) }}
                    inputMode="decimal"
                    placeholder={amount > 0 && quoteCurrency !== payCurrency && !fx && !quoteFailed ? '正在计算…' : '0.00'}
                    aria-label="收款金额"
                    className="num h-16 min-w-0 flex-1 bg-transparent px-4 text-[24px] font-semibold text-ink outline-none placeholder:text-line-strong"
                  />
                  <select
                    aria-label="收款币种"
                    value={quoteCurrency}
                    onChange={(e) => {
                      setNowTick(Date.now())
                      const next = e.target.value as Currency
                      if (isFps) setFpsCurrency(next)
                      else setDestCurrency(next)
                      setError(null)
                    }}
                    className="h-10 max-w-[45%] shrink-0 cursor-pointer border-l border-line bg-transparent px-3 text-[13px] font-medium text-ink outline-none"
                  >
                    {(isFps ? FPS_CURRENCIES : PAYEE_CURRENCIES).map((option) => (
                      <option key={option.value} value={option.value}>{option.value} · {option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p role="status" className="text-[12px] leading-relaxed text-ink-mute">
                {needsReverse && !reverseReady ? '正在计算付款金额…'
                  : needsReverse && parsedAmount === null ? '无法获取报价或金额超出范围，请调整金额或币种。'
                    : quoteFailed ? '报价暂不可用，请调整金额或币种后重试。'
                      : fx ? `参考汇率：1 ${fx.fromCurrency} = ${formatRate(fx.rate)} ${fx.toCurrency}（含点差）。${amountSide === 'receive' && receiveAmount !== fx.toAmount ? `按当前报价折算，预计实际收款 ${formatCurrency(fx.toAmount, fx.toCurrency)}。` : ''}手续费另计，实际到账以交易结果为准。`
                        : amount > 0 && quoteCurrency !== payCurrency ? '正在获取报价…'
                          : '手续费另计，实际到账以交易结果为准。'}
              </p>
            </div>

            {error && (
              <p className="mt-6 flex items-start gap-2 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
                <AlertIcon size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <Button
              variant="primary"
              size="lg"
              block
              className="mt-7"
              onClick={() => goToRecipient()}
              disabled={accounts.loading}
            >
              下一步
            </Button>
            <p className="mt-3 text-center text-[12px] text-ink-mute">
              转账即表示您已阅读并同意相关条款
            </p>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card className="float-up">
            {quickPayees.length > 0 && (
              <div className="mb-7">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[13px] font-medium text-ink-soft">历史收款人</p>
                  <button
                    type="button"
                    onClick={() => setPayeesOpen(true)}
                    className="text-[13px] font-medium text-gold-deep transition-colors hover:text-gold"
                  >
                    全部（{channelPayees.length}）
                  </button>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {quickPayees.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setNowTick(Date.now()); applyPayee(p) }}
                      className="inline-flex h-10 items-center gap-2 rounded-chip border border-line px-3.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
                    >
                      <UsersIcon size={16} />
                      {p.name}
                      <span className="num text-ink-mute">
                        {p.channel === 'fps'
                          ? maskFpsValue(
                              p.fpsMethod ?? 'mobile',
                              (p.fpsMethod === 'account' ? p.accountNo : p.fpsId) ?? '',
                            )
                          : maskBankAccount(p.accountNo ?? '')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 收款信息 */}
            <div className="grid gap-5">
              {isFps ? (
                <>
                  <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
                    <span className="text-[13px] font-medium text-ink-soft">收款国家/地区</span>
                    <span className="text-[14px] text-ink">中国香港</span>
                  </div>

                  <div>
                    <p className="mb-3 text-[13px] font-medium text-ink-soft">汇款方式</p>
                    <Segmented
                      value={fpsMethod}
                      onChange={switchFpsMethod}
                      options={FPS_METHODS}
                      className="flex-wrap"
                    />
                  </div>

                  {/* 收款银行：跨境支付通无论哪种汇款方式都必须指定 */}
                  <div>
                    <p className="mb-3 text-[13px] font-medium text-ink-soft">收款银行</p>
                    <BankPicker
                      banks={banks.data ?? []}
                      region={activeBankRegion}
                      value={selectedBank}
                      hint="转数快为香港清算网络，收款行必为香港持牌银行"
                      onValueChange={(bank) => selectBank(bank)}
                    />
                  </div>

                  {fpsMethod === 'account' ? (
                    <>
                      <Field
                        label="收款账号"
                        value={fpsValue}
                        onChange={(e) => setFpsValue(formatFpsValue('account', e.target.value))}
                        placeholder={FPS_METHOD_PLACEHOLDER.account}
                        autoComplete="off"
                        error={fpsValueError ?? undefined}
                        hint="请输入英文字母或数字，最多 24 位"
                      />
                      <Field
                        label="收款户名"
                        value={payeeName}
                        onChange={(e) => setPayeeName(e.target.value)}
                        placeholder="请输入英文字母和半角空格"
                        hint="户名需与收款人在银行登记的姓名一致"
                      />
                    </>
                  ) : fpsMethod === 'mobile' ? (
                    <>
                      <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
                        <span className="text-[13px] font-medium text-ink-soft">区号</span>
                        <span className="text-[14px] text-ink">中国香港（+852）</span>
                      </div>
                      <Field
                        label="收款手机号"
                        value={fpsValue}
                        onChange={(e) => setFpsValue(formatFpsValue('mobile', e.target.value))}
                        placeholder={FPS_METHOD_PLACEHOLDER.mobile}
                        inputMode="numeric"
                        autoComplete="off"
                        error={fpsValueError ?? undefined}
                        hint="收款人需已用该手机号登记转数快"
                      />
                    </>
                  ) : fpsMethod === 'email' ? (
                    <Field
                      label="收款邮箱"
                      value={fpsValue}
                      onChange={(e) => setFpsValue(formatFpsValue('email', e.target.value))}
                      placeholder={FPS_METHOD_PLACEHOLDER.email}
                      inputMode="email"
                      autoComplete="off"
                      error={fpsValueError ?? undefined}
                      hint="收款人需已用该邮箱登记转数快"
                    />
                  ) : (
                    <Field
                      label="FPS ID"
                      value={fpsValue}
                      onChange={(e) => setFpsValue(formatFpsValue('fpsid', e.target.value))}
                      placeholder={FPS_METHOD_PLACEHOLDER.fpsid}
                      inputMode="numeric"
                      autoComplete="off"
                      error={fpsValueError ?? undefined}
                      hint="FPS ID 由收款人在其银行 App 内设定，为 7 位数字"
                    />
                  )}

                  <Field
                    label="收款地址（选填）"
                    value={fpsAddress}
                    onChange={(e) => setFpsAddress(e.target.value)}
                    placeholder="选填，便于收款行核对"
                  />
                </>
              ) : (
                <>
                  <div>
                    <p className="mb-3 text-[13px] font-medium text-ink-soft">收款银行</p>
                    <BankPicker
                      banks={banks.data ?? []}
                      region={activeBankRegion}
                      value={selectedBank}
                      hint={
                        activeBankRegion === 'HK'
                          ? '境外汇款的收款行在香港'
                          : '境内转账的收款行在内地'
                      }
                      onValueChange={(bank) => selectBank(bank)}
                    />
                  </div>

                  <Field
                    label="收款账户"
                    value={accountNo}
                    onChange={(e) => setAccountNo(formatBankAccount(e.target.value))}
                    placeholder={
                      activeBankRegion === 'CN'
                        ? '请输入收款人的银行卡号'
                        : '请输入收款人的银行账户号'
                    }
                    inputMode="numeric"
                    autoComplete="off"
                    error={accountError ?? binError}
                    hint={accountHint}
                  />

                  <Field
                    label="收款人"
                    value={payeeName}
                    onChange={(e) => setPayeeName(e.target.value)}
                    placeholder="请输入收款人姓名"
                  />

                  <div className="flex items-start justify-between gap-4">
                    <span className="text-[13px] font-medium text-ink-soft">转账类型</span>
                    <Segmented
                      value={scope}
                      onChange={setScope}
                      options={[
                        { value: 'domestic', label: '境内' },
                        { value: 'overseas', label: '境外' },
                      ]}
                    />
                  </div>
                </>
              )}

              <Field
                label="备注（选填）"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="例如：房租 AA"
              />
            </div>

            {error && (
              <p className="mt-6 flex items-start gap-2 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
                <AlertIcon size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="mt-7 flex gap-3">
              <Button block onClick={() => { setError(null); setStep(1) }}>
                上一步
              </Button>
              <Button
                block
                variant="primary"
                loading={resolving || checkingRecipient}
                onClick={() => void goReview()}
              >
                {resolving ? '正在查询转数快…' : checkingRecipient ? '正在核验收款账户…' : '下一步'}
              </Button>
            </div>
            <p className="mt-3 text-center text-[12px] text-ink-mute">
              转账即表示您已阅读并同意相关条款
            </p>
          </Card>

          {/* 右侧摘要 */}
          <Card className="float-up h-fit" style={{ animationDelay: '80ms' }}>
            <h2 className="text-[17px] leading-6 font-semibold text-ink">费用摘要</h2>
            <dl className="mt-5 flex flex-col gap-4 text-[14px]">
              <SummaryRow label="转账方式" value={isFps ? '转数快 / 跨境支付通' : '银行账户转账'} />
              {isFps ? (
                <>
                  <SummaryRow label="收款币种" value={fpsCurrency === 'HKD' ? '港币' : '人民币'} />
                  <SummaryRow label="汇款方式" value={FPS_METHOD_LABEL[fpsMethod]} />
                </>
              ) : (
                <SummaryRow label="收款币种" value={`${CURRENCY_LABEL[destCurrency]}（${destCurrency}）`} />
              )}
              <SummaryRow label="收款银行" value={selectedBank?.name ?? '—'} />
              <SummaryRow
                label={isFps ? FPS_METHOD_LABEL[fpsMethod] : '收款账户'}
                value={identifier}
              />
              <SummaryRow label="手续费" value={formatCurrency(fee, payCurrency)} />
              {fx && (
                <>
                  <SummaryRow
                    label="参考汇率"
                    value={`1 ${fx.fromCurrency} = ${fx.toCurrency} ${formatRate(fx.rate)}`}
                  />
                  <SummaryRow label="换汇点差" value={`${(fx.spread * 100).toFixed(2)}%`} />
                  <SummaryRow
                    label="预计到账"
                    value={formatCurrency(fx.toAmount, fx.toCurrency)}
                  />
                </>
              )}
              <SummaryRow label="到账时间" value={etaText} />
              <div className="border-t border-line pt-4">
                <SummaryRow
                  label="剩余余额"
                  action={<RevealToggle shown={shown} onToggle={toggleShown} />}
                  value={
                    account
                      ? shown
                        ? formatCurrency(Math.max(remaining, 0), payCurrency)
                        : `${CURRENCY_SYMBOL[payCurrency]}••••••`
                      : '—'
                  }
                  strong
                />
              </div>
            </dl>

            {quote && (
              <p className="mt-4 rounded-field bg-sunk px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-soft">
                {quote.channelNote}
              </p>
            )}
            {overLimit && quote && (
              <p className="mt-3 rounded-field bg-coral-wash px-3.5 py-2.5 text-[13px] text-coral">
                超出单笔上限 {formatCurrency(quote.singleLimit, payCurrency)}
              </p>
            )}
            {insufficient && (
              <p className="mt-3 rounded-field bg-coral-wash px-3.5 py-2.5 text-[13px] text-coral">
                可用余额不足，请调整金额
              </p>
            )}
          </Card>
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card className="float-up">
            <h2 className="text-[17px] leading-6 font-semibold text-ink">信息确认</h2>
            <p className="mt-2 text-[13px] text-ink-mute">
              请核对收款人信息。确认后不可撤销，跨境款项将进入风控复核。
            </p>

            {/* 转数快中央登记册回显的收款人 */}
            {isFps && fpsMethod !== 'account' && resolved && (
              <div className="mt-6 flex items-start gap-3 rounded-field border border-blue-wash bg-blue-tint px-4 py-3.5">
                <CheckIcon size={18} className="mt-0.5 shrink-0 text-blue" />
                <span className="text-[13px] leading-relaxed text-ink">
                  <span className="block font-medium">已从转数快登记册核对收款人</span>
                  <span className="mt-0.5 block text-ink-soft">
                    登记户口名称：{resolved.name}
                    {resolved.bankCount && resolved.bankCount > 1
                      ? `（该标识绑定了 ${resolved.bankCount} 间银行，此处为其默认收款户口）`
                      : ''}
                  </span>
                  {/* 把登记银行也摆出来：用户自己选的收款行如果和登记的对不上，
                      在这一步就能看出来，而不是等款项被退回 */}
                  {resolved.bankName && (
                    <span className="mt-1 block text-ink-soft">
                      登记银行：{resolved.bankName}
                      {resolved.bankCode ? ` · 香港银行代码 ${resolved.bankCode}` : ''}
                    </span>
                  )}
                </span>
              </div>
            )}

            {!isFps && recipientCheck && (
              <div className="mt-6 rounded-field border border-blue-wash bg-blue-tint px-4 py-3.5 text-[13px] leading-relaxed text-ink">
                {recipientCheck.kind === 'internal'
                  ? `已核对本行收款人：${recipientCheck.holderNameMasked} · ${recipientCheck.cardLast4 ? `银行卡尾号 ${recipientCheck.cardLast4}` : '资金账户'} · 实时入账 · 到账 ${CURRENCY_LABEL[destCurrency]}${destCurrency === 'CNY' ? '' : '（同一资金账户，无该币种余额时自动开立）'}`
                  : '收款行为其他银行：本演示仅模拟转出与清算提交，对方银行余额无法在本系统查询。'}
              </div>
            )}

            <p className="num mt-8 text-center text-[34px] leading-none font-bold tracking-[-0.03em] text-ink sm:text-[46px]">
              {formatCurrency(amount, payCurrency)}
            </p>
            <p className="mt-3 text-center text-[13px] text-ink-mute">
              扣账金额 · {CURRENCY_LABEL[payCurrency]}（{payCurrency}）
            </p>

            {/* 换汇：把「扣多少」和「对方收到多少」并排讲清楚，并显示锁价剩余时间 */}
            {fx && (
              <div className="mt-6 rounded-field border border-line bg-sunk px-5 py-4">
                <dl className="flex flex-col gap-3.5 text-[14px]">
                  <SummaryRow
                    label="参考汇率"
                    value={`1 ${fx.fromCurrency} = ${fx.toCurrency} ${formatRate(fx.rate)}`}
                  />
                  <SummaryRow label="换汇点差" value={`${(fx.spread * 100).toFixed(2)}%`} />
                  <div className="border-t border-line pt-3.5">
                    <SummaryRow
                      label={`预计到账（${CURRENCY_LABEL[fx.toCurrency]}）`}
                      value={formatCurrency(fx.toAmount, fx.toCurrency)}
                      strong
                    />
                  </div>
                </dl>
                <p className="mt-3 text-[12px] leading-relaxed text-ink-mute">
                  {quoteSecondsLeft > 0
                    ? `报价 ${quoteSecondsLeft} 秒内有效，过期会自动按最新汇率重新询价`
                    : '报价已过期，正在按最新汇率重新询价…'}
                </p>
              </div>
            )}

            <dl className="mt-9 flex flex-col gap-4 border-t border-line pt-6 text-[14px]">
              <SummaryRow label="转账方式" value={isFps ? '转数快 / 跨境支付通' : '银行账户转账'} />
              {isFps ? (
                <>
                  <SummaryRow label="收款国家/地区" value="中国香港" />
                  <SummaryRow label="收款币种" value={fpsCurrency === 'HKD' ? '港币' : '人民币'} />
                  <SummaryRow label="汇款方式" value={FPS_METHOD_LABEL[fpsMethod]} />
                </>
              ) : (
                <SummaryRow label="收款币种" value={`${CURRENCY_LABEL[destCurrency]}（${destCurrency}）`} />
              )}
              <SummaryRow label="收款银行" value={selectedBank?.name ?? '—'} />
              <SummaryRow
                label={isFps ? FPS_METHOD_LABEL[fpsMethod] : '收款账户'}
                value={identifier}
              />
              <SummaryRow
                label={isFps && fpsMethod !== 'account' ? '收款人（系统核对）' : '收款人'}
                value={finalPayeeName || '—'}
              />
              {isFps && fpsAddress.trim() && (
                <SummaryRow label="收款地址" value={fpsAddress.trim()} />
              )}
              {!isFps && (
                <SummaryRow
                  label="转账类型"
                  value={effectiveScope === 'overseas' ? '境外' : '境内'}
                />
              )}
              <SummaryRow label="备注" value={memo || '—'} />
              <SummaryRow label="手续费" value={formatCurrency(fee, payCurrency)} />
              <SummaryRow label="到账时间" value={etaText} />
            </dl>

            <div className="mt-6">
              <Field
                label="支付密码"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={paymentPassword}
                disabled={submitting}
                hint="6 位数字，仅用于本次转账验证"
                onChange={(event) => setPaymentPassword(event.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>

            {error && (
              <p className="mt-6 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
                {error}
              </p>
            )}

            {confirmOpen && <div role="alert" className="mt-6 rounded-field bg-gold-wash p-4 text-[14px] leading-relaxed text-ink">
              <p className="font-semibold">请再次确认</p>
              <p className="mt-1">{quote?.confirmReason ?? '该笔转账金额较大，请再次核对收款人和金额。'}</p>
            </div>}
            <div className="mt-8 flex gap-3">
              <Button block disabled={submitting} onClick={() => { setConfirmOpen(false); setPaymentPassword(''); setStep(2) }}>
                返回修改
              </Button>
              <Button
                block
                variant="primary"
                loading={submitting}
                onClick={() => {
                  if (quote?.requiresConfirm && !confirmOpen) setConfirmOpen(true)
                  else void doSubmit()
                }}
              >
                {confirmOpen ? '确认转出' : '确认转账'}
              </Button>
            </div>
          </Card>

          <Card className="float-up h-fit" style={{ animationDelay: '80ms' }}>
            <h2 className="text-[17px] leading-6 font-semibold text-ink">扣款账户</h2>
            {accounts.loading ? (
              <Skeleton className="mt-4 h-24 w-full" />
            ) : (
              <>
                <p className="mt-4 text-[15px] font-medium text-ink">{account?.label ?? '—'}</p>
                <p className="num mt-1 text-[12px] text-ink-mute">
                  {CURRENCY_LABEL[payCurrency]}（{payCurrency}）· 尾号 {account?.accountNo.slice(-4) ?? '—'}
                </p>
                <dl className="mt-5 flex flex-col gap-4 text-[14px]">
                  <SummaryRow
                    label="当前可用"
                    value={account ? (shown ? formatCurrency(account.available, payCurrency) : `${CURRENCY_SYMBOL[payCurrency]}••••••`) : '—'}
                  />
                  <SummaryRow label="本次支出" value={formatCurrency(total, payCurrency)} />
                  <div className="border-t border-line pt-4">
                    <SummaryRow
                      label="转账后余额"
                      value={
                        account
                          ? shown
                            ? formatCurrency(account.available - total, payCurrency)
                            : `${CURRENCY_SYMBOL[payCurrency]}••••••`
                          : '—'
                      }
                      strong
                    />
                  </div>
                </dl>
              </>
            )}
          </Card>
        </div>
      )}

      {step === 4 && result && (
        <Card className="float-up mx-auto w-full max-w-[520px] text-center">
          {resultStatus !== 'success' ? (
            <span className="mx-auto grid size-16 place-items-center rounded-chip bg-gold-wash text-gold-deep">
              <AlertIcon size={30} />
            </span>
          ) : (
            <span className="mx-auto grid size-16 place-items-center rounded-chip bg-blue-wash text-blue">
              <CheckIcon size={30} />
            </span>
          )}
          <h2 className="mt-5 text-[22px] font-bold tracking-[-0.01em] text-ink">
            {resultStatus === 'failed'
              ? '转账未完成'
              : resultPendingReason === 'inflight'
                ? '转账处理中'
                : resultStatus === 'pending'
                  ? '已提交模拟清算'
                  : '转账成功'}
          </h2>
          <p className="num mt-3 text-[34px] leading-none font-bold text-ink">
            {formatCurrency(result.amount, payCurrency)}
          </p>
          <p className="mt-3 text-[14px] text-ink-soft">
            {resultStatus === 'failed'
              ? resultRecord?.memo
              : resultPendingReason === 'inflight'
                ? `大额转账延迟到账 · 转往 ${finalPayeeName}`
                : resultStatus === 'pending'
                  ? `转往 ${finalPayeeName} · 外行收款账户不在本演示数据库内`
                  : `已转给 ${finalPayeeName} · ${etaText}`}
          </p>

          {resultStatus === 'pending' && resultPendingReason === 'inflight' && result.holdUntil && (
            <div className="mt-5 rounded-tile border border-gold-deep/30 px-4 py-3">
              <p className="text-[13px] text-ink-mute">窗口到点自动到账，此前可撤销</p>
              <p className="num mt-1 text-[22px] font-bold text-gold-deep">
                {(() => {
                  const left = new Date(result.holdUntil).getTime() - nowMs
                  if (left <= 0) return '窗口已到点，正在自动到账…'
                  const totalSec = Math.ceil(left / 1000)
                  const m = Math.floor(totalSec / 60)
                  const s = totalSec % 60
                  return `还剩 ${m > 0 ? `${m} 分 ` : ''}${s} 秒`
                })()}
              </p>
              <p className="mt-2 text-[12px] text-ink-mute">
                本金与手续费已预留，撤销后解除冻结；到账时实际扣款。
              </p>
            </div>
          )}

          <dl className="mt-8 flex flex-col gap-3.5 border-t border-line pt-6 text-left text-[14px]">
            <SummaryRow label="收款银行" value={selectedBank?.name ?? '—'} />
            <SummaryRow label="收款标识" value={result.identifier} />
            <SummaryRow label="收款币种" value={`${CURRENCY_LABEL[result.fx?.toCurrency ?? payCurrency]}（${result.fx?.toCurrency ?? payCurrency}）`} />
            {result.fx && (
              <SummaryRow
                label="到账金额"
                value={formatCurrency(result.fx.toAmount, result.fx.toCurrency)}
              />
            )}
            <SummaryRow label="流水号" value={result.referenceNo} />
            <SummaryRow label="手续费" value={formatCurrency(result.fee, payCurrency)} />
            {result.fx && (
              <SummaryRow
                label="成交汇率"
                value={`1 ${result.fx.fromCurrency} = ${result.fx.toCurrency} ${formatRate(
                  result.fx.rate,
                )}`}
              />
            )}
          </dl>

          <div className="mt-8 flex flex-col gap-3">
            {resultStatus === 'pending' && resultPendingReason === 'inflight' && result.holdUntil && Date.parse(result.holdUntil) > nowMs && (
              <Button
                block
                variant="secondary"
                disabled={recalling}
                onClick={doRecall}
              >
                {recalling ? '撤销中…' : '撤销这笔转账'}
              </Button>
            )}
            <div className="flex gap-3">
              <Button block disabled={recalling} onClick={reset}>
                再转一笔
              </Button>
              <Button block variant="primary" disabled={recalling} onClick={onClose}>完成</Button>
            </div>
          </div>
        </Card>
      )}

      {!accounts.loading && !account && (
        <Card>
          <EmptyState title="没有可用账户" description="请联系客服开通账户后再试。" />
        </Card>
      )}

      <Modal
        open={payeesOpen}
        onClose={() => setPayeesOpen(false)}
        title="历史收款人"
        description="每次转账成功后自动记录，按最近使用排序；点选直接填入，也可以删除不再需要的。"
        width="max-w-[520px]"
      >
        <label className="mb-4 block text-[13px] text-ink-soft">搜索姓名、账号或备注<input aria-label="搜索历史收款人" value={payeeKeyword} maxLength={140} onChange={event => setPayeeKeyword(event.target.value)} className="mt-2 min-h-11 w-full rounded-field border border-line px-3" /></label>
        {editingPayee && <form className="mb-4 flex gap-2" onSubmit={event => {
          event.preventDefault(); void api.updatePayeeRemark(editingPayee.id, editingPayee.remark).then(() => { setEditingPayee(null); payees.reload() }).catch(error => toast.show(error instanceof Error ? error.message : '备注保存失败', 'error'))
        }}><input aria-label="收款人备注" value={editingPayee.remark} maxLength={140} onChange={event => setEditingPayee({ ...editingPayee, remark: event.target.value })} className="min-h-11 min-w-0 flex-1 rounded-field border border-line px-3" /><Button type="submit">保存备注</Button><Button onClick={() => setEditingPayee(null)}>取消</Button></form>}
        <div className="-mx-6 max-h-[420px] divide-y divide-line overflow-y-auto px-6">
          {channelPayees.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-3">
              <button
                type="button"
                onClick={() => { setNowTick(Date.now()); applyPayee(p); setPayeesOpen(false) }}
                className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:text-gold-deep"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-chip bg-sunk text-ink-mute">
                  <UsersIcon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{p.name}</span>
                  {p.remark && <span className="block truncate text-[12px] text-ink-soft">{p.remark}</span>}
                  <span className="num mt-0.5 block truncate text-[12px] text-ink-mute">
                    {p.bankName ? `${p.bankName} · ` : ''}{p.channel === 'fps'
                      ? maskFpsValue(p.fpsMethod ?? 'mobile', (p.fpsMethod === 'account' ? p.accountNo : p.fpsId) ?? '')
                      : maskBankAccount(p.accountNo ?? '')}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-mute">最近 {formatDate(p.lastUsedAt)}</span>
              </button>
              <Button variant="ghost" onClick={() => setEditingPayee({ id: p.id, remark: p.remark ?? '' })}>备注</Button>
              <button
                type="button"
                disabled={deletingPayeeId === p.id}
                onClick={() => void removePayee(p)}
                className="shrink-0 rounded-chip px-2 py-1 text-[12px] text-ink-mute transition-colors hover:bg-coral-wash hover:text-coral disabled:opacity-50"
              >
                {deletingPayeeId === p.id ? '删除中…' : '删除'}
              </button>
            </div>
          ))}
          {channelPayees.length === 0 && (
            <p className="py-10 text-center text-[13px] text-ink-mute">当前通道还没有历史收款人。</p>
          )}
        </div>
      </Modal>
    </div>
  )
}

function ChannelCard({
  active,
  title,
  badge,
  onClick,
}: {
  active: boolean
  title: string
  badge: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-start gap-2 rounded-card border p-5 text-left transition-colors',
        active ? 'border-gold bg-gold-tint' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <span className="flex w-full items-center gap-3">
        <span className={cn('text-[16px] font-semibold', active ? 'text-gold-deep' : 'text-ink')}>
          {title}
        </span>
        {active && (
          <span className="ml-auto grid size-6 place-items-center rounded-chip bg-gold text-ink">
            <CheckIcon size={14} />
          </span>
        )}
      </span>
      <span className="mt-1 inline-flex h-7 items-center rounded-chip bg-blue-wash px-2.5 text-[12px] font-medium text-blue">
        {badge}
      </span>
    </button>
  )
}

function SummaryRow({
  label,
  value,
  strong,
  action,
}: {
  label: string
  value: string
  strong?: boolean
  /** 值旁边的附加控件（例如敏感余额的那只眼睛） */
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5">
        <span className={cn('num min-w-0 break-all text-right', strong ? 'font-semibold text-ink' : 'text-ink')}>
          {value}
        </span>
        {action}
      </dd>
    </div>
  )
}
