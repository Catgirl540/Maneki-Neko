import { AlertIcon } from '@/components/ui/icons'

/** 所有路由共用的演示声明，独占一行，避免遮住标题、按钮或通知。 */
export function DemoWatermark() {
  return (
    <div
      aria-label="本作品为比赛演示用途，非真实银行，不提供任何金融服务，所有数据均为模拟"
      className="demo-watermark sticky top-0 z-50 flex h-7 items-center justify-center gap-1.5 border-b border-line bg-sunk px-3 text-[11px] text-ink-soft print:hidden"
    >
      <AlertIcon size={12} className="shrink-0 text-coral" />
      <span>比赛演示作品 · 非真实银行</span>
    </div>
  )
}
