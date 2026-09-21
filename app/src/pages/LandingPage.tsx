/**
 * 官网首页（`/`）。
 *
 * ## 这一页的定位
 *
 * 它是一家银行的**官网**，不是技术说明页。所以版面按银行官网的常规骨架来：
 * 品牌主张的大字首屏 + 主 CTA → 三条服务承诺 → 图文交替的功能板块
 * （每个板块：小标题 + 一句话 + 三个「粗体标签：说明」+ 了解更多）→ 更多服务
 * → 开户引导 → 页脚。功能板块的次序也按银行官网的习惯排：
 * **智能助手 / 投资理财 / 账单分析 / 转账与银行卡**，安全能力放在「还有这些」里。
 *
 * ## 三条写法规矩
 *
 * **1. 只写应用里真的做了的事。** 官网最容易变成"愿景墙"——写一堆规划中的能力，
 * 用户点进去发现没有。下面每一块都对应真实存在、能点进去用的页面；没做的
 * （保险 / 贷款 / 股票 / 基金 / 信用卡分期）一个字都不提。
 *
 * **2. 正文不重复"这是演示作品"的声明。** 演示标识由 `DemoWatermark` 在**每条路由上
 * 常驻**显示（文案是「比赛演示作品 · 非真实银行」，无障碍名里写明了"不提供任何金融服务、
 * 所有数据均为模拟"）。正文再写一遍只是把同一件事说三次，还把功能说明挤掉了。
 * **但也不许顺势写"真实银行"这类反向的假话**——不声明不等于可以乱说，
 * 下面每一句仍然必须是这个项目真的做到的（`tools/check-landing.mjs` 里有反向断言：
 * 一旦出现"百万用户""年度数字银行"这种编造的背书就会失败）。
 *
 * **3. 界面图都是画出来的 HTML，且标了「界面示意」。** 不用截图：改了界面没人回来换图，
 * 而且图片没有深色值。用的色板与排版和应用里完全一致，所以看起来和被截图一样。
 *
 * @module app/pages/LandingPage
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CatMark, Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import {
  ArrowDownLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BoltIcon,
  CardIcon,
  ChartIcon,
  CheckIcon,
  FoodIcon,
  GlobalIcon,
  HouseIcon,
  LockIcon,
  MicIcon,
  PhoneIcon,
  PigIcon,
  ShieldIcon,
  ShopIcon,
  SparkleIcon,
  TransferIcon,
  WalletIcon,
} from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useSession } from '@/store/session-context'

/* ══════════════════════════════════════════════════════════ 界面示意图零件 ══
   都是纯 HTML，用的是应用里同一套 token，所以它们和被截图的真实界面长得一样。 */

/** 示意图外面那层壳：标明这是示意，避免被当成实时数据。 */
function Mock({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('card overflow-hidden', className)}>
      <div className="flex items-center gap-2 border-b border-line bg-sunk px-4 py-2.5">
        <span className="size-2 rounded-chip bg-line-strong" />
        <span className="size-2 rounded-chip bg-line-strong" />
        <span className="ml-1.5 text-[11px] text-ink-mute">界面示意 · {label}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

/** 账户概览：首屏右侧的主视觉，一眼看出"这是一家银行"。 */
function AccountMock() {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[12px] text-ink-mute">总资产</p>
          <p className="num mt-1 text-[28px] leading-none font-semibold text-ink">¥42,864.50</p>
          <p className="mt-1 text-[11px] text-ink-mute">CNY · 含理财持仓</p>
        </div>
        <span className="grid size-9 place-items-center rounded-chip bg-gold-wash">
          <CatMark className="size-5 text-gold-deep" cutout="var(--color-gold-wash)" />
        </span>
      </div>

      <div className="mt-5 space-y-2">
        {[
          ['Ⅰ 类户 · 活期', '¥12,864.50', '**** 6688'],
          ['稳健增利 90 天', '¥30,000.00', 'R2'],
        ].map(([name, amount, tail]) => (
          <div key={name} className="flex items-baseline justify-between gap-3 rounded-chip bg-sunk px-3.5 py-2.5">
            <span className="text-[12px] text-ink-soft">{name}</span>
            <span className="num text-[13px] font-medium text-ink">{amount}</span>
            <span className="num text-[11px] text-ink-mute">{tail}</span>
          </div>
        ))}
      </div>

      {/* 最近一笔：银行首页几乎都会放，也让"这是一本账"这件事一眼成立 */}
      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
        <span className="grid size-8 place-items-center rounded-chip bg-blue-wash">
          <ArrowUpRightIcon size={15} className="text-blue" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-ink">转账 · 梁乐怡</p>
          <p className="num text-[11px] text-ink-mute">今天 14:03</p>
        </div>
        <p className="num text-[13px] font-medium text-ink">-¥800.00</p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {([['转账', TransferIcon], ['理财', PigIcon], ['账单', ChartIcon]] as const).map(([label, Icon]) => (
          <span
            key={label}
            className="flex flex-col items-center gap-1.5 rounded-chip bg-sunk py-2.5 text-[11px] text-ink-soft"
          >
            <Icon size={16} className="text-ink-mute" />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** 智能助手：一轮对话 + 它调了工具 + 确认卡片。 */
function AssistantMock() {
  return (
    <Mock label="智能客服">
      <div className="space-y-3">
        <div className="flex justify-end">
          <p className="max-w-[88%] rounded-card bg-ink px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-invert">
            帮我看看上个月的账单
          </p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-chip bg-gold-wash">
            <CatMark className="size-4 text-gold-deep" cutout="var(--color-gold-wash)" />
          </span>
          <p className="rounded-card bg-sunk px-3.5 py-2.5 text-[12px] leading-relaxed text-ink">
            上个月共 27 笔支出，合计 6,412.30 CNY。最大一笔是 2,800.00 CNY 的房租。
          </p>
        </div>
        <div className="flex items-center gap-2 pl-9">
          <span className="inline-flex items-center gap-2 rounded-chip border border-blue-wash bg-blue-wash px-2.5 py-1 text-[11px] text-blue">
            查询交易流水
            <span className="text-blue/70">已完成</span>
          </span>
        </div>
      </div>

      {/* 确认卡片：这个助手的核心不是"能聊"，而是"该停的时候会停" */}
      <div className="mt-4 rounded-card border border-line bg-surface p-4">
        <p className="text-[13px] font-semibold text-ink">需要你确认：转账</p>
        <p className="mt-0.5 text-[11px] text-ink-soft">在你确认之前，这笔操作不会执行。</p>
        <dl className="mt-2.5 divide-y divide-line rounded-chip border border-line">
          {[
            ['收款人', '梁乐怡'],
            ['转账金额', '800.00 CNY'],
            ['收款账号', '**** 9123'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <dt className="text-[11px] text-ink-mute">{label}</dt>
              <dd className="num text-[12px] font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2.5 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-chip bg-blue-wash px-2 py-0.5 text-[10px] text-blue">
            <LockIcon size={10} />
            支付密码
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-chip bg-gold px-2.5 py-1 text-[11px] font-medium text-ink">
            <CheckIcon size={11} />
            确认并验证
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
        <span className="grid size-8 place-items-center rounded-chip bg-gold text-ink">
          <MicIcon size={15} />
        </span>
        <span className="text-[11px] text-ink-soft">按住说话，松手就发出去</span>
      </div>
    </Mock>
  )
}

/** 投资理财：净值曲线 + 风险等级 + 费用与适当性。 */
function WealthMock() {
  const spark = 'M0 46 L18 40 L36 43 L54 31 L72 34 L90 22 L108 25 L126 14'
  return (
    <Mock label="理财">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-ink">招财猫稳健增利 90 天</p>
          <p className="num mt-1 text-[11px] text-ink-mute">LC-WM-001 · 持有 90 天</p>
        </div>
        <span className="rounded-chip bg-coral-wash px-2.5 py-1 text-[11px] text-coral">R2 稳健型</span>
      </div>
      <svg viewBox="0 0 126 60" className="mt-4 h-16 w-full" aria-hidden="true">
        <path d={spark} fill="none" stroke="var(--color-gold-deep)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <p className="num mt-1 text-[10px] text-ink-mute">业绩比较基准 2.85% · 非预期收益，不承诺保本</p>
      <div className="mt-3 space-y-2 text-[11px]">
        {[
          ['管理费', '0.30% / 年（按日计提）'],
          ['认购费', '0.00%'],
          ['赎回费', '持有满 90 天免收'],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <span className="text-ink-mute">{label}</span>
            <span className="num text-ink-soft">{value}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-start gap-2 rounded-chip bg-sunk px-3 py-2.5 text-[11px] text-ink-soft">
        <ShieldIcon size={13} className="mt-0.5 shrink-0 text-ink-mute" />
        <span>风险测评结果与产品风险等级不匹配时会被硬拦截，买不进去。</span>
      </div>
    </Mock>
  )
}

/** 账单分析：分类占比环形图 + 近 6 月走势 + 分类明细。 */
function AnalysisMock() {
  const slices: [string, number, string][] = [
    ['房租', 42, 'var(--color-blue)'],
    ['餐饮', 23, 'var(--color-gold)'],
    ['购物', 19, 'var(--color-coral)'],
    ['其它', 16, 'var(--color-line-strong)'],
  ]
  // 用 stroke-dasharray 画环：周长 2πr ≈ 226（r=36），每段按占比切。
  const circumference = 226
  let offset = 0
  return (
    <Mock label="消费分析">
      <div className="flex items-center gap-6">
        <svg viewBox="0 0 96 96" className="size-24 shrink-0 -rotate-90" aria-hidden="true">
          <circle cx="48" cy="48" r="36" fill="none" stroke="var(--color-sunk)" strokeWidth="14" />
          {slices.map(([label, percent, color]) => {
            const length = (percent / 100) * circumference
            const element = (
              <circle
                key={label}
                cx="48"
                cy="48"
                r="36"
                fill="none"
                stroke={color}
                strokeWidth="14"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              />
            )
            offset += length
            return element
          })}
        </svg>
        <div className="min-w-0 flex-1 space-y-2">
          {slices.map(([label, percent, color]) => (
            <div key={label} className="flex items-center gap-2 text-[11px]">
              <span className="size-2 shrink-0 rounded-chip" style={{ backgroundColor: color }} />
              <span className="text-ink-soft">{label}</span>
              <span className="num ml-auto text-ink-mute">{percent}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-[11px] text-ink-mute">近 6 个月支出</p>
        {/* 柱高写死：这是示意图，不假装是实时数据 */}
        <div className="mt-2 flex h-14 items-end gap-2">
          {[58, 72, 46, 64, 80, 67].map((height, index) => (
            <span key={index} className="flex-1 rounded-t-[3px] bg-blue-wash" style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2 text-[11px]">
        {([
          [HouseIcon, '房租', '-¥2,800.00'],
          [FoodIcon, '餐饮', '-¥1,474.20'],
          [ShopIcon, '购物', '-¥1,218.10'],
        ] as const).map(([Icon, label, amount]) => (
          <div key={label} className="flex items-center gap-2.5">
            <span className="grid size-6 place-items-center rounded-chip bg-sunk">
              <Icon size={12} className="text-ink-mute" />
            </span>
            <span className="text-ink-soft">{label}</span>
            <span className="num ml-auto text-ink">{amount}</span>
          </div>
        ))}
      </div>
    </Mock>
  )
}

/** 转账与回单：一笔转账做完的样子。 */
function TransferMock() {
  return (
    <Mock label="电子回单">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-soft">转账 · 梁乐怡</p>
          <p className="num mt-1 text-[24px] leading-none font-semibold text-ink">-¥800.00</p>
        </div>
        <span className="rounded-chip bg-gold-wash px-2.5 py-1 text-[11px] text-gold-deep">已完成</span>
      </div>
      <dl className="mt-4 space-y-2 text-[11px]">
        {[
          ['交易编号', 'LCB-DEMO-8F2A41'],
          ['授权码', 'A7K39215'],
          ['交易前余额', '¥13,664.50'],
          ['交易后余额', '¥12,864.50'],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-mute">{label}</dt>
            <dd className="num text-ink-soft">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex items-start gap-2 rounded-chip bg-sunk px-3 py-2.5 text-[11px] text-ink-soft">
        <GlobalIcon size={13} className="mt-0.5 shrink-0 text-ink-mute" />
        <span>转数快 / 跨境支付通：收款人姓名按登记册核对过才让你确认。</span>
      </div>
    </Mock>
  )
}

/* ══════════════════════════════════════════════════════════════ 页面内容 ══ */

/** 首屏下面那三条服务承诺（银行官网的常规位置）。 */
const PROMISES: { Icon: typeof CardIcon; title: string; desc: string }[] = [
  {
    Icon: BoltIcon,
    title: '7×24 在线',
    desc: '没有营业时间。半夜想起来要转账，进来就能办。',
  },
  {
    Icon: CardIcon,
    title: '开户在线办',
    desc: '不用预约、不用跑网点，全程在线填完。',
  },
  {
    Icon: WalletIcon,
    title: '一个入口管全部',
    desc: '账户、转账、理财、账单，都在同一个地方。',
  },
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
  Mock: () => ReactNode
  flip?: boolean
}[] = [
  {
    id: 'assistant',
    to: '/support',
    linkText: '去和智能助手聊聊',
    eyebrow: '智能助手',
    title: '有事说一句，不用翻菜单',
    lead: '账户余额、交易流水、电子回单、转账、理财申购赎回，都能在对话里办。它不是只会答话的机器人——该查的它去调用工具查，该办的它去办。',
    points: [
      ['说一句就能发起', '说清收款人和金额，剩下的核对它自己做。'],
      ['敏感操作会停下来', '涉及资金和敏感信息时，先把交易信息摆出来，等你确认、验过支付密码才执行。'],
      ['能听也能念', '按住说话发消息，回复可以朗读出来。'],
    ],
    Mock: AssistantMock,
  },
  {
    id: 'wealth',
    to: '/wealth',
    linkText: '看看理财产品',
    eyebrow: '投资理财',
    title: '先测风险，再谈收益',
    lead: '6 题风险测评（有效期一年），R1–R5 产品超市，净值走势与费用披露摊开写。',
    points: [
      ['适当性硬拦截', '测评结果与产品风险等级不匹配时，申购按钮点不动。'],
      ['费用分开列', '按日计提和一次性费用不混成一个数。'],
      ['申购要三样', '抄录风险确认原文、支付密码、确认卡片。'],
    ],
    Mock: WealthMock,
    flip: true,
  },
  {
    id: 'analysis',
    to: '/analysis',
    linkText: '看看我的账单',
    eyebrow: '账单分析',
    title: '钱花在哪儿，一眼看出',
    lead: '分类占比、近 6 个月走势、流水筛选与搜索。首页还有近 7 天与 30 天的现金流图。',
    points: [
      ['分类占比', '这个月的钱去哪了，一个环看完。'],
      ['看趋势不看单点', '近 6 个月走势，支出突然变高一眼就能发现。'],
      ['从分类钻到单笔', '点进分类看流水，再从流水进单笔电子回单。'],
    ],
    Mock: AnalysisMock,
  },
  {
    id: 'transfer',
    to: '/transfer',
    linkText: '去转账',
    eyebrow: '转账与银行卡',
    title: '转出去之前，先让你看清转给谁',
    lead: '境内走银行账户或转数快，境外走跨境支付通。收款方填错一个数字，钱就去了别处——所以姓名要按登记册核对过。',
    points: [
      ['四种汇款方式', '收款账户、手机号、电邮、FPS ID 都可以。'],
      ['姓名核对后才放行', '登记册对不上就不让确认。'],
      ['每笔都有回单', '交易编号、授权码、交易前后余额对账，可直接打印。'],
    ],
    Mock: TransferMock,
    flip: true,
  },
]

/** 「还有这些」：不进主版块、但确实做出来的东西。 */
const MORE: { to: string; Icon: typeof CardIcon; title: string; desc: string }[] = [
  {
    to: '/cards',
    Icon: CardIcon,
    title: '银行卡',
    desc: '银联与 Visa 两种卡种，可选邮寄地址、在线支付制卡费，锁卡与限额随时可调。',
  },
  {
    to: '/security',
    Icon: ShieldIcon,
    title: '安全中心',
    desc: '四条交易风控规则可自行开关。换登录手机号与改登录密码都要人脸核身。',
  },
  {
    to: '/open-account',
    Icon: SparkleIcon,
    title: '在线开户',
    desc: 'Ⅰ / Ⅱ / Ⅲ 类户的类别与限额写在页面上，短信验证码与人脸核身两步都走。',
  },
]

const NAV: { href: string; label: string }[] = [
  { href: '#assistant', label: '智能助手' },
  { href: '#wealth', label: '投资理财' },
  { href: '#analysis', label: '账单分析' },
  { href: '#transfer', label: '转账与银行卡' },
]

export function LandingPage() {
  const { user } = useSession()
  // **是 `null` 不是 `undefined`**：写成 `user !== undefined` 会永远为真，
  // 于是官网一直显示「已登录」的样子、`立即开户` 那个入口根本不出现
  // （实测踩到，由 `tools/check-landing.mjs` 的一条断言抓出来）。
  const loggedIn = user !== null

  return (
    <div className="min-h-svh bg-paper">
      {/* ── 吸顶导航 ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-8 px-6">
          <Link to="/" aria-label="招财猫银行首页">
            <Logo markClass="h-9 w-9" wordClass="text-[21px]" />
          </Link>
          <nav className="hidden items-center gap-6 lg:flex">
            {NAV.map(({ href, label }) => (
              <a key={href} href={href} className="text-[13px] text-ink-soft transition-colors hover:text-ink">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {/* 已登录时**只留一个**入口：并排放两个都指向同一处的按钮，
                一主一辅看着像两件不同的事，其实一样 */}
            {!loggedIn && (
              <Link to="/login">
                <Button size="sm" variant="ghost">登录</Button>
              </Link>
            )}
            <Link to={loggedIn ? '/dashboard' : '/open-account'}>
              <Button size="sm" variant="primary" trailing={<ArrowRightIcon size={15} />}>
                {loggedIn ? '进入总览' : '立即开户'}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* 主区域标记：读屏软件要能跳到主体；检查脚本也靠它把正文和常驻水印分开读 */}
      <main>
        {/* ── 首屏 ───────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          {/* 背景几何：和登录页同一套语言（暖金 + 蓝的浅色块），不用图片 */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -top-24 -right-24 size-[420px] rounded-full bg-blue-wash" />
            <div className="absolute top-40 -left-32 size-[320px] rounded-full bg-gold-wash opacity-70" />
          </div>

          <div className="relative mx-auto max-w-[1120px] px-6 pt-16 pb-14 sm:pt-24 sm:pb-18">
            <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="float-up">
                <h1 className="text-[42px] leading-[1.08] font-bold tracking-[-0.03em] text-ink sm:text-[60px]">
                  新形态银行
                  <br />
                  从一句话开始
                </h1>
                <p className="mt-6 max-w-[560px] text-[16px] leading-relaxed text-ink-soft">
                  不用在菜单里一层层找功能。账户、转账、理财、账单，
                  <span className="text-ink">说一句就能办</span>；
                  而涉及资金的操作，它一定先给你看、等你确认。
                </p>

                <div className="mt-9 flex flex-wrap gap-3">
                  <Link to={loggedIn ? '/dashboard' : '/open-account'}>
                    <Button size="lg" variant="primary" trailing={<ArrowRightIcon size={16} />}>
                      {loggedIn ? '进入总览' : '立即开户'}
                    </Button>
                  </Link>
                  <a href="#assistant">
                    <Button size="lg" variant="secondary">看它能做什么</Button>
                  </a>
                </div>

                <p className="mt-6 max-w-[520px] text-[13px] leading-relaxed text-ink-mute">
                  任意 11 位手机号 + 密码 <span className="num text-ink-soft">123456</span> 即可进入。
                  涉及金额、卡号、流水的地方，界面上都会标明是占位数据。
                </p>
              </div>

              <div className="float-up" style={{ animationDelay: '90ms' }}>
                <AccountMock />
                <p className="mt-3 text-center text-[11px] text-ink-mute">界面示意 · 账户总览</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 三条服务承诺 ───────────────────────────────────────────── */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-[1120px] gap-px px-6 sm:grid-cols-3 sm:gap-8 sm:py-10">
            {PROMISES.map(({ Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4 py-6 sm:py-0">
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
        <div className="mx-auto max-w-[1120px] px-6">
          {FEATURES.map(({ id, to, linkText, eyebrow, title, lead, points, Mock: Panel, flip }) => (
            <section
              key={id}
              id={id}
              /* scroll-mt 是给吸顶导航留的位置：不写的话锚点跳过来标题会被导航条压住 */
              className="scroll-mt-20 border-b border-line py-16 last:border-b-0 sm:py-20"
            >
              <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
                <div className={cn(flip && 'lg:order-2')}>
                  <span className="text-[12px] font-medium tracking-wide text-gold-deep">{eyebrow}</span>
                  <h2 className="mt-3 text-[28px] leading-[1.2] font-bold tracking-[-0.02em] text-ink sm:text-[34px]">
                    {title}
                  </h2>
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
                  <Link to={to} className="mt-7 inline-flex">
                    <Button size="sm" variant="secondary" trailing={<ArrowRightIcon size={14} />}>
                      {linkText}
                    </Button>
                  </Link>
                </div>
                <div className={cn(flip && 'lg:order-1')}>
                  <Panel />
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* ── 还有这些 ───────────────────────────────────────────────── */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-[1120px] px-6 py-16 sm:py-20">
            <h2 className="text-[26px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[30px]">
              还有这些
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              {MORE.map(({ to, Icon, title, desc }) => (
                <Link
                  key={to}
                  to={to}
                  className="group flex flex-col rounded-card border border-line bg-paper p-6 transition-colors hover:border-gold"
                >
                  <span className="grid size-10 place-items-center rounded-chip bg-sunk">
                    <Icon size={19} className="text-ink-soft" />
                  </span>
                  <span className="mt-4 text-[16px] font-semibold text-ink">{title}</span>
                  <span className="mt-2.5 flex-1 text-[13px] leading-relaxed text-ink-soft">{desc}</span>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-mute transition-colors group-hover:text-gold-deep">
                    进去看看
                    <ArrowRightIcon size={14} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ── 开户引导 ───────────────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-[1120px] px-6 py-16 sm:py-20">
            <h2 className="text-[26px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[30px]">
              三步就能用起来
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              {[
                { step: '1', title: '在线开户', desc: 'Ⅰ / Ⅱ / Ⅲ 类户任选，类别与限额写在页面上。' },
                { step: '2', title: '跟智能助手说一句', desc: '「我的账户余额还有多少？」或者「帮我转 800 元给梁乐怡，账号尾号 9123」。' },
                { step: '3', title: '核对确认卡片', desc: '涉及资金的操作会停下来等你。核对完点确认并输入支付密码，它才会执行。' },
              ].map(({ step, title, desc }) => (
                <div key={step} className="rounded-card border border-line bg-paper p-6">
                  <span className="num grid size-8 place-items-center rounded-chip bg-gold-wash text-[13px] font-semibold text-gold-deep">
                    {step}
                  </span>
                  <p className="mt-4 text-[15px] font-semibold text-ink">{title}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-4 rounded-card bg-sunk px-6 py-5">
              <p className="text-[14px] leading-relaxed text-ink">现在开户，然后去跟智能助手说第一句话。</p>
              <div className="ml-auto flex gap-3">
                <Link to={loggedIn ? '/dashboard' : '/open-account'}>
                  <Button size="sm" variant="primary" trailing={<ArrowRightIcon size={14} />}>
                    {loggedIn ? '进入总览' : '立即开户'}
                  </Button>
                </Link>
                {!loggedIn && (
                  <Link to="/login">
                    <Button size="sm" variant="ghost">登录</Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── 页脚 ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-line">
        <div className="mx-auto max-w-[1120px] px-6 py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Logo markClass="h-8 w-8" wordClass="text-[17px]" />
              <p className="mt-3 max-w-[440px] text-[12px] leading-relaxed text-ink-mute">
                账户、流水与对话记录都存在这台设备的浏览器里，不往服务器存。
              </p>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-ink-soft">
              {NAV.map(({ href, label }) => (
                <a key={href} href={href} className="transition-colors hover:text-ink">
                  {label}
                </a>
              ))}
              <Link to="/cards" className="transition-colors hover:text-ink">银行卡</Link>
              <Link to="/security" className="transition-colors hover:text-ink">安全中心</Link>
            </nav>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-6 text-[12px] text-ink-mute">
            <span className="inline-flex items-center gap-2">
              <PhoneIcon size={13} />
              客服热线 24 小时提供自助语音服务
            </span>
            <span className="inline-flex items-center gap-2">
              <ArrowDownLeftIcon size={13} />
              数据不会离开这台设备
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}
