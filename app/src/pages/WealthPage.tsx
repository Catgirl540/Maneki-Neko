import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/api'
import type { RiskAssessment, WealthCategory, WealthHolding, WealthProduct } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { EmptyState, Segmented } from '@/components/ui/Segmented'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { RevealToggle } from '@/components/ui/Reveal'
import { Modal } from '@/components/ui/Modal'
import { ChartIcon, ChevronRightIcon, PigIcon, ReceiptIcon, SearchIcon, ShieldIcon, WalletIcon } from '@/components/ui/icons'
import { ProductDetailModal } from '@/components/wealth/ProductDetailModal'
import { RedeemModal } from '@/components/wealth/RedeemModal'
import { RiskAssessmentModal, RiskResultModal } from '@/components/wealth/RiskAssessmentModal'
import { WealthAccountOpeningModal } from '@/components/wealth/WealthAccountOpeningModal'
import { RiskBadge } from '@/components/wealth/RiskBadge'
import { WealthHeader } from '@/components/wealth/WealthHeader'
import { useToast } from '@/components/ui/toast-context'
import { formatAmount, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useReveal } from '@/lib/useReveal'
import { BENCHMARK_DISCLAIMER, CATEGORY_LABEL, TOLERANCE_LABEL, benchmarkLabel, canBuyRisk } from '@/lib/wealth'
import { DEFAULT_WEALTH_FILTERS, filterWealthHoldings, filterWealthProducts, hasValidWealthRisk, type WealthFilters } from '@/lib/wealth-workspace'
import { MEMBER_TIER_RULES } from '../../../shared/membership.mjs'

const CATEGORIES: { value: WealthCategory | 'all'; label: string }[] = [
  { value: 'all', label: '全部产品' }, { value: 'cash', label: '现金管理' }, { value: 'fixed', label: '固定收益' },
  { value: 'mixed', label: '混合' }, { value: 'equity', label: '权益' }, { value: 'derivative', label: '衍生品' },
]
type View = 'overview' | 'products' | 'holdings'
const TITLES: Record<View, string> = { overview: '理财总览', products: '理财产品', holdings: '我的持仓' }

export function WealthPage({ view = 'overview' }: { view?: View }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const overview = useAsync(() => api.getWealthOverview(), [])
  const products = useAsync(() => api.listWealthProducts(), [])
  const accounts = useAsync(() => api.listAccounts(), [])
  const [detail, setDetail] = useState<WealthProduct | null>(null)
  const [redeemTarget, setRedeemTarget] = useState<string | null>(null)
  const [holdingDetail, setHoldingDetail] = useState<WealthHolding | null>(null)
  const [assessing, setAssessing] = useState(false)
  const [assessed, setAssessed] = useState<RiskAssessment | null>(null)
  const [opening, setOpening] = useState(false)
  const questions = useAsync(() => assessing || opening ? api.listRiskQuestions() : Promise.resolve(null), [assessing, opening])
  const [compareCodes, setCompareCodes] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [now] = useState(() => Date.now())
  const candidate = params.get('category')
  const category = CATEGORIES.some(item => item.value === candidate) ? candidate as WealthFilters['category'] : 'all'
  const [filters, setFilters] = useState<WealthFilters>({ ...DEFAULT_WEALTH_FILTERS })
  const [holdingFilter, setHoldingFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [activeHolding, setActiveHolding] = useState<string | null>(null)
  const balance = useReveal()

  if (!overview.data) return overview.error ? <DataUnavailable message={overview.error} onRetry={overview.reload} /> : <DataLoading />
  const data = overview.data
  const risk = data.risk
  const validRisk = hasValidWealthRisk(risk)
  const opened = data.account.opened
  const catalog = products.data ?? []
  const list = filterWealthProducts(catalog, { ...filters, category, matchedOnly: filters.matchedOnly && validRisk }, risk)
  const holdings = filterWealthHoldings(data.holdings, holdingFilter)
  const redeemHolding = data.holdings.find(holding => holding.id === redeemTarget)
  const redeemProduct = catalog.find(product => product.code === redeemHolding?.productCode)
  const compared = compareCodes.flatMap(code => catalog.find(product => product.code === code) ?? [])
  const upcoming = data.holdings.filter(holding => holding.closed && holding.redeemableAt && Date.parse(holding.redeemableAt) >= now && Date.parse(holding.redeemableAt) - now <= 7 * 86400000)
  const riskSoon = validRisk && Date.parse(risk.expiresAt) - now <= 30 * 86400000

  function toggleCompare(code: string) {
    if (compareCodes.includes(code)) setCompareCodes(compareCodes.filter(item => item !== code))
    else if (compareCodes.length < 2) setCompareCodes([...compareCodes, code])
    else toast.show('一次可比较两款产品，请先移除一款', 'info')
  }
  function setCategory(value: WealthFilters['category']) {
    setParams(previous => { const next = new URLSearchParams(previous); if (value === 'all') next.delete('category'); else next.set('category', value); return next }, { replace: true })
  }
  const productError = products.error && <DataUnavailable message={products.error} onRetry={products.reload} />

  return <div className="wealth-workspace">
    <WealthHeader title={TITLES[view]} />
    <div className="wealth-status">
      <ShieldIcon size={18} />
      <div className="wealth-status-copy"><strong>{opened ? '理财已开通' : '尚未开通理财'}</strong>
        {validRisk ? <>{risk.level && TOLERANCE_LABEL[risk.level]} · 测评有效至 {formatDate(risk.expiresAt)}</> : risk.done && risk.expired ? '风险测评已过期' : '购买前需完成风险测评'}
      </div>
      <Button size="sm" onClick={() => opened ? setAssessing(true) : setOpening(true)}>{opened ? validRisk ? '重新测评' : '完成测评' : '开通理财'}</Button>
    </div>
    {overview.error && <DataUnavailable message={overview.error} onRetry={overview.reload} />}

    {view === 'overview' && <>
      <div className="wealth-hero">
        <div className="wealth-hero-main">
          <div className="wealth-hero-label">理财持仓市值 · CNY<RevealToggle shown={balance.shown} onToggle={balance.toggle} label={balance.shown ? '隐藏理财资产' : '显示理财资产'} /></div>
          <p className="wealth-hero-value">{balance.shown ? `¥${formatAmount(data.totalValue)}` : '¥••••••'}</p>
          <dl className="wealth-metrics">
            <div><dt>累计盈亏</dt><dd className={data.totalProfit >= 0 ? 'text-blue' : 'text-coral'}>{balance.shown ? signed(data.totalProfit) : '••••••'}</dd></div>
            <div><dt>昨日收益</dt><dd className={data.yesterdayProfit >= 0 ? 'text-blue' : 'text-coral'}>{balance.shown ? signed(data.yesterdayProfit) : '••••••'}</dd></div>
            <div><dt>投入本金</dt><dd>{balance.shown ? `¥${formatAmount(data.totalPrincipal)}` : '••••••'}</dd></div>
          </dl>
        </div>
        <div className="wealth-shortcuts">
          <Link to="/wealth/products"><ChartIcon size={21} />浏览产品</Link>
          <Link to="/wealth/holdings"><WalletIcon size={21} />查看持仓 / 赎回</Link>
          <Link to="/wealth/plans"><PigIcon size={21} />存钱目标</Link>
          <Link to="/wealth/plans?tab=invest"><ReceiptIcon size={21} />定投计划</Link>
        </div>
      </div>
      <div className="wealth-two-columns">
        <section className="wealth-section">
          <SectionTitle title="我的持仓" to="/wealth/holdings" />
          {data.holdings.length ? data.holdings.slice(0, 3).map(holding => <HoldingRow key={holding.id} holding={holding} shown={balance.shown} onDetail={() => setHoldingDetail(holding)} />) : <EmptyState title="还没有理财持仓" description="先了解产品，再决定如何投资。" action={<Link className="service-link" to="/wealth/products">浏览理财产品</Link>} />}
        </section>
        <section className="wealth-section">
          <SectionTitle title="待处理事项" />
          <div>
            {!opened && <div className="wealth-task"><ShieldIcon size={18} /><p>开通投资资格，使用现有储蓄账户结算。</p><button onClick={() => setOpening(true)}>去开通</button></div>}
            {(!validRisk || riskSoon) && <div className="wealth-task"><ChartIcon size={18} /><p>{!risk.done ? '首次购买前需要完成风险测评' : risk.expired ? '测评已过期，购买前请重新评估' : '风险测评将在 30 天内到期'}</p><button onClick={() => setAssessing(true)}>去测评</button></div>}
            {upcoming.map(holding => <div className="wealth-task" key={holding.id}><WalletIcon size={18} /><p>{holding.productName}<br />{formatDate(holding.redeemableAt!)} 结束封闭期</p><Link to="/wealth/holdings">查看</Link></div>)}
            {opened && validRisk && !riskSoon && !upcoming.length && <EmptyState title="暂无待处理事项" />}
          </div>
        </section>
      </div>
      <section>
        <SectionTitle title="了解不同投资选择" to="/wealth/products" />
        {productError || (products.loading ? <DataLoading /> : <div className="wealth-product-grid">{catalog.slice(0, 3).map(product => <ProductTile key={product.code} product={product} onClick={() => setDetail(product)} />)}</div>)}
        {products.data?.length === 0 && <EmptyState title="暂无在售产品" />}
      </section>
      <p className="text-[12px] leading-relaxed text-ink-mute">{BENCHMARK_DISCLAIMER}</p>
    </>}

    {view === 'products' && <>
      <section className="wealth-section">
        <Segmented value={category} options={CATEGORIES} onChange={setCategory} className="flex-wrap" />
        <div className="wealth-filters">
          <label className="wealth-search"><SearchIcon size={17} /><input type="search" aria-label="搜索理财产品" placeholder="产品名称、代码或发行方" value={filters.keyword} onChange={event => setFilters({ ...filters, keyword: event.target.value })} /></label>
          <select aria-label="产品风险等级" value={filters.risk} onChange={event => setFilters({ ...filters, risk: event.target.value })}><option value="all">全部风险</option>{['R1', 'R2', 'R3', 'R4', 'R5'].map(level => <option key={level}>{level}</option>)}</select>
          <select aria-label="赎回开放条件" value={filters.liquidity} onChange={event => setFilters({ ...filters, liquidity: event.target.value as WealthFilters['liquidity'] })}><option value="all">全部期限</option><option value="open">开放式</option><option value="closed">有封闭期</option></select>
          <select aria-label="起购金额上限" value={filters.maxMinimum ?? ''} onChange={event => setFilters({ ...filters, maxMinimum: event.target.value ? Number(event.target.value) : null })}><option value="">不限起购金额</option><option value="10000">100 元及以下</option><option value="100000">1,000 元及以下</option><option value="1000000">10,000 元及以下</option></select>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-[12px] text-ink-mute">
          <span>{products.data ? `${list.length} 款产品` : '加载产品中'}</span>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-gold" disabled={!validRisk} checked={filters.matchedOnly && validRisk} onChange={event => setFilters({ ...filters, matchedOnly: event.target.checked })} />仅看风险匹配{!validRisk && '（需先测评）'}</label>
        </div>
        {category === 'cash' && <Link to="/wealth/cash-management" className="mt-4 inline-flex items-center gap-1 text-[13px] text-gold-deep">查看已有活钱余额与转入设置<ChevronRightIcon size={14} /></Link>}
        {productError || (products.loading ? <DataLoading /> : <div className="wealth-table-scroll mt-5"><table className="wealth-table">
          <thead><tr><th scope="col">产品</th><th scope="col">净值 / 七日年化</th><th scope="col">起购金额</th><th scope="col">期限与流动性</th><th scope="col">操作</th></tr></thead>
          <tbody>{list.map(product => <tr key={product.code}>
            <td><button className="text-left" onClick={() => setDetail(product)}><strong>{product.name}</strong><small>{product.code} · {product.issuer}</small></button><span className="mt-2 block"><RiskBadge risk={product.risk} /></span><small>{!risk.done ? '需先完成风险测评' : risk.expired ? '测评已过期，需重新评估' : canBuyRisk(risk.level, product.risk) ? '风险匹配' : '超出你的风险承受能力'}</small>
              {product.priorityOpenAt && product.priorityTier && Date.parse(product.priorityOpenAt) > now && <small>{MEMBER_TIER_RULES[product.priorityTier].label}优先购至 {formatDate(product.priorityOpenAt)}</small>}</td>
            <td><strong className="num text-[18px]">{product.sevenDayYield == null ? product.nav.toFixed(4) : `${(product.sevenDayYield * 100).toFixed(2)}%`}</strong><small>{product.sevenDayYield == null ? '单位净值' : '七日年化'} · {product.navDate}</small></td>
            <td className="num">¥{formatAmount(product.minAmount)}</td><td>{product.term}<small>{product.openEnded ? '开放式，按规则赎回' : '封闭期内不可赎回'}</small></td>
            <td><Button size="sm" onClick={() => setDetail(product)}>详情</Button><label className="mt-3 flex items-center gap-2 text-[12px] text-ink-mute"><input type="checkbox" aria-label={`比较 ${product.name}`} className="accent-gold" checked={compareCodes.includes(product.code)} onChange={() => toggleCompare(product.code)} />比较</label></td>
          </tr>)}</tbody>
        </table></div>)}
        {products.data && list.length === 0 && <EmptyState title="没有符合条件的产品" action={<Button size="sm" onClick={() => { setFilters(DEFAULT_WEALTH_FILTERS); setCategory('all') }}>清空筛选</Button>} />}
      </section>
      <p className="text-[12px] leading-relaxed text-ink-mute">{BENCHMARK_DISCLAIMER}</p>
      {compareCodes.length > 0 && <div className="wealth-compare-tray"><p>已选 {compareCodes.length}/2 款：{compared.map(product => product.name).join('、')}</p><Button size="sm" variant="ghost" onClick={() => setCompareCodes([])}>清空</Button><Button size="sm" variant="primary" disabled={compared.length !== 2} onClick={() => setComparing(true)}>开始比较</Button></div>}
    </>}

    {view === 'holdings' && <>
      <section className="wealth-section">
        <div className="flex items-center justify-between"><SectionTitle title="持仓资产 · CNY" /><RevealToggle shown={balance.shown} onToggle={balance.toggle} label={balance.shown ? '隐藏持仓金额' : '显示持仓金额'} /></div>
        <dl className="wealth-metrics"><div><dt>持有市值</dt><dd>{balance.shown ? `¥${formatAmount(data.totalValue)}` : '¥••••••'}</dd></div><div><dt>投入本金</dt><dd>{balance.shown ? `¥${formatAmount(data.totalPrincipal)}` : '¥••••••'}</dd></div><div><dt>持仓盈亏</dt><dd className={data.totalProfit >= 0 ? 'text-blue' : 'text-coral'}>{balance.shown ? signed(data.totalProfit) : '••••••'}</dd></div></dl>
      </section>
      <section className="wealth-section">
        <div className="wealth-section-heading"><Segmented value={holdingFilter} options={[{ value: 'all', label: '全部持仓' }, { value: 'open', label: '可赎回' }, { value: 'closed', label: '封闭期内' }]} onChange={setHoldingFilter} /><span className="text-[12px] text-ink-mute">{holdings.length} 笔</span></div>
        {holdings.map(holding => <HoldingRow key={holding.id} holding={holding} shown={balance.shown} onDetail={() => setHoldingDetail(holding)} onRedeem={() => setRedeemTarget(holding.id)} redeemDisabled={holding.closed || !catalog.some(product => product.code === holding.productCode)} />)}
        {!holdings.length && <EmptyState title={data.holdings.length ? '此分类暂无持仓' : '还没有理财持仓'} action={<Link className="service-link" to="/wealth/products">浏览理财产品</Link>} />}
        {productError}
      </section>
      {data.holdings.length > 0 && <section className="wealth-section"><SectionTitle title="持仓分布" /><div className="flex flex-col gap-4">{Object.entries(CATEGORY_LABEL).flatMap(([key, label]) => {
        const value = data.holdings.filter(holding => holding.category === key).reduce((sum, holding) => sum + holding.marketValue, 0)
        if (value <= 0) return []
        const ratio = data.totalValue > 0 ? value / data.totalValue : 0
        return [<div key={key} className="grid grid-cols-[150px_minmax(0,1fr)_60px] items-center gap-4 text-[13px] text-ink-soft" onPointerEnter={() => setActiveHolding(key)} onPointerLeave={() => setActiveHolding(null)}><span>{label}</span><div className="h-2 overflow-hidden rounded bg-sunk"><div className="h-full rounded bg-gold transition-opacity" style={{ width: `${ratio * 100}%`, opacity: activeHolding && activeHolding !== key ? 0.35 : 1 }} /></div><span className="num text-right">{(ratio * 100).toFixed(1)}%</span></div>]
      })}</div></section>}
    </>}

    {(assessing || opening) && questions.error && <DataUnavailable message={questions.error} onRetry={questions.reload} />}
    {(assessing || opening) && questions.loading && <DataLoading />}
    {assessing && questions.data && <RiskAssessmentModal questions={questions.data} onClose={() => setAssessing(false)} onDone={result => { setAssessing(false); setAssessed(result); overview.reload() }} />}
    {assessed && <RiskResultModal result={assessed} onClose={() => { setAssessed(null); toast.show('风险测评已更新', 'success') }} />}
    {opening && questions.data && accounts.data && <WealthAccountOpeningModal accounts={accounts.data} questions={questions.data} risk={risk} onClose={() => setOpening(false)} onRiskUpdated={overview.reload} onOpened={() => { setOpening(false); overview.reload(); toast.show('理财已开通，申赎通过现有储蓄资金账户结算', 'success') }} />}
    {opening && accounts.error && <DataUnavailable message={accounts.error} onRetry={accounts.reload} />}
    {detail && <ProductDetailModal product={detail} risk={risk} accountOpened={opened} onClose={() => setDetail(null)} onNeedAccount={() => { setDetail(null); setOpening(true) }} onNeedAssessment={() => { setDetail(null); setAssessing(true) }} onSubscribed={() => { setDetail(null); overview.reload(); navigate('/wealth/holdings'); toast.show('申购结果已更新，请查看持仓与资金流水', 'success') }} />}
    {redeemHolding && redeemProduct && <RedeemModal holding={redeemHolding} product={redeemProduct} onClose={() => setRedeemTarget(null)} onDone={() => { setRedeemTarget(null); overview.reload(); toast.show('赎回结果已更新，到账信息以银行回执与流水为准', 'success') }} />}
    {holdingDetail && <Modal open title="持仓详情" onClose={() => setHoldingDetail(null)} footer={<><Button block onClick={() => setHoldingDetail(null)}>关闭</Button><Button block disabled={!catalog.some(product => product.code === holdingDetail.productCode)} onClick={() => { setDetail(catalog.find(product => product.code === holdingDetail.productCode) ?? null); setHoldingDetail(null) }}>查看产品</Button></>}>
      <h2 className="mb-4 font-semibold">{holdingDetail.productName}</h2><RiskBadge risk={holdingDetail.risk} />
      <dl className="mt-5 space-y-4 text-[13px]">{[['持有份额', `${holdingDetail.shares.toFixed(2)} 份`], ['买入净值', holdingDetail.costNav.toFixed(4)], ['持有市值', balance.shown ? `¥${formatAmount(holdingDetail.marketValue)}` : '¥••••••'], ['累计盈亏', balance.shown ? signed(holdingDetail.profit) : '••••••'], ['确认日期', formatDate(holdingDetail.purchasedAt)], ['赎回状态', holdingDetail.closed ? `封闭至 ${holdingDetail.redeemableAt ? formatDate(holdingDetail.redeemableAt) : '以产品规则为准'}` : '可按产品规则赎回']].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-ink-mute">{label}</dt><dd>{value}</dd></div>)}</dl>
    </Modal>}
    <Modal open={comparing && compared.length === 2} title="产品比较" width="max-w-[820px]" onClose={() => setComparing(false)} footer={<Button block onClick={() => setComparing(false)}>返回产品列表</Button>}>
      {compared.length === 2 && <><div className="wealth-table-scroll"><table className="wealth-compare-table"><thead><tr><th scope="col">比较项</th>{compared.map(product => <td key={product.code}>{product.name}<small className="block text-ink-mute">{product.code}</small></td>)}</tr></thead><tbody>
        <tr><th scope="row">风险等级</th>{compared.map(product => <td key={product.code}><RiskBadge risk={product.risk} /></td>)}</tr>
        <tr><th scope="row">本人风险匹配</th>{compared.map(product => <td key={product.code}>{!validRisk ? '需完成有效测评' : canBuyRisk(risk.level, product.risk) ? '风险匹配，仍需核对申购条件' : '超出本人风险承受能力'}</td>)}</tr>
        <tr><th scope="row">期限与赎回</th>{compared.map(product => <td key={product.code}>{product.term}<br />{product.openEnded ? '开放式' : '封闭期内不可赎回'}</td>)}</tr>
        <tr><th scope="row">起购 / 递增</th>{compared.map(product => <td key={product.code}>¥{formatAmount(product.minAmount)} / ¥{formatAmount(product.stepAmount)}</td>)}</tr>
        <tr><th scope="row">业绩比较基准</th>{compared.map(product => <td key={product.code}>{benchmarkLabel(product.benchmark)}<small className="block mt-2 text-ink-mute">依据：{product.benchmark.basis}</small></td>)}</tr>
        <tr><th scope="row">一次性费用</th>{compared.map(product => <td key={product.code}>{product.transactionFees.length ? product.transactionFees.map(fee => <p key={fee.label}>{fee.label} {(fee.rate * 100).toFixed(2)}%</p>) : '申购、赎回免费'}</td>)}</tr>
        <tr><th scope="row">按日计提费用</th>{compared.map(product => <td key={product.code}>{product.ongoingFees.length ? product.ongoingFees.map(fee => <p key={fee.label}>{fee.label} {(fee.rate * 100).toFixed(2)}%/年</p>) : '无'}</td>)}</tr>
      </tbody></table></div><p className="mt-4 text-[12px] text-ink-mute">{BENCHMARK_DISCLAIMER}。比较不会产生申购或扣款。</p></>}
    </Modal>
  </div>
}

function signed(amount: number) { return `${amount < 0 ? '-' : '+'}¥${formatAmount(Math.abs(amount))}` }
function SectionTitle({ title, to }: { title: string; to?: string }) {
  return <div className="wealth-section-heading"><h2>{title}</h2>{to && <Link to={to}>查看全部 →</Link>}</div>
}
function HoldingRow({ holding, shown, onDetail, onRedeem, redeemDisabled }: { holding: WealthHolding; shown: boolean; onDetail: () => void; onRedeem?: () => void; redeemDisabled?: boolean }) {
  return <div className="wealth-holding"><span className="wealth-holding-mark"><ChartIcon size={18} /></span><button onClick={onDetail} className="wealth-holding-title text-left"><p>{holding.productName}</p><small>{holding.closed ? `封闭期${holding.redeemableAt ? `至 ${formatDate(holding.redeemableAt)}` : '内'}` : '可按规则赎回'} · {holding.risk}</small></button><div className="wealth-holding-value"><span>{shown ? `¥${formatAmount(holding.marketValue)}` : '¥••••••'}</span><small className={holding.profit >= 0 ? 'text-blue' : 'text-coral'}>{shown ? signed(holding.profit) : '••••••'}</small></div>{onRedeem && <Button size="sm" disabled={redeemDisabled} onClick={onRedeem}>{holding.closed ? '封闭中' : '赎回'}</Button>}</div>
}
function ProductTile({ product, onClick }: { product: WealthProduct; onClick: () => void }) {
  return <button className="wealth-product-tile" onClick={onClick}><div className="flex items-center justify-between gap-2"><small>{CATEGORY_LABEL[product.category]}</small><RiskBadge risk={product.risk} showLevel={false} /></div><h3>{product.name}</h3><div><strong>{product.sevenDayYield == null ? product.nav.toFixed(4) : `${(product.sevenDayYield * 100).toFixed(2)}%`}</strong><small>{product.sevenDayYield == null ? '单位净值' : '七日年化'} · {product.navDate}</small></div><div className="wealth-product-foot"><span>¥{formatAmount(product.minAmount)} 起</span><span>{product.term}</span></div></button>
}
