import brandCatBlack from '../../assets/design/brand-cat-black.png'
import { cn } from '../../lib/cn'
import { WorkbenchBrand } from './WorkbenchBrand'
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

/** 网页客户端新字标；旧尺寸参数保留以兼容已有登录与开户页面。 */
export function Logo({
  className = '',
  showBank = true,
}: {
  className?: string
  markClass?: string
  wordClass?: string
  showBank?: boolean
}) {
  return <span className={className} style={{ fontSize: showBank ? undefined : 'inherit' }}>
    <WorkbenchBrand />
  </span>
}

/** App Icon：白底圆角方 + 黑猫，与安卓启动图标一致。 */
export function AppIcon({ className }: { className?: string }) {
  return (
    <span className={cn('app-icon', className)} role="presentation" aria-hidden="true">
      <img src={brandCatBlack} alt="" />
    </span>
  )
}
