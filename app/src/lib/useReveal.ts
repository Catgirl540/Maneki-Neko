import { useCallback, useState } from 'react'

/**
 * 「显示 / 隐藏」某一块敏感信息。
 *
 * **一块一只眼睛，各管各的** —— 卡片那只眼只管这张卡的卡号/有效期/安全码，
 * 余额那只眼只管这块余额。不做一个全局开关：那样点一下银行卡会把首页余额也掀开，
 * 而用户想露的往往只是眼前这一块（演示时尤其如此）。
 *
 * 状态不落 localStorage：刷新就回到遮住的状态。否则上次离开时摊开着，
 * 下次一进来还是摊开的，等于没遮。
 */
export function useReveal(initial = false) {
  const [shown, setShown] = useState(initial)
  const toggle = useCallback(() => setShown((v) => !v), [])
  return { shown, toggle }
}
