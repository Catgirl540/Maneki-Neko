import { CAT_MARK, CAT_MARK_VIEW_BOX } from './cat-mark'

/**
 * 招财猫图形标 —— 手写 SVG，任意尺寸清晰、颜色随 currentColor。
 *
 * 坐标来自 `cat-mark.ts`（与静态行标 `app/public/banks/cn-LCB.svg` 共用同一份），
 * 这里只负责把它画出来并接上主题色。
 */
interface CatMarkProps {
  className?: string
  /** 眼睛/鼻子的挖空色，默认跟随卡片底色 */
  cutout?: string
  title?: string
}

export function CatMark({ className, cutout = 'var(--color-surface)', title }: CatMarkProps) {
  return (
    <svg
      viewBox={CAT_MARK_VIEW_BOX}
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      {/* 耳朵 */}
      {CAT_MARK.ears.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
      {/* 头 */}
      <circle cx={CAT_MARK.head.cx} cy={CAT_MARK.head.cy} r={CAT_MARK.head.r} fill="currentColor" />
      {/* 胡须 */}
      <g stroke="currentColor" strokeWidth={CAT_MARK.whiskerWidth} strokeLinecap="round">
        {CAT_MARK.whiskers.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {/* 眼睛与鼻 */}
      {CAT_MARK.eyes.map((e) => (
        <ellipse key={e.cx} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill={cutout} />
      ))}
      <path d={CAT_MARK.nose} fill={cutout} />
    </svg>
  )
}

/**
 * 横版品牌锁定：图形标 + luckycat / BANK 字标。
 * 字标用 Poppins（几何 grotesk），与生成稿一致。
 */
export function Logo({
  className = '',
  markClass = 'h-9 w-9',
  wordClass = 'text-[21px]',
  showBank = true,
}: {
  className?: string
  markClass?: string
  wordClass?: string
  showBank?: boolean
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <CatMark className={`${markClass} shrink-0 text-gold`} title="招财猫银行" />
      <span className="flex flex-col items-end leading-none">
        <span
          className={`font-brand font-semibold tracking-[-0.02em] text-ink ${wordClass}`}
          style={{ lineHeight: 1 }}
        >
          luckycat
        </span>
        {showBank && (
          <span
            className="font-brand font-medium text-ink-soft"
            style={{ fontSize: '0.42em', letterSpacing: '0.44em', lineHeight: 1.6 }}
          >
            BANK
          </span>
        )}
      </span>
    </span>
  )
}

/** App Icon：金色圆角方 + 负空间猫脸（对应 logo-c-negative-cat.png） */
export function AppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="presentation" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="currentColor" />
      <path d="M17 22.5 L19.5 10 L30 19.5 Z" fill="var(--color-surface)" />
      <path d="M47 22.5 L44.5 10 L34 19.5 Z" fill="var(--color-surface)" />
      <circle cx="24" cy="36" r="3.4" fill="var(--color-surface)" />
      <circle cx="40" cy="36" r="3.4" fill="var(--color-surface)" />
      <path d="M32 42.5 L36 48 H28 Z" fill="var(--color-surface)" />
    </svg>
  )
}