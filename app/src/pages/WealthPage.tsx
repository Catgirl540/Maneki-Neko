import { useState } from 'react'
import { api } from '@/api'
import type {
  Account,
  RiskAssessment,
  RiskQuestion,
  WealthAccount,
  WealthCategory,
  WealthOverview,
  WealthProduct,
} from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, Segmented, Skeleton, Tag } from '@/components/ui/Segmented'
import { AlertIcon, ChartIcon, ChevronRightIcon, ShieldIcon } from '@/components/ui/icons'
import {
  ProductDetailModal,
} from '@/components/wealth/ProductDetailModal'
import { RedeemModal } from '@/components/wealth/RedeemModal'
import { RiskAssessmentModal, RiskResultModal } from '@/components/wealth/RiskAssessmentModal'
import { WealthAccountOpeningModal } from '@/components/wealth/WealthAccountOpeningModal'
import { RiskBadge, ToleranceBadge } from '@/components/wealth/RiskBadge'
import { useToast } from '@/components/ui/toast-context'
import { cn } from '@/lib/cn'
import { formatAmount } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import {
  BENCHMARK_DISCLAIMER,
  CATEGORY_LABEL,
  RISK_PLAIN_LABEL,
  TOLERANCE_LABEL,
  WEALTH_DEPOSIT_WARNING,
  benchmarkLabel,
  maxRiskFor,
} from '@/lib/wealth'

type Filter = WealthCategory | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'cash', label: '现金管理' },
  { value: 'fixed', label: '固收' },
  { value: 'mixed', label: '混合' },
  { value: 'equity', label: '权益' },
  { value: 'derivative', label: '衍生品' },
]

export function WealthPage() {
  const toast = useToast()
  const overview = useAsync<WealthOverview>(() => api.getWealthOverview(), [])
  const products = useAsync<WealthProduct[]>(() => api.listWealthProducts(), [])
  const questions = useAsync<RiskQuestion[]>(() => api.listRiskQuestions(), [])
  // 资金账户：开理财账户时要指定，申购扣款走它
  const accounts = useAsync<Account[]>(() => api.listAccounts(), [])

  const [filter, setFilter] = useState<Filter>('all')
  const [detail, setDetail] = useState<WealthProduct | null>(null)
  const [redeemTarget, setRedeemTarget] = useState<string | null>(null)
  const [assessing, setAssessing] = useState(false)
  const [assessed, setAssessed] = useState<RiskAssessment | null>(null)
  const [openingAccount, setOpeningAccount] = useState(false)

  const wealthAccount: WealthAccount | null = overview.data?.account ?? null
  const opened = wealthAccount?.opened ?? false

  const data = overview.data
  const risk = data?.risk
  const assessable = risk?.done && !risk?.expired
  const holdings = data?.holdings ?? []
  const redeemHolding = holdings.find((h) => h.id === redeemTarget) ?? null
  const redeemProduct = products.data?.find((p) => p.code === redeemHolding?.productCode) ?? null
  const list = (products.data ?? []).filter((p) => filter === 'all' || p.category === filter)

  return (
    <div className="flex flex-col gap-7">
      <header className="float-up">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-ink">理财</h1>
        <p className="mt-2 text-[14px] text-ink-mute">
          产品净值与持仓收益每日更新；购买前需完成风险承受能力评估
        </p>
      </header>

      {/* 风险揭示：监管要求在醒目位置提示 */}
      <p className="float-up flex items-start gap-2 rounded-field border border-coral-wash bg-coral-wash/40 px-4 py-3 text-[13px] font-medium text-coral">
        <AlertIcon size={16} className="mt-0.5 shrink-0" />
        {WEALTH_DEPOSIT_WARNING}
      </p>

      {/* 未开立理财账户：闸门。银行账户 ≠ 理财账户（和 ZA 一样） */}
      {overview.loading ? (
        <Skeleton className="h-52 rounded-card" />
      ) : !opened ? (
        <Card className="float-up">
          <div className="flex flex-wrap items-start gap-6">
            <span className="grid size-12 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep">
              <ShieldIcon size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[19px] leading-tight font-semibold text-ink">
                还没有理财账户
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                银行账户是装钱的地方，理财账户才是买理财的资格。
                理财账户不装钱，它把「你」和理财公司之间的委托关系立起来，
                申购扣款与赎回到账都走你指定的资金账户。
              </p>
            </div>
          </div>

          <ol className="mt-6 grid gap-4 border-t border-line pt-6 sm:grid-cols-3">
            {[
              { n: '1', title: '风险承受能力评估', desc: '监管要求，结果有效期一年' },
              { n: '2', title: '实名身份核验', desc: '姓名 / 身份证 / 短信 / 人脸' },
              { n: '3', title: '签署投资协议', desc: '并指定一个资金账户' },
            ].map((item) => (
              <li key={item.n} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-chip bg-sunk text-[12px] font-semibold text-ink-soft">
                  {item.n}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-ink">{item.title}</span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-mute">
                    {item.desc}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              icon={<ShieldIcon size={18} />}
              disabled={questions.loading || !questions.data?.length || !risk}
              onClick={() => setOpeningAccount(true)}
            >
              开立理财账户
            </Button>
            <p className="text-[12px] text-ink-mute">
              开立后可以浏览并申购理财产品；产品超市现在就可以看。
            </p>
          </div>
        </Card>
      ) : null}

      {/* 总资产 + 风险测评：仅已开立时显示 */}
      {opened && (
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="float-up">
          <p className="text-[13px] text-ink-mute">理财总资产</p>
          {overview.loading || !data ? (
            <Skeleton className="mt-4 h-12 w-56" />
          ) : (
            <>
              <p className="num mt-3 text-[clamp(30px,4.2vw,42px)] leading-none font-bold tracking-[-0.03em] text-ink">
                ¥{formatAmount(data.totalValue)}
              </p>
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-3">
                <div className="flex items-baseline justify-between gap-3 sm:block">
                  <dt className="text-[12px] text-ink-mute">累计收益</dt>
                  <dd
                    className={cn(
                      'num text-[17px] font-semibold sm:mt-1.5',
                      data.totalProfit >= 0 ? 'text-blue' : 'text-coral',
                    )}
                  >
                    {data.totalProfit >= 0 ? '+' : '-'}¥{formatAmount(Math.abs(data.totalProfit))}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 sm:block sm:border-l sm:border-line sm:pl-4">
                  <dt className="text-[12px] text-ink-mute">昨日收益</dt>
                  <dd
                    className={cn(
                      'num text-[17px] font-semibold sm:mt-1.5',
                      data.yesterdayProfit >= 0 ? 'text-blue' : 'text-coral',
                    )}
                  >
                    {data.yesterdayProfit >= 0 ? '+' : '-'}¥
                    {formatAmount(Math.abs(data.yesterdayProfit))}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 sm:block sm:border-l sm:border-line sm:pl-4">
                  <dt className="text-[12px] text-ink-mute">投入本金</dt>
                  <dd className="num text-[17px] font-semibold text-ink sm:mt-1.5">
                    ¥{formatAmount(data.totalPrincipal)}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </Card>

        <Card className="float-up" style={{ animationDelay: '60ms' }}>
          <CardHeader
            title="风险承受能力"
            action={
              assessable ? (
                <ToleranceBadge level={risk!.level} />
              ) : (
                <Tag tone="coral">{risk?.expired && risk.done ? '已过期' : '未评估'}</Tag>
              )
            }
          />
          {overview.loading || !risk ? (
            <Skeleton className="mt-4 h-20 w-full" />
          ) : assessable ? (
            <>
              <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
                可购买 <span className="font-medium text-ink">{maxRiskFor(risk.level)}</span>（
                {RISK_PLAIN_LABEL[maxRiskFor(risk.level)]}）及以下风险等级的产品。
              </p>
              <p className="num mt-2 text-[12px] text-ink-mute">
                有效期至 {risk.expiresAt.slice(0, 10)} · 监管要求满一年需重新评估
              </p>
              <Button className="mt-5" block icon={<ShieldIcon size={18} />} onClick={() => setAssessing(true)}>
                重新评估
              </Button>
            </>
          ) : (
            <>
              <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
                {risk.expired && risk.done
                  ? '你的评估结果已超过一年。监管要求重新评估后才能继续购买理财产品。'
                  : '按投资者适当性管理要求，首次购买理财产品前必须完成风险承受能力评估。'}
              </p>
              <Button
                variant="primary"
                className="mt-5"
                block
                icon={<ShieldIcon size={18} />}
                onClick={() => setAssessing(true)}
                disabled={questions.loading || !questions.data?.length}
              >
                开始评估（6 题）
              </Button>
            </>
          )}
        </Card>
      </div>
      )}

      {/* 我的持仓 */}
      {opened && (
      <Card className="float-up" style={{ animationDelay: '120ms' }}>
        <CardHeader
          title="我的持仓"
          action={<span className="text-[13px] text-ink-mute">共 {holdings.length} 笔</span>}
        />
        <div className="mt-3 divide-y divide-line">
          {overview.loading &&
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="py-4">
                <Skeleton className="h-12 w-full" />
              </div>
            ))}

          {!overview.loading && holdings.length === 0 && (
            <EmptyState title="还没有理财持仓" description="从下面的产品超市挑一只开始。" />
          )}

          {holdings.map((h) => {
            const closed = h.closed
            return (
              <div key={h.id} className="flex flex-wrap items-center gap-4 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-gold-tint text-gold-deep">
                  <ChartIcon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">
                    {h.productName}
                  </span>
                  <span className="num mt-1 block text-[12px] text-ink-mute">
                    {h.shares.toFixed(2)} 份 · 买入净值 {h.costNav.toFixed(4)}
                    {closed ? ` · 封闭至 ${h.redeemableAt!.slice(0, 10)}` : ' · 可随时赎回'}
                  </span>
                </span>
                <span className="text-right">
                  <span className="num block text-[15px] font-semibold text-ink">
                    ¥{formatAmount(h.marketValue)}
                  </span>
                  <span
                    className={cn(
                      'num mt-0.5 block text-[12px]',
                      h.profit >= 0 ? 'text-blue' : 'text-coral',
                    )}
                  >
                    {h.profit >= 0 ? '+' : '-'}¥{formatAmount(Math.abs(h.profit))}
                    {' · '}
                    {(h.profitRate * 100).toFixed(2)}%
                  </span>
                </span>
                <Button size="sm" onClick={() => setRedeemTarget(h.id)}>
                  赎回
                </Button>
              </div>
            )
          })}
        </div>
      </Card>
      )}

      {/* 产品超市 */}
      <Card className="float-up" style={{ animationDelay: '180ms' }}>
        <CardHeader
          title="产品超市"
          action={
            assessable ? (
              <span className="text-[13px] text-ink-mute">
                可购买 {maxRiskFor(risk!.level)} 及以下
              </span>
            ) : (
              <span className="text-[13px] text-coral">完成评估后可购买</span>
            )
          }
        />
        <div className="mt-4">
          <Segmented value={filter} options={FILTERS} onChange={setFilter} className="flex-wrap" />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {products.loading &&
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-card" />
            ))}

          {list.map((p) => {
            const purchasable = assessable && maxRiskFor(risk!.level) >= p.risk
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => setDetail(p)}
                className="flex min-w-0 flex-col rounded-card border border-line bg-surface p-5 text-left transition-colors hover:border-line-strong"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink">{p.name}</span>
                    <span className="mt-1 block text-[12px] text-ink-mute">
                      {p.issuer} · {CATEGORY_LABEL[p.category]}
                    </span>
                  </span>
                  <RiskBadge risk={p.risk} />
                </span>

                <span className="mt-4 flex items-end justify-between gap-3">
                  <span>
                    <span className="num block text-[22px] leading-none font-bold text-ink">
                      {p.sevenDayYield != null
                        ? `${(p.sevenDayYield * 100).toFixed(2)}%`
                        : p.nav.toFixed(4)}
                    </span>
                    <span className="mt-1.5 block text-[12px] text-ink-mute">
                      {p.sevenDayYield != null ? '七日年化' : '单位净值'}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="num block text-[13px] text-ink-soft">{p.term}</span>
                    <span className="num mt-1.5 block text-[12px] text-ink-mute">
                      {formatAmount(p.minAmount)} 元起
                    </span>
                  </span>
                </span>

                <span className="mt-4 block border-t border-line pt-3.5 text-[12px] leading-relaxed text-ink-mute">
                  业绩比较基准 {benchmarkLabel(p.benchmark)}
                </span>

                <span className="mt-3 flex items-center gap-2 text-[12px]">
                  {purchasable ? (
                    <span className="text-gold-deep">符合你的风险等级 · 查看详情</span>
                  ) : (
                    <span className="text-coral">超出你的风险承受能力</span>
                  )}
                  <ChevronRightIcon size={14} className="ml-auto text-ink-mute" />
                </span>
              </button>
            )
          })}

          {!products.loading && list.length === 0 && (
            <div className="lg:col-span-2">
              <EmptyState title="该分类下暂无产品" />
            </div>
          )}
        </div>

        <p className="mt-5 text-[12px] leading-relaxed text-ink-mute">{BENCHMARK_DISCLAIMER}</p>
      </Card>

      {/* —— 弹层 —— */}
      {assessing && questions.data && (
        <RiskAssessmentModal
          questions={questions.data}
          onClose={() => setAssessing(false)}
          onDone={(result) => {
            setAssessing(false)
            setAssessed(result)
            overview.reload()
          }}
        />
      )}

      {assessed && (
        <RiskResultModal
          result={assessed}
          onClose={() => {
            setAssessed(null)
            toast.show(`风险承受能力已更新为 ${assessed.level}（${TOLERANCE_LABEL[assessed.level]}）`, 'success')
          }}
        />
      )}

      {detail && risk && (
        <ProductDetailModal
          product={detail}
          risk={risk}
          accountOpened={opened}
          onClose={() => setDetail(null)}
          onNeedAccount={() => {
            setDetail(null)
            setOpeningAccount(true)
          }}
          onNeedAssessment={() => {
            setDetail(null)
            setAssessing(true)
          }}
          onSubscribed={() => {
            setDetail(null)
            overview.reload()
            toast.show('申购已受理，可在「我的持仓」查看', 'success')
          }}
        />
      )}

      {openingAccount && risk && questions.data && (
        <WealthAccountOpeningModal
          accounts={accounts.data ?? []}
          questions={questions.data}
          risk={risk}
          onClose={() => setOpeningAccount(false)}
          onRiskUpdated={(result) => setAssessed(result)}
          onOpened={(acc) => {
            setOpeningAccount(false)
            overview.reload()
            toast.show(`理财账户已开立（${acc.accountNo}），可以申购了`, 'success')
          }}
        />
      )}

      {redeemHolding && redeemProduct && (
        <RedeemModal
          holding={redeemHolding}
          product={redeemProduct}
          onClose={() => setRedeemTarget(null)}
          onDone={() => {
            setRedeemTarget(null)
            overview.reload()
            toast.show('赎回已受理，款项将于 T+1 个工作日到账', 'success')
          }}
        />
      )}
    </div>
  )
}
