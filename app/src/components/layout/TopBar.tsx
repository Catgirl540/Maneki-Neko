import { CatMark } from '@/components/brand/Logo'

/**
 * 移动端品牌栏。交易搜索已移到账单页内，通知移到左下角悬浮按钮，
 * 桌面端不再保留空顶栏（原先的 sticky 顶栏随之移除）。
 */
export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center border-b border-line bg-paper/95 px-4 backdrop-blur lg:hidden print:hidden">
      <span aria-label="招财猫银行"><CatMark className="size-8 text-gold" /></span>
    </header>
  )
}
