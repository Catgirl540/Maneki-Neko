/**
 * 检查脚本共用的登录助手。
 *
 * ## 为什么必须有这么一个共享件
 *
 * 登录态改成**只存内存、不落盘**之后（见 `app/src/lib/authToken.ts`），原来那种
 * "往 localStorage 塞一个 token 就等于登录了"的写法全部失效了——那正是这次改动的目的。
 * 16 个浏览器检查脚本都要建立登录态，如果各自复制一份登录流程，那么登录页每改一次
 * （这次就加了短信验证码），就有 16 个地方要跟着改，而且**漏一个就是一个静默失败**：
 * 那个检查会停在登录页上，然后因为找不到元素而超时。
 *
 * 所以登录流程只在这里实现一次。它走的是**真实的界面路径**：
 * 填手机号、点获取验证码、把页面上显示的验证码读出来、提交。
 *
 * ## 两个入口，各管一件事
 *
 *   · `login(page, base)`   —— 走完登录流程（手机号 + 密码 + 短信验证码）；
 *                              已经是登录状态时它什么也不做，只把你送到目标页
 *   · `gotoInApp(page, p)`  —— **应用内**换页（pushState + popstate 触发 router），
 *                              不产生整页加载
 *
 * 登录态存在 `sessionStorage` 里：**同一个标签页刷新还在，关掉标签页才没**。
 * 所以整页 `goto` 本身不会再把你登出（早先那版是纯内存，`goto` 会清掉登录态，
 * 那时 `gotoInApp` 是必需的；现在它只是更省时间，也是 SPA 里更贴近真实点击的换页方式）。
 *
 * 有一处旧的陷阱仍然成立、值得记着：**刷新会重置页面里的模块状态**。
 * 像 `check-stale-data` 那种"写坏存档再让应用重新读盘"的检查，
 * 需要的正是整页加载，所以它用 `login()`（内含一次 `goto`）而不是 `gotoInApp`。
 *
 * @module tools/lib/session
 */

/** 演示环境的登录凭据（与 `app/src/api/mock` 里的默认值一致）。 */
export const DEMO_PHONE = '13800138000'
export const DEMO_PASSWORD = '123456'

/** 不需要登录就能看的路径。守卫不会把访问这些路径的人弹走。 */
const PUBLIC_PATHS = new Set(['/', '/login', '/open-account'])

/**
 * 应用内换页：改 URL 并让 router 认到，**不触发整页加载**。
 *
 * 做法是：React Router 监听 `popstate`，所以 `pushState` + 手动派发一个
 * `popstate` 事件就能让它按新地址重新渲染——省掉一次整页加载
 * （也省掉重新拉一遍所有接口），比 `goto` 更贴近用户点链接的行为。
 *
 * @param page - Playwright 的 page。
 * @param path - 目标路径，例如 `/wealth`。
 * @param options - `expect`：**期望最终停在**哪个路径。默认就是 `path`。
 *   要传它是因为有些路径会立刻被重定向走——例如已登录时去 `/login`，
 *   守卫会马上把你送回 `/dashboard`，这时等 `path` 是等不到的（实测踩到）。
 */
export async function gotoInApp(page, path, options = {}) {
  const expect = options.expect ?? path
  await page.evaluate((to) => {
    window.history.pushState({}, '', to)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  // 等 router 把新页面渲染出来。没有导航事件可等，所以等地址稳定 + 一小段让 React 提交。
  try {
    await page.waitForFunction((to) => window.location.pathname === to, expect, { timeout: 5_000 })
  } catch {
    throw new Error(
      `应用内换页到 ${path} 之后没有落在 ${expect}，实际停在 ${new URL(page.url()).pathname}`,
    )
  }
  await page.waitForTimeout(150)
}

/**
 * 走一遍完整登录流程，成功后停在应用内。
 *
 * @param page - Playwright 的 page。
 * @param base - 站点根地址，例如 `http://127.0.0.1:5180`。
 * @param options - `to`：登录后要落到哪个页面（默认总览）；`phone` / `password` 可覆盖。
 * @throws 任一步失败时抛错（带页面上的报错文本），由调用方决定怎么记。
 */
export async function login(page, base, options = {}) {
  const to = options.to ?? '/dashboard'
  const phone = options.phone ?? DEMO_PHONE
  const password = options.password ?? DEMO_PASSWORD

  // 未登录时得有个"会被守卫拦下"的入口，才会把来源记进 state、登录后送回来。
  // 公开页不会被拦，所以目标若是公开页，统一从 /login 进，登录后再应用内换过去。
  const entry = PUBLIC_PATHS.has(to) ? '/login' : to
  await page.goto(`${base}${entry}`, { waitUntil: 'domcontentloaded' })

  /*
   * 判据是**登录表单出没出现**，不能看 `page.url()`。
   * 守卫的跳转是客户端 `replaceState`，`domcontentloaded` 时还没发生——
   * 那时候 `page.url()` 仍然是 `/dashboard`，据此判断会得出"已经登录了"的
   * 错误结论，于是整个登录流程被跳过（实测踩到：登录页一直在，登录从没发生）。
   */
  /*
   * 用**占位符**定位，不用 `getByLabel`。
   *
   * 原因：`Field` 组件把 `trailing` 也渲染在 `<label>` 里面，而 Playwright 的
   * `getByLabel` 是按"被这个 label 关联的控件"匹配的——于是密码框里那个"显示密码"
   * 眼睛按钮也会命中 `getByLabel('密码')`（实测命中 2 个）。占位符是唯一的，不受这个影响。
   * 对真实用户没有影响：眼睛按钮有自己的 `aria-label`，名字是对的。
   */
  const phoneInput = page.getByPlaceholder('请输入 11 位手机号')
  const needsLogin = await phoneInput.waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true).catch(() => false)

  if (!needsLogin) {
    // 已经是登录状态，把它挪到目标页就好
    if (new URL(page.url()).pathname !== to && to !== '/login') await gotoInApp(page, to)
    return
  }

  await phoneInput.fill(phone)
  await page.getByPlaceholder('请输入密码').fill(password)

  // 获取验证码。按钮在手机号不足 11 位时是禁用的，所以必须在填完之后再点。
  await page.getByRole('button', { name: '获取验证码' }).click()

  // 验证码**从页面上读**，不猜：演示后端会把它回传并显示出来。
  // 猜一个写死的码，在改动面前会静默失效。
  const hint = page.getByText(/演示环境验证码[：:]\s*\d{6}/)
  await hint.waitFor({ state: 'visible', timeout: 10_000 })
  const code = /\d{6}/.exec(await hint.innerText())?.[0]
  if (code === undefined) throw new Error('拿不到演示验证码')

  await page.getByPlaceholder('请输入 6 位验证码').fill(code)
  await page.getByRole('button', { name: '登入' }).click()

  // 用**地址**判断登录成功，不用"按钮消失"：失败时按钮也还在，页面会停住
  const landed = PUBLIC_PATHS.has(to) ? '/dashboard' : to
  try {
    await page.waitForFunction((target) => window.location.pathname === target, landed, { timeout: 15_000 })
  } catch {
    const message = await page.locator('[role="alert"]').first().innerText().catch(() => '（读不到报错）')
    throw new Error(
      `登录没有进入 ${landed}，停在 ${new URL(page.url()).pathname}；页面报错：${message}`,
    )
  }

  // 目标是公开页（官网 / 开户页）时，登录先落在总览，再应用内换过去
  const finalTarget = to === '/login' ? '/dashboard' : to
  if (finalTarget !== landed) await gotoInApp(page, finalTarget)
}
