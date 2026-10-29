import { useMemo, useState } from 'react'
import type { Bank, BankRegion } from '@/api/types'
import { CheckIcon, ChevronDownIcon, SearchIcon } from './icons'
import { BANK_REGION_LABEL, describeBank } from '@/lib/bank'
import { cn } from '@/lib/cn'
import brandCat from '@/assets/design/brand-cat.png'

/**
 * 收款银行下拉选择器。
 *
 * 名录是真实数据（55 家），所以做成「收起 → 展开搜索 + 滚动列表」的下拉，
 * 而不是铺一排 chip。
 *
 * 列表**只列当前市场的全部银行**（内地 20 / 香港 35），按代码升序。
 * 市场本身由调用方推导后传入，不在这里切换：收款银行的市场是被转账方向决定的，
 * 让用户自由切反而会切出「境内转账选一家香港银行」这种矛盾状态。
 *
 * 顺带一提，市场不只是分类：两地的 3 位清算代码相互独立、会撞号，
 * 所以选中一家银行必须 (region, code) 成对记录。
 */
export function BankPicker({
  banks,
  region,
  value,
  hint,
  onValueChange,
  className,
}: {
  banks: Bank[]
  /** 当前可选的市场，由转账方向推导后传入 */
  region: BankRegion
  /** 选中的银行；null 表示未选 */
  value: Bank | null
  /** 未选时显示在触发器里的说明 */
  hint?: string
  onValueChange: (bank: Bank) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  /** 当前市场的全部银行，按代码升序；非数字代码（本行的内部代码）排最前 */
  const inMarket = useMemo(
    () =>
      banks
        .filter((b) => b.region === region)
        .sort((a, b) => {
          const an = /^\d+$/.test(a.code)
          const bn = /^\d+$/.test(b.code)
          if (an !== bn) return an ? 1 : -1
          return a.code.localeCompare(b.code)
        }),
    [banks, region],
  )

  const matched = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return inMarket
    return inMarket.filter(
      (b) => b.name.toLowerCase().includes(kw) || b.code.toLowerCase().includes(kw),
    )
  }, [inMarket, keyword])

  function toggle() {
    // 每次展开都从「全部银行」开始，不残留上一次的搜索词
    if (!open) setKeyword('')
    setOpen(!open)
  }

  function pick(bank: Bank) {
    onValueChange(bank)
    setOpen(false)
  }

  return (
    <div
      className={cn('relative', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
      }}
    >
      {/* 触发器：收起时只显示选中的那一家 */}
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择收款银行"
        className={cn(
          'flex h-14 w-full items-center gap-3 rounded-field border bg-surface px-4 text-left transition-colors',
          open ? 'border-gold' : 'border-line hover:border-line-strong',
        )}
      >
        {value ? (
          <BankMark key={`${value.region}-${value.code}`} bank={value} />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-tile bg-sunk text-ink-mute">
            <SearchIcon size={16} />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span
            className={cn('block truncate text-[15px]', value ? 'text-ink' : 'text-ink-mute')}
          >
            {value ? value.name : '请选择收款银行'}
          </span>
          <span className="num mt-0.5 block truncate text-[12px] text-ink-mute">
            {value
              ? `${BANK_REGION_LABEL[value.region]} · 银行代码 ${value.code}`
              : (hint ?? `${BANK_REGION_LABEL[region]}共 ${inMarket.length} 家`)}
          </span>
        </span>

        <ChevronDownIcon
          size={18}
          className={cn(
            'shrink-0 text-ink-mute transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="关闭银行列表"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute inset-x-0 z-50 mt-2 overflow-hidden rounded-field border border-line bg-surface shadow-[0_18px_40px_rgba(14,27,38,0.12)]">
            <div className="flex items-center gap-2.5 border-b border-line px-3.5">
              <SearchIcon size={17} className="shrink-0 text-ink-mute" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索银行名称或代码"
                aria-label="搜索收款银行"
                autoFocus
                className="h-12 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-mute"
              />
              <span className="num shrink-0 text-[12px] text-ink-mute">
                {BANK_REGION_LABEL[region]} {matched.length}/{inMarket.length}
              </span>
            </div>

            <ul className="max-h-[264px] overflow-y-auto p-2" role="listbox">
              {matched.map((bank) => {
                const active = bank.code === value?.code && bank.region === value.region
                return (
                  <li key={`${bank.region}-${bank.code}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => pick(bank)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-tile px-3 py-2.5 text-left transition-colors',
                        active ? 'bg-gold-wash' : 'hover:bg-sunk',
                      )}
                    >
                      <BankMark bank={bank} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate text-[14px]',
                            active ? 'font-medium text-gold-deep' : 'text-ink',
                          )}
                        >
                          {bank.name}
                        </span>
                        <span className="num mt-0.5 block text-[12px] text-ink-mute">
                          银行代码 {bank.code}
                        </span>
                      </span>
                      {active && <CheckIcon size={18} className="shrink-0 text-gold-deep" />}
                    </button>
                  </li>
                )
              })}

              {matched.length === 0 && (
                <li className="px-3 py-8 text-center text-[13px] text-ink-mute">
                  没有匹配的银行，试试只输几个字，或直接输 3 位银行代码
                </li>
              )}
            </ul>

            <p className="border-t border-line px-4 py-2.5 text-[12px] leading-relaxed text-ink-mute">
              {value ? `已选：${describeBank(value)}` : (hint ?? '请选择收款银行')}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * 银行行标。
 *
 * 本行复用工作台品牌图；其他行标来自 `app/public/banks/`，不依赖第三方图床 ——
 * 实测那些服务对解析不到的域名会静默返回一张灰色占位图，等于把假数据当真的用。
 *
 * 加载失败时退回「品牌色块 + 行名首字」，不留破图：真后端如果换素材 URL，
 * 有一两家取不到也是常事，界面不能因此变丑。
 */
function BankMark({ bank, size = 32 }: { bank: Bank; size?: number }) {
  const [failed, setFailed] = useState(false)
  const logo = bank.internal && bank.code === 'LCB' ? brandCat : bank.logo

  if (logo && !failed) {
    return (
      <img
        src={logo}
        // 行名就在旁边，图是装饰性的
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-[8px] border border-line/70 bg-surface object-contain"
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[8px] font-semibold text-ink-invert"
      style={{ width: size, height: size, backgroundColor: bank.color, fontSize: size * 0.42 }}
    >
      {bank.name.slice(0, 1)}
    </span>
  )
}
