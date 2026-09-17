import { AlertIcon } from '@/components/ui/icons'

/**
 * 比赛演示水印。
 *
 * 挂在 App 层而不是 AppShell 里 —— 登录页、开户页这些没有外壳的页面同样要有，
 * 否则「这不是真实银行」这句话恰好漏在最容易被外人看到的那一页上。
 *
 * 位置：**右上角、顶栏下方**。
 *
 * 这里踩过一个坑：一开始贴在顶栏带子里（top-6）并把 z 设成 20 想「让着」顶栏，
 * 结果直接看不见了 —— 顶栏是 `sticky top-0 z-30 h-[76px] bg-paper/85 backdrop-blur`，
 * 背景铺满整条，z 更低的东西会被那层 85% 不透明的底连模糊一起吃掉。
 * 当时只想着水平避开通知铃，忘了顶栏的**背景是整条**的。
 *
 * 所以改成落在顶栏下方（76 + 8 = 84px），z 提到 40 正常压在内容之上。
 * 两个角落本来就都被占了：右下角是智能客服悬浮球（`right-8 bottom-8` 的 56px），
 * 右上角是顶栏的通知铃（`px-10` + 48px）—— 放在带子下面是最省事且不打架的位置。
 *
 * 刻意不做成斜跨页面的大字水印：那是纸面场景的做法，放在可交互的网页上会挡住内容。
 * 这里要的是"清楚但安静" —— 该看见的人一眼看见，不干扰正常使用。
 */
export function DemoWatermark() {
  return (
    <div
      aria-label="本作品为比赛演示用途，非真实银行，不提供任何金融服务，所有数据均为模拟"
      className="pointer-events-none fixed top-[84px] right-10 z-40 flex select-none items-center gap-1.5 rounded-chip border border-line bg-surface/90 px-3 py-1.5 text-[12px] text-ink-soft shadow-[0_4px_14px_rgba(14,27,38,0.06)] backdrop-blur-sm"
    >
      <AlertIcon size={13} className="shrink-0 text-coral" />
      <span>比赛演示作品 · 非真实银行</span>
    </div>
  )
}
