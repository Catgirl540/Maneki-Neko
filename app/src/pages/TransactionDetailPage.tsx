/* ==========================================================================
   交易详情 —— 电子回单
   --------------------------------------------------------------------------
   字段口径参照：
   · Alipay+ 交易详情页 UX 规范：交易状态 / 支付金额 / 商户名称 / 支付方式 /
     商户交易号 / 订单金额（本币 + 外币）/ 汇率，且汇率必须注明是参考汇率
   · GB/T 44554.4 银行电子回单：交易时间、金额、币种、收付款人、流水号须齐备
   · 汇率按 ISO 4217 惯例展示 —— 金额是「代码 数字」（USD 5.00），
     汇率是「数字 代码 数字」（USD 1.00 = CNY 7.29580000），
     保留 8 位小数且**不四舍五入**（凑整会造成实际贬值）
   ========================================================================== */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/api'
import type {
  Cents,
  TransactionDetail,
  TransactionRecord,
  TransactionStatus,
} from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { CategoryIcon } from '@/components/ui/CategoryIcon'
import { EmptyState, Skeleton, Tag } from '@/components/ui/Segmented'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToast } from '@/components/ui/toast-context'
import {
  AlertIcon,
  ArrowLeftIcon,
  ChatIcon,
  CheckIcon,
  DownloadIcon,
} from '@/components/ui/icons'
import { CATEGORY_LABEL } from '@/lib/categories'
import { cn } from '@/lib/cn'
import {
  CURRENCY_LABEL,
  formatAmount,
  formatDateTimeFull,
  formatFxAmount,
  formatRate,
  maskAccountNo,
} from '@/lib/format'
import { CHANNEL_LABEL, statusText } from '@/lib/tx'
import { useAsync } from '@/lib/useAsync'
import { usePendingTransaction } from '@/lib/usePendingTransaction'

const STATUS_TONE: Record<TransactionStatus, 'blue' | 'gold' | 'coral'> = {
  success: 'blue',
  pending: 'gold',
  failed: 'coral',
}

export function TransactionDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const record = useAsync(() => api.getTransaction(id), [id])
  const tx = record.data
  const detail = tx?.detail
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [recallBusy, setRecallBusy] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  /** 在途（大额延迟到账）且仍在窗口内才可撤销（§9.3） */
  const inflight = tx?.id === id && record.error === null && tx.status === 'pending' &&
    tx.pendingReason === 'inflight' && !!tx.holdUntil && Date.parse(tx.holdUntil) > nowMs
  usePendingTransaction(id, tx?.id === id && tx.status === 'pending', record.setData)
  useEffect(() => {
    if (tx?.status !== 'pending' || !tx.holdUntil) return
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [tx?.status, tx?.holdUntil])

  /** 直接粘贴链接进来时没有可回退的历史，退回流水列表而不是留一个空白页 */
  const goBack = useCallback(() => {
    if (location.key === 'default') navigate('/analysis')
    else navigate(-1)
  }, [location.key, navigate])

  const fields = tx && detail ? rowsOf(tx, detail) : []

  /**
   * 取电子回单。
   *
   * 真后端返回**带签名的临时下载地址**（银行回单不允许长期公开可访问），直接开新页下载；
   * 演示部署没有服务端 PDF 能力，`url` 为 null，退回浏览器打印 ——
   * 打印对话框里选「另存为 PDF」得到的是同一张回单。
   * 这个分支不是兜底 hack，而是接口里明确约定的能力差异。
   */
  async function downloadReceipt() {
    if (!tx) return
    setReceiptBusy(true)
    try {
      const file = await api.getReceipt(tx.id)
      if (file.url) {
        window.open(file.url, '_blank', 'noopener')
        toast.show(`回单已开始下载：${file.fileName}`, 'success')
        return
      }
      toast.show('演示环境不生成服务端 PDF，已改为打印：选「另存为 PDF」即可', 'info')
      window.print()
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '回单生成失败，请稍后重试', 'error')
    } finally {
      setReceiptBusy(false)
    }
  }

  /**
   * 撤销在途转账（§9.3）：只解冻可用余额，指令从未执行过、不发生扣款。
   * 窗口到点自动到账、或员工已拦截后就撤不了了。
   */
  async function recallTransfer() {
    if (!tx) return
    setRecallBusy(true)
    try {
      const r = await api.recallTransfer(tx.id)
      toast.show(r.memo, 'success')
      record.reload()
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : '撤销失败，请稍后重试', 'error')
    } finally {
      setRecallBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="float-up flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex h-10 items-center gap-1.5 rounded-chip pr-3.5 pl-2.5 text-[14px] font-medium text-ink-soft transition-colors hover:bg-sunk hover:text-ink print:hidden"
        >
          <ArrowLeftIcon size={19} />
          返回
        </button>
        <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em] text-ink">
          交易详情
        </h1>
        <div className="ml-auto flex items-center gap-2.5 print:hidden">
          {inflight && (
            <Button variant="danger" loading={recallBusy} onClick={() => void recallTransfer()}>
              撤销转账
            </Button>
          )}
          <Button
            variant="primary"
            icon={<DownloadIcon size={18} />}
            loading={receiptBusy}
            disabled={!tx}
            onClick={() => void downloadReceipt()}
          >
            下载电子回单
          </Button>
        </div>
      </header>

      {record.loading && <DetailSkeleton />}

      {/*
        出错时**一律**走"查不到"，即使手上还留着上一笔的数据。
        `useAsync` 是 stale-while-revalidate：拉取失败时会保留旧数据不清空
        （对列表是对的——一次抖动不该把界面打空），但这一页是**凭证**：
        把 A 的回单显示在 B 的编号下面，比空状态糟糕得多。
        触发路径不是"网络抖了一下"，而是**换了一笔交易**——客户端从
        `/transactions/txn_0007` 跳到 `/transactions/txn_9999` 时会复用组件，
        于是旧数据还在，而新的取数 404 了。实测踩到。
      */}
      {!record.loading && record.error !== null && (
        <Card className="float-up">
          <EmptyState
            title="这笔交易查不到了"
            description={record.error}
            action={<Button onClick={goBack}>返回流水</Button>}
          />
        </Card>
      )}

      {/* 没有错、也没有数据：同样给空状态（不留白屏） */}
      {!record.loading && record.error === null && !tx && (
        <Card className="float-up">
          <EmptyState
            title="这笔交易查不到了"
            description="交易编号可能有误，或已超出可查询期限。"
            action={<Button onClick={goBack}>返回流水</Button>}
          />
        </Card>
      )}

      {record.error === null && tx && detail && (
        <>
          {/* —— 凭证头 —— */}
          <Card className="float-up print:rounded-none print:border-0 print:shadow-none print:break-inside-avoid">
            <div className="flex flex-wrap items-start gap-6">
              <span
                className={cn(
                  'grid size-14 shrink-0 place-items-center rounded-card',
                  tx.direction === 'in' ? 'bg-blue-wash text-blue' : 'bg-gold-tint text-gold-deep',
                )}
              >
                <CategoryIcon category={tx.category} size={26} />
              </span>

              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[22px] leading-tight font-semibold text-ink">
                  {detail.counterpartyName ?? tx.counterparty}
                </h2>
                <p className="mt-1.5 text-[13px] text-ink-mute">
                  {CATEGORY_LABEL[tx.category]} · {CHANNEL_LABEL[detail.channel]}
                </p>
              </div>

              <div className="text-right">
                <p
                  className={cn(
                    'num text-[34px] leading-none font-bold tracking-[-0.02em]',
                    tx.direction === 'in' ? 'text-blue' : 'text-ink',
                  )}
                >
                  {tx.direction === 'in' ? '+' : '-'}¥{formatAmount(tx.amount)}
                </p>
                <p className="mt-2 text-[12px] text-ink-mute">
                  记账金额 · {CURRENCY_LABEL[detail.settleCurrency]}（{detail.settleCurrency}）
                </p>
              </div>
            </div>

            {/* 虚线撕口：纸质回单的视觉锚点 */}
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-dashed border-line-strong pt-6">
              <Tag tone={STATUS_TONE[tx.status]}>
                {tx.status === 'success' ? (
                  <CheckIcon size={14} />
                ) : (
                  <AlertIcon size={14} />
                )}
                <span className="ml-1.5">{statusText(tx.status, tx.pendingReason)}</span>
              </Tag>
              <p className="num text-[13px] text-ink-soft">{formatDateTimeFull(tx.createdAt)}</p>
              <p className="text-[13px] text-ink-soft">{detail.paymentMethod}</p>
              <p className="num ml-auto text-[12px] text-ink-mute">
                交易编号 {detail.referenceNo}
              </p>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[1.55fr_1fr]">
            {/* —— 交易信息 —— */}
            <Card className="float-up" style={{ animationDelay: '60ms' }}>
              <CardHeader
                title="交易信息"
                action={<span className="text-[13px] text-ink-mute">共 {fields.length} 项</span>}
              />
              <dl className="mt-4">
                {fields.map((row) => (
                  <InfoRow key={row.label} label={row.label} copy={row.copy}>
                    {row.value}
                  </InfoRow>
                ))}
              </dl>
            </Card>

            <div className="flex flex-col gap-6 lg:sticky lg:top-[100px] lg:self-start">
              {/* —— 账户与余额：回单的价值在于能对上账 —— */}
              <Card className="float-up print:break-inside-avoid" style={{ animationDelay: '90ms' }}>
                <CardHeader title="账户与余额" />
                <p className="mt-4 text-[14px] text-ink">
                  {detail.accountLabel}
                  <span className="num ml-2 text-[13px] text-ink-mute">
                    {maskAccountNo(detail.accountNo)}
                  </span>
                </p>

                <dl className="mt-5 flex flex-col gap-3.5 border-t border-line pt-5">
                  <BalanceLine label="交易前余额" value={detail.balanceBefore} />
                  <BalanceLine
                    label="交易金额"
                    value={tx.signedAmount}
                    tone={tx.direction === 'in' ? 'blue' : 'ink'}
                  />
                  <div className="flex items-baseline justify-between border-t border-line pt-3.5">
                    <dt className="text-[13px] text-ink-soft">交易后余额</dt>
                    <dd className="num text-[19px] leading-none font-semibold text-ink">
                      ¥{formatAmount(detail.balanceAfter)}
                    </dd>
                  </div>
                </dl>

                <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">
                  余额已按此笔交易更新。交易前余额 + 交易金额 = 交易后余额，
                  可与账户流水逐笔核对。
                </p>
              </Card>

              {/* —— 帮助入口 —— */}
              <Card className="float-up print:hidden" style={{ animationDelay: '120ms' }}>
                <CardHeader title="需要帮助？" />
                <div className="mt-5 flex flex-col gap-3">
                  <Button
                    block
                    icon={<ChatIcon size={18} />}
                    onClick={() => navigate('/assistant')}
                  >
                    对这笔交易有疑问
                  </Button>
                  <button
                    type="button"
                    onClick={() =>
                      toast.show('已收到反馈，我们会在 1 个工作日内核对商户名称与地点', 'success')
                    }
                    className="h-11 rounded-field px-4 text-[13px] text-ink-soft transition-colors hover:bg-sunk hover:text-ink"
                  >
                    商户名称 / 地点有误？提供建议
                  </button>
                </div>
                <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">
                  联系客服时请提供交易编号 {detail.referenceNo}，可最快定位到这笔交易。
                </p>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 字段表 */

interface InfoField {
  label: string
  value: ReactNode
  /** 有值时在右侧显示复制按钮 */
  copy?: string
}

/**
 * 按渠道决定显示哪一组字段 —— 这也是把渠道放进明细而不是简单标签的原因：
 * 商户信息只有消费类交易才有，对方账号只有转账才有。
 */
function rowsOf(tx: TransactionRecord, detail: TransactionDetail): InfoField[] {
  const fields: InfoField[] = [
    { label: '交易状态', value: statusText(tx.status, tx.pendingReason) },
    { label: '交易类型', value: tx.classificationState === 'pending' ? `${CATEGORY_LABEL[tx.category]} · 正在分类` : tx.classificationState === 'failed' ? `${CATEGORY_LABEL[tx.category]} · 分类暂不可用` : CATEGORY_LABEL[tx.category] },
    { label: '交易渠道', value: CHANNEL_LABEL[detail.channel] },
    { label: '交易时间', value: formatDateTimeFull(tx.createdAt) },
  ]

  // 在途（大额延迟到账）：把窗口截止时刻亮出来，客户才知道什么时候到、什么时候前能撤
  if (tx.holdUntil) {
    fields.push({ label: '在途截止', value: formatDateTimeFull(tx.holdUntil) })
  }

  if (detail.counterpartyName) {
    fields.push({ label: '对方户名', value: detail.counterpartyName })
  }
  if (detail.merchantId) {
    fields.push({ label: '商户编号', value: detail.merchantId })
  }
  if (detail.merchantCountry) {
    fields.push({
      label: '商户注册地',
      value: [detail.merchantCountry, detail.merchantCity].filter(Boolean).join(' · '),
    })
  }
  if (detail.location) {
    fields.push({ label: '交易地点', value: detail.location })
  }
  if (detail.merchantNote) {
    fields.push({ label: '商品', value: detail.merchantNote })
  }
  if (detail.counterpartyAccountNo) {
    fields.push({ label: '对方账号', value: detail.counterpartyAccountNo })
  }
  if (detail.counterpartyBank) {
    fields.push({ label: '对方机构', value: detail.counterpartyBank })
  }

  fields.push({ label: '交易编号', value: detail.referenceNo, copy: detail.referenceNo })
  fields.push({ label: '支付方式', value: detail.paymentMethod })

  if (detail.authCode) {
    fields.push({ label: '授权码', value: detail.authCode, copy: detail.authCode })
  }

  if (detail.originAmount && detail.originCurrency && detail.exchangeRate) {
    fields.push({
      label: '原交易金额',
      value: formatFxAmount(detail.originAmount, detail.originCurrency),
    })
    fields.push({
      label: '记账汇率',
      value: (
        <span className="flex flex-col items-end">
          <span className="num">
            1 {detail.originCurrency} = {detail.settleCurrency}{' '}
            {formatRate(detail.exchangeRate)}
          </span>
          <span className="mt-1 text-[12px] leading-relaxed text-ink-mute">
            {detail.exchangeRateNote ? `${detail.exchangeRateNote} · ` : ''}汇率仅供参考
          </span>
        </span>
      ),
    })
  }

  if (detail.remark) {
    fields.push({ label: '附言', value: detail.remark })
  }

  return fields
}

function InfoRow({
  label,
  copy,
  children,
}: {
  label: string
  copy?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-6 border-b border-line py-3.5 last:border-b-0">
      <dt className="w-[112px] shrink-0 text-[13px] leading-6 text-ink-mute">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-start justify-end gap-1.5 text-right">
        <span className="num min-w-0 text-[14px] leading-6 break-all text-ink">{children}</span>
        {copy && <CopyButton value={copy} label={label} />}
      </dd>
    </div>
  )
}


function BalanceLine({
  label,
  value,
  tone = 'soft',
}: {
  label: string
  value: Cents
  tone?: 'soft' | 'ink' | 'blue'
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-[13px] text-ink-soft">{label}</dt>
      <dd
        className={cn(
          'num text-[14px] font-medium',
          tone === 'blue' ? 'text-blue' : tone === 'ink' ? 'text-ink' : 'text-ink-soft',
        )}
      >
        {value > 0 && tone !== 'soft' ? '+' : value < 0 ? '-' : ''}¥{formatAmount(value)}
      </dd>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="float-up">
        <div className="flex items-start gap-6">
          <Skeleton className="size-14 rounded-card" />
          <div className="flex-1">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-3 h-4 w-32" />
          </div>
          <Skeleton className="h-9 w-40" />
        </div>
        <Skeleton className="mt-7 h-7 w-full" />
      </Card>
      <div className="grid gap-6 lg:grid-cols-[1.55fr_1fr]">
        <Card>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mt-3 h-5 w-full" />
          ))}
        </Card>
        <Card>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-5 h-24 w-full" />
        </Card>
      </div>
    </div>
  )
}
