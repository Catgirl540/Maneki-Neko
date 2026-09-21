/**
 * 开关的生命周期：**关掉要有动画，重开要是干净的**。
 *
 * 这两件事总是成对出现，而且解法互相冲突：想"重开是干净的"，最顺手的写法是
 * `{open && <弹层/>}` —— 卸载即重置。可那正是退场动画做不到的原因：
 * 父级直接把组件从树上摘了，组件自己没机会播动画。
 *
 * 所以这里拆成两个工具：常驻挂载 + `usePresence` 负责动画，
 * 打开时用 `useResetOnOpen` 把表单清干净。两个都用渲染期同步，
 * 不走 effect（effect 里同步 setState 会多一轮渲染，而且被 lint 拦）。
 *
 * @module app/lib/usePresence
 */

import { useEffect, useState } from 'react'

export interface Presence {
  /** 元素该不该在 DOM 里（退场动画放完之前一直是 true）。 */
  mounted: boolean
  /** 正在退场：该套退场动画了。 */
  exiting: boolean
}

/**
 * 把"要不要显示"拆成"要不要渲染" + "是不是正在退场"。
 *
 * 入场是**立刻**的（由 `open` 直接决定），只有退场需要记状态——
 * 所以打开时不会多一帧延迟，也不会出现"打开时先播一遍退场动画"。
 * @param open - 想不想显示。
 * @param exitMs - 退场动画多长（要和 CSS 里的时长对上，否则会提前抽走元素）。
 * @returns 见 {@link Presence}。
 */
export function usePresence(open: boolean, exitMs: number): Presence {
  // 记录上一次"想显示"的值，用来分辨这一帧是刚打开还是刚关闭。
  const [wasOpen, setWasOpen] = useState(open)
  const [gone, setGone] = useState(!open)

  // 渲染期同步（React 官方的 "adjusting state when a prop changes" 写法）：
  // 用 effect 做的话会先渲染一帧"还没打开"，看得见地闪一下。
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setGone(false)
  }

  useEffect(() => {
    if (open) return
    const timer = setTimeout(() => { setGone(true) }, exitMs)
    return () => { clearTimeout(timer) }
  }, [open, exitMs])

  return { mounted: open || !gone, exiting: !open && !gone }
}

/**
 * 每次**重新打开**时把表单清干净。
 *
 * 只在"关 → 开"这一下调用 `reset`：打开期间用户正在填的东西不会被冲掉。
 * @param open - 想不想显示。
 * @param reset - 清空各字段（内部会 setState，所以必须在渲染期调用）。
 */
export function useResetOnOpen(open: boolean, reset: () => void): void {
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) reset()
  }
}
