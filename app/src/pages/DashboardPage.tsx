import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, isMockMode } from '@/api'
import { CopyButton } from '@/components/ui/CopyButton'
import type {
  Account,
  CashFlow,
  Cents,
  ReceivingInfo,
  SpendingAnalysis,
  Transaction,
} from '@/api/types'
import { CashFlowChart, CashFlowLegend } from '@/components/charts/CashFlowChart'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/Segmented'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { ArrowDownLeftIcon, ChevronRightIcon, PlusIcon, TransferIcon } from '@/components/ui/icons'
import { formatAmount, formatMoney } from '@/lib/format'
import { RevealToggle } from '@/components/ui/Reveal'
import { useAsync } from '@/lib/useAsync'
import { copyText } from '@/lib/clipboard'
import { receivingRows, receivingText } from '@/lib/receiving'
import { useReveal } from '@/lib/useReveal'
import { useToast } from '@/components/ui/toast-context'
import { useResetOnOpen } from '@/lib/usePresence'

type Range = '7' | '30'

export function DashboardPage() {
  /** 余额那块自己的眼睛 */
  const balance = useReveal()
  /** 账户速览那块自己的眼睛 —— 两块互不联动 */
  const accountsReveal = useReveal()
  const navigate = useNavigate()
  const [range, setRange] = useState<Range>('7')
  const [depositOpen, setDepositOpen] = useState(false)

  const accounts = useAsync<Account[]>(() => api.listAccounts(), [])
  const cashFlow = useAsync<CashFlow>(() => api.getCashFlow(Number(range)), [range])
  const spending = useAsync<SpendingAnalysis>(() => api.getSpending(), [])
  const current = accounts.data?.[0] ?? null

  const transactions = useAsync<{ items: Transaction[] }>(
    () => (current ? api.listTransactions(current.id, { size: 5 }) : Promise.resolve({ items: [] })),
    [current?.id],
  )

  const netChange = current?.monthNetChange ?? 0
  const opening = current ? current.balance - netChange : 0
  const ratio = opening > 0 ? netChange / opening : 0
  const netPositive = netChange >= 0

  const requests = [accounts, cashFlow, spending, transactions]
  const failed = requests.filter(state => state.error !== null && state.data === null)
  if (failed.length) return <DataUnavailable message={failed[0]!.error!} onRetry={() => failed.forEach(state => state.reload())} />
  if (requests.some(state => state.loading && state.data === null)) return <DataLoading />

  return (
    <div className="flex flex-col gap-6">
      <header className="float-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 text-[12px] font-medium tracking-wider text-gold-deep">我的账户</p>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em] text-ink sm:text-[32px]">财务总览</h1>
        </div>
        <span className="rounded-chip border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-soft">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</span>
      </header>
      {/* 第一行：余额 + 现金流 */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.08fr]">
        <Card className="balance-card float-up flex flex-col">
          <p className="text-[13px] text-ink-mute">储蓄账户余额</p>

          {accounts.loading || !current ? (
            <div className="mt-5 flex flex-col gap-4">
              <Skeleton className="h-14 w-60" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                <span className="flex items-center gap-2">
                  <span className="num text-[clamp(26px,4vw,44px)] leading-none font-bold tracking-[-0.03em] text-ink">
                    {balance.shown ? `¥${formatAmount(current.balance)}` : '¥••••••'}
                  </span>
                  {/* 只管这块余额，不跟卡片页或账户速览联动 */}
                  <RevealToggle shown={balance.shown} onToggle={balance.toggle} />
                </span>
                <span
                  className={`mb-1 inline-flex h-8 items-center gap-1 rounded-chip px-2.5 text-[13px] font-semibold ${
                    netPositive ? 'bg-blue-wash text-blue' : 'bg-coral-wash text-coral'
                  }`}
                >
                  {netPositive ? '↑ +' : '↓ -'}
                  {(Math.abs(ratio) * 100).toFixed(1)}%
                  <span className="font-normal text-ink-mute">本月</span>
                </span>
              </div>
              <p className="num mt-3 text-[13px] text-ink-mute">
                {/* 账号不遮：它本来就是给人转钱用的收款项，遮起来反而妨碍用 */}
                {current.accountNo} · 可用{' '}
                {balance.shown ? `¥${formatAmount(current.available)}` : '¥••••••'}
              </p>

              {/*
                本月收支小结：把余额卡的留白填成有效信息。

                窄屏下 3 列塞不进 6 位数金额 —— Tailwind 的 grid-cols-* 是
                repeat(N, minmax(0,1fr))，轨道可以缩到 0，但「+23,631.00」这种
                不可断行的数字缩不了，于是会溢出轨道、压过竖线、冲出卡片。
                所以窄屏落成一列「标签在左、金额在右」的行，sm 以上才回到三栏。
              */}
              <dl className="balance-summary mt-6 flex flex-col gap-4 border-t border-line pt-6 sm:grid sm:grid-cols-3 sm:gap-4">
                <div className="flex items-baseline justify-between gap-4 sm:block">
                  <dt className="shrink-0 text-[12px] text-ink-mute">本月收入</dt>
                  <dd className="num text-[17px] font-semibold text-blue sm:mt-1.5">
                    {balance.shown
                      ? `+${formatMoney(netChange + (spending.data?.total ?? 0))}`
                      : '¥••••••'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 sm:block sm:border-l sm:border-line sm:pl-4">
                  <dt className="shrink-0 text-[12px] text-ink-mute">本月支出</dt>
                  <dd className="num text-[17px] font-semibold text-ink sm:mt-1.5">
                    {balance.shown ? `-${formatMoney(spending.data?.total ?? 0)}` : '¥••••••'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 sm:block sm:border-l sm:border-line sm:pl-4">
                  <dt className="shrink-0 text-[12px] text-ink-mute">本月结余</dt>
                  <dd className="num text-[17px] font-semibold text-ink sm:mt-1.5">
                    {balance.shown
                      ? `${netPositive ? '+' : '-'}${formatMoney(Math.abs(netChange))}`
                      : '¥••••••'}
                  </dd>
                </div>
              </dl>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  icon={<TransferIcon size={18} />}
                  onClick={() => navigate('/transfer')}
                >
                  转账
                </Button>
                <Button icon={<PlusIcon size={18} />} onClick={() => setDepositOpen(true)}>
                  转入
                </Button>
                <Button variant="ghost" onClick={() => navigate('/cards')}>
                  更多
                </Button>
              </div>
            </>
          )}
        </Card>

        <Card className="float-up" style={{ animationDelay: '60ms' }}>
          <CardHeader
            title="现金流"
            action={
              <Segmented
                value={range}
                onChange={setRange}
                options={[
                  { value: '7', label: '近 7 天' },
                  { value: '30', label: '近 30 天' },
                ]}
              />
            }
          />

          <div className="mt-6">
            {cashFlow.loading ? (
              <Skeleton className="h-60 w-full" />
            ) : (
              <CashFlowChart points={cashFlow.data?.points ?? []} />
            )}
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <CashFlowLegend
              totalIncome={cashFlow.data?.totalIncome ?? 0}
              totalExpense={cashFlow.data?.totalExpense ?? 0}
            />
          </div>
        </Card>
      </div>

      {/* 第二行：最近交易 + 账户速览 */}
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Card className="float-up" style={{ animationDelay: '120ms' }}>
          <CardHeader
            title="最近交易"
            action={
              <Link
                to="/analysis"
                className="inline-flex items-center gap-0.5 text-[13px] font-medium text-gold-deep transition-colors hover:text-ink"
              >
                查看全部
                <ChevronRightIcon size={15} />
              </Link>
            }
          />
          <div className="mt-3 divide-y divide-line">
            {transactions.loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-4">
                  <Skeleton className="size-10 rounded-chip" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}

            {transactions.data?.items.length === 0 && (
              <EmptyState title="还没有交易记录" description="转入第一笔资金即可开始。" />
            )}

            {transactions.data?.items.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}
          </div>
        </Card>

        <Card className="float-up" style={{ animationDelay: '160ms' }}>
          {/* 开户入口不放在这里：侧栏「开户」与登录页「立即开户」已经覆盖，
              同一张卡片里再塞一个纯属重复 */}
          <CardHeader
            title="本月速览"
            action={
              <RevealToggle
                shown={accountsReveal.shown}
                onToggle={accountsReveal.toggle}
                label={accountsReveal.shown ? '隐藏账户余额' : '显示账户余额'}
              />
            }
          />
          <ul className="mt-3 divide-y divide-line">
            {accounts.loading &&
              Array.from({ length: 1 }).map((_, i) => (
                <li key={i} className="py-4">
                  <Skeleton className="h-9 w-full" />
                </li>
              ))}

            <li className="flex items-center gap-3 py-5">
              <span
                className="size-2.5 shrink-0 rounded-chip"
                style={{ backgroundColor: 'var(--color-chart-neutral)' }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] text-ink-soft">本月支出</span>
                <span className="mt-0.5 block text-[12px] text-ink-mute">
                  {spending.data
                    ? `环比 ${spending.data.monthOverMonth >= 0 ? '↑' : '↓'} ${Math.abs(
                        spending.data.monthOverMonth * 100,
                      ).toFixed(1)}%`
                    : '—'}
                </span>
              </span>
              <span className="num shrink-0 text-[19px] font-semibold text-ink">
                {accountsReveal.shown ? `¥${formatAmount(spending.data?.total ?? 0)}` : '¥••••••'}
              </span>
            </li>
          </ul>
        </Card>
      </div>

      {/*
        这里原来靠 `key={depositOpen ? … }` 在每次打开时重挂载，好回到「收款信息」首屏。
        那个写法**顺带把退场动画也弄没了**：关闭时 key 一变，React 立刻卸载旧实例、
        挂一个 open=false 的新实例，`Modal` 里的退场动画根本没机会播。
        现在改成常驻挂载 + 打开时重置（`useResetOnOpen`），两件事都成立。
      */}
      <MoneyInModal
        open={depositOpen}
        accountId={current?.id ?? ''}
        onClose={() => setDepositOpen(false)}
        onDone={() => {
          accounts.reload()
          transactions.reload()
          cashFlow.reload()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------- 转入 / 收款信息弹层 */

const QUICK_AMOUNTS: Cents[] = [100_000, 500_000, 1_000_000, 2_000_000]

/**
 * 「转入」= **把你的收款信息给对方**。
 *
 * 这是真实语义：银行 App 里的「转入」从来不是一个把余额改大的按钮，
 * 而是「别人要转钱给我，我该把什么抄给他」。所以默认展示户名 / 收款账户 /
 * 转数快标识，逐项带复制，并给一段「复制全部」。
 *
 * 演示环境另外保留了「模拟一笔转入」—— 不然这个 demo 里余额只能减不能加。
 * 它被明确标成演示用，且默认不在首屏，免得被当成真功能。
 */
function MoneyInModal({
  open,
  accountId,
  onClose,
  onDone,
}: {
  open: boolean
  accountId: string
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [mode, setMode] = useState<'info' | 'demo'>('info')
  const info = useAsync<ReceivingInfo>(() => api.getReceivingInfo(), [])

  // 演示表单的状态放在这一层：Modal 的 footer 是父级的 prop，
  // 表单拆成子组件的话按钮就够不到状态了
  const [amount, setAmount] = useState('1000')
  const [channel, setChannel] = useState<'card' | 'salary'>('card')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 每次重开都回到「收款信息」首屏：上次停在演示表单上，下次打开会让人以为走错了。
  useResetOnOpen(open, () => {
    setMode('info')
    setAmount('1000')
    setChannel('card')
    setError(null)
  })

  async function submitDeposit() {
    setError(null)
    setLoading(true)
    try {
      await api.deposit(accountId, Math.round(Number(amount) * 100), channel)
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '转入失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'info' ? '转入 · 收款信息' : '模拟一笔转入'}
      description={
        mode === 'info'
          ? '把这些抄到对方银行 App 的收款人里，即可转给你。'
          : '演示用：直接给储蓄账户记一笔入账，方便看清余额变化。'
      }
      width={mode === 'info' ? 'max-w-[480px]' : 'max-w-[440px]'}
      footer={
        mode === 'info' ? (
          <>
            {isMockMode && <Button block onClick={() => setMode('demo')}>
              模拟一笔转入
            </Button>}
            <Button
              block
              variant="primary"
              onClick={() => {
                if (info.data) void copyText(receivingText(info.data), '收款信息', toast)
              }}
            >
              复制全部
            </Button>
          </>
        ) : (
          <>
            <Button block onClick={() => setMode('info')}>
              返回收款信息
            </Button>
            <Button block variant="primary" loading={loading} onClick={() => void submitDeposit()}>
              确认转入
            </Button>
          </>
        )
      }
    >
      {mode === 'info' ? (
        <ReceivingPanel info={info.data} />
      ) : (
        <>
          <Field
            label="转入金额（元）"
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            icon={<ArrowDownLeftIcon size={20} />}
            error={error ?? undefined}
            hint="单笔上限 ¥50,000.00"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((cents) => (
              <button
                key={cents}
                type="button"
                onClick={() => setAmount(String(cents / 100))}
                className="h-9 rounded-chip border border-line px-3.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
              >
                ¥{formatAmount(cents)}
              </button>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            {(
              [
                { key: 'card', label: '绑定银行卡' },
                { key: 'salary', label: '工资入账' },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setChannel(item.key)}
                className={`h-11 flex-1 rounded-field border text-[14px] transition-colors ${
                  channel === item.key
                    ? 'border-gold bg-gold-wash text-gold-deep'
                    : 'border-line text-ink-soft hover:border-line-strong'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

/** 收款信息：一行一项，各自带复制 */
function ReceivingPanel({ info }: { info: ReceivingInfo | null }) {
  if (!info) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {receivingRows(info).map((row) => (
        <div key={row.key} className="flex items-center gap-3 rounded-field border border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-ink-mute">{row.label}</p>
            <p className="num mt-0.5 truncate text-[16px] font-semibold text-ink">{row.value}</p>
            {row.hint && <p className="mt-1 text-[11px] leading-relaxed text-ink-mute">{row.hint}</p>}
          </div>
          <CopyButton value={row.value} label={row.label} size="md" />
        </div>
      ))}
      <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
        转数快是香港清算网络，用手机号或 FPS ID 即可收款；内地转账则填「收款账户」，
        户名需与账户登记一致，填错会被退回。
      </p>
    </div>
  )
}
