/**
 * 官网首页（`/`）。
 *
 * ## 这一页的定位
 *
 * 它是一家银行的**官网**，不是技术说明页。结构参照六家数字银行官网调研
 * （docs/design 调研稿：微众 / 网商 / Revolut / N26 / Monzo / Starling）：
 *
 * - **导航按意图命名**（N26）：问小招 / 转账 / 理财 / 账单 / 会员，不按内部模块名
 * - **产品界面就是主视觉**（Revolut / Starling）：Hero 右侧悬浮真实的助手对话卡
 *   与会员卡面，不用插画充数
 * - **全站一个 CTA 文案**（Starling）：「注册并开户」从头用到尾，访客不用重新学习
 * - **公告条做过渡带**（微众）：Hero 与正文之间一条演示开放条
 * - **会员四档递进写法**（N26 套餐页）：「在上一档基础上，再加……」不重复罗列
 *
 * ## 三条写法规矩
 *
 * **1. 只写应用里真的做了的事。** 官网最容易变成"愿景墙"——写一堆规划中的能力，
 * 用户点进去发现没有。下面每一块都对应真实存在、能点进去用的页面；没做的
 * （保险 / 贷款 / 股票 / 基金 / 信用卡分期）一个字都不提。
 *
 * **2. 正文不重复"这是演示作品"的声明。** 演示标识由 `DemoWatermark` 在**每条路由上
 * 常驻**显示。正文再写一遍只是把同一件事说三次，还把功能说明挤掉了。
 * **但也不许顺势写"真实银行"这类反向的假话**——不声明不等于可以乱说，
 * 下面每一句仍然必须是这个项目真的做到的（`tools/check-landing.mjs` 里有反向断言：
 * 一旦出现"百万用户""年度数字银行"这种编造的背书就会失败）。
 *
 * **3. 公开页只展示服务说明，不展示编造的余额、交易或收益数据。**
 * Hero 对话卡演示的是交互方式（问一句 → 它去查 → 敏感操作停下等确认），
 * 故意不带任何金额与账户数字。
 *
 * @module app/pages/LandingPage
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import {
  ArrowRightIcon,
  ArrowDownLeftIcon,
  BoltIcon,
  CardIcon,
  DownloadIcon,
  ChartIcon,
  CheckIcon,
  ChatIcon,
  PhoneIcon,
  PigIcon,
  ShieldIcon,
  SparkleIcon,
  TransferIcon,
  WalletIcon,
} from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { formatAmount } from '@/lib/format'
import { useSession } from '@/store/session-context'
import { MEMBER_TIER_RULES } from '../../../shared/membership.mjs'
import cardStandard from '@/assets/membership/member-standard.webp'
import cardGold from '@/assets/membership/member-gold.webp'
import cardPlatinum from '@/assets/membership/member-platinum.webp'
import cardDiamond from '@/assets/membership/member-diamond.webp'

/* ═══════════════════════════════════════════ 首屏右侧：产品元素当主视觉 ══ */

/**
 * 助手对话卡——Revolut「真实 App 界面悬浮进 Hero」的做法。
 * 内容演示的是交互方式而不是数据：不放金额、不放余额。
 */
function AssistantCard() {
  const bubbles: { from: 'user' | 'cat'; text: string }[] = [
    { from: 'user', text: '转一笔账给林晓。' },
    { from: 'cat', text: '已在收款人登记册中查到「林晓」。明细卡片在这里，请核对后再继续。' },
    { from: 'user', text: '没问题，继续。' },
    { from: 'cat', text: '好的。请输入支付密码，完成后我把电子回单发给您。' },
  ]
  return (
    <div className="relative z-10 w-[300px] rounded-card border border-line bg-surface p-4 shadow-[0_24px_60px_-24px_rgba(6,27,49,0.35)]">
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <span className="grid size-7 place-items-center rounded-chip bg-gold-wash text-gold-deep"><ChatIcon size={15} /></span>
        <span className="text-[13px] font-semibold text-ink">小招 · 智能助手</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#1f9d6b]"><i className="size-1.5 rounded-full bg-[#1f9d6b]" />在线</span>
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        {bubbles.map(({ from, text }, index) => (
          <p
            key={index}
            className={cn(
              'max-w-[85%] rounded-field px-3 py-2 text-[12px] leading-relaxed',
              from === 'user' ? 'self-end bg-gold text-ink' : 'self-start bg-sunk text-ink-soft',
            )}
          >
            {text}
          </p>
        ))}
      </div>
    </div>
  )
}

/** Hero 右侧视觉：会员卡斜置垫底 + 对话卡浮前 + 徽章压角（Monzo 的做法）。 */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[400px]">
      <img
        src={cardPlatinum}
        alt="白金会员卡面"
        className="absolute -top-10 right-0 w-[240px] rotate-[8deg] rounded-card border border-line shadow-[0_20px_50px_-20px_rgba(6,27,49,0.4)]"
      />
      <div className="relative pt-16 pr-10"><AssistantCard /></div>
      {/* 徽章直接长在视觉上，不单独占区块 */}
      <span className="absolute -top-3 left-2 inline-flex rotate-[-4deg] items-center gap-1.5 rounded-chip bg-surface px-3 py-1.5 text-[12px] font-medium text-ink shadow-md">
        <BoltIcon size={13} className="text-gold-deep" />7×24 在线
      </span>
      <span className="absolute -bottom-3 right-4 inline-flex rotate-[3deg] items-center gap-1.5 rounded-chip bg-ink px-3 py-1.5 text-[12px] font-medium text-ink-invert shadow-md">
        <CheckIcon size={13} />全程线上开户
      </span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════ 功能板块配图 ══ */

/** 公开页只介绍服务，不构造账户、交易、持仓或收益数据。 */
function ServicePreview({ title, Icon, rows }: { title: string; Icon: typeof CardIcon; rows: [string, string][] }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line bg-sunk px-5 py-4">
        <span className="grid size-10 place-items-center rounded-chip bg-gold-wash text-gold-deep"><Icon size={22} /></span>
        <span className="text-[15px] font-semibold text-ink">{title}</span>
      </div>
      <dl className="divide-y divide-line px-5">
        {rows.map(([label, description]) => <div key={label} className="py-5"><dt className="text-[14px] font-medium text-ink">{label}</dt><dd className="mt-2 text-[13px] leading-relaxed text-ink-soft">{description}</dd></div>)}
      </dl>
      <p className="border-t border-line px-5 py-3 text-[12px] text-ink-mute">登录后查看账户信息与服务记录</p>
    </div>
  )
}

function WealthPreview() {
  return <ServicePreview title="理财产品" Icon={PigIcon} rows={[
    ['风险测评', '先答 6 道题，一年之内不用再测。'],
    ['产品超市', 'R1 到 R5 分级陈列，净值与费用买前写清。'],
    ['持仓与申赎', '持有份额、收益和赎回条件都在持仓页。'],
  ]} />
}
function AnalysisPreview() {
  return <ServicePreview title="账单分析" Icon={ChartIcon} rows={[
    ['分类统计', '餐饮、购物、出行各占多少，按比例排开。'],
    ['收支走势', '近 6 个月的变化一条线看完。'],
    ['回单下载', '每笔流水都能开出电子回单。'],
  ]} />
}
function TransferPreview() {
  return <ServicePreview title="转账与银行卡" Icon={TransferIcon} rows={[
    ['境内与 FPS', '银行账户、手机号、电邮、FPS ID 四种收款方式。'],
    ['姓名核对', '收款人姓名按登记册核对，对不上不放行。'],
    ['多卡同户', '多张银行卡共享同一个资金账户。'],
  ]} />
}
function AssistantPreview() {
  return <ServicePreview title="小招在线" Icon={SparkleIcon} rows={[
    ['能查', '余额、流水、回单、理财持仓，直接读账户数据。'],
    ['能办', '转账、申赎在对话里发起，明细先给您看。'],
    ['会说会听', '按住说话发消息，回复可以朗读。'],
  ]} />
}

/* ══════════════════════════════════════════════════════════════ 页面内容 ══ */

/** 首屏下面那三条服务承诺（银行官网的常规位置）。 */
const PROMISES: { Icon: typeof CardIcon; title: string; desc: string }[] = [
  { Icon: WalletIcon, title: '一个账户', desc: '储蓄账户注册即开通；多币种余额、多张银行卡，同属一户。' },
  { Icon: CheckIcon, title: '先确认再办', desc: '涉及资金的操作，先出示明细等您确认，验过支付密码才执行。' },
  { Icon: CardIcon, title: '笔笔有回单', desc: '每笔转账与申赎均生成电子回单，随时下载。' },
]

/** 图文交替的功能板块。次序按银行官网的习惯排。 */
const FEATURES: {
  id: string
  to: string
  linkText: string
  eyebrow: string
  title: string
  lead: string
  points: [string, string][]
  Preview: () => ReactNode
  flip?: boolean
}[] = [
  {
    id: 'assistant',
    to: '/assistant',
    linkText: '认识小招',
    eyebrow: '智能助手',
    title: '说一声，账就办了',
    lead: '小招连着您的真实账户。查余额、翻流水、开回单、转账、申赎理财，在对话里就能办完。',
    points: [
      ['真查真办', '小招调用工具读取账户数据，不猜、不编。'],
      ['先确认再执行', '转账、申赎先出明细卡片，您确认、验支付密码才办。'],
      ['按住说话', '支持语音输入，回复可朗读，手上忙着也能办。'],
    ],
    Preview: AssistantPreview,
  },
  {
    id: 'transfer',
    to: '/transfer',
    linkText: '查看转账方式',
    eyebrow: '转账',
    title: '转出去之前，先核对姓名',
    lead: '境内银行账户与转数快 FPS 都能转。收款人姓名按登记册核对无误后才放行，笔笔有电子回单。',
    points: [
      ['四种收款方式', '手机号、电邮、FPS ID、账号，任选其一。'],
      ['姓名先核对', '按登记册核对收款人姓名，对不上不放行。'],
      ['回单随时开', '每笔转账生成电子回单，可下载留存。'],
    ],
    Preview: TransferPreview,
    flip: true,
  },
  {
    id: 'wealth',
    to: '/wealth',
    linkText: '了解理财产品',
    eyebrow: '理财',
    title: '不合适的产品，买不了',
    lead: '先做 6 题风险测评，结果一年有效。R1 至 R5 产品均披露净值与费用；风险不匹配时，申购按钮不可用。',
    points: [
      ['六题测评', '6 道题评定风险等级，一年内有效。'],
      ['净值费用全披露', 'R1 至 R5 分级陈列，买前看得明白。'],
      ['不匹配不能买', '超出承受能力的产品，申购按钮不可用。'],
    ],
    Preview: WealthPreview,
  },
  {
    id: 'analysis',
    to: '/analysis',
    linkText: '了解账单功能',
    eyebrow: '账单',
    title: '钱花在哪，一看便知',
    lead: '按分类看占比，拉近 6 个月看走势。每笔流水可筛选、可搜索，回单即开即得。',
    points: [
      ['分类占比', '支出按类别统计，每类占多少一目了然。'],
      ['半年走势', '近 6 个月收支变化，趋势看得见。'],
      ['能筛能搜', '流水按条件筛选、按关键词搜索。'],
    ],
    Preview: AnalysisPreview,
    flip: true,
  },
]

/**
 * 会员四档：N26 套餐页的递进写法（「在上一档基础上，再加……」）。
 * 阈值与权益取自 shared/membership.mjs 的真实规则，不另造一套营销口径。
 */
const TIERS: {
  tier: keyof typeof MEMBER_TIER_RULES
  card: string
  note: string
  gains: string[]
}[] = [
  { tier: 'standard', card: cardStandard, note: '开户即是，账户功能全量可用：',
    gains: ['基础银行服务', '账单与流水分析', '在线客服工单'] },
  { tier: 'gold', card: cardGold, note: '含普通会员全部权益，另享：',
    gains: ['境外转账手续费全免', '客服工单 VIP 优先', '制卡费 5 折，每年 1 次免费', '换汇点差 9 折'] },
  { tier: 'platinum', card: cardPlatinum, note: '含金卡会员全部权益，另享：',
    gains: ['专属客户经理', '理财产品优先申购', '机场 / 高铁贵宾厅 2 次 / 年', '制卡费全免，换汇点差 8 折'] },
  { tier: 'diamond', card: cardDiamond, note: '含白金会员全部权益，另享：',
    gains: ['专属理财顾问', '境外汇款手续费减免', '贵宾厅 6 次 / 年', '制卡费每年 2 次免费（含寄送），换汇点差 7 折'] },
]

/** 导航按意图命名（N26：Plans / Save / Invest 而不是产品代号）。 */
const NAV: { href: string; label: string }[] = [
  { href: '#assistant', label: '助手' },
  { href: '#transfer', label: '转账' },
  { href: '#wealth', label: '理财' },
  { href: '#analysis', label: '账单' },
  { href: '#member', label: '会员' },
]

export function LandingPage() {
  const { user } = useSession()
  // **是 `null` 不是 `undefined`**：写成 `user !== undefined` 会永远为真，
  // 于是官网一直显示「已登录」的样子、开户入口根本不出现（check-landing 有断言）。
  const loggedIn = user !== null
  // Starling 的做法：全站一个 CTA 文案，不在每个页面换说法
  const cta = loggedIn ? '进入总览' : '注册并开户'
  const ctaTo = loggedIn ? '/dashboard' : '/open-account'

  return (
    <div className="min-h-svh bg-paper">
      {/* ── 吸顶导航 ─────────────────────────────────────────────────── */}
      <header className="sticky top-7 z-30 border-b border-line bg-paper/95 backdrop-blur-sm">
        <div className="content-shell content-shell--narrow flex min-h-16 flex-wrap items-center gap-2 py-3 sm:gap-8">
          <Link to="/" aria-label="招财猫银行首页">
            <Logo markClass="h-8 w-8 sm:h-9 sm:w-9" wordClass="text-[19px] sm:text-[21px]" />
          </Link>
          <nav className="hidden items-center gap-6 xl:flex">
            {NAV.map(({ href, label }) => (
              <a key={href} href={href} className="text-[13px] text-ink-soft transition-colors hover:text-ink">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/download" className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-chip px-3 text-[13px] font-medium text-ink hover:bg-sunk">
              <DownloadIcon size={15} />下载安卓版
            </Link>
            {!loggedIn && (
              <Link to="/login" className="inline-flex min-h-10 items-center rounded-chip px-3 text-[13px] font-medium text-ink-soft hover:bg-sunk">登录</Link>
            )}
            <Link to={ctaTo} className="inline-flex min-h-10 items-center gap-1.5 rounded-chip bg-gold px-3 text-[13px] font-medium text-ink transition-colors hover:bg-gold-deep hover:text-ink-invert">
              {cta}<ArrowRightIcon size={15} />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── 首屏 ───────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -top-24 -right-24 size-[420px] rounded-full bg-blue-wash" />
            <div className="absolute top-40 -left-32 size-[320px] rounded-full bg-gold-wash opacity-70" />
          </div>

          <div className="relative content-shell content-shell--narrow pt-16 pb-14 sm:pt-24 sm:pb-18">
            <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
              <div className="float-up">
                <h1 className="text-[42px] leading-[1.08] font-bold tracking-[-0.03em] text-ink sm:text-[60px]">
                  把钱花在日子上，
                  <br />
                  不把日子花在钱上。
                </h1>
                <p className="mt-6 max-w-[560px] text-[16px] leading-relaxed text-ink-soft">
                  注册即开通储蓄资金账户，人民币、港币余额同户分区。
                  查账、转账、理财，<span className="text-ink">说一声，小招就去办</span>。
                </p>
                <div className="mt-9 flex flex-wrap gap-3">
                  <Link to={ctaTo} className="inline-flex h-14 items-center gap-2 rounded-chip bg-gold px-6 text-[15px] font-medium text-ink transition-colors hover:bg-gold-deep hover:text-ink-invert">
                    {cta}<ArrowRightIcon size={16} />
                  </Link>
                  <Link to="/download" className="inline-flex h-14 items-center gap-2 rounded-chip border border-line bg-surface px-6 text-[15px] font-medium text-ink transition-colors hover:bg-sunk">
                    <DownloadIcon size={16} />下载安卓 App
                  </Link>
                </div>
              </div>
              <div className="float-up" style={{ animationDelay: '90ms' }}>
                <HeroVisual />
              </div>
            </div>
          </div>
        </section>

        {/* ── 公告条（微众的做法：Hero 与正文之间的过渡带）────────────── */}
        <p className="border-y border-line bg-surface">
          <span className="content-shell content-shell--narrow flex items-center gap-3 py-3 text-[13px] text-ink-soft">
            <SparkleIcon size={14} className="shrink-0 text-gold-deep" />
            【公告】谨防假冒客服诈骗：小招与本行不会以任何名义索取您的支付密码和短信验证码。
            <Link to={ctaTo} className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-gold-deep hover:underline">
              {cta}<ArrowRightIcon size={13} />
            </Link>
          </span>
        </p>

        {/* ── 三条服务承诺 ───────────────────────────────────────────── */}
        <section className="bg-surface">
          <div className="content-shell content-shell--narrow grid gap-px pb-14 sm:grid-cols-3 sm:gap-8 sm:py-10">
            {PROMISES.map(({ Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4 border-t border-line py-6 sm:border-t-0 sm:py-0">
                <span className="grid size-10 shrink-0 place-items-center rounded-chip bg-sunk">
                  <Icon size={18} className="text-ink-soft" />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-ink">{title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 图文交替的功能板块 ─────────────────────────────────────── */}
        <div className="content-shell content-shell--narrow">
          {FEATURES.map(({ id, to, linkText, eyebrow, title, lead, points, Preview: Panel, flip }) => (
            <section key={id} id={id} className="scroll-mt-20 border-b border-line py-16 last:border-b-0 sm:py-20">
              <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
                <div className={cn(flip && 'lg:order-2')}>
                  <span className="text-[12px] font-medium tracking-wide text-gold-deep">{eyebrow}</span>
                  <h2 className="mt-3 text-[28px] leading-[1.2] font-bold tracking-[-0.02em] text-ink sm:text-[34px]">{title}</h2>
                  <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{lead}</p>
                  <ul className="mt-7 space-y-4">
                    {points.map(([label, desc]) => (
                      <li key={label} className="flex gap-3">
                        <CheckIcon size={16} className="mt-1 shrink-0 text-gold-deep" />
                        <p className="text-[13px] leading-relaxed text-ink-soft">
                          <span className="font-medium text-ink">{label}：</span>
                          {desc}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <Link to={to} className="mt-7 inline-flex min-h-10 items-center gap-1.5 rounded-chip border border-line bg-surface px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-sunk">
                    {linkText}<ArrowRightIcon size={14} />
                  </Link>
                </div>
                <div className={cn(flip && 'lg:order-1')}>
                  <Panel />
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* ── 会员四档（真实规则，递进写法）───────────────────────────── */}
        <section id="member" className="scroll-mt-20 border-t border-line bg-surface">
          <div className="content-shell content-shell--narrow py-16 sm:py-20">
            <span className="text-[12px] font-medium tracking-wide text-gold-deep">会员</span>
            <h2 className="mt-3 text-[26px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[30px]">
              资产到了，等级自然到
            </h2>
            <p className="mt-4 max-w-[560px] text-[14px] leading-relaxed text-ink-soft">
              会员按上月日均资产自动评定，达标即时升级，无需报名。
            </p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {TIERS.map(({ tier, card, note, gains }) => (
                <div key={tier} className="flex flex-col rounded-card border border-line bg-paper p-5">
                  <img src={card} alt={`${MEMBER_TIER_RULES[tier].label}卡面`} className="w-full rounded-field border border-line" />
                  <p className="mt-4 text-[16px] font-semibold text-ink">{MEMBER_TIER_RULES[tier].label}</p>
                  <p className="num mt-1 text-[12px] text-ink-mute">
                    {MEMBER_TIER_RULES[tier].threshold === 0
                      ? '无门槛'
                      : `上月日均资产 ≥ ¥${formatAmount(MEMBER_TIER_RULES[tier].threshold)}`}
                  </p>
                  <p className="mt-4 text-[12px] text-ink-mute">{note}</p>
                  <ul className="mt-2 flex-1 space-y-2">
                    {gains.map((gain) => (
                      <li key={gain} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-soft">
                        <CheckIcon size={13} className="mt-0.5 shrink-0 text-gold-deep" />
                        {gain}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 三步就能用起来 ─────────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="content-shell content-shell--narrow py-16 sm:py-20">
            <h2 className="text-[26px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[30px]">
              三步就能用起来
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              {[
                { step: '1', title: '在线开户', desc: '短信验证码加人脸核身，全程线上，不用跑网点。' },
                { step: '2', title: '下载 App', desc: '安卓 App 已开放下载，账户随身带。' },
                { step: '3', title: '交给小招', desc: '查账、转账、申赎理财，说一声就办。' },
              ].map(({ step, title, desc }) => (
                <div key={step} className="rounded-card border border-line bg-paper p-6">
                  <span className="num grid size-8 place-items-center rounded-chip bg-gold-wash text-[13px] font-semibold text-gold-deep">{step}</span>
                  <p className="mt-4 text-[15px] font-semibold text-ink">{title}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-4 rounded-card bg-sunk px-6 py-5">
              <p className="text-[14px] leading-relaxed text-ink">现在开户，然后去跟小招说第一句话。</p>
              <div className="ml-auto flex gap-3">
                <Link to={ctaTo} className="inline-flex min-h-10 items-center gap-1.5 rounded-chip bg-gold px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-gold-deep hover:text-ink-invert">
                  {cta}<ArrowRightIcon size={14} />
                </Link>
                {!loggedIn && (
                  <Link to="/login" className="inline-flex min-h-10 items-center rounded-chip px-3.5 text-[13px] font-medium text-ink-soft hover:bg-sunk">登录</Link>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── 页脚 ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-line">
        <div className="content-shell content-shell--narrow py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Logo markClass="h-8 w-8" wordClass="text-[17px]" />
              <p className="mt-3 max-w-[440px] text-[12px] leading-relaxed text-ink-mute">
                一个账户，一位助手，把日常的钱管好。
              </p>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-ink-soft">
              {NAV.map(({ href, label }) => (
                <a key={href} href={href} className="transition-colors hover:text-ink">{label}</a>
              ))}
              <Link to="/cards" className="transition-colors hover:text-ink">银行卡</Link>
              <Link to="/security" className="transition-colors hover:text-ink">安全中心</Link>
              <Link to="/download" className="transition-colors hover:text-ink">下载安卓版</Link>
            </nav>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-6 text-[12px] text-ink-mute">
            <span className="inline-flex items-center gap-2"><PhoneIcon size={13} />自助服务：锁卡、限额、制卡、回单随时办</span>
            <span className="inline-flex items-center gap-2"><ArrowDownLeftIcon size={13} />小招全天在线，VIP 服务按会员等级提供</span>
            <span className="inline-flex items-center gap-2"><ShieldIcon size={13} />演示环境注册即可体验全部功能</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
