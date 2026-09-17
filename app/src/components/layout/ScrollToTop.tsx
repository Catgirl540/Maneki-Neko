import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * 切换路由时回到页面顶部。
 *
 * 浏览器的默认行为是**保留滚动位置**：从一个滚到一半的页面点侧栏跳到另一个栏目，
 * 新页面会从同样的高度开始，看起来就像「跳到了下面去」——甚至可能直接落在页脚附近，
 * 让人以为页面没加载完。单页应用必须自己处理这件事。
 *
 * 两个细节：
 * - 用 `useLayoutEffect` 而不是 `useEffect`：它在浏览器绘制之前执行，
 *   不会先画出错误的位置再跳一下。路由切换这种「位置本来就是错的」场景，
 *   宁可同步改掉。
 * - 只认 `pathname`：query / hash 变化（例如页内定位）不该把页面拽回顶部。
 * - **只对 PUSH / REPLACE 生效**。返回（POP）时把位置**交回给浏览器恢复** ——
 *   从交易详情返回流水列表，本来就该回到原来那一行；一律滚到顶反而是帮倒忙。
 *   这也是浏览器的默认行为，不写这个分支的话会变成「先滚到顶、再被浏览器恢复」，
 *   结果虽然碰巧对，但是在跟浏览器抢，顺序一变换个浏览器就露馅。
 */
export function ScrollToTop() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()

  useLayoutEffect(() => {
    if (navigationType === 'POP') return
    // 用 'instant' 明确关掉 CSS 的平滑滚动：路由切换要的是「立刻在顶部」，
    // 顺着动画滚上去会看到一段莫名其妙的长滚动
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, navigationType])

  return null
}
