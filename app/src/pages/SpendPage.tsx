import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '@/api'
import type { BankCard, Cents, SpendReceipt, TransactionCategory } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { EmptyState, Tag } from '@/components/ui/Segmented'
import { useAsync } from '@/lib/useAsync'
import { useToast } from '@/components/ui/toast-context'
import { CATEGORY_LABEL } from '@/lib/categories'
import { formatAmount, formatCurrency } from '@/lib/format'
import { FREE_MERCHANT_NAME_MAX, FREE_SPEND_MERCHANTS, SPEND_MAX_CENTS, SPEND_PLATFORMS, findFreeMerchant, findSpendPlatform } from '../../../shared/spend-platforms.mjs'
import { ArrowRightIcon, CardIcon, ReceiptIcon } from '@/components/ui/icons'
import meituanIcon from '@/assets/spend/meituan.svg'
import taobaoIcon from '@/assets/spend/taobao.svg'
import starbucksIcon from '@/assets/spend/starbucks.svg'
import chinaMobileIcon from '@/assets/spend/china-mobile.png'
import jdIcon from '@/assets/spend/jd.png'
import pinduoduoIcon from '@/assets/spend/pinduoduo.png'
import didiIcon from '@/assets/spend/didi.png'
import luckinIcon from '@/assets/spend/luckin.png'
import hemaIcon from '@/assets/spend/hema.png'
import iqiyiIcon from '@/assets/spend/iqiyi.png'
import ziroomIcon from '@/assets/spend/ziroom.png'
import maoyanIcon from '@/assets/spend/maoyan.png'
import stripeIcon from '@/assets/spend/stripe.svg'
import customMerchantIcon from '@/assets/spend/custom-merchant.svg'
import '@/styles/spend.css'

/**
 * 平台真实图标。
 * app：整块应用图标，铺满圆角块；logo：白底留白的品牌标。
 * 缺素材的平台不出现在这里，回落成品牌色字形块；补图时按平台 id 加一行即可。
 */
const PLATFORM_ICON: Record<string, { src: string; kind: 'app' | 'logo' }> = {
  meituan: { src: meituanIcon, kind: 'logo' },
  taobao: { src: taobaoIcon, kind: 'logo' },
  starbucks: { src: starbucksIcon, kind: 'logo' },
  'china-mobile': { src: chinaMobileIcon, kind: 'logo' },
  jd: { src: jdIcon, kind: 'app' },
  pinduoduo: { src: pinduoduoIcon, kind: 'app' },
  didi: { src: didiIcon, kind: 'app' },
  luckin: { src: luckinIcon, kind: 'app' },
  hema: { src: hemaIcon, kind: 'app' },
  iqiyi: { src: iqiyiIcon, kind: 'app' },
  ziroom: { src: ziroomIcon, kind: 'app' },
  maoyan: { src: maoyanIcon, kind: 'app' },
  stripe: { src: stripeIcon, kind: 'logo' },
  custom: { src: customMerchantIcon, kind: 'logo' },
}

function PlatformIcon({ id, tone, ink, glyph, size = 36 }: {
  id: string
  tone: string
  ink?: string
  glyph: string
  size?: number
}) {
  const icon = PLATFORM_ICON[id]
  return <span aria-hidden="true"
    className={`spend-icon${icon ? (icon.kind === 'app' ? ' is-app' : ' is-color') : ''}`}
    style={{ width: size, height: size, background: icon ? undefined : tone }}>
    {icon
      ? <img src={icon.src} alt="" />
      : <span className="spend-icon-glyph" style={{ color: ink ?? '#fff' }}>{glyph}</span>}
  </span>
}

const AMOUNT_PRESETS: Cents[] = [2_000, 5_000, 10_000, 30_000]

/** 把用户输入的「38.5」解析成分；非法返回 null。 */
function parseAmount(raw: string): Cents | null {
  const text = raw.trim()
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(text)) return null
  const [yuan, cents = ''] = text.split('.')
  const value = Number(yuan) * 100 + Number(cents.padEnd(2, '0'))
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

const STATUS_LABEL: Record<BankCard['status'], string> = {
  lost: '已挂失',
  active: '使用中',
  locked: '已锁定',
  pending: '待激活',
  replaced: '已换卡',
}

/**
 * 模拟消费。
 *
 * 演示「在外部商户刷卡」：预设国内常用平台，选卡、填金额，由服务端从卡绑定的
 * 资金账户扣款并落一笔卡类流水；分类交给服务端分类器判定，页面只显示结果。
 *
 * 入口支持带标记的链接直接进入并预选平台：
 *   /spend?merchant=meituan   或   /spend#meituan
 */
export function SpendPage() {
  const toast = useToast()
  const [params] = useSearchParams()
  const cards = useAsync<BankCard[]>(() => api.listCards(), [])
  const marker = params.get('merchant') ?? window.location.hash.replace(/^#/, '')
  const preset = findSpendPlatform(marker)
  const [platformId, setPlatformId] = useState<string>(preset?.id ?? SPEND_PLATFORMS[0].id)
  const [cardId, setCardId] = useState<string | null>(null)
  const [amountText, setAmountText] = useState('38.50')
  /** 账单详情：店铺/商品说明，可留空 */
  const [noteText, setNoteText] = useState('')
  /** 自由商家（自定义/Stripe）的商户名称 */
  const [merchantText, setMerchantText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState<SpendReceipt | null>(null)
  /** 后台分类完成后回填的最终分类；null 表示还没拿到 */
  const [classified, setClassified] = useState<TransactionCategory | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const usable = useMemo(
    () => (cards.data ?? []).filter(card => card.status === 'active'),
    [cards.data],
  )
  // 只有使用中的卡能消费；没选过就默认第一张可用卡
  const effectiveCardId = cardId && usable.some(card => card.id === cardId)
    ? cardId
    : usable[0]?.id ?? null
  const selectedCard = usable.find(card => card.id === effectiveCardId) ?? null
  const presetPlatform = findSpendPlatform(platformId)
  const freePlatform = presetPlatform ? null : findFreeMerchant(platformId)
  const platform = presetPlatform ?? freePlatform ?? SPEND_PLATFORMS[0]
  const merchantName = merchantText.trim()
  const merchantValid = !freePlatform || (merchantName.length >= 2 && merchantName.length <= FREE_MERCHANT_NAME_MAX)
  const amount = parseAmount(amountText)
  const overCap = amount !== null && amount > SPEND_MAX_CENTS

  useEffect(() => {
    // 平台来自链接标记时提示一下，避免用户以为是随机默认
    if (preset) toast.show(`已按链接预选「${preset.name}」`, 'info')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 回执里分类是 pending 时轮询交易详情，直到分类完成/失败（最多约 20 秒）
  useEffect(() => {
    if (!receipt || receipt.classificationState !== 'pending') return
    let stopped = false
    let tries = 0
    const tick = async () => {
      if (stopped) return
      tries += 1
      try {
        const record = await api.getTransaction(receipt.transaction.id)
        if (stopped) return
        if (record.classificationState && record.classificationState !== 'pending') {
          setClassified(record.category)
          setReceipt(prev => prev ? { ...prev, category: record.category, classificationState: record.classificationState, transaction: { ...prev.transaction, category: record.category, classificationState: record.classificationState } } : prev)
          return
        }
      } catch { /* 单次查询失败继续轮询 */ }
      if (tries < 14) pollTimer.current = setTimeout(() => void tick(), 1500)
    }
    pollTimer.current = setTimeout(() => void tick(), 1200)
    return () => { stopped = true; if (pollTimer.current) clearTimeout(pollTimer.current) }
  }, [receipt])

  async function submit() {
    if (!selectedCard || amount === null || overCap) return
    setSubmitting(true); setError(null)
    try {
      const note = noteText.trim()
      const result = await api.spendOnCard(selectedCard.id, {
        platform: platform.id,
        amount,
        ...(note ? { note } : {}),
        ...(freePlatform ? { merchant: merchantName } : {}),
      })
      setClassified(result.classificationState === 'pending' ? null : result.category)
      setReceipt(result)
      cards.reload()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '模拟消费失败，请稍后重试')
    } finally { setSubmitting(false) }
  }

  return <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-5 px-4 py-7 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink">模拟消费</h1>
        <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-ink-soft">
          在预设商户上模拟一次刷卡：从所选银行卡绑定的资金账户扣款，落一笔卡类流水。
          交易分类由服务端分类器按商户判定，与真实刷卡同一条链路。
        </p>
        <p className="mt-2 text-[13px] text-ink-mute">
          给某几个平台设了每日额度？
          <Link to="/analysis/budgets" className="ml-1 font-medium text-gold-deep underline-offset-2 hover:underline">去支出预算看看</Link>
        </p>
      </div>
      <Tag tone="gold">演示功能 · 不产生真实扣款</Tag>
    </header>

    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <Card>
        <CardHeader title="1. 选择消费平台" />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[...SPEND_PLATFORMS, ...FREE_SPEND_MERCHANTS].map(item => {
            const active = item.id === platform.id
            const subtitle = 'merchantId' in item ? `${item.city} · ${item.merchantId}` : item.counterpartyBank
            return (
              <button key={item.id} type="button" onClick={() => setPlatformId(item.id)}
                className={`flex items-center gap-2.5 rounded-card border px-3 py-2.5 text-left transition-colors ${active ? 'border-gold bg-gold-tint text-ink' : 'border-line bg-surface text-ink-soft hover:bg-sunk'}`}>
                <PlatformIcon id={item.id} tone={item.tone} ink={(item as { ink?: string }).ink} glyph={item.glyph} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{item.name}</span>
                  <span className="num mt-0.5 block truncate text-[11px] text-ink-mute">{subtitle}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <Field label="消费金额（元）" value={amountText} inputMode="decimal"
              onChange={e => setAmountText(e.target.value)}
              error={amount === null ? '请输入不超过两位小数的金额' : overCap ? `单笔上限 ¥${formatAmount(SPEND_MAX_CENTS)}` : undefined} />
            <div className="mt-2 flex flex-wrap gap-2">
              {AMOUNT_PRESETS.map(presetAmount => (
                <button key={presetAmount} type="button" onClick={() => setAmountText((presetAmount / 100).toFixed(2))}
                  className="rounded-chip border border-line px-3 py-1 text-[12px] text-ink-soft hover:bg-sunk">
                  ¥{formatAmount(presetAmount)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-soft">用哪张卡</p>
            {cards.loading ? <p className="text-[13px] text-ink-mute">加载中…</p>
              : usable.length === 0 ? <EmptyState title="没有可消费的卡" description="锁定、待激活或已换发的卡不能消费" />
              : <div className="flex flex-col gap-2">
                {usable.map(card => {
                  const active = card.id === effectiveCardId
                  return (
                    <button key={card.id} type="button" onClick={() => setCardId(card.id)}
                      className={`flex items-center justify-between gap-3 rounded-card border px-3 py-2 text-left transition-colors ${active ? 'border-gold bg-gold-tint' : 'border-line bg-surface hover:bg-sunk'}`}>
                      <span className="flex items-center gap-2 text-[13px] text-ink"><CardIcon size={15} />{card.productName}</span>
                      <span className="num text-[12px] text-ink-soft">尾号 {card.last4}</span>
                    </button>
                  )
                })}
              </div>}
            {selectedCard && <p className="mt-2 text-[12px] text-ink-mute">单日限额 ¥{formatAmount(selectedCard.dailyLimit)}，{STATUS_LABEL[selectedCard.status]}</p>}
          </div>
        </div>

        {freePlatform && <div className="mt-4">
          <Field label="商户名称" value={merchantText} maxLength={FREE_MERCHANT_NAME_MAX}
            placeholder={freePlatform.noteHint}
            error={merchantText.length > 0 && !merchantValid ? `商户名称需为 2–${FREE_MERCHANT_NAME_MAX} 字` : undefined}
            onChange={e => setMerchantText(e.target.value)} />
          <p className="mt-1 text-[11px] text-ink-mute">
            {freePlatform.id === 'stripe' ? '回单对方机构记为 Stripe Payments（境外收单）。' : '商户名任意，回单对方机构记为「自定义收单」。'}
          </p>
        </div>}

        <div className="mt-4">
          <Field label="账单详情（可选）" value={noteText} maxLength={80} placeholder={platform.noteHint}
            onChange={e => setNoteText(e.target.value)} />
          <p className="mt-1 text-[11px] text-ink-mute">写进流水摘要，如店铺名与商品；留空则记为「{platform.name} 消费」。</p>
        </div>

        {error && <p role="alert" className="mt-4 text-[13px] text-coral">{error}</p>}
        <Button block size="lg" className="mt-5" variant="primary" loading={submitting}
          disabled={!selectedCard || amount === null || overCap || !merchantValid} onClick={() => void submit()}>
          模拟刷卡 ¥{amount !== null ? formatAmount(amount) : '—'}
        </Button>
      </Card>

      <div className="flex flex-col gap-5">
        {receipt ? <Card className="bg-gold-tint">
          <CardHeader title="消费成功" />
          <p className="mt-4 flex items-center gap-2.5 text-[13px] text-ink-soft">
            <PlatformIcon id={platform.id} tone={platform.tone} ink={(platform as { ink?: string }).ink} glyph={platform.glyph} size={30} />
            在「{receipt.transaction.counterparty}」的模拟消费已记账。
          </p>
          <dl className="mt-4 flex flex-col gap-3 text-[14px]">
            <div className="flex justify-between gap-4"><dt className="text-ink-soft">商户</dt><dd className="text-right text-ink">{receipt.transaction.counterparty}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-soft">账单详情</dt><dd className="text-right text-ink">{receipt.transaction.memo}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-soft">金额</dt><dd className="num text-right text-ink">¥{formatAmount(receipt.transaction.amount)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-soft">分类</dt><dd className="text-right text-ink">
              {receipt.classificationState === 'pending'
                ? <span className="inline-flex items-center gap-1.5 text-ink-mute"><span className="size-1.5 animate-pulse rounded-full bg-gold" />正在分类…</span>
                : <>{CATEGORY_LABEL[classified ?? receipt.category]}<span className="ml-1 text-[11px] text-ink-mute">{receipt.classificationState === 'failed' ? '分类器暂不可用' : '分类器判定'}</span></>}
            </dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-soft">扣款账户余额</dt><dd className="num text-right text-ink">{formatCurrency(receipt.available, receipt.currency)}</dd></div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to={`/transactions/${receipt.transaction.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-gold-deep">查看交易详情 <ArrowRightIcon size={14} /></Link>
            <Link to="/analysis" className="inline-flex items-center gap-1 text-[13px] font-medium text-gold-deep">去账单看统计 <ArrowRightIcon size={14} /></Link>
          </div>
        </Card> : <Card>
          <CardHeader title="刷卡说明" />
          <ul className="mt-4 flex flex-col gap-3 text-[13px] leading-relaxed text-ink-soft">
            <li className="flex gap-2"><ReceiptIcon size={15} className="mt-0.5 shrink-0 text-ink-mute" />扣的是卡绑定的资金账户余额，不新建账户；多张卡共享同一个账户。</li>
            <li className="flex gap-2"><CardIcon size={15} className="mt-0.5 shrink-0 text-ink-mute" />锁定、待激活、已换发的卡不能消费；关闭线上支付的卡同样拒绝。</li>
            <li className="flex gap-2"><ReceiptIcon size={15} className="mt-0.5 shrink-0 text-ink-mute" />单笔上限 ¥{formatAmount(SPEND_MAX_CENTS)}，并受单日限额、渠道限额与商户类别限额约束。</li>
            <li className="flex gap-2"><ReceiptIcon size={15} className="mt-0.5 shrink-0 text-ink-mute" />账单详情可写店铺与商品（如「嗉泰面（大朗店）· 猪扒包」），会写进流水摘要。</li>
            <li className="flex gap-2"><ReceiptIcon size={15} className="mt-0.5 shrink-0 text-ink-mute" />链接带标记可直接进入并预选平台：<span className="num">/spend?merchant=meituan</span></li>
          </ul>
        </Card>}
      </div>
    </div>
  </div>
}
