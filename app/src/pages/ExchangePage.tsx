import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '@/api'
import type { Account, Currency, ExchangeQuote, ExchangeQuoteRequest, ExchangeResult } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PinInput } from '@/components/ui/PinInput'
import { Segmented, Tag } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { AlertIcon, CheckIcon, GlobalIcon, TransferIcon } from '@/components/ui/icons'
import { CURRENCY_LABEL, formatCurrency, formatFxAmount, formatRate } from '@/lib/format'
import { parseAmountInput } from '@/lib/amountInput'
import { useAsync } from '@/lib/useAsync'

const CURRENCIES: Currency[] = ['CNY', 'USD', 'HKD']

type QuoteSnapshot = { request: ExchangeQuoteRequest; quote: ExchangeQuote; receivedAt: number }
function validateQuote(quote: ExchangeQuote, request: ExchangeQuoteRequest, fromCurrency: Currency) {
  const fx = quote.fx
  if (fx.fromCurrency !== fromCurrency || fx.toCurrency !== request.toCurrency ||
    fx.fromAmount !== request.amount || !Number.isSafeInteger(fx.toAmount) || fx.toAmount <= 0 ||
    !Number.isFinite(fx.rate) || fx.rate <= 0 || !Number.isFinite(fx.quoteTtlSeconds) || fx.quoteTtlSeconds <= 0) {
    throw new Error('报价异常，请重新获取')
  }
}

export function ExchangePage() {
  const accounts = useAsync<Account[]>(() => api.listAccounts(), [])
  const reloadAccounts = accounts.reload

  const [fromId, setFromId] = useState('')
  const [toCurrency, setToCurrency] = useState<Currency>('USD')
  const [amountText, setAmountText] = useState('')
  const [snapshot, setSnapshot] = useState<QuoteSnapshot | null>(null)
  const quoteVersion = useRef(0)
  const submittingRef = useRef(false)
  const [now, setNow] = useState(() => Date.now())
  const [quoting, setQuoting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [pvError, setPvError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ExchangeResult | null>(null)

  const list = useMemo(() => accounts.data ?? [], [accounts.data])
  const selectedFromId = fromId || (list.find((a) => a.currency === 'CNY')?.id ?? list[0]?.id ?? '')
  const fromAccount = list.find((a) => a.id === selectedFromId) ?? null
  const amount = parseAmountInput(amountText)
  const quoteMatches = snapshot?.request.fromAccountId === selectedFromId &&
    snapshot.request.toCurrency === toCurrency && snapshot.request.amount === amount
  const quote = quoteMatches ? snapshot.quote : null
  const quotedAt = snapshot?.receivedAt ?? 0

  useEffect(() => () => { quoteVersion.current++ }, [])

  useEffect(() => {
    if (!quote) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [quote])

  const ttlLeft = quote ? Math.max(0, quote.fx.quoteTtlSeconds - Math.floor((now - quotedAt) / 1000)) : 0
  const liveQuote = quote && ttlLeft > 0 ? quote : null

  const invalidateQuote = useCallback(() => {
    quoteVersion.current++
    setSnapshot(null)
    setQuoting(false)
    setFormError(null)
  }, [])

  const closeConfirm = useCallback(() => {
    if (submittingRef.current) return
    setConfirmOpen(false)
    setPassword('')
    setPvError(null)
  }, [])

  const toOptions = CURRENCIES.filter((c) => c !== fromAccount?.currency).map((c) => ({
    value: c,
    label: CURRENCY_LABEL[c],
  }))

  function pickFrom(id: string) {
    setFromId(id)
    invalidateQuote()
    const account = list.find((a) => a.id === id)
    if (account && account.currency === toCurrency) {
      const alt = CURRENCIES.find((c) => c !== account.currency)
      if (alt) setToCurrency(alt)
    }
  }

  const handleFetchQuote = useCallback(async () => {
    if (!fromAccount) return setFormError('请选择扣账账户')
    if (amount === null || amount <= 0) return setFormError('请输入有效金额，最多两位小数')
    if (amount > fromAccount.available) return setFormError('金额超过该账户可用余额')
    const request = { fromAccountId: fromAccount.id, toCurrency, amount }
    const version = ++quoteVersion.current
    setSnapshot(null)
    setQuoting(true)
    setFormError(null)
    try {
      const next = await api.quoteExchange(request)
      if (version !== quoteVersion.current) return
      validateQuote(next, request, fromAccount.currency)
      setSnapshot({ request, quote: next, receivedAt: Date.now() })
      setNow(Date.now())
    } catch (err) {
      if (version !== quoteVersion.current) return
      setSnapshot(null)
      setFormError(err instanceof Error ? err.message : '获取报价失败，请稍后重试')
    } finally {
      if (version === quoteVersion.current) setQuoting(false)
    }
  }, [amount, fromAccount, toCurrency])

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return
    if (!fromAccount || !quoteMatches || !snapshot) return
    if (Date.now() >= snapshot.receivedAt + snapshot.quote.fx.quoteTtlSeconds * 1000) {
      setNow(Date.now())
      return setPvError('参考报价已过期，请重新获取并确认')
    }
    if (!/^\d{6}$/.test(password)) return setPvError('请输入 6 位支付密码')
    submittingRef.current = true
    const version = quoteVersion.current
    setSubmitting(true)
    setPvError(null)
    try {
      // 现有契约没有锁价凭据；提交前复核参考报价，变化后须再次确认。
      const latest = await api.quoteExchange(snapshot.request)
      if (version !== quoteVersion.current) return
      validateQuote(latest, snapshot.request, fromAccount.currency)
      const changed = latest.fx.rate !== snapshot.quote.fx.rate || latest.fx.toAmount !== snapshot.quote.fx.toAmount
      if (changed) {
        setSnapshot({ ...snapshot, quote: latest, receivedAt: Date.now() })
        setNow(Date.now())
        setPassword('')
        setPvError('参考报价已更新，请核对后重新确认')
        return
      }
      const res = await api.submitExchange({
        ...snapshot.request,
        paymentPassword: password,
      })
      setResult(res)
      setConfirmOpen(false)
      invalidateQuote()
      setPassword('')
      setAmountText('')
      reloadAccounts()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BAD_PAY_PASSWORD') setPassword('')
      setPvError(err instanceof Error ? err.message : '换汇失败，请稍后重试')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [fromAccount, quoteMatches, snapshot, password, invalidateQuote, reloadAccounts])

  if (!accounts.data) return accounts.error ? <DataUnavailable message={accounts.error} onRetry={accounts.reload} /> : <DataLoading />
  const data = accounts.data

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">多币种与划转</h1>

      <Card className="float-up">
        <CardHeader title="我的多币种账户" action={<span className="text-[13px] text-ink-mute">{data.length} 个账户</span>} />
        <div className="mt-3 divide-y divide-line">
          {data.map((account) => (
            <div key={account.id} className="flex items-center gap-4 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-tile bg-gold-tint text-gold-deep">
                <GlobalIcon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">{account.label}</span>
                <span className="num mt-0.5 block text-[13px] text-ink-mute">尾号 {account.accountNo.slice(-4)} · {CURRENCY_LABEL[account.currency]}</span>
              </span>
              <span className="num shrink-0 text-[16px] font-semibold text-ink">{formatCurrency(account.balance, account.currency)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="float-up" style={{ animationDelay: '80ms' }}>
        <CardHeader title="账户内换汇" action={<Tag tone="blue">{liveQuote ? `参考报价 · ${ttlLeft}s` : '参考报价'}</Tag>} />
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-soft">扣账账户</p>
            <div className="flex flex-wrap gap-2">
              {data.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => pickFrom(account.id)}
                  disabled={confirmOpen || submitting}
                  className={`flex min-h-11 items-center gap-2 rounded-chip border px-4 text-[13px] font-medium transition-colors ${selectedFromId === account.id ? 'border-gold-wash bg-gold-wash text-gold-deep' : 'border-line bg-surface text-ink-soft hover:text-ink'}`}
                >
                  {account.label}
                  <span className="num text-[12px] text-ink-mute">{account.currency}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Field
                label="换汇金额"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => { setAmountText(e.target.value); invalidateQuote() }}
                disabled={confirmOpen || submitting}
                placeholder="0.00"
                trailing={<span className="text-[13px] text-ink-mute">{fromAccount?.currency ?? 'CNY'}</span>}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2 pb-1">
              <TransferIcon size={18} />
              <Segmented disabled={confirmOpen || submitting} value={toCurrency} options={toOptions} onChange={(next) => { setToCurrency(next); invalidateQuote() }} />
            </div>
          </div>

          {liveQuote ? (
            <dl className="flex flex-col gap-3 rounded-field bg-sunk px-4 py-3.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-soft">参考汇率</dt>
                <dd className="num text-ink">1 {liveQuote.fx.fromCurrency} = {formatRate(liveQuote.fx.rate)} {liveQuote.fx.toCurrency}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">点差</dt>
                <dd className="num text-ink">{(liveQuote.fx.spread * 100).toFixed(2)}%</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="text-ink-soft">预计到账</dt>
                <dd className="num text-[16px] font-semibold text-ink">{formatFxAmount(liveQuote.fx.toAmount, liveQuote.fx.toCurrency)}</dd>
              </div>
            </dl>
          ) : (
            <p className="rounded-field bg-sunk px-4 py-3.5 text-[13px] text-ink-mute">
              选择扣账账户、目标币种与金额，获取参考报价。
            </p>
          )}

          {formError && (
            <p className="flex items-start gap-2 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />
              {formError}
            </p>
          )}

          {liveQuote ? (
            <div className="flex gap-3">
              <Button block variant="secondary" onClick={invalidateQuote} disabled={submitting}>重新输入</Button>
              <Button block variant="primary" onClick={() => { setPassword(''); setPvError(null); setConfirmOpen(true) }}>确认换汇</Button>
            </div>
          ) : (
            <Button block variant="primary" loading={quoting} onClick={() => void handleFetchQuote()}>获取报价</Button>
          )}
        </div>
      </Card>

      <p className="text-[12px] leading-relaxed text-ink-mute">
        参考报价不锁价，实际到账金额以成交结果为准。
      </p>

      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title="确认换汇"
        description={quote ? `${formatFxAmount(quote.fx.fromAmount, quote.fx.fromCurrency)} → ${formatFxAmount(quote.fx.toAmount, quote.fx.toCurrency)}` : undefined}
        closeDisabled={submitting}
        footer={
          <>
            <Button block variant="secondary" onClick={closeConfirm} disabled={submitting}>取消</Button>
            {liveQuote || submitting
              ? <Button block variant="primary" loading={submitting} onClick={() => void handleSubmit()}>确认换汇</Button>
              : <Button block variant="primary" onClick={() => { closeConfirm(); void handleFetchQuote() }}>重新获取报价</Button>}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <PinInput label="支付密码" value={password} onChange={(next) => { setPassword(next); setPvError(null) }} error={pvError ?? undefined} autoFocus disabled={submitting} />
          {pvError && <p role="alert" className="text-[13px] text-coral">{pvError}</p>}
          {!liveQuote && <p role="alert" className="text-[13px] text-coral">参考报价已过期，请重新获取并确认。</p>}
          <p className="text-[12px] text-ink-mute">实际到账金额以成交结果为准。</p>
        </div>
      </Modal>

      <Modal
        open={Boolean(result)}
        onClose={() => setResult(null)}
        title="换汇成功"
        footer={<Button block variant="primary" onClick={() => setResult(null)}>完成</Button>}
      >
        {result && (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-chip bg-blue-wash text-blue">
              <CheckIcon size={28} />
            </span>
            <p className="num mt-4 text-[26px] leading-none font-bold text-ink">{formatFxAmount(result.fx.toAmount, result.fx.toCurrency)}</p>
            <p className="mt-2 text-[13px] text-ink-mute">已入账目标币种账户</p>
            <dl className="mt-6 flex flex-col gap-3 border-t border-line pt-5 text-left text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-soft">业务参考号</dt>
                <dd className="num text-ink">{result.referenceNo}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">成交汇率</dt>
                <dd className="num text-ink">1 {result.fx.fromCurrency} = {formatRate(result.fx.rate)} {result.fx.toCurrency}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">成交金额</dt>
                <dd className="num text-ink">{formatFxAmount(result.fx.fromAmount, result.fx.fromCurrency)}</dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  )
}
