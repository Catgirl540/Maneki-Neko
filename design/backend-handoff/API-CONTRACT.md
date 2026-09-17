# 招财猫银行 · 后端接口与行为交接文档

面向**从没看过这个项目**的后端开发者。目标：只读这一份文档就能把后端实现出来，
不需要读前端源码。

- 前端仓库：React 19 + TypeScript + Vite，代码在 `app/`
- 事实来源（本文档全部结论都出自这几处，没有一条来自「常见做法」）：
  - `app/src/api/contract.ts` —— `routes` 路由表 + `BankApi` 接口方法签名
  - `app/src/api/types.ts` —— 全部请求/响应类型
  - `app/src/api/http.ts` —— 前端调真后端的方式（路径、方法、鉴权头、错误解析）
  - `app/src/api/mock/index.ts` —— mock 后端，即行为规范（校验、错误码、限额、状态流转）
  - `app/src/api/mock/db.ts` —— 种子数据与全部业务常量
  - `app/src/api/mock/card-bin.ts` + `app/src/api/mock/bin-table.ts` —— 卡 BIN 识别
  - `app/src/lib/*.ts` —— 被界面与 mock 共用的业务规则与合规文案

约定：

- 字段名一律照抄源码，不做意译。金额字段一律是叫 `Cents` 的 `number`。
- 凡是**靠 mock 推断、前端没有明确依据**的地方，集中在第 8 节，不在正文里替后端做决定。
- 发现 mock 或 README 自相矛盾的地方，如实记在第 8 节，不替它选一个。

---

## 1. 总览

### 1.1 前端怎么找到后端

| 环境变量 | 作用 |
| --- | --- |
| `VITE_API_BASE_URL` | 后端基地址。**可为空字符串**，此时请求直接打到当前源（`'' + path`），开发期由 Vite 的 `/api` 代理转发 |
| `VITE_USE_MOCK` | `'false'` 才用真后端（`createHttpApi`）；其余任何值（含未定义）都走 mock |

出处：`app/src/api/index.ts` 第 11 行
`const useMock = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false'`。

```ts
// app/src/api/http.ts:19
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
// 实际请求地址 = BASE_URL + path，path 已自带 /api 前缀
fetch(BASE_URL + path, { ...init, headers })
```

`app/vite.config.ts` 的开发代理：

```ts
proxy: { '/api': { target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8080', changeOrigin: true } }
```

`app/.env.development` 里 `VITE_USE_MOCK=true`、`VITE_API_BASE_URL=`（空）、
`VITE_PROXY_TARGET=http://127.0.0.1:8080`。
**后端监听 8080 即可被前端代理命中，不需要改前端任何文件。**

### 1.2 鉴权

- 登录成功后前端把响应里的 `token` 字符串存进 `localStorage`（key `luckycat.token`），
  同时把 `user` 对象存进 `luckycat.session.user`。
- 之后每个请求带上请求头：`Authorization: Bearer <token>`。
  **仅在 token 存在时**才带这个头（`...(token ? { Authorization: \`Bearer ${token}\` } : {})`）。
- 前端**不做** token 过期判断、不刷新 token、不解析 token 内容。它只在收到 401 时把
  错误文案弹出来，登录态由本地 `user` 对象是否存在决定（`store/session.tsx` 的路由守卫）。
  所以后端返回 401 时，用户会停留在页面上看到报错，**不会自动跳回登录页**——
  如果要强制登出，需要后端在 401 之外给出明确语义（见第 8 节）。
- `POST /api/auth/logout` 前端**不等**返回结果做任何事，返回后无论如何都清本地 token 与 user。
- **开户接口 `POST /api/accounts/open` 与 `/api/auth/sms-code` 在登录前就会被调用**
  （登录页「立即开户」进入的 `/open-account` 是公开路由）。这两个接口不能强制要求登录态，
  否则新客户开户流程走不通。`app/src/App.tsx` 第 38 行的公开路由是依据。

### 1.3 统一的请求约定

- 全部请求 JSON，请求头固定有 `Content-Type: application/json`（包括没有 body 的 GET/POST）。
- 有 body 的请求由前端 `JSON.stringify` 后发送；`body === undefined` 时**完全不发 body**。
  所以 `POST /api/auth/logout`、`POST /api/auth/profile` 之类可能收到空 body，后端要容忍。
- 路径参数为字符串，前端按模板直接拼接，**不做 URL 编码**：
  `routes.card(id)` → `/api/cards/${id}`。所以 `id` 里不应出现 `/`、`?`、`#` 等字符。
- Query 参数由前端用 `URLSearchParams` 拼：
  - 值为 `undefined`、空字符串、`0`、`false` 时**不会**出现在 query 里
    （http.ts 里一律是 `if (query.page) params.set(...)` 这种写法）。
  - `category === 'all'` 时**不会**发 `category` 参数（意为「不筛选」）。
  - `keyword` 为空串时不发。
- 分页从 1 开始。前端**从不显式传 `page`**（只在内部翻页时传），
  首次请求只传 `size`。所以后端必须自己把缺省 `page` 当 1 处理。

### 1.4 统一的响应约定

- 成功响应：HTTP 200 + **直接是业务数据本身的 JSON**，没有任何 `{ code, data }` 包装层。
  例如 `GET /api/accounts` 的响应体就是 `Account[]`，`GET /api/auth/profile` 就是 `User`。
- `204 No Content` 之类没有响应体的成功也支持：前端先 `res.text()`，
  空字符串时 `payload = null`，然后 `return payload as T`。所以返回 `void` 的接口
  （`logout`、`changePassword`）**返回 200 + 空 body 或 `{}` 都可以**，前端不看内容。
- 响应体必须是合法 JSON。非 JSON 文本会在 `JSON.parse` 处抛出，前端只会显示
  「网络异常，请稍后重试」，拿不到具体原因。

### 1.5 错误体结构

`app/src/api/http.ts` 第 32–39 行是唯一依据：

```ts
const text = await res.text()
const payload = text ? (JSON.parse(text) as unknown) : null
if (!res.ok) {
  const body = payload as { message?: string; code?: string } | null
  throw new ApiError(body?.message ?? `请求失败（${res.status}）`, res.status, body?.code)
}
```

由此得到后端**必须**遵守的三条：

1. 判错只看 HTTP status：`!res.ok` 即错误。**不要用 200 + `{ code: '...' }` 表示业务失败**，
   那样前端会当成成功并把错误对象当成业务数据往下传。
2. 错误体必须是**扁平对象**，且字段名就这两个：
   - `message: string` —— 直接展示给用户的中文文案（前端不做任何二次包装）
   - `code: string` —— 机器可判别的错误码（前端只在少数地方用，见 1.6）
   两个字段都是可选的：`message` 缺失时前端兜底显示 `请求失败（<status>）`；
   `code` 缺失时 `ApiError.code` 为 `undefined`。
   **不要嵌套成 `{ error: { message } }`。**
3. 错误体不要是空字符串。空 body 时 `payload` 为 `null`，`message` 就拿不到了
   （仍会抛错，但用户只看到 `请求失败（500）`）。

### 1.6 前端实际依赖 `code` 的地方（只有这两处）

```
app/src/components/cards/CardSecretsModal.tsx:49
  if (e instanceof ApiError && e.code === 'BAD_PAY_PASSWORD') setPassword('')   // 清空重输

app/src/components/cards/CardApplicationModal.tsx:110
app/src/components/wealth/ProductDetailModal.tsx:103
  if (err instanceof ApiError && err.code?.includes('PAY_PASSWORD')) setPassword('')
  // 注意是 includes，不是 ===：'BAD_PAY_PASSWORD' 与 'PAY_PASSWORD_LOCKED' 都会命中
```

也就是说：**支付密码相关的错误码必须包含子串 `PAY_PASSWORD`**，否则密码框不会被清空
（用户会以为密码没输错）。其余错误码目前只用于文档和排障，改文案不影响前端逻辑。
但请不要因此随意改错误码——第 3 节的表是要和后端对齐的契约。

### 1.7 金额与时间

- **金额一律是整数「分」，字段名 `Cents`（`type Cents = number`）。**
  ¥1,234.56 传 `123456`。前端 `lib/format.ts` 里所有展示都是 `cents / 100`。
  后端返回浮点分（如 `1234.5600001`）会让前端显示成 `¥12.35` 这类错值。
- 分数不能整除时前端自己会 `Math.round`，但**后端必须保证返回整数**。
- 时间一律 ISO 8601 字符串（`new Date().toISOString()` 的形式，带 `Z`）。
  前端用 `new Date(iso)` 解析后按**浏览器本地时区**渲染，所以在响应里带 UTC 偏移即可，
  不要返回 `YYYY-MM-DD HH:mm:ss` 这种没有时区的本地串。
- 纯日期字段（`ExportQuery.from` / `to`、`SpendingTrendPoint.month`、
  `CashFlowPoint.date`、`NavPoint.date`）是 `YYYY-MM-DD` / `YYYY-MM`，不含时间。

---

## 2. 逐接口清单

共 **47** 个路由键。路径全部来自 `app/src/api/contract.ts` 的 `routes`，一条不漏。
其中 46 个对应 `BankApi` 的方法；第 47 个是 `card`（`GET /api/cards/:id`），
**它只在路由表里存在**，没有任何方法或实现（见 6.1）。

下表的分节按业务域划分；`GET /api/accounts/tiers` 在 2.3.7 与 2.4.2 各被提一次
（同一路由，不重复计数）。另有 6 条跨章节的**指回**小节
（2.4.2 / 2.6.9 / 2.7.5 / 2.7.6 / 2.8.5 / 2.8.6），只是指回正文，不新增接口。
**接口条数以「`routes` 键」为准：47 个键 = 46 个可用接口 + 1 个空定义。**

每个小节固定给出：**HTTP 方法与路径 → 请求体 → 响应体 → 业务含义与校验顺序 → 错误码
→ 用在哪个页面**。「用在」一栏是给后端排优先级用的，`—` 表示当前前端代码里
没有任何调用点（见第 6 节）。

### 2.1 身份（4 条）

#### 2.1.1 `POST /api/auth/login`

- 请求体：`{ phone: string; password: string }`（http.ts 第 54 行显式构造）
- 响应：`{ token: string; user: User }`
- 业务含义：登录。成功后前端把 `token` / `user` 落 localStorage。
- mock 行为：手机号必须匹配 `/^\d{11}$/`；密码必须等于库里的登录密码。**登录成功会把
  `payPasswordFailures` 归零**（「重新登录即解除支付密码锁定」）。
- 错误：`INVALID_PHONE` 400、`BAD_CREDENTIALS` 401
- 用在：`pages/LoginPage.tsx`（经 `store/session.tsx` 的 `login()`）、`store/session.tsx`
- 注意：`User` 只用来渲染顶栏的头像首字与会员等级，**响应里不要放手机号以外的敏感信息**。

#### 2.1.2 `POST /api/auth/logout`

- 请求体：无（`post(routes.logout())`，body 为 `undefined`）
- 响应：`void`
- 业务含义：登出。前端收到响应后清本地 token 与 user。
- mock 行为：**`resetDb()` —— 把整个演示库重置回种子状态**。
  真实后端显然不应该这么做；这是纯前端演示才有的行为（见第 6 节）。
- 错误：无（mock 不抛）
- 用在：`store/session.tsx` 的 `logout()`

#### 2.1.3 `GET /api/auth/profile`

- 请求体：无
- 响应：`User`
- 业务含义：当前登录用户信息（顶栏头像、会员等级）。
- 用在：**目前没有调用点**。`store/session.tsx` 登录后直接用登录响应里的 `user`，
  并用 `bootstrapSession()` 从 localStorage 恢复。仍请实现（契约的一部分）。
- 错误：mock 不抛；真后端应在未登录时返回 401。

#### 2.1.4 `POST /api/auth/sms-code`

- 请求体：`{ phone: string }`（http.ts 第 83 行）
- 响应：`SmsCodeResult`
- 业务含义：发短信验证码。开户、开理财账户、更换登录手机号三处都用它。
- 校验：`/^1[3-9]\d{9}$/`（先 `digitsOnly` 去掉非数字）
- 有效期：**5 分钟**（mock 里 `Date.now() + 5 * 60_000`）
- **一次性**：开户 / 开理财户 / 换手机号成功时都把 `pendingSms` 置空，用过即废。
- `demoCode` 字段：mock 把验证码原样回传，字段名点明是演示。
  **真后端绝不能下发验证码**，但**字段必须存在**（前端只是展示，不做判空）。
  建议真后端返回空字符串或者干脆不下发该字段（前端不会崩）。
- 错误：`INVALID_PHONE` 400
- 用在：`pages/OpenAccountPage.tsx`、`pages/SecurityPage.tsx`（换手机号）、
  `components/wealth/WealthAccountOpeningModal.tsx`
- 前端行为：发送成功后按钮进入 **60 秒倒计时**；倒计时是前端自己算的，
  后端不需要返回冷却时间（`SmsCodeResult` 里没有这个字段）。

```ts
interface SmsCodeResult {
  sent: boolean
  expiresAt: string   // ISO，5 分钟后
  demoCode: string    // 仅演示环境
}
```

#### 2.1.5 `PATCH /api/auth/phone`

- 请求体：`ChangePhoneRequest` = `{ newPhone: string; smsCode: string; faceTicket: string }`
- 响应：`User`（换绑后的用户对象）
- 业务含义：更换登录手机号。**高危操作**：手机号是找回密码与接验证码的唯一凭证。
- **注意 HTTP 方法**：契约与 http.ts 都写 `PATCH`；README 的接口清单里没有这一条。
  ── 见第 6 节。
- mock 校验顺序（照这个顺序实现，顺序本身有安全含义）：
  1. `newPhone` 去非数字后必须匹配 `/^1[3-9]\d{9}$/` → `INVALID_PHONE` 400
  2. 新号不能等于当前登录号 → `SAME_PHONE` 400
  3. `faceTicket` 非空（先核身）→ `FACE_REQUIRED` 400
  4. `pendingSms` 必须存在 → `SMS_NOT_SENT` 400
  5. **`sms.phone` 必须等于 `newPhone`** → `SMS_PHONE_MISMATCH` 400
     （防「拿发给别的号的验证码来换绑」）
  6. 未过期 → `SMS_EXPIRED` 400；验证码匹配 → `BAD_SMS_CODE` 400
  7. 换绑并写一条安全日志，**`level` 必须是 `'warn'`**（会进顶栏通知小红点）
     日志 `detail` 形如 `138****8000 → 139****9000`（`maskPhone` 的格式）
- 用在：`pages/SecurityPage.tsx`

### 2.2 账户与流水（8 条）

#### 2.2.1 `GET /api/accounts`

- 请求体：无
- 响应：`Account[]`
- 业务含义：账户列表。**前端绝大多数页面都取 `[0]`（第一个）当「活期账户」用**
  （转账的付款账户、转入目标、理财扣款账户、卡片的资金账户）。
  所以**数组顺序有语义**：请把主活期账户放在第一位。
  mock 里 `accounts[0]` 在所有地方被当成默认出账账户（`chargeCardFee`、
  `subscribeWealth`、`redeemWealth`、`getReceivingInfo`、`openCard` 全部硬取 `db.accounts[0]`）。
- `Account` 字段：

```ts
interface Account {
  id: string
  kind: 'current' | 'savings' | 'deposit'
  tier: 'I' | 'II' | 'III'
  label: string          // 如 '活期账户' / '储蓄账户（Ⅱ 类户）'
  accountNo: string
  currency: 'CNY' | 'USD' | 'HKD'
  balance: Cents
  available: Cents
  interestRate: number   // 年化，0.003 = 0.30%
  monthNetChange: Cents  // 本月净变动（收入 - 支出），由后端汇总
}
```

- `monthNetChange` 是**派生字段**：mock 在读取时按月现算（`withDerived`），不落库。
  真实后端也应实时算。首页用它画那个「↑ +23.6% 本月」的标签，还会反推月初余额
  （`opening = balance - monthNetChange`），所以**必须与 `balance` 出自同一套口径**。
- `balance` 与 `available` 在种子数据里不相等（活期 `12_864_055` vs `12_764_055`），
  差额是冻结/在途。转账校验用的是 `available`，展示余额用 `balance`。
- 用在：`DashboardPage`、`TransferPage`、`CardsPage`、`AnalysisPage`、`WealthPage`

#### 2.2.2 `GET /api/accounts/:id`

- 路径参数：`id`
- 响应：`Account`
- 业务含义：单个账户。
- 错误：`ACCOUNT_NOT_FOUND` 404 `'账户不存在'`
- 用在：**目前没有调用点**（页面都只调 `listAccounts`）。仍请实现。

#### 2.2.3 `GET /api/accounts/:id/transactions`

- 路径参数：`id`
- Query：
  | 参数 | 类型 | 默认 | 说明 |
  | --- | --- | --- | --- |
  | `page` | number | 1 | 前端首次请求不传，翻页才传 |
  | `size` | number | **8** | mock 默认 8；前端各页面传 5 或 6 |
  | `category` | `TransactionCategory` | 不发 | `'all'` 时前端**不发这个参数** |
  | `keyword` | string | 不发 | 空串不发 |
- 响应：`Paged<Transaction>`

```ts
interface Paged<T> { items: T[]; page: number; size: number; total: number }

interface Transaction {   // 列表 DTO —— 刻意不含明细字段
  id: string
  accountId: string
  direction: 'in' | 'out'
  amount: Cents
  signedAmount: Cents      // 正数收入 / 负数支出
  counterparty: string
  memo: string
  category: TransactionCategory
  createdAt: string
  status: 'success' | 'pending' | 'failed'
}
```

- 业务含义：分页流水。**筛选与搜索的口径**：
  - `category` 精确匹配 `t.category`
  - `keyword` 去空白、转小写后，**匹配 `counterparty` 或 `memo` 的子串**
    （`includes`，不是前缀；只这两列，不含附言/交易编号）
- **排序**：mock 里种子数据按 `createdAt` 倒序存放，且分页前**没有再排序**
  （`seedTransactions` 结尾 `.sort((a,b) => b.createdAt.localeCompare(a.createdAt))`，
  新交易用 `unshift` 进数组头）。所以**后端必须按 `createdAt` 倒序返回**，
  最新一笔在第一页第一条；否则「交易后余额」的对账视图会乱。
- 账户不存在时抛 `ACCOUNT_NOT_FOUND` 404
- **列表里绝不包含**：`referenceNo`、`channel`、`exchangeRate`、`originAmount`、
  `counterpartyAccountNo`、`balanceBefore`、`balanceAfter`、`authCode`、`merchantId`。
  这些属于 `TransactionDetail`，只从详情接口出。类型系统已经这么切了
  （`toTransactionListItem`），后端请照做（见 4.8）。
- 用在：`DashboardPage`（`{ size: 5 }`）、`AnalysisPage`（`{ size: 6, category, keyword }`）

#### 2.2.4 `GET /api/accounts/:id/transactions/export`

- 路径参数：`id`
- Query（`ExportQuery`）：`from?: 'YYYY-MM-DD'`、`to?: 'YYYY-MM-DD'`、
  `category?: TransactionCategory | 'all'`、`keyword?: string`
  - 同样：`'all'` 与空串不发
  - 前端 `AnalysisPage` 目前**只传 `category` 与 `keyword`，不传 `from`/`to`**
- 响应：`ExportDataset`

```ts
interface ExportColumn { key: string; label: string }

interface ExportDataset {
  batchNo: string           // 导出批次号，客服对账用
  generatedAt: string
  fileName: string          // 建议文件名，含时间范围
  total: number
  range: { from: string; to: string } | null   // 实际导出数据的时间范围
  columns: ExportColumn[]
  rows: Record<string, string>[]               // 值**已按银行口径格式化**
}
```

- 业务含义：给「下载流水」按钮提供数据集。**后端给列 + 已格式化的值**，
  前端只做文件机制（转义、UTF-8 BOM、文件名、触发下载）。
  原因：导出哪些字段、金额怎么表达、账号怎么脱敏，是银行的账务与合规口径。
- **15 列，顺序即展示顺序**，`key` 与 `label` 都照抄 mock 的 `EXPORT_COLUMNS`：

| # | key | label | 值格式 |
| --- | --- | --- | --- |
| 1 | `createdAt` | 交易时间 | `YYYY-MM-DD HH:mm:ss` |
| 2 | `direction` | 收支 | `收入` / `支出` |
| 3 | `amount` | 交易金额 | 千分位两位小数，**不带符号、不带币种**，如 `1,234.56` |
| 4 | `currency` | 币种 | 记账币种代码，如 `CNY` |
| 5 | `originAmount` | 原交易金额 | `USD 5.00`（代码在前）；无外币时为 `''` |
| 6 | `exchangeRate` | 记账汇率 | `1 USD = CNY 7.29580000`（**8 位小数**）；无外币时 `''` |
| 7 | `counterpartyName` | 对方户名 | 明细里的干净户名，缺省回退 `counterparty` |
| 8 | `counterpartyAccountNo` | 对方账号 | 已脱敏，缺省 `''` |
| 9 | `counterpartyBank` | 对方机构 | 缺省 `''` |
| 10 | `channel` | 交易渠道 | 中文标签（`网上交易`/`刷卡消费`/`转账汇款`/`账户划转`/`利息结算`） |
| 11 | `category` | 交易类型 | 中文标签（见 2.2.6 的 `CATEGORY_LABEL`） |
| 12 | `status` | 交易状态 | `交易成功`/`处理中`/`交易失败` |
| 13 | `balanceAfter` | 交易后余额 | 千分位两位小数 |
| 14 | `referenceNo` | 交易编号 | 19 位 |
| 15 | `remark` | 附言 | 缺省 `''` |

- **没有单独的「手续费」列**：手续费在台账里是独立的一笔（`counterparty` 为 `'手续费'`），
  加一列会让同一笔支出被重复计一次。
- `range` 按**实际导出的数据**首尾给（mock 取所有行的本地日期排序后取首尾），
  **不是回显请求参数**；没有数据时必须是 `null`。
- `fileName` mock 的格式：`招财猫银行_交易流水_YYYYMMDD-YYYYMMDD.csv`（无数据时用当天）。
  前端拿它当下载文件名，`.csv` 后缀是必须的。
- `batchNo` mock 的格式：`EXP` + 10 位时间戳尾巴。
- 前端行为：`dataset.total === 0` 时**不下载**，只弹「当前筛选条件下没有可导出的流水」。
  所以 `total` 必须准确。
- **可选增量**：真后端若更希望直接流式返回文件，在响应体上加一个 `downloadUrl`，
  前端会优先用它（现有字段全部保留，不要删）。
- 用在：`pages/AnalysisPage.tsx`

#### 2.2.5 `GET /api/transactions/:id`

- 路径参数：`id`（交易 id，即 `Transaction.id`，**不是** `referenceNo`）
- 响应：`TransactionRecord`

```ts
interface TransactionRecord extends Transaction {   // 列表字段 + detail
  detail: TransactionDetail
}

interface TransactionDetail {
  referenceNo: string          // 交易编号（凭证号），唯一且不可变
  channel: 'quickpay' | 'card' | 'transfer' | 'account' | 'interest'
  paymentMethod: string        // 如 '招财猫 · 星享借记卡 尾号 8888'
  accountLabel: string
  accountNo: string
  settleCurrency: 'CNY' | 'USD' | 'HKD'
  balanceBefore: Cents
  balanceAfter: Cents
  counterpartyName?: string
  merchantId?: string
  merchantCountry?: string
  merchantCity?: string
  counterpartyAccountNo?: string   // 已脱敏
  counterpartyBank?: string
  location?: string
  remark?: string
  authCode?: string                // 只有 card / quickpay 有
  originAmount?: Cents
  originCurrency?: 'CNY' | 'USD' | 'HKD'
  exchangeRate?: number            // 1 原币 = ? 记账币
  exchangeRateNote?: string
}
```

- 业务含义：单笔交易的**凭证**（电子回单页的数据源）。
- **对账恒等式**：`balanceBefore + signedAmount === balanceAfter`。
  带符号金额用列表的 `signedAmount`（支出为负）。前端交易详情页把这两个值并排展示，
  `tools/check-tx-detail.mjs` 会断言这个恒等式。**后端必须保证它成立。**
  mock 的做法是「按账户当前余额沿着倒序台账反推」（`withBalances`），不落库。
- **`referenceNo` 必须由后端确定性派生、且对同一条记录永远相同**
  （mock 用 FNV-1a 从交易 id 派生，19 位，固定以 `2` 开头）。
  原因：客服凭这个号核对，每次刷新/重新登录都必须一样。
- `authCode`：6 位，只有 `channel` 为 `card` 或 `quickpay` 才有；转账与代发没有。
- 汇率口径：`exchangeRate` 是 **1 原币 = ? 记账币**（例：`1 USD = CNY 7.29580000`），
  **已经包含外币交易手续费**，所以 `exchangeRateNote` 写「已包括 1.95% 外币交易手续费」，
  不再单独列一笔手续费。`formatRate` 固定 8 位小数且不四舍五入。
- 错误：`TX_NOT_FOUND` 404 `'交易不存在或已超出可查询期限'`
- 用在：`pages/TransactionDetailPage.tsx`

#### 2.2.6 `GET /api/transactions/:id/receipt`

- 路径参数：`id`
- 响应：`ReceiptFile` = `{ fileName: string; url: string | null; expiresAt: string | null }`
- 业务含义：电子回单文件。
- **`url: null` 是能力声明，不是错误**：演示环境没有服务端 PDF 能力，前端据此
  **退回浏览器打印**（`window.open(url)` 只在 `url` 非空时才走）。
  真后端应返回**带签名的临时下载地址**（回单不允许长期公开可访问），
  `expiresAt` 与签名有效期一致。
- `fileName` mock 的格式：`招财猫银行_电子回单_<referenceNo>.pdf`
- 错误：`TX_NOT_FOUND` 404
- 用在：`pages/TransactionDetailPage.tsx`

#### 2.2.7 `POST /api/accounts/:id/deposit`

- 路径参数：`id`
- 请求体：`{ amount: Cents; channel: string }`（http.ts 第 80 行显式构造）
- 响应：`Account`（**入账后的账户**，前端用它刷新余额）
- 业务含义：转入（演示用的入账）。`channel` 前端只会传 `'salary'` 或 `'card'`
  （`DashboardPage` 第 324 行 `useState<'card' | 'salary'>`），
  但类型上是宽松的 `string`。
- 校验：
  - `amount <= 0` → `INVALID_AMOUNT` 400 `'转入金额必须大于 0'`
  - `amount > 5_000_000`（¥50,000.00）→ `LIMIT_EXCEEDED` 400 `'单笔转入上限 ¥50,000.00'`
- 副作用（**必须落台账**）：
  - `channel === 'salary'`：`direction: 'in'`、`counterparty: '工资入账'`、
    `memo: '工资入账'`、`category: 'salary'`、明细 `channel: 'account'`、
    `paymentMethod: '工资代发'`、`counterpartyName: '上海云栖科技有限公司'`、
    `location: '招财猫银行 App'`、`remark: '本月薪资'`
  - 否则：`counterparty: '主动转入'`、`memo: '从绑定卡转入'`、`category: 'other'`、
    明细 `channel: 'card'`、`paymentMethod` 为 `CARD_PAYMENT_METHOD`、
    `counterpartyBank: '中国建设银行'`、`location: '招财猫银行 App'`
  - 账户不存在时 `findAccount` → `ACCOUNT_NOT_FOUND` 404
- 用在：`pages/DashboardPage.tsx`（首页「转入」弹层的**第二屏**，明确标着演示）
- ⚠️ **与 README 的冲突**：README §12.5 说「转入」的正职是展示收款信息
  （`GET /api/receiving`），「模拟一笔转入」已退到第二屏。但 README §5 与 §7 又把这个
  入账当成真实功能描述。本接口就是那个「模拟转入」，见第 8 节。

#### 2.2.8 `GET /api/receiving`

- 请求体：无
- 响应：`ReceivingInfo`

```ts
interface ReceivingInfo {
  holder: string          // 收款户名
  accountNo: string       // 收款账户号
  accountLabel: string    // 账户类型说明（活期 / 储蓄…）
  bankName: string
  bankRegion: 'CN' | 'HK'
  fpsMobile: string       // 转数快手机号
  fpsId: string           // 转数快 FPS ID
}
```

- 业务含义：**我的收款信息**——别人要转钱给我时照着填的东西。
  由后端按账户 + 转数快登记拼好：账户号归「银行账户转账」用、转数快标识归「转数快」用，
  两者填的位置不同，这是账户侧的规则，不该让前端自己凑。
- mock 行为：`holder = db.user.name`、`accountNo = db.accounts[0].accountNo`、
  `accountLabel = db.accounts[0].label`、`bankName = '招财猫银行'`、`bankRegion: 'CN'`、
  `fpsMobile = db.user.phone`、`fpsId = USER_FPS_ID`（种子里是 `'2046881'`）。
- **前端的硬假设**：`lib/receiving.ts` 的 `receivingRows()` 把这 7 个字段摊成 5 行，
  顺序固定为 收款户名 / 收款账户 / 收款银行 / 转数快手机号 / FPS ID，
  并且「复制全部」的文本由**同一份 rows** 生成。
  收款银行那行拼的是 `${bankName}（${BANK_REGION_LABEL[bankRegion]}）` → `CN` 渲染成 `内地`、
  `HK` 渲染成 `香港`。**`bankRegion` 只有这两个值。**
- ⚠️ **`accountNo` 不脱敏、明文展示**（README §12.5 明确要求：账号是收款项，
  本来就该给人抄去转账）。这与「余额必须遮住」是两件事，不要一起处理。
- 用在：`pages/DashboardPage.tsx`

### 2.3 收款银行与转账（7 条）

#### 2.3.1 `GET /api/banks`

- 请求体：无
- 响应：`Bank[]`
- 业务含义：**收款银行名录**。真实数据：内地走人民银行《支付系统银行行别、行号业务标准》
  的 3 位行别代码，香港走 HKICL 清算所银行代码。两地共 **55 家**（内地 20 条含本行、
  香港 35 条）。
- `Bank` 字段：

```ts
interface Bank {
  code: string            // 3 位清算代码；本行是 'LCB'（非数字）
  region: 'CN' | 'HK'     // 必填，与 code 成对
  name: string
  shortName: string
  color: string           // 近似品牌色，仅用于行标缺失时的文字色块
  domain?: string
  logo?: string           // 路径，如 '/banks/cn-102.svg'
  primaryBin?: string     // 该行常用借记卡号段（6 位）；香港为空
  internal?: boolean      // true = 本行（虚构机构）
}
```

- **`(region, code)` 才是主键，`code` 单独不唯一。** 完整码表里 307（内地平安 /
  香港 ABN AMRO）、308、309、316 两地都有机构在用。本收窄名录恰好没撞上，
  但这是巧合不是保证。**任何「按 code 找银行」的实现都必须带 region。**
- 前端对排序的依赖：`BankPicker.tsx` 自己按 `code` 升序排，**非数字 code 排最前**
  （所以 `'LCB'` 会排在内地列表第一位）。后端返回顺序无所谓，但请看住这条，
  免得后端「顺手排好」之后和前端又排一次、结果不一致。
- 前端只按 `region === 当前市场` 过滤，市场由转账方向推导：
  转数快必定 `HK`、境内转账必定 `CN`、境外汇款收款行在 `HK`。
- 行标：`logo` 指向 `app/public/banks/` 下的本地资产，**以 SVG 为主**，
  只有大生银行（`/banks/hk-061.png`）是位图。`logo` 缺失或加载失败时 UI 退回
  「品牌色块 + 首字」。真后端换成自己托管的官方素材 URL 即可。
- 用在：`pages/TransferPage.tsx`（经 `components/ui/BankPicker.tsx`）

#### 2.3.2 `POST /api/cards/bin`

- 请求体：`CardBinQuery` = `{ digits: string; region: BankRegion }`
  - `digits`：用户已输入的卡号（前端传的是**去除非数字后的完整输入**，可能超过 6 位）
  - `region`：在哪个市场里找
- 响应：`CardBinResolution`，四选一：

```ts
type CardBinResolution =
  | { status: 'matched'; bin: string; bank: Bank }
  | { status: 'incomplete'; need: number }
  | { status: 'unsupported' }
  | { status: 'not-applicable' }
```

- 业务含义：**输卡号前 6 位 → 反查发卡行**。真实实现是一次银联/网联的卡 BIN 查询
  （BIN 表十万量级且会变，不可能下发给客户端）。
- **三种「查不到」必须分开返回，界面要说的话完全不同**：

| status | 触发条件 | 前端界面文案 |
| --- | --- | --- |
| `incomplete` | 去非数字后不足 6 位；`need` = 还差几位 | 「输入卡号前 6 位，自动识别发卡行」（**不是错误**） |
| `not-applicable` | `region !== 'CN'`（香港） | 「香港的银行账户号不含发卡行信息，请手动选择收款银行」 |
| `unsupported` | 前 6 位不属于任何已收录银行 | 「暂不支持该银行」，并在「下一步」就拦住 |
| `matched` | 命中；返回 `bin` 与完整 `Bank` 对象（**省掉前端再查一次名录**） | 「已识别发卡行：<name>（号段 <bin>）」 |

- 判定顺序（mock 的 `lookupCardBin`，照抄）：
  1. `region !== 'CN'` → `not-applicable`（**先判市场，再判位数**）
  2. 不足 6 位 → `incomplete`
  3. 取前 6 位；**先判本行前缀**：等于 `'882000'`（`INTERNAL_ACCOUNT_PREFIX`）时，
     在名录里找 `internal === true && region === 'CN'` 的那家返回 `matched`
  4. 查 BIN 表；没有 → `unsupported`
  5. **表里有、名录里没有 → 也返回 `unsupported`**（两边不同步时不要凭空编一家银行）
- BIN 表范围（`app/src/api/mock/bin-table.ts`，由 `tools/gen-bin-table.mjs` 生成，
  数据来自公开码表 [hexindai/bcbc](https://github.com/hexindai/bcbc)）：
  - **275 条**，覆盖内地 **19 家**（不含本行）
  - 只收**借记卡**（信用卡不能作为转账收款方）
  - 只收 **6 位、`62` 开头**的银联 BIN（真实 BIN 6–9 位，MVP 不做最长前缀匹配）
  - 同一 BIN 挂在两家银行下时**丢弃**（上游表里 `622309` 同时挂工商和浙商）
- **本行前缀 `882000` 不在公开码表里**（就是我们自己的账号格式 `8820…`），
  单独放在 `INTERNAL_ACCOUNT_PREFIX`，不混进 `CN_CARD_BINS`。
- 用在：`pages/TransferPage.tsx`（输满 6 位后防抖 320ms 调一次；
  命中后**以卡号为准把收款行切过去**）

#### 2.3.3 `GET /api/payees`

- 请求体：无
- 响应：`Payee[]`
- 业务含义：常用收款人。前端**按 `lastUsedAt` 倒序取前 4 个**展示成 chip，
  并按当前 `channel` 过滤。所以**后端应按 `lastUsedAt` 倒序返回**（mock 显式排序）。
- `Payee` 字段：

```ts
interface Payee {
  id: string
  name: string
  channel: 'bank' | 'fps'
  bankCode?: string
  bankRegion?: 'CN' | 'HK'    // 与 bankCode 成对
  bankName?: string
  accountNo?: string
  fpsMethod?: 'mobile' | 'email' | 'fpsid' | 'account'
  fpsId?: string
  payeeCurrency?: 'CNY' | 'USD' | 'HKD'
  scope: 'domestic' | 'overseas'
  lastUsedAt: string
}
```

- 前端的用法（`applyPayee`）：`channel === 'fps'` 时用 `fpsMethod`（缺省 `'mobile'`）、
  `fpsId` 或 `accountNo`、`payeeCurrency`（缺省 `'HKD'`）、`bankCode`；
  否则用 `bankRegion`（缺省按 `scope` 推导：`overseas` → `HK`，否则 `CN`）、
  `bankCode`、`accountNo`、`name`。
  **`bankCode` 与 `bankRegion` 必须成对给出**，否则会填错市场的槽位。
- **同一标识只应有一条**：mock 在建收款人时按
  `${channel}:${fpsMethod ?? ''}:${fpsId ?? ''}:${accountNo ?? ''}` 判重，命中就只更新
  `lastUsedAt` 与 `name`。
- 用在：`pages/TransferPage.tsx`

#### 2.3.4 `POST /api/fps/resolve`

- 请求体：`{ idType: FpsIdType; fpsId: string }`
  - `FpsIdType = 'mobile' | 'email' | 'fpsid'`
  - **注意**：前端只在 `fpsMethod !== 'account'` 时调它；`account` 方式不发这个请求
- 响应：`FpsResolveResult`

```ts
interface FpsResolveResult {
  registered: boolean
  name?: string         // 已登记时：**部分隐藏**的户口名称
  bankName?: string
  bankCode?: string
  bankRegion?: 'CN' | 'HK'   // 转数快是香港清算网络，必定 'HK'
  bankCount?: number         // 该标识绑定了几间银行 / SVF
  reason?: string            // 未登记时的说明
}
```

- 业务含义：转数快中央解析（HKICL）。付款人只输标识，系统查出**已登记的收款人姓名**，
  在本项目的「信息确认」一步回显给付款人核对。
- **姓名必须部分隐藏**：mock 的 `hideMiddle` —— `梁乐怡` → `梁*怡`，`Ken Ho` → `K***o`
  （长度 ≤1 原样；长度 2 时 `梁*`）。**不是全隐藏、也不是明文。**
- 未登记时不抛错，返回 `{ registered: false, reason: '...' }`。
  前端把 `reason` 当成用户可见文案展示。mock 的 `reason`：
  `'该标识未登记转数快。请核对标识，或改用「收款账户」方式转账。'`
- 解析前先把输入里的空白全部去掉再比对（`(fpsId ?? '').replace(/\s/g, '')`）。
- 前端还会把 `bankName` / `bankCode` 与用户自己选的收款行并排展示，让他能看出
  「选的行和登记的行对不上」，而不是等款项被退回。
- 一个标识可以绑多间银行，解析返回的是**默认收款户口**；`bankCount > 1` 时界面会补一句
  「该标识绑定了 N 间银行，此处为其默认收款户口」。
- 用在：`pages/TransferPage.tsx`（`goReview()` 里，只在标识方式）

#### 2.3.5 `POST /api/transfers/quote`

- 请求体：`TransferQuoteRequest`

```ts
interface TransferQuoteRequest {
  fromAccountId: string
  channel: 'bank' | 'fps'
  scope: 'domestic' | 'overseas'
  amount: Cents
  bankCode?: string
  bankRegion?: 'CN' | 'HK'
  payeeCurrency?: 'CNY' | 'USD' | 'HKD'
}
```

- 响应：`TransferQuote`

```ts
interface TransferQuote {
  fee: Cents
  etaText: string
  maxAmount: Cents
  singleLimit: Cents
  requiresConfirm: boolean
  confirmReason?: string
  channelNote: string
  fx?: FxQuote              // 仅当扣账币种 ≠ 收款币种
}
```

- 业务含义：**转账询价**。金额一变（输入框每敲一次，防抖 220ms）前端就重新询一次。
- 前端的调用参数：`scope` 传的是**推导后的** `effectiveScope`
  （`channel === 'fps'` 时恒为 `'overseas'`）；`payeeCurrency` **只有 fps 通道才传**
  （`quoteCurrency = isFps ? fpsCurrency : undefined`），银行账户通道不产生换汇。
- 关键规则：
  - **`fee`**
    - 转数快（`channel === 'fps'`）：恒为 **0**
    - 银行账户 + 境外：`Math.max(Math.round(amount * 0.001), 5000)`
      —— **0.1%，最低 ¥50.00（5000 分）**
    - 银行账户 + 境内：**0**
  - **`singleLimit`**：`fps` → **`1_000_000`（¥10,000.00）**；
    否则 → **`5_000_000`（¥50,000.00）**
  - **`maxAmount`** = `Math.min(账户 available, singleLimit)`
    （⚠️ mock 没有把手续费减进来，见第 8 节）
  - **`etaText`**（固定文案，按优先级）：
    `fps` → `'预计 5 秒内到账'`；`overseas` → `'预计 1 个工作日到账'`；
    `bank?.code === 'LCB'` → `'实时到账'`；其余 → `'预计 2 小时内到账'`
  - **`requiresConfirm`** = `amount >= 500_000`（**≥ ¥5,000.00**，含等于）
  - **`confirmReason`**（仅 `requiresConfirm` 时给）：
    `'单笔金额超过 ¥5,000.00，需二次确认'`
    （mock 用 `` `单笔金额超过 ¥${(LARGE_TRANSFER / 100).toLocaleString('zh-CN')}，需二次确认` ``）
  - **`channelNote`**（固定文案，mock 的 `CHANNEL_NOTE`）：
    - `bank`：`'境内转账实时到账免手续费；境外按 0.1% 计费（最低 ¥50.00）'`
    - `fps`：`'转数快（FPS）按手机号 / 邮箱 / FPS ID 即时转账，免手续费，通常 5 秒内到账'`
- **`fx`（换汇报价）** —— 扣账币种 ≠ 收款币种时才给：

```ts
interface FxQuote {
  fromCurrency: Currency      // 扣账币种
  toCurrency: Currency        // 收款币种
  rate: number                // 1 扣账币 = ? 收款币
  fromAmount: Cents
  toAmount: Cents
  spread: number              // 如 0.0035 = 0.35%
  quoteTtlSeconds: number     // 报价有效期（秒），mock 固定 30
  quotedAt: string
}
```

  - 汇率表（mock 固定值）：`CNY: 1`、`USD: 7.1562`、`HKD: 0.91547`
    （含义：1 单位该币 = ? 人民币）
  - 交叉汇率：`mid = FX_MID_RATES[from] / FX_MID_RATES[to]`，
    **点差永远对客户不利**：`rate = mid * (1 - 0.0035)`（`FX_SPREAD = 0.0035`）
  - `toAmount = Math.round(fromAmount * rate)`
  - **点差已包含在 `rate` 里，不再单独收换汇手续费**（与回单口径一致：
    汇率那行注明「已包括 x%」）
  - `from === to` 或 `fromAmount <= 0` 时不返回 `fx` 字段
- **锁价**：`quoteTtlSeconds` 是核心约定。前端**从「收到报价的本地时刻」起算**
  （不是用 `quotedAt`，避免客户端与服务端时钟偏差），到期自动重新询价并提示
  「换汇报价已过期，已按最新汇率重新询价，请核对到账金额」。
  **汇率不能让用户拿过期的价格成交。**
- ⚠️ mock **不校验** `fromAccountId` 是否存在，找不到就静默回退到 `db.accounts[0]`
  （`db.accounts.find(...) ?? db.accounts[0]`）。真后端应当返回 404，见第 8 节。
- 错误：mock 不抛任何错误码
- 用在：`pages/TransferPage.tsx`（金额 / 通道 / 币种 / 收款行 / 账户变化时自动询价）

#### 2.3.6 `POST /api/transfers`

- 请求体：`TransferRequest`

```ts
interface TransferRequest {
  fromAccountId: string
  channel: 'bank' | 'fps'
  scope: 'domestic' | 'overseas'
  payeeName: string
  amount: Cents
  memo: string                        // 备注，前端传的是 trim() 后的值（可能空串）
  payeeBankCode?: string
  payeeBankRegion?: 'CN' | 'HK'
  payeeAccountNo?: string
  fpsMethod?: 'mobile' | 'email' | 'fpsid' | 'account'
  fpsId?: string
  payeeCurrency?: 'CNY' | 'USD' | 'HKD'
  payeeAddress?: string
}
```

- 响应：`TransferResult`

```ts
interface TransferResult {
  transactionId: string
  referenceNo: string
  amount: Cents
  fee: Cents
  channel: 'bank' | 'fps'
  identifier: string    // **已脱敏**的收款标识，用于回执展示
  createdAt: string
  fx?: FxQuote          // 实际成交的换汇信息（含成交汇率）
}
```

- 业务含义：提交转账。**前端在各通道下的实际传参**：

| 通道 | 传的字段 |
| --- | --- |
| `bank` | `fromAccountId, channel, scope, payeeName, amount, memo, payeeBankCode, payeeBankRegion, payeeAccountNo`（**不带任何 fps 字段、不带 payeeCurrency**） |
| `fps` + `fpsMethod === 'account'` | 上面那批 + `fpsMethod: 'account'`、`payeeAccountNo`、`payeeCurrency`、`payeeAddress?` |
| `fps` + 其余三种 | 上面那批 + `fpsMethod`、`fpsId`（email 传原文；mobile / fpsid 传 `digitsOnly`）、`payeeCurrency`、`payeeAddress?`。**不传 `payeeAccountNo`**；`payeeName` 传的是**解析出来的登记姓名** |

- 校验顺序（mock 的 `submitTransfer`，逐条照做）：
  1. `amount <= 0` → `INVALID_AMOUNT` 400 `'转账金额必须大于 0'`
  2. `channel === 'fps'` 时（`fpsMethod` 缺省按 `'mobile'`）：
     - `payeeBankCode` 缺失 → `BANK_REQUIRED` 400 `'请选择收款银行'`
       （**跨境支付通四种汇款方式都必须指定收款银行**，款项要路由到该行）
     - `findBank(banks, payeeBankCode, payeeBankRegion)` 查不到 → `BANK_NOT_FOUND` 400
       `'收款银行不存在'`
     - `fpsMethod === 'account'`：`validateFpsValue('account', payeeAccountNo)` 失败 →
       `INVALID_ACCOUNT_NO` 400（**错误文案直接用 lib 返回的那句**）；
       且 `payeeName.trim()` 为空 → `PAYEE_REQUIRED` 400 `'请填写收款户名'`
     - 其余方式：`validateFpsValue(method, fpsId)` 失败 → `INVALID_FPS_ID` 400
  3. `channel === 'bank'` 时：`payeeName.trim()` 为空 → `PAYEE_REQUIRED` 400
     `'请填写收款人'`；`validateBankAccount(payeeAccountNo)` 失败 → `INVALID_ACCOUNT_NO` 400
  4. 算 `fee` 与 `total = amount + fee`
  5. `amount > singleLimit` → `LIMIT_EXCEEDED` 400
     `` `单笔转账上限 ¥${(singleLimit / 100).toLocaleString('zh-CN')}` ``
  6. `total > account.available` → `INSUFFICIENT_FUNDS` 400 `'账户可用余额不足'`
     （**比较的是含手续费的总额**）
  7. 扣 `total`、落台账、建/更新收款人
- 前端本地校验的文案（会先于接口拦住用户，但后端仍要独立校验）：
  - 超限：`单笔上限 ¥50,000.00，请调整金额或分多笔转出`
  - 余额：`账户可用余额不足`；卡 BIN 不识别：`暂不支持该银行：卡号前 6 位 …`
- 副作用（**必须落台账，且手续费是独立一笔**）：
  - 主交易：`direction: 'out'`、`amount`、`signedAmount: -amount`、
    `counterparty: \`转账 · ${payeeName.trim()}\``、`category: 'transfer'`、
    `status: 'success'`；明细 `channel: 'transfer'`、
    `counterpartyName: payeeName.trim()`、`counterpartyAccountNo: identifier`（**脱敏值**）、
    `counterpartyBank: bank?.name`、`location: '招财猫银行 App'`
    - `memo` 缺省时后端自己拼：fps → `` `转数快 FPS 转账至 ${identifier}` ``；
      否则 `` `${scope === 'overseas' ? '境外' : '境内'}转账至${bank?.shortName ?? '对方银行'}` ``
  - **手续费 > 0 时额外落一笔**：`counterparty: '手续费'`、`memo: '境外转账手续费'`、
    `category: 'other'`，明细 `channel: 'account'`、`remark: \`境外转账手续费 · ${payeeName}\``
    —— 因为手续费是独立台账，转账详情里就**不再重复列示手续费**，
    余额回推也自然对得上（两笔各扣一次）
  - 换汇时主交易明细要存**反向汇率**：
    `originAmount = fx.toAmount`、`originCurrency = fx.toCurrency`、
    `exchangeRate = 1 / fx.rate`、`exchangeRateNote = \`已包括 ${(fx.spread * 100).toFixed(2)}% 换汇点差\``
    （回单口径是「1 原币 = ? 记账币」，即报价的倒数）
  - **收款人簿**：同标识只更新时间与姓名，否则新增。mock 的判重键是
    `${channel}:${fpsMethod ?? ''}:${fpsId ?? ''}:${accountNo ?? ''}`
    注意 `fpsId` 存的是去掉空白后的值、`accountNo`（银行通道）存的是去非数字后的值。
    新增时 `scope`：fps 一律 `'overseas'`，否则用请求的 `scope`；
    fps 记 `fpsMethod`/`fpsId`/`payeeCurrency`（缺省 `'CNY'`），
    `fpsMethod === 'account'` 时把账号存进 `accountNo`。
- `identifier`（脱敏规则，来自 `lib/account.ts`）：
  | 方式 | 规则 | 例 |
  | --- | --- | --- |
  | 银行账号 | 前 4 + ` **** **** ` + 后 4（≤8 位原样） | `6222 **** **** 3445` |
  | fps `account` | 前 3 + ` **** ` + 后 3（≤6 位原样） | `004 **** 118` |
  | fps `mobile` | 前 4 + ` ****`（非 8 位则原样回显数字） | `9123 ****` |
  | fps `fpsid` | **原样**（不脱敏） | `8820314` |
  | fps `email` | 名字前 2 位 + `*` 补齐 + `@域名` | `ke**@example.com` |
- `referenceNo`：**mock 返回的是 `` `LC${Date.now().toString().slice(-10)}` ``，
  与台账里那条交易的 `detail.referenceNo` 不是同一个值**（后者由 id 确定性派生）。
  这是 mock 的真实缺陷，第 6 节记录；真后端**应当让两者一致**，
  因为收款成功页展示的「流水号」和稍后交易详情页展示的「交易编号」是同一个号，
  对不上客服就没法核对。见第 8 节。
- ⚠️ mock **不校验锁价票据**：注释里写明「真实系统在这里校验锁价票据是否还在有效期内，
  过期就报错让前端重新询价」，但代码只是**用成交时的汇率重算一遍**
  （`buildFxQuote`），且不接收任何票据字段。`TransferRequest` 里也没有票据字段。
  **这是前后端边界上的一个真实缺口**，见第 6、8 节。
- 用在：`pages/TransferPage.tsx`（「信息确认」步的确认按钮；大额时先进二次确认弹层）

#### 2.3.7 `GET /api/accounts/tiers`

- 请求体：无
- 响应：`AccountTier[]`

```ts
interface AccountTier {
  tier: 'I' | 'II' | 'III'
  name: string
  summary: string
  features: string[]
  limitations: string[]
  limits: { label: string; value: string }[]
  online: boolean
  offlineReason?: string
  requiresBinding: boolean
}
```

- 业务含义：账户分类管理的功能与限额说明。**这几组数字照抄监管原文，不是估算**
  （银发〔2015〕392 号、银发〔2018〕16 号）——它是用户判断「够不够用」的唯一依据。
- 三条记录的准确内容（照抄 `ACCOUNT_TIERS`）：

| tier | name | online | requiresBinding | limits |
| --- | --- | --- | --- | --- |
| `I` | `Ⅰ 类户` | **false** | false | 账户余额 `无上限`；消费与缴费 `无上限`；向非绑定账户转出 `无上限` |
| `II` | `Ⅱ 类户` | true | **true** | 非绑定账户转入 / 存现 / 消费缴费 / 向非绑定账户转出 / 取现 = `日累计合计 1 万元、年累计合计 20 万元`；与绑定账户之间的转账 = `不受上述限额约束` |
| `III` | `Ⅲ 类户` | true | **true** | 账户余额 `不得超过 2000 元`；消费缴费 / 向非绑定账户转出 = `日累计合计 2000 元、年累计合计 5 万元` |

- `I` 类的 `offlineReason`：
  `'按账户分类管理规定，Ⅰ 类户需本人持身份证到柜台面签，无法在线开立'`
  —— 界面上**保留Ⅰ类卡片但置灰并写出这个原因**，直接藏掉会让用户以为是产品缺失。
- 前端用 `requiresBinding` 决定开户第二步是否显示「绑定本人 Ⅰ 类户」字段。
- 用在：`pages/OpenAccountPage.tsx`

### 2.4 开户（1 条，另见 2.1.4 的 `sms-code`）

#### 2.4.1 `POST /api/accounts/open`

- 请求体：`AccountOpeningRequest`

```ts
interface AccountOpeningRequest {
  tier: 'I' | 'II' | 'III'
  kind: 'current' | 'savings' | 'deposit'
  holderName: string
  idNumber: string
  smsCode: string
  bindingCardNo?: string   // Ⅱ / Ⅲ 类必填
  faceTicket: string
  pledge: string           // 合法开立和使用账户承诺（必须逐字等于常量）
}
```

- 响应：`AccountOpeningResult`

```ts
interface AccountOpeningResult {
  account: Account
  openedAt: string
  tier: 'I' | 'II' | 'III'
  limits: { label: string; value: string }[]   // = 该类别的 limits，回显用
}
```

- 业务含义：开立 Ⅱ / Ⅲ 类个人银行结算账户。
- 校验顺序（mock 的 `openAccount`）：
  1. `tier` 不在名录 → `TIER_NOT_FOUND` 404 `'账户类别不存在'`
  2. `!tier.online` → `TIER_OFFLINE_ONLY` 400，**文案用 `tier.offlineReason`**
     （即Ⅰ类户那句柜台面签说明）
  3. `holderName.trim()` 为空 → `NAME_REQUIRED` 400 `'请填写姓名'`
  4. `idNumber.trim()` 不匹配 `/^\d{17}[\dXx]$/` → `INVALID_ID` 400 `'请输入 18 位身份证号'`
  5. `pendingSms` 不存在 → `SMS_NOT_SENT` 400 `'请先获取短信验证码'`
  6. 已过期 → `SMS_EXPIRED` 400 `'验证码已过期，请重新获取'`（并把 pendingSms 清掉）
  7. `smsCode` 去非数字后不等于 `pendingSms.code` → `BAD_SMS_CODE` 400 `'验证码不正确'`
  8. `tier.requiresBinding` 时校验 `bindingCardNo`（12–19 位数字）→
     `INVALID_BINDING_CARD` 400，文案是 `` `绑定卡：${err}` ``
  9. `faceTicket` 为空 → `FACE_REQUIRED` 400 `'请先完成人脸识别'`
  10. **承诺语句逐字比对** `ACCOUNT_OPENING_PLEDGE`，不等 →
      `PLEDGE_REQUIRED` 400 `'请确认合法开立和使用账户承诺'`
      - 前端勾选框时传常量原文，未勾选时**传空字符串**，靠后端拦住。
      - 注意这是「**确认**」不是「抄录」（与理财那条不同），
        依据银发〔2019〕85 号原文：承诺语句由客户**确认**。所以是勾选框 + 服务端逐字校验，
        不需要用户手打。
  11. `pendingSms = null`（**验证码用过即废，防止一码多开**）
- 开户结果：
  - `label` = `活期账户` / `储蓄账户` / `定期存款`（按 `kind`）+ `（${tier.name}）`
    —— 例：`活期账户（Ⅱ 类户）`
  - `currency: 'CNY'`、`balance: 0`、`available: 0`、`monthNetChange: 0`
  - `interestRate`：`savings` → `0.0155`；`deposit` → `0.021`；其余 → `0.003`
  - `accountNo`：mock 生成 `('6222' + 13 位随机数字)` 共 17 位 —— 见第 8 节
    （README §11 声称本行账号格式是 `8820…`，种子数据也是这样，只有这里不一致）
- 开户**不验支付密码**：开户不涉及付款，需要的是身份核验。
  支付密码留给申卡、理财申购这类真正扣钱的场景。
- 用在：`pages/OpenAccountPage.tsx`（两条路由共用同一流程：
  `/open-account` 公开整页，`/accounts/open` 需登录；差别只是手机号能否编辑）

#### 2.4.2 `GET /api/accounts/tiers`

见 2.3.7（同一条路由，放在账户分组下更自然，此处不重复）。

### 2.5 银行卡（8 条）

#### 2.5.1 `GET /api/cards`

- 请求体：无
- 响应：`BankCard[]`
- 业务含义：银行卡列表。**列表里绝不包含完整卡号与安全码**（见 4.8）。
- `BankCard` 字段：

```ts
interface BankCard {
  id: string
  accountId: string          // 必填：这张卡从哪个资金账户扣钱
  productName: string
  last4: string              // 卡号后四位
  cardholder: string         // 卡面英文名，如 'LIN XIAOMAN'
  expiry: string             // 'MM/YY'
  theme: 'ink' | 'gold'      // 卡面配色
  network: 'visa' | 'unionpay'  // 卡组织
  kind: 'debit' | 'credit'
  status: 'active' | 'locked' | 'pending' | 'replaced'
  onlinePayment: boolean
  overseasPayment: boolean
  dailyLimit: Cents
  shippingAddress?: MailingAddress   // 卡在路上时用于回显
  issuingFee?: Cents                 // 已收取的制卡费用合计
}
```

- `theme` 与 `network` 是**两件无关的事**：一张 Visa 卡可以是深色也可以是金色。
  星享借记卡同样走 Visa 网络（本行自有品牌不是卡组织）。
- 前端硬依赖：`accountId` 必须能在 `listAccounts()` 的返回里找到，
  卡片下方要写「资金账户：活期账户 · 6222 **** **** 3445」。
- 用在：`pages/CardsPage.tsx`、`components/cards/CardSecretsModal.tsx`（拿 `id` / `productName` / `last4`）

#### 2.5.2 `GET /api/cards/products`

- 请求体：无
- 响应：`CardProduct[]`
- 业务含义：可申请的卡产品。**定价是业务口径，不该写死在前端。**
- `CardProduct`：

```ts
interface CardProduct {
  code: string
  name: string
  theme: CardTheme
  network: CardNetwork
  kind: CardKind
  issuingFee: Cents    // 制卡工本费
  deliveryFee: Cents   // 寄送费
  perks: string[]      // 权益，逐条展示
  deliveryDays: number // 预计寄达工作日
}
```

- 种子里的两个产品（定价请以此为准）：

| code | name | theme | network | issuingFee | deliveryFee | deliveryDays |
| --- | --- | --- | --- | --- | --- | --- |
| `LCB-UP-DEBIT` | 招财猫 · 云闪付借记卡 | `gold` | `unionpay` | `1000`（¥10.00） | `0`（挂号信，不收） | 5 |
| `LCB-VISA-DEBIT` | 招财猫 · Visa 全球借记卡 | `ink` | `visa` | `2000`（¥20.00） | `1500`（¥15.00 快递） | 7 |

- **前端的硬假设（很重要）**：`CardApplicationModal.tsx` 第 55、58 行按**数组下标**取产品：
  - 换卡时：`products.find(p => p.network === card.network)?.code ?? products[0]?.code ?? ''`
  - 申卡时：`products[1]?.code ?? products[0]?.code ?? ''`
  **所以数组至少要有 1 个元素，申卡的默认值取第 2 个（下标 1）。**
  若真后端返回空数组，申卡弹层的产品选择会是空的。
- 用在：`pages/CardsPage.tsx`、`components/cards/CardApplicationModal.tsx`

#### 2.5.3 `POST /api/cards/open`

- 请求体：`CardApplication` = `{ productCode: string; address: MailingAddress; paymentPassword: string }`
- 响应：`BankCard`（**新卡**，`status: 'pending'`）
- `MailingAddress`：

```ts
interface MailingAddress {
  recipient: string
  phone: string
  region: string     // 省 / 直辖市
  city: string
  detail: string     // 街道、门牌、楼层房号
  postalCode?: string
}
```

- 校验顺序（**先验密码再收钱，顺序不能反**）：
  1. `productCode` 不在 `CARD_PRODUCTS` → `PRODUCT_NOT_FOUND` 404 `'卡产品不存在'`
  2. **`verifyPayPassword(paymentPassword)`** —— 见 4.4 的完整规则
  3. `validateAddress(address)` 有错 → `INVALID_ADDRESS` 400，`message` 用 lib 返回的那句
  4. 扣费：`fee = issuingFee + deliveryFee`，从**活期账户**扣（mock 是 `db.accounts[0]`）
- `validateAddress` 的逐字段规则（`lib/address.ts`，**返回第一条错误**，
  字段顺序固定为 `recipient, phone, region, city, detail, postalCode`）：

| 字段 | 规则 | 错误文案 |
| --- | --- | --- |
| `recipient` | trim 后非空 | `请填写收件人姓名` |
| `phone` | 去非数字后匹配 `/^1[3-9]\d{9}$/` | 空：`请填写手机号`；否则 `请输入 11 位手机号` |
| `region` | trim 后非空 | `请填写省 / 直辖市` |
| `city` | trim 后非空 | `请填写城市` |
| `detail` | trim 后长度 ≥ 5 | 空：`请填写详细地址`；否则 `详细地址至少 5 个字` |
| `postalCode` | 可空；非空时 `/^\d{6}$/` | `邮政编码为 6 位数字` |

- 扣费必须**落一笔台账**（不能只改余额，否则对账单上凭空少一笔）：
  `direction: 'out'`、`counterparty: '制卡工本费'`、`category: 'other'`、
  `status: 'success'`、明细 `channel: 'account'`、`paymentMethod`/`accountLabel` 取账户的
  `label`、`location: '招财猫银行 App'`、`remark: \`${product.name} 制卡费（含寄送费）\``
  （`deliveryFee > 0` 时才带「（含寄送费）」）。
  余额不足 → `INSUFFICIENT_FUNDS` 400 `'活期账户可用余额不足，请先转入后再申请'`
- 新卡的初始字段：`status: 'pending'`、`onlinePayment: false`、`overseasPayment: false`、
  **`dailyLimit: 200_000`（¥2,000.00）**、`shippingAddress: req.address`、
  `issuingFee: fee`、`accountId` 为活期账户 id。
  安全码与完整卡号另行存放（见 2.5.8）。
- ⚠️ mock 的行为细节（真后端需要自己定）：`last4` 与 `expiry` 是 mock 随机/写死生成的
  （`expiry` 恒为 `'05/31'`，`cardholder` 从已有卡里抄），**真后端必须由发卡系统给真值**。
  见第 8 节。
- 用在：`components/cards/CardApplicationModal.tsx`（`mode: 'open'`）

#### 2.5.4 `POST /api/cards/:id/lock`

- 路径参数：`id`
- 请求体：`{ locked: boolean }`（http.ts 第 97 行）
- 响应：`BankCard`（**更新后的卡**；前端乐观更新后用这个权威值写回）
- 业务含义：锁卡 / 解锁。
- 规则：
  - 卡不存在 → `CARD_NOT_FOUND` 404 `'银行卡不存在'`
  - **`status === 'replaced'` → `CARD_REPLACED` 400 `'该卡已换卡，无法操作'`**
  - 锁卡：`status = 'locked'`，**同时自动关闭 `onlinePayment` 与 `overseasPayment`**
    （锁卡联动，README §7 明确要求）
  - 解锁：`status = 'active'`（**不恢复**那两个开关）
- ⚠️ mock **允许对 `pending`（寄送中）的卡调这个接口**，会把状态改成 `locked`/`active`，
  等于跳过激活。这是 mock 的漏洞，见第 8 节。
- 用在：`pages/CardsPage.tsx`（乐观更新 + 失败回滚）

#### 2.5.5 `POST /api/cards/:id/replace`

- 路径参数：`id`
- 请求体：`CardReplaceRequest` = `{ address: MailingAddress; paymentPassword: string }`
- 响应：`BankCard`（**新卡**，`status: 'pending'`）
- 业务含义：换卡。旧卡置为 `'replaced'`、新卡 `'pending'` 且**卡号变更**。
- 校验顺序：
  1. 卡不存在 → `CARD_NOT_FOUND` 404
  2. **`card.status === 'replaced'` → `CARD_REPLACED` 400 `'该卡已换卡，无法重复操作'`**
     —— 幂等保护：同一张卡不能被换两次
  3. `verifyPayPassword(paymentPassword)`
  4. `validateAddress(address)` → `INVALID_ADDRESS` 400
  5. 收费：按**同卡组织**的产品定价 `issuingFee + deliveryFee`；
     名录里找不到对应产品时 mock 用固定 `2000`（¥20.00）。同样**落一笔台账**，
     `remark: \`${card.productName} 换卡工本费\``
  6. 旧卡 `status = 'replaced'`；新卡从旧卡复制字段但**重新生成 `id`、`last4`**、
     `status: 'pending'`、两个开关置 `false`、`shippingAddress` 换成新地址、
     `issuingFee` 换成这次的费用
  7. **新卡的安全码必须重新生成**（安全码是每张卡各自的，不能沿用旧卡的）
- 幂等：换卡后再次调用应被 `CARD_REPLACED` 拒绝（第 2 步）。
- 用在：`components/cards/CardApplicationModal.tsx`（`mode: 'replace'`）

#### 2.5.6 `PATCH /api/cards/:id/settings`

- 路径参数：`id`
- 请求体：`Partial<Pick<BankCard, 'onlinePayment' | 'overseasPayment' | 'dailyLimit'>>`
  —— 前端三次调用分别只传一个字段：
  `{ onlinePayment }`、`{ overseasPayment }`、`{ dailyLimit }`
  （`CardsPage.tsx` 三处 `api.updateCardSettings`）
- 响应：`BankCard`
- 业务含义：线上支付 / 境外交易 / 单日限额。
- 规则：
  - 卡不存在 → `CARD_NOT_FOUND` 404
  - **`card.status === 'locked'` 且 patch 里 `onlinePayment` 或 `overseasPayment` 为真 →
    `CARD_LOCKED` 400 `'卡片已锁定，请先解锁'`**（已锁卡禁止改支付设置）
  - 其余情况直接 `Object.assign(card, patch)`
- 前端的限额预设：`[200_000, 500_000, 1_000_000, 5_000_000]`
  （¥2,000 / ¥5,000 / ¥10,000 / ¥50,000）。后端应按同样的档位校验，
  超出范围的 `dailyLimit` 要有明确的拒绝（mock **不校验**，见第 8 节）。
- ⚠️ mock **不拦 `status === 'replaced'`** 的卡，与锁卡接口不对称。见第 8 节。
- 用在：`pages/CardsPage.tsx`（乐观更新 + 失败回滚）

#### 2.5.7 `GET /api/cards/:id`

⚠️ **路由表里有这一条（`routes.card`），但 `BankApi` 接口里没有对应方法，
两套实现也都没有这个方法。** 全仓库零引用。见第 6 节。
如果后端要保留这条路径，建议实现为「`GET /api/cards/:id` 返回单个 `BankCard`，
不含卡号与安全码」。

#### 2.5.8 `POST /api/cards/:id/secrets`

- 路径参数：`id`
- 请求体：`{ paymentPassword: string }`（http.ts 第 99 行）
- 响应：`CardSecrets` = `{ pan: string; expiry: string; cvv: string; revealSeconds: number }`
- 业务含义：**查看完整卡号与安全码**。这是唯一会下发 `pan` / `cvv` 的接口。
- 校验顺序（**先验身再看卡状态**，顺序有安全含义——反过来的话，
  密码不对的人也能从报错文案里探到卡的状态）：
  1. 卡不存在 → `CARD_NOT_FOUND` 404
  2. `verifyPayPassword(paymentPassword)`
  3. **`status === 'pending'` → `CARD_NOT_DELIVERED` 409
     `'卡还在寄送途中，收到并激活后才能查看安全码'`**
     —— 卡没到手就不该看到它的信息。界面上这个按钮**不置灰**：
     置灰了点不动，服务端这句话用户就永远看不到。
  4. **`status === 'replaced'` → `CARD_REPLACED` 409 `'这张卡已换发，旧卡信息不再可用'`**
     （**注意这里同一个 code 用的是 409，而换卡/锁卡处是 400**）
  5. 没有安全码记录 → `CARD_SECRET_MISSING` 404 `'该卡暂无安全码记录'`
- `revealSeconds`：服务端给出的可见时长（秒），mock 固定 **`60`**。
  **前端完全依赖它**：解锁后 `expiresAt = Date.now() + revealSeconds * 1000`，
  到点**真把值从 state 里删掉**（不是只把数字藏起来——只藏数字的话，
  有人在 devtools 里翻 React state 还是能翻到）。前端不落 localStorage。
- `expiry` 也跟着一起回来只是为了「查看卡片信息」这一处能一次拿全；
  它本身就印在卡面上，不是秘密。
- 用在：`components/cards/CardSecretsModal.tsx`
- 前端对错误码的依赖：`code === 'BAD_PAY_PASSWORD'` 时清空密码框重输（见 1.6）。

### 2.6 理财（9 条）

#### 2.6.1 `GET /api/wealth/products`

- 请求体：无
- 响应：`WealthProduct[]`
- 业务含义：理财产品超市。
- `WealthProduct` 字段：

```ts
interface WealthProduct {
  code: string
  name: string
  issuer: string              // 发行方（理财公司）
  category: 'cash' | 'fixed' | 'mixed' | 'equity' | 'derivative'
  risk: 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
  principalProtected: false   // **字面量 false**：理财一律非保本
  benchmark: Benchmark
  sevenDayYield?: number      // 仅现金管理类有
  nav: number                 // 最新单位净值
  navDate: string             // YYYY-MM-DD
  sinceInception: number      // 成立以来年化
  volatility: number          // 近一个月年化波动率
  minAmount: Cents            // 起购金额
  stepAmount: Cents           // 递增金额
  term: string                // '随时赎回' / '90 天' / '365 天' …
  openEnded: boolean
  ongoingFees: FeeItem[]      // 按日计提、已体现在净值里
  transactionFees: FeeItem[]  // 一次性收取、投资者额外承担
  navHistory: NavPoint[]      // { date: 'YYYY-MM-DD'; nav: number }[]
  topHoldings: AssetHolding[] // { name; weight; lookThrough: boolean }[]
}
```

- `Benchmark` 是判别联合：

```ts
type Benchmark =
  | { kind: 'formula'; formula: string; basis: string }
  | { kind: 'range'; low: number; high: number; basis: string }
```

  **两种都必须带 `basis`（测算依据）**——监管要求（见 4.9）。
- `principalProtected` 在类型上就是字面量 `false`，**给理财标保本这条路被类型系统堵死了**。
- mock 行为：`navDate` 在读列表时统一改成「今天」。
- 6 只产品的种子（价格与费率请以此为准）：

| code | name | category | risk | nav | minAmount | stepAmount | term | openEnded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `LCB-CASH-A` | 招财猫现金添利 A | `cash` | `R1` | 1.0015 | `100`（¥1.00） | `100` | 随时赎回 | true |
| `LCB-FIXED-090` | 招财猫稳盈 90 天 | `fixed` | `R2` | 1.0064 | `1_000_000`（¥10,000） | `100_000` | 90 天 | false |
| `LCB-FIXED-365` | 招财猫稳盈 365 天 | `fixed` | `R2` | 1.0128 | `1_000_000` | `100_000` | 365 天 | false |
| `LCB-MIXED-180` | 招财猫平衡配置 180 天 | `mixed` | `R3` | 0.9984 | `1_000_000` | `100_000` | 180 天 | false |
| `LCB-EQUITY-300` | 招财猫沪深 300 指数增强 | `equity` | `R4` | 1.0342 | `1_000_000` | `100_000` | 随时赎回 | true |
| `LCB-GOLD-365` | 招财猫黄金挂钩 365 天 | `derivative` | `R5` | 1.0571 | `5_000_000`（¥50,000） | `500_000` | 365 天 | false |

- 费率结构（**两组必须分开列，混在一起用户会以为自己被收了两遍**）：
  - `ongoingFees`（按日计提、已体现在净值里，投资者看不到单独扣款）：
    固定管理费 / 托管费 / 销售服务费
  - `transactionFees`（一次性收取、投资者额外承担）：
    只有 `LCB-EQUITY-300` 有 `申购费 0.0015`（0.15%）、
    `赎回费（持有不满 7 天）0.005`（0.5%）；
    `LCB-GOLD-365` 有 `申购费 0.003`（0.3%）。其余为空数组。
  - **本次实现只按 `label.startsWith('申购')` / `startsWith('赎回')` 取一项**，
    且 `rate === 0` 时视为免费（见 2.6.6 / 2.6.7）。
- `navHistory`：mock 用**固定种子的伪随机游走**生成 30 天序列，不用 `Math.random()`
  ——同一天多次刷新得到的曲线必须一致，否则用户觉得数据在乱跳，截图和断言也没法做。
  真后端应由真实净值序列填充。
- `topHoldings`：**新规要求同时披露穿透前与穿透后**，用 `lookThrough` 区分。
- 用在：`pages/WealthPage.tsx`

#### 2.6.2 `GET /api/wealth/products/:code`

- 路径参数：`code`（产品代码，如 `LCB-FIXED-090`）
- 响应：`WealthProduct`
- 业务含义：产品详情。
- 错误：`PRODUCT_NOT_FOUND` 404 `'理财产品不存在'`
- ⚠️ **前端目前只从 `listWealthProducts()` 的结果里挑产品，没有调用这个接口**
  （`ProductDetailModal` 拿的是列表里那个对象）。仍请实现，契约的一部分。
- 用在：`—`（无调用点）

#### 2.6.3 `GET /api/wealth/overview`

- 请求体：无
- 响应：`WealthOverview`

```ts
interface WealthOverview {
  account: WealthAccount
  totalValue: Cents
  totalPrincipal: Cents
  totalProfit: Cents
  yesterdayProfit: Cents
  holdings: WealthHolding[]
  risk: RiskAssessment
}

interface WealthAccount {
  opened: boolean
  accountNo: string            // 未开立时为空串 ''
  openedAt: string             // 未开立时为空串 ''
  settlementAccountId: string  // 绑定的资金账户 id
  agreementSignedAt: string
  riskLevelAtOpening: 'C1' | 'C2' | 'C3' | 'C4' | 'C5'
}

interface WealthHolding {
  id: string
  productCode: string
  productName: string
  category: WealthCategory
  risk: RiskLevel
  shares: number
  costNav: number
  principal: Cents
  marketValue: Cents
  profit: Cents
  profitRate: number
  purchasedAt: string
  redeemableAt: string | null   // 活期为 null
  closed: boolean               // 当前是否处于封闭期
}

interface RiskAssessment {
  done: boolean
  level: RiskTolerance
  score: number
  assessedAt: string
  expiresAt: string
  expired: boolean
}
```

- 业务含义：总资产 + 持仓 + 风险测评状态 + 理财账户状态。
- **派生字段必须实时算，不能落库**：
  - `marketValue = Math.round(shares * 产品最新 nav)`
  - `profit = marketValue - principal`
  - `profitRate = principal === 0 ? 0 : profit / principal`
  - `closed = redeemableAt != null && Date.now() < redeemableAt`
    —— **由后端判定**，不让前端拿 `Date.now()` 在渲染期算。
    「能不能赎回」本来就是服务端事实，而且那会让渲染变成非纯函数。
  - `totalValue = Σ marketValue`；`totalPrincipal = Σ principal`；
    `totalProfit = totalValue - totalPrincipal`
  - `yesterdayProfit = Σ Math.round(shares × (最新两日净值差))`；
    净值序列不足 2 点时该项不计入
  - `expired = !done || Date.now() > expiresAt`
    （**过期等同于未测评**，前端据此判断能否购买）
- **未开立理财账户时**：`account.opened === false`，前端**整块不显示总资产与持仓**，
  只展示一张闸门卡片与产品超市。所以此时 `holdings` 应为 `[]`、总额应为 0，
  `account.accountNo` / `openedAt` 应为 `''`（前端会直接渲染这两个字符串）。
- 前端的硬假设：
  - `risk.expiresAt.slice(0, 10)` 会被直接渲染成「有效期至 2026-09-17」
    ——**未测评时 `expiresAt` 是空串，`''.slice(0,10)` 是 `''`**，
    所以空串是安全的（前端只在 `risk.done` 为真时渲染那一行）。
  - `risk.done === false` 与 `risk.expired === true` 是**两种不同展示**
    （「未评估」/「已过期」），不要合并。
  - `WealthPage` 用 `overview.account.opened` 决定是否显示申购入口。
- 用在：`pages/WealthPage.tsx`

#### 2.6.4 `POST /api/wealth/account/open`

- 请求体：`WealthAccountOpeningRequest`

```ts
interface WealthAccountOpeningRequest {
  holderName: string
  idNumber: string
  smsCode: string
  faceTicket: string
  settlementAccountId: string
  agreement: string   // 服务端逐字校验
}
```

- 响应：`WealthAccount`
- 业务含义：开立**理财账户（投资账户）**。银行户 ≠ 理财户：银行户装钱，
  理财户不装钱，只是把「你」和理财公司之间的委托关系立起来。
- 校验顺序（mock 的 `openWealthAccount`）：
  1. **已开立 → `ALREADY_OPENED` 400 `'理财账户已开立，无需重复开户'`**（幂等保护）
  2. `holderName.trim()` 为空 → `NAME_REQUIRED` 400 `'请填写姓名'`
  3. `idNumber` 不匹配 `/^\d{17}[\dXx]$/` → `INVALID_ID` 400 `'请输入 18 位身份证号'`
  4. `pendingSms` 缺失 → `SMS_NOT_SENT` 400；过期 → `SMS_EXPIRED` 400；
     不匹配 → `BAD_SMS_CODE` 400
  5. `faceTicket` 为空 → `FACE_REQUIRED` 400
  6. **风险测评必须先做完且在有效期内** → `RISK_ASSESSMENT_REQUIRED` 403
     `'请先完成风险承受能力评估'`
     ——**顺序是先测评再开户，不是并行**：账户的适当性等级要在开立时确定并记录下来。
  7. `agreement.trim()` 必须逐字等于 `WEALTH_INVESTMENT_AGREEMENT` →
     否则 `AGREEMENT_REQUIRED` 400 `'请阅读并签署投资协议'`
  8. `settlementAccountId` 必须能在账户里找到 → 否则 `SETTLEMENT_REQUIRED` 400
     `'请选择资金账户'`
  9. `pendingSms = null`
- 开户结果：`opened: true`、`accountNo` mock 生成 `'9' + 11 位数字`（共 12 位）、
  `openedAt` = `agreementSignedAt` = 当前时间、
  **`riskLevelAtOpening` = 开户时的 `risk.level` 快照**。
- 用在：`components/wealth/WealthAccountOpeningModal.tsx`
  （流程是 风险测评 → 身份核验 → 签署协议 → 完成，四步）

#### 2.6.5 `GET /api/wealth/risk/questions`

- 请求体：无
- 响应：`RiskQuestion[]` = `{ id: string; question: string; options: { label: string; score: number }[] }[]`
- 业务含义：风险承受能力问卷。**6 题**，覆盖监管列明的维度
  （年龄、财务状况、投资经验、投资目的、收益期望、风险偏好、流动性要求、
  风险认识及风险损失承受程度）。
- 每题的 `options` 是 **4 个**，`score` 分别 `1 / 2 / 3 / 4`。
  种子里 `id` 为 `q1`…`q6`，题干见 `RISK_QUESTIONS`。
- 前端的硬假设：`answers: number[]` 里的元素是**选项下标（0 起）**，
  不是 `score`。提交时长度必须等于题目数（见 2.6.6）。
- 用在：`pages/WealthPage.tsx`、`components/wealth/RiskAssessmentModal.tsx`

#### 2.6.6 `POST /api/wealth/risk/assess`

- 请求体：`{ answers: number[] }`（http.ts 第 107 行显式构造）
- 响应：`RiskAssessment`
- 校验：
  1. `answers.length !== 题目数（6）` → `INCOMPLETE_ANSWERS` 400 `'请完成全部题目'`
  2. 逐个 `q.options[answers[i]]`，越界 → `INVALID_ANSWER` 400 `'答案无效'`
  3. `score = Σ option.score`
- 评级映射（`toleranceFromScore`，**照抄**）：

| 总分 | 等级 |
| --- | --- |
| ≤ 9 | `C1` 保守型 |
| 10–12 | `C2` 谨慎型 |
| 13–16 | `C3` 稳健型 |
| 17–20 | `C4` 积极型 |
| ≥ 21 | `C5` 激进型 |

（总分范围 6–24）
- **有效期一年**：`expiresAt = assessedAt` 加一年（mock 用 `setFullYear(+1)`）。
  监管要求：《理财公司理财产品销售管理暂行办法》第三十一条，
  **超过一年未评估的投资者，再次购买前必须重新评估**。
- 响应里 `expired` 应为 `false`。
- 用在：`components/wealth/RiskAssessmentModal.tsx`（经 `pages/WealthPage.tsx`）

#### 2.6.7 `POST /api/wealth/subscribe`

- 请求体：`WealthSubscribeRequest`

```ts
interface WealthSubscribeRequest {
  productCode: string
  amount: Cents
  paymentPassword: string
  riskAcknowledgement: string   // 必须完整抄录
}
```

- 响应：`WealthSubscribeResult`

```ts
interface WealthSubscribeResult {
  holding: WealthHolding
  confirmedAt: string
  shares: number
  nav: number
  fees: Cents     // 一次性费用合计
}
```

- 校验顺序（mock 的 `subscribeWealth`，**顺序即优先级，照做**）：
  1. `productCode` 不存在 → `PRODUCT_NOT_FOUND` 404
  2. **未开立理财账户 → `WEALTH_ACCOUNT_REQUIRED` 403 `'请先开立理财账户'`**
  3. 风险测评未做或已过期 → `RISK_ASSESSMENT_REQUIRED` 403
  4. **适当性不匹配 → `RISK_MISMATCH` 403**，
     `message` = `suitabilityMessage(risk.level, product.risk)`
     —— **这是硬拦截，不是提示**。监管把「误导投资者购买与其风险承受能力不相匹配的
     理财产品」列为禁止行为。
  5. `riskAcknowledgement.trim()` 必须逐字等于 `RISK_ACKNOWLEDGEMENT`
     → 否则 `ACKNOWLEDGEMENT_MISMATCH` 400，
     `` message = `请完整抄录风险确认语句：${RISK_ACKNOWLEDGEMENT}` ``
     —— 监管要的是**抄录**，不是一个勾选框。
  6. `amount < product.minAmount` → `BELOW_MIN_AMOUNT` 400，
     `` `起购金额 ¥${(minAmount / 100).toLocaleString('zh-CN')}` ``
  7. `amount % product.stepAmount !== 0` → `INVALID_STEP` 400，
     `` `追加金额需为 ¥${(stepAmount / 100).toLocaleString('zh-CN')} 的整数倍` ``
  8. `amount > 活期账户 available` → `INSUFFICIENT_FUNDS` 400
     `'活期账户可用余额不足'`
  9. **`verifyPayPassword(paymentPassword)`** —— **放在所有业务校验之后**
     （先验密码再收钱，但不能拿密码校验去掩盖业务拒绝）
- 费用与份额（**内扣**）：
  - `oneOffFee(product, amount, '申购')`：在 `transactionFees` 里找
    **`label.startsWith('申购')`** 的第一项；找不到或 `rate === 0` → `fee: 0`
  - `fee = Math.round(amount * item.rate)`
  - `netAmount = amount - fee`
  - `shares = Number((netAmount / product.nav).toFixed(2))` —— **份额保留 2 位小数**
- 副作用：
  - 从活期账户扣**全额 `amount`**（不是扣 `netAmount`）
  - **落一笔台账**：`direction: 'out'`、`counterparty: \`申购 · ${product.name}\``、
    `memo: \`申购 ${product.name}\``、`category: 'other'`、`status: 'success'`；
    明细 `channel: 'account'`、`remark` 为
    `申购费 ¥xx.xx（内扣）` 或 `'申购费免费'`
  - **同一产品合并持仓**：`totalShares = 旧 shares + 新 shares`；
    `costNav` 按加权平均重算；
    `principal += amount`；`purchasedAt` 保持原值（mock 不动它）
  - 新持仓的 `redeemableAt`：`openEnded` 为 true 时 `null`，
    否则 = 现在 + 期限天数（mock 从 `term` 里抽数字，默认 90 天），时刻设为当天 09:00
- `confirmedAt`：监管要求及时告知确认日期、确认份额和金额。
- 用在：`components/wealth/ProductDetailModal.tsx`

#### 2.6.8 `POST /api/wealth/redeem`

- 请求体：`WealthRedeemRequest` = `{ holdingId: string; shares?: number }`
  —— **`shares` 省略表示全部赎回**
- 响应：`WealthRedeemResult`

```ts
interface WealthRedeemResult {
  holdingId: string
  acceptedAt: string
  shares: number
  estimatedAmount: Cents
  etaText: string
}
```

- 校验顺序：
  1. 持仓不存在 → `HOLDING_NOT_FOUND` 404 `'持仓不存在'`
  2. 产品不存在 → `PRODUCT_NOT_FOUND` 404
  3. **处于封闭期 → `IN_CLOSED_PERIOD` 400**，
     `` `该产品处于封闭期，${formatDate(redeemableAt)} 起可赎回` ``
     （`formatDate` 输出 `YYYY-MM-DD`）
  4. `shares` 缺省取全部持仓；`<= 0` → `INVALID_SHARES` 400 `'赎回份额必须大于 0'`
  5. `shares > 持仓份额` → `EXCEED_SHARES` 400 `'赎回份额超过持有份额'`
- 金额：
  - `gross = Math.round(shares * product.nav)`
  - `oneOffFee(product, gross, '赎回')`：找 `label.startsWith('赎回')` 的第一项
  - `net = gross - fee`
- 副作用：
  - **款项回到资金账户**（mock 是 `db.accounts[0]`）。README 说「款项回到**申购时使用的账户**」，
    但 mock 没有记录申购账户，一律进 `accounts[0]`。见第 8 节。
  - **落一笔台账**：`direction: 'in'`、`amount: net`、`signedAmount: net`、
    `counterparty: \`赎回 · ${product.name}\``、`memo: \`赎回 ${product.name}\``、
    `category: 'other'`；明细 `remark` 为 `赎回费 ¥x.xx（已扣除）` 或 `'赎回费免费'`
    ——**注意入账金额是净额（已扣赎回费）**，没有单独的手续费台账。
  - 持仓按**份额比例**扣减本金：`principal = Math.round(principal * (1 - ratio))`，
    `ratio = shares / 旧 shares`；`shares` 减到 `<= 0` 时**删除该持仓**
- `etaText`：mock 固定 `'预计 T+1 个工作日到账'`（「T+1」到账口径）
- 用在：`components/wealth/RedeemModal.tsx`

#### 2.6.9 `GET /api/wealth/overview` / `GET /api/wealth/products/:code`

见 2.6.3 / 2.6.2。

### 2.7 财务管理（6 条）

#### 2.7.1 `GET /api/analysis/spending`

- Query：`month?: 'YYYY-MM'`（前端**目前不传**，mock 默认当前月）
- 响应：`SpendingAnalysis`

```ts
interface SpendingAnalysis {
  month: string                                    // 'YYYY-MM'
  total: Cents
  monthOverMonth: number                           // 环比：(本月 - 上月) / 上月；上月为 0 时给 0
  categories: SpendingCategory[]                   // { key; label; amount; ratio }[]
  trend: SpendingTrendPoint[]                      // { month; amount }[]
}
```

- 业务含义：消费分析。
- 口径：
  - **只统计支出**（`direction === 'out'`），金额取 `amount`（正数）
  - `total` = 目标月所有支出的 `amount` 之和
  - `categories` 按 `category` 聚合，**按金额从大到小排序**
    （环形图与「最大支出分类」都按这个顺序，避免图表顺序误导用户）
  - `ratio = total === 0 ? 0 : amount / total`（**小数，不是百分数**）
  - `label` 用中文分类标签（见下）
  - `trend`：**近 6 个月**，从 5 个月前到本月，每月一个点，`amount` 为该月支出合计。
    月份键是 `'YYYY-MM'`
- 中文分类标签（`lib/categories.ts` 的 `CATEGORY_LABEL`，**唯一来源**）：

| key | label |
| --- | --- |
| `salary` | 工资入账 |
| `transfer` | 转账 |
| `dining` | 餐饮 |
| `shopping` | 购物 |
| `housing` | 房租 |
| `transport` | 交通 |
| `subscription` | 订阅服务 |
| `other` | 其他 |

- ⚠️ 月份归属与所在时区有关：mock 用**本地时间**取月（`localMonth`），
  并用 `iso.slice(0, 7)`（即 UTC）做过滤。两者在跨月边界上会不一致，见第 8 节。
  真后端请明确一个时区（建议按用户所在时区/东八区）并全程一致。
- 用在：`pages/AnalysisPage.tsx`、`pages/DashboardPage.tsx`
  （首页用它算「本月收入 = monthNetChange + spending.total」与「本月支出 = spending.total」，
  所以 `total` 必须与 `monthNetChange` 的口径自洽）

#### 2.7.2 `GET /api/analysis/cashflow`

- Query：`days?: number`（前端传 `7` 或 `30`；缺省 mock 用 7）
- 响应：`CashFlow`

```ts
interface CashFlow {
  days: number
  points: CashFlowPoint[]                  // { date: 'YYYY-MM-DD'; income; expense }[]
  totalIncome: Cents
  totalExpense: Cents
}
```

- 业务含义：现金流（逐日收入/支出）。
- 口径：
  - `points` **必须正好 `days` 个点，按日期升序，最后一个是今天**
    （mock 从 `days - 1` 天前循环到今天）
  - 每一天按**本地日** `[00:00:00, 次日 00:00:00)` 切分
  - `income` = 当天 `direction === 'in'` 的 `amount` 之和；
    `expense` = 当天 `direction === 'out'` 的 `amount` 之和
  - **没有交易的日子也要补一个 `{ income: 0, expense: 0 }` 的点**——
    前端直接按下标画面积图，缺一天整条曲线就错位
  - `totalIncome` / `totalExpense` 是 `points` 各自求和
- 用在：`pages/DashboardPage.tsx`（近 7 天 / 30 天双序列面积图）

#### 2.7.3 `GET /api/autodebits`

- 请求体：无
- 响应：`AutoDebit[]`

```ts
interface AutoDebit {
  id: string
  merchant: string
  amount: Cents
  cycle: string        // '每月 8 日' / '每年 5 月'
  nextRunAt: string
  enabled: boolean
  category: TransactionCategory
}
```

- 业务含义：自动扣款列表。
- 用在：`pages/AnalysisPage.tsx`

#### 2.7.4 `PATCH /api/autodebits/:id`

- 路径参数：`id`
- 请求体：`{ enabled: boolean }`（http.ts 第 116 行）
- 响应：`AutoDebit`（**更新后的那一条**）
- 错误：`AUTODEBIT_NOT_FOUND` 404 `'扣款计划不存在'`
- 用在：`pages/AnalysisPage.tsx`（乐观更新）

#### 2.7.5 `GET /api/accounts/:id/transactions/export`

见 2.2.4。

#### 2.7.6 `GET /api/analysis/spending` / `GET /api/analysis/cashflow`

见 2.7.1 / 2.7.2。

### 2.8 安全中心（6 条）

#### 2.8.1 `GET /api/security/overview`

- 请求体：无
- 响应：`SecurityOverview`

```ts
interface SecurityOverview {
  score: number            // 0-100
  level: string
  identityVerified: boolean
  devices: SecurityDevice[]                                  // { id; name; location; lastActiveAt; current }[]
  logs: SecurityLog[]                                        // { id; action; detail; createdAt; level: 'info' | 'warn' }[]
  riskRules: { id: string; label: string; description: string; enabled: boolean }[]
}
```

- 业务含义：安全评分 / 设备 / 日志 / 风控规则。
- **`score` 与 `level` 都是派生字段**（mock 的 `withDerivedSecurity`）：
  ```
  score = min(100, 60 + (identityVerified ? 12 : 0) + 已开启规则数 * 6)
  level = score >= 90 ? '防护优秀' : score >= 75 ? '防护良好' : '建议加强'
  ```
  按种子的 4 条规则（3 条开启）算，score = 78、level = `防护良好`。
  `level` 的中文串**由后端下发**，前端直接渲染 `overview.data?.level`，
  所以它必须始终是这三个值之一（或后端自定义，但前端不做映射）。
- 种子里的 4 条风控规则（`id` 是前端 `setSecurityRule` 的键，**不要改**）：

| id | label | description | 种子 enabled |
| --- | --- | --- | --- |
| `rule_amount` | 大额转账二次确认 | 单笔超过 ¥5,000.00 需再次确认 | true |
| `rule_overseas` | 境外交易拦截 | 境外收款方自动触发人工复核 | true |
| `rule_new_device` | 新设备登录验证 | 陌生设备登录需短信验证码 | true |
| `rule_night` | 深夜交易提醒 | 23:00–06:00 的交易实时推送 | false |

- `logs[].level`：`'warn'` 会在顶栏通知里出小红点，`'info'` 不会。
  **日志按 `createdAt` 倒序返回**（mock 用 `unshift` 插到头部）。
- 用在：`pages/SecurityPage.tsx`、`components/layout/TopBar.tsx`（只为看 `logs` 里的 warn）

#### 2.8.2 `PATCH /api/security/rules/:id`

- 路径参数：`id`（规则 id，见上表）
- 请求体：`{ enabled: boolean }`（http.ts 第 119 行）
- 响应：`SecurityOverview`（**整个对象**，不是单条规则）
  —— 前端直接 `overview.setData(await api.setSecurityRule(id, next))`，整块替换。
  `score` 会因为规则数变化而变，所以必须返回重算后的值。
- 规则不存在 → `RULE_NOT_FOUND` 404 `'风控规则不存在'`
- 副作用：写一条安全日志 —— `action` 为 `'开启风控规则'` / `'关闭风控规则'`，
  `detail` 是规则 `label`，**`level` 为 `'info'`（开启）/ `'warn'`（关闭）**。
- 用在：`pages/SecurityPage.tsx`（乐观更新）
- ⚠️ README §18 说「侧栏不再有『开户』项」等，但没有提到 `security/rules` 路由；
  路由表里有、README 接口清单里没有。见第 6 节。

#### 2.8.3 `POST /api/security/password`

- 请求体：`{ oldPassword: string; newPassword: string }`（http.ts 第 121 行）
- 响应：`void`
- 校验：
  - `oldPassword !== 当前登录密码` → `BAD_OLD_PASSWORD` 400 `'原密码不正确'`
  - `newPassword.length < 6` → `WEAK_PASSWORD` 400 `'新密码至少 6 位'`
- 副作用：写一条安全日志，`action: '修改登录密码'`、
  `detail: '密码已更新，请在其他设备重新登录'`、`level: 'info'`。
- 用在：`pages/SecurityPage.tsx`
- ⚠️ 该接口**不验支付密码、不验人脸/短信票据**。README §18.1 的表格里
  「密码」这一行没有列出所需的核身步骤，但「重置密码」在 MVP 范围里被标记为已完成。
  见第 8 节。

#### 2.8.4 `POST /api/security/verify`

- 请求体：`{ channel: 'sms' | 'face' }`（http.ts 第 123 行）
- 响应：`{ ticket: string }`
- 业务含义：身份认证，返回一张票据。**这个接口被三处复用**：
  - 开户第二步的人脸核身（`OpenAccountPage` 调 `verifyIdentity('face')`）
  - 开立理财账户第二步（`WealthAccountOpeningModal` 调 `verifyIdentity('face')`）
  - 更换登录手机号（`SecurityPage` 调 `verifyIdentity('face')`）
- mock 行为：**不做任何校验**，直接返回 `verify.<channel>.<Date.now()>`。
  真后端应签发有**有效期**、**一次性**、**绑定用户与用途**的票据，
  并在 `openAccount` / `openWealthAccount` / `changePhone` 处校验它。
  当前 mock **完全不校验票据真伪**（只判非空），这是明确的实现缺口，见第 6、8 节。
- ⚠️ README §18 明确说明「独立的『身份认证』板块已删除」，身份认证是敏感操作里的**一步**。
  所以这个接口应当**只能被上述流程在流程内部调用**，不应做成用户可随时点一下拿票的东西。
- 用在：`pages/OpenAccountPage.tsx`、`pages/SecurityPage.tsx`、
  `components/wealth/WealthAccountOpeningModal.tsx`

#### 2.8.5 `PATCH /api/auth/phone`

见 2.1.5。

#### 2.8.6 `POST /api/security/password`

见 2.8.3。

### 2.9 智能客服（2 条）

#### 2.9.1 `GET /api/support/messages`

- 请求体：无
- 响应：`SupportMessage[]`

```ts
interface SupportMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  createdAt: string
  actions?: { label: string; to: string }[]   // 可点操作，to 是前端路由
}
```

- 业务含义：客服历史。
- `actions[].to` 是**前端路由**（如 `/transfer`、`/cards`、`/security`、`/analysis`、`/support`、`/`），
  前端直接 `navigate(to)`。所以后端下发的是路由字符串，不是 URL。
- mock 在**没有任何历史时**返回一条欢迎语：
  `'你好，我是招财猫银行的智能客服。转账、锁卡、密码重置、消费分析都可以问我。'`
  有历史时返回历史。**mock 的历史存在 localStorage，服务端不落库**（见第 6 节）。
- 用在：`pages/SupportPage.tsx`

#### 2.9.2 `POST /api/support/chat`

- 请求体：`{ text: string }`（http.ts 第 126 行）
- 响应：`SupportReply` = `{ message: SupportMessage; canned: boolean }`
- 业务含义：客服对话。MVP 是**固定话术匹配**（关键词规则），未接入大模型，
  所以 `canned: true`。
- `message.role` 必须是 `'agent'`（前端把它追加到消息列表）。
- **关键词规则**（mock 的 `CANNED_RULES`，按顺序取第一条命中的，`i` 表示忽略大小写）：

| 顺序 | 匹配（正则） | 回复要点 | 附带 action |
| --- | --- | --- | --- |
| 1 | `/fps&#124;转数快&#124;跨境支付通&#124;手机号转账&#124;邮箱转账&#124;电邮转账/i` | 四种汇款方式说明、姓名由登记册解析、跨境都必须选收款行、免手续费实时到账 | `去转账` → `/transfer` |
| 2 | `/转账&#124;汇款&#124;打钱/` | 两条通道 + 费率 + 单笔超 ¥5,000 二次确认 | `去转账` → `/transfer` |
| 3 | `/余额&#124;多少钱&#124;账户/` | 活期余额已同步；储蓄/定期需先转活期 | `查看总览` → `/` |
| 4 | `/锁卡&#124;冻结&#124;丢卡&#124;挂失/` | 丢卡请立刻锁卡；找回后可解锁 | `去锁卡` → `/cards` |
| 5 | `/换卡&#124;补卡&#124;卡坏/` | 新卡 3 个工作日内寄出；旧卡立即失效、卡号变更、自动扣款需重签 | `去换卡` → `/cards` |
| 6 | `/密码&#124;忘.*密码&#124;重置/` | 安全中心重置，需先通过短信或人脸认证 | `去安全中心` → `/security` |
| 7 | `/限额&#124;额度/` | 借记卡默认单日 ¥50,000，可调整，调高需身份认证 | `调整限额` → `/cards` |
| 8 | `/境外&#124;海外&#124;出国&#124;香港/` | 境外转账约 1 个工作日；需打开境外交易开关 | `打开境外交易` → `/cards` |
| 9 | `/消费&#124;花销&#124;花了多少&#124;账单/` | 消费分析按分类统计 + 近 6 月走势 | `查看消费分析` → `/analysis` |
| 10 | `/扣款&#124;自动&#124;订阅&#124;会员/` | 自动扣款列表可随时关停 | `管理自动扣款` → `/analysis` |
| 11 | `/利率&#124;利息&#124;存款/` | 活期 0.30%、储蓄 1.55%、定期 2.10%；按日计提按季结息 | `查看账户` → `/` |
| 12 | `/人工&#124;客服&#124;投诉/` | 转人工入口；服务时间 09:00–21:00 | `转人工客服` → `/support` |

- 一条都没命中时的兜底文案：
  `'我是招财猫银行的智能客服（MVP 演示版，回答为固定话术）。你可以问我：怎么转账、怎么锁卡、密码怎么重置、本月花了多少、自动扣款在哪里管理。'`
  （**不带 action**）
- **完整文案以 `app/src/api/mock/index.ts` 第 328–389 行的 `CANNED_RULES` 为准**，
  真后端若要复用这套话术，请直接照抄那一份（不要凭上表的「要点」自己重写）。
- ⚠️ 表里的利率口径与 `WealthProduct` 无关（那是存款利率），且 mock 只在话术里提到它，
  `Account.interestRate` 的种子值是 `0.003 / 0.0155 / 0.021`。
- 用在：`pages/SupportPage.tsx`

---

## 3. 错误码表

全部来自 `app/src/api/mock/index.ts` 的 `new ApiError(...)` 调用点（共 **78** 处），
去重后 **53** 个不同的 `code`。`ApiError` 的构造签名是
`new ApiError(message: string, status: number, code?: string)`，所以
**HTTP status 由后端自己定，`code` 才是契约**。

`message` 一列就是 mock 实际抛出的中文文案，**前端直接展示它，不做任何包装**。
带 `${...}` 的是模板，照抄模板即可。

### 3.1 认证与身份（8 个）

| code | HTTP | 触发条件 | message |
| --- | --- | --- | --- |
| `INVALID_PHONE` | 400 | 手机号不匹配 `/^\d{11}$/`（login）/ `/^1[3-9]\d{9}$/`（sms-code、changePhone） | `请输入 11 位手机号` |
| `BAD_CREDENTIALS` | 401 | 登录密码不对 | `手机号或密码不正确` |
| `BAD_OLD_PASSWORD` | 400 | `changePassword` 的原密码不对 | `原密码不正确` |
| `WEAK_PASSWORD` | 400 | 新密码长度 < 6 | `新密码至少 6 位` |
| `SAME_PHONE` | 400 | 换绑的新号等于当前登录号 | `新手机号与当前登录手机号相同` |
| `SMS_NOT_SENT` | 400 | 没有 `pendingSms` 就提交（开户 / 开理财户 / 换手机号） | `请先获取短信验证码` |
| `SMS_EXPIRED` | 400 | 验证码已过期（> 5 分钟） | `验证码已过期，请重新获取` |
| `BAD_SMS_CODE` | 400 | 验证码不匹配（去非数字后比对） | `验证码不正确` |
| `SMS_PHONE_MISMATCH` | 400 | 换手机号时验证码不是发往新号的 | `验证码不是发往该手机号的，请重新获取` |
| `FACE_REQUIRED` | 400 | `faceTicket` 为空（开户 / 开理财户 / 换手机号） | `请先完成人脸识别` |

### 3.2 支付密码（3 个）

| code | HTTP | 触发条件 | message |
| --- | --- | --- | --- |
| `PAY_PASSWORD_LOCKED` | **423** | 已连续输错达 3 次（`payPasswordFailures >= 3`） | `支付密码已锁定，请重新登录后再试` |
| `INVALID_PAY_PASSWORD` | 400 | 输入的支付密码不是 6 位数字 | `请输入 6 位数字支付密码` |
| `BAD_PAY_PASSWORD` | 401 | 格式对但值不对；`message` 带剩余次数 | 还有次数时：`` `支付密码不正确，还可尝试 ${left} 次` ``；用尽时：`支付密码连续错误，已锁定，请重新登录` |

**支付密码的完整规则**（`verifyPayPassword`，三个接口共用：`openCard`、`replaceCard`、
`revealCardSecrets`、`subscribeWealth`）：

1. 先查锁定：`failures >= 3` → `PAY_PASSWORD_LOCKED` 423
2. 再查格式：不匹配 `/^\d{6}$/` → `INVALID_PAY_PASSWORD` 400
3. 比对值：不对则 `failures += 1` 并抛 `BAD_PAY_PASSWORD` 401
   （`left = 3 - failures`，`left > 0` 时文案带剩余次数）
4. 正确则 `failures = 0`
5. **登录成功时把 `failures` 归零**（`login` 里显式做了）——「重新登录解除锁定」

`CardSecretsModal` 依赖 `BAD_PAY_PASSWORD` 来清空密码框（见 1.6）。

### 3.3 账户与流水（9 个）

| code | HTTP | 触发条件 | message |
| --- | --- | --- | --- |
| `ACCOUNT_NOT_FOUND` | 404 | `:id` 找不到账户（getAccount / listTransactions / deposit） | `账户不存在` |
| `TX_NOT_FOUND` | 404 | `:id` 找不到交易（getTransaction / getReceipt） | `交易不存在或已超出可查询期限` |
| `INVALID_AMOUNT` | 400 | `amount <= 0`（deposit / submitTransfer） | `转入金额必须大于 0` / `转账金额必须大于 0` |
| `LIMIT_EXCEEDED` | 400 | 超过单笔上限（deposit > ¥50,000；transfer > 该通道 `singleLimit`） | `单笔转入上限 ¥50,000.00` / `` `单笔转账上限 ¥50,000.00` ``（数字随通道变） |
| `INSUFFICIENT_FUNDS` | 400 | 余额不足（转账含手续费；制卡扣费；理财申购） | `账户可用余额不足` / `活期账户可用余额不足` / `活期账户可用余额不足，请先转入后再申请` |
| `TIER_NOT_FOUND` | 404 | 开户时 `tier` 不在名录 | `账户类别不存在` |
| `TIER_OFFLINE_ONLY` | 400 | Ⅰ 类户等 `online === false` 的类别被请求开户 | **`tier.offlineReason`**（即「按账户分类管理规定，Ⅰ 类户需本人持身份证到柜台面签，无法在线开立」） |
| `NAME_REQUIRED` | 400 | `holderName.trim()` 为空（开户 / 开理财户） | `请填写姓名` |
| `INVALID_ID` | 400 | 身份证号不匹配 `/^\d{17}[\dXx]$/` | `请输入 18 位身份证号` |
| `INVALID_BINDING_CARD` | 400 | Ⅱ / Ⅲ 类户的绑定卡号不是 12–19 位数字 | `` `绑定卡：${err}` ``（`err` 是 lib 的原文案） |
| `PLEDGE_REQUIRED` | 400 | 承诺语句不逐字等于 `ACCOUNT_OPENING_PLEDGE` | `请确认合法开立和使用账户承诺` |

### 3.4 转账（6 个）

| code | HTTP | 触发条件 | message |
| --- | --- | --- | --- |
| `BANK_REQUIRED` | 400 | `channel === 'fps'` 但没给 `payeeBankCode` | `请选择收款银行` |
| `BANK_NOT_FOUND` | 400 | `(payeeBankCode, payeeBankRegion)` 在名录里查不到 | `收款银行不存在` |
| `PAYEE_REQUIRED` | 400 | 收款人姓名为空（fps 的 `account` 方式 / bank 通道） | `请填写收款户名` / `请填写收款人` |
| `INVALID_ACCOUNT_NO` | 400 | 收款账号校验失败（`validateBankAccount` / `validateFpsValue('account')`） | **lib 的原文案**，见下表 |
| `INVALID_FPS_ID` | 400 | fps 标识校验失败 | **lib 的原文案**，见下表 |

`lib/account.ts` 的校验文案（**这些文案由前端/lib 定义，后端返回同样的串**）：

| 场景 | 规则 | 文案 |
| --- | --- | --- |
| 银行卡号 | 去非数字后 12–19 位 | 空：`请输入收款账号`；<12：`账号至少 12 位`；>19：`账号最多 19 位` |
| fps `account` | trim 后长度 ≥ 6 | 空：`请输入收款账户`；否则 `收款账号至少 6 位` |
| fps `mobile` | 去非数字后 `/^[4-9]\d{7}$/` | 空：`请输入手机号`；否则 `请输入 8 位香港手机号（4/5/6/7/8/9 开头）` |
| fps `fpsid` | 去非数字后 `/^\d{7}$/` | 空：`请输入FPS ID`；否则 `FPS ID 为 7 位数字` |
| fps `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` | 空：`请输入电邮`；否则 `请输入有效的邮箱地址` |

### 3.5 银行卡（9 个）

| code | HTTP | 触发条件 | message |
| --- | --- | --- | --- |
| `CARD_NOT_FOUND` | 404 | `:id` 找不到卡（lock / replace / secrets） | `银行卡不存在` |
| `PRODUCT_NOT_FOUND` | 404 | 卡产品 / 理财产品代码不存在 | `卡产品不存在` / `理财产品不存在` |
| `CARD_REPLACED` | **400** | 对 `status === 'replaced'` 的卡做锁卡 / 换卡 | `该卡已换卡，无法操作` / `该卡已换卡，无法重复操作` |
| `CARD_REPLACED` | **409** | 对 `status === 'replaced'` 的卡查安全码 | `这张卡已换发，旧卡信息不再可用` |
| `CARD_NOT_DELIVERED` | **409** | 对 `status === 'pending'` 的卡查安全码 | `卡还在寄送途中，收到并激活后才能查看安全码` |
| `CARD_SECRET_MISSING` | 404 | 卡存在但没有 `cardSecrets` 记录 | `该卡暂无安全码记录` |
| `CARD_LOCKED` | 400 | 对已锁的卡开启 `onlinePayment` / `overseasPayment` | `卡片已锁定，请先解锁` |
| `INVALID_ADDRESS` | 400 | `validateAddress` 返回非空（见 2.5.3 的表） | 该函数返回的第一条错误文案 |

⚠️ **同一个 `CARD_REPLACED` 有两个 HTTP status（400 与 409），取决于调用点。**
这是 mock 的原样行为，不是笔误。后端若要统一，请在文档第 8 节确认后再改。

### 3.6 理财（11 个）

| code | HTTP | 触发条件 | message |
| --- | --- | --- | --- |
| `ALREADY_OPENED` | 400 | 理财账户已开立还要再开 | `理财账户已开立，无需重复开户` |
| `RISK_ASSESSMENT_REQUIRED` | **403** | 风险测评未做或已过期（开理财户 / 申购） | `请先完成风险承受能力评估` |
| `WEALTH_ACCOUNT_REQUIRED` | **403** | 未开立理财账户就申购 | `请先开立理财账户` |
| `AGREEMENT_REQUIRED` | 400 | 投资协议不逐字等于 `WEALTH_INVESTMENT_AGREEMENT` | `请阅读并签署投资协议` |
| `SETTLEMENT_REQUIRED` | 400 | `settlementAccountId` 找不到账户 | `请选择资金账户` |
| `RISK_MISMATCH` | **403** | 适当性不匹配（`canBuyRisk` 为假） | `` `该产品风险等级为 ${risk}（${RISK_PLAIN_LABEL[risk]}），超过你的风险承受能力 ${tolerance}（${TOLERANCE_LABEL[tolerance]}）。按投资者适当性管理要求，无法购买。如风险承受能力已变化，请重新测评。` `` |
| `ACKNOWLEDGEMENT_MISMATCH` | 400 | 风险确认语句不逐字等于 `RISK_ACKNOWLEDGEMENT` | `` `请完整抄录风险确认语句：本人已经阅读风险揭示，愿意承担投资风险` `` |
| `BELOW_MIN_AMOUNT` | 400 | `amount < product.minAmount` | `` `起购金额 ¥${(minAmount / 100).toLocaleString('zh-CN')}` `` |
| `INVALID_STEP` | 400 | `amount % stepAmount !== 0` | `` `追加金额需为 ¥${(stepAmount / 100).toLocaleString('zh-CN')} 的整数倍` `` |
| `INCOMPLETE_ANSWERS` | 400 | 风险测评答案数 ≠ 题目数 | `请完成全部题目` |
| `INVALID_ANSWER` | 400 | 选项下标越界 | `答案无效` |
| `HOLDING_NOT_FOUND` | 404 | 赎回时持仓不存在 | `持仓不存在` |
| `IN_CLOSED_PERIOD` | 400 | 持仓处于封闭期 | `` `该产品处于封闭期，${YYYY-MM-DD} 起可赎回` `` |
| `INVALID_SHARES` | 400 | 赎回份额 ≤ 0 | `赎回份额必须大于 0` |
| `EXCEED_SHARES` | 400 | 赎回份额 > 持有份额 | `赎回份额超过持有份额` |

`RISK_MISMATCH` 的文案里 `RISK_PLAIN_LABEL` / `TOLERANCE_LABEL` 取自 `lib/wealth.ts`：
`R1 低风险 / R2 中低风险 / R3 中风险 / R4 中高风险 / R5 高风险`；
`C1 保守型 / C2 谨慎型 / C3 稳健型 / C4 积极型 / C5 激进型`。

### 3.7 其他（3 个）

| code | HTTP | 触发条件 | message |
| --- | --- | --- | --- |
| `AUTODEBIT_NOT_FOUND` | 404 | 自动扣款 `:id` 不存在 | `扣款计划不存在` |
| `RULE_NOT_FOUND` | 404 | 风控规则 `:id` 不存在 | `风控规则不存在` |
| `CARD_NOT_FOUND` | 404 | 见 3.5 | `银行卡不存在` |

### 3.8 HTTP status 使用汇总

| status | 用在哪 |
| --- | --- |
| 400 | 参数 / 业务校验失败（绝大多数） |
| 401 | 凭证不对（`BAD_CREDENTIALS`、`BAD_PAY_PASSWORD`） |
| **403** | **适当性 / 前置条件类硬拦截**（`RISK_MISMATCH`、`RISK_ASSESSMENT_REQUIRED`、`WEALTH_ACCOUNT_REQUIRED`） |
| 404 | 资源不存在 |
| **409** | **状态冲突**（`CARD_NOT_DELIVERED`、已换发卡查安全码） |
| **423** | **已锁定**（`PAY_PASSWORD_LOCKED`） |

mock **不使用** 500，也不使用 422。

---

## 4. 业务规则与不变量

### 4.1 金额：整数「分」

- 所有金额字段的 TS 类型是 `Cents = number`，语义是**整数分**。
- 字段名一律是 `amount` / `balance` / `available` / `fee` / `minAmount` / `stepAmount` /
  `dailyLimit` / `issuingFee` / `deliveryFee` / `monthNetChange` / `total*` /
  `marketValue` / `principal` / `profit` / `yesterdayProfit` / `signedAmount` /
  `balanceBefore` / `balanceAfter` / `originAmount` / `toAmount` / `fromAmount` /
  `estimatedAmount` / `fees`。
- **唯一的例外是 `shares`（份额，不是金额）与各种 `rate` / `ratio` / `spread` /
  `volatility` 等比率**，它们是小数（`0.0035` 表示 0.35%）。
- `signedAmount`：正数表示收入、负数表示支出，等于 `direction` 的带符号表达。
  恒等式：`direction === 'in' ? signedAmount === amount : signedAmount === -amount`。
- `exchangeRate` 是「1 原币 = ? 记账币」的**数值**（`7.2958`），不是分。
- 舍入规则（照抄 mock）：
  - 换汇 `toAmount = Math.round(fromAmount * rate)`
  - 手续费 `fee = Math.max(Math.round(amount * rate), minFee)`
  - 一次性申赎费 `fee = Math.round(amount * rate)`
  - 份额 `shares = Number((netAmount / nav).toFixed(2))`（**保留 2 位小数**）
  - 市值 `marketValue = Math.round(shares * nav)`
  - 赎回按比例扣本金 `principal = Math.round(principal * (1 - ratio))`

### 4.2 全部限额、费率、定价

| 项目 | 数值 | 出处 |
| --- | --- | --- |
| 大额转账二次确认阈值 | **≥ 500_000 分（¥5,000.00）** | `LARGE_TRANSFER` |
| 银行账户转账单笔上限 | **5_000_000 分（¥50,000.00）** | `BANK_SINGLE_LIMIT` |
| 转数快单笔上限 | **1_000_000 分（¥10,000.00）** | `FPS_SINGLE_LIMIT` |
| 境外转账费率 | **0.1%（`0.001`），最低 5_000 分（¥50.00）** | `OVERSEAS_RATE` / `OVERSEAS_MIN_FEE` |
| 境内 / 转数快手续费 | **0** | mock `quoteTransfer` |
| 单笔转入（deposit）上限 | **5_000_000 分（¥50,000.00）** | mock `deposit` |
| 换汇点差 | **0.35%（`0.0035`）**，已含在 `rate` 里 | `FX_SPREAD` |
| 换汇报价有效期 | **30 秒** | `FX_QUOTE_TTL` |
| 换汇基准汇率（1 单位外币 = ? 人民币） | `CNY 1`、`USD 7.1562`、`HKD 0.91547` | `FX_MID_RATES` |
| 安全码可见时长 | **60 秒** | `CARD_SECRET_REVEAL_SECONDS` |
| 支付密码最大连续错误次数 | **3** | `PAY_PASSWORD_MAX_ATTEMPTS` |
| 支付密码长度 | **6 位纯数字** | `verifyPayPassword` 的 `/^\d{6}$/` |
| 短信验证码有效期 | **5 分钟**，一次性 | mock `sendSmsCode` |
| 风险测评有效期 | **1 年** | mock `submitRiskAssessment` |
| 开卡：云闪付借记卡 | 工本费 **1000**、寄送费 **0**、5 个工作日 | `CARD_PRODUCTS[0]` |
| 开卡：Visa 全球借记卡 | 工本费 **2000**、寄送费 **1500**、7 个工作日 | `CARD_PRODUCTS[1]` |
| 换卡费用 | 按同卡组织产品定价；无匹配产品时 **2000** | mock `replaceCard` |
| 新卡默认单日限额 | **200_000 分（¥2,000.00）** | mock `openCard` |
| 卡片单日限额档位 | `[200_000, 500_000, 1_000_000, 5_000_000]` | `CardsPage.LIMIT_PRESETS` |
| 存款年化利率 | 活期 `0.003`、储蓄 `0.0155`、定期 `0.021` | 种子 `accounts` + `openAccount` |
| 理财一次性费率 | `LCB-EQUITY-300` 申购 0.15% / 赎回（<7 天）0.5%；`LCB-GOLD-365` 申购 0.3% | `WEALTH_PRODUCTS` |
| 理财起购 / 递增 | 见 2.6.1 的表 | `WEALTH_PRODUCTS` |
| 转数快手机号 | 香港 **8 位，4–9 开头** | `validateFpsValue` |
| FPS ID | **7 位数字** | `validateFpsValue` |
| 银行账号 | **12–19 位数字** | `validateBankAccount` |
| fps 收款账户 | **≥ 6 位**（字母数字，≤24 位） | `validateFpsValue` / `formatFpsValue` |
| 邮寄地址详细地址 | **≥ 5 个字** | `validateAddressField` |
| 邮政编码 | 可空，非空时 **6 位数字** | `validateAddressField` |
| 身份证号 | **`/^\d{17}[\dXx]$/`** | `openAccount` / `openWealthAccount` |
| 登录密码最小长度 | **6** | `changePassword`（`WEAK_PASSWORD`） |

### 4.3 状态机

#### 账户（`Account`）

`Account` 上**没有 `status` 字段**，只有 `kind` 与 `tier`：
`kind ∈ {current, savings, deposit}`、`tier ∈ {I, II, III}`。
**账户类别（tier）在开户时确定，之后不可变更**（没有任何接口能改它）。

| tier | 能否线上开（`online`） | 需绑定Ⅰ类户（`requiresBinding`） | 限额（监管原文） |
| --- | --- | --- | --- |
| `I` | **false** | false | 无上限 |
| `II` | true | **true** | 非绑定账户转入 / 存现 / 消费缴费 / 向非绑定账户转出 / 取现 = **日累计合计 1 万元、年累计合计 20 万元** |
| `III` | true | **true** | 余额**不得超过 2000 元**；消费缴费 / 向非绑定账户转出 = **日累计合计 2000 元、年累计合计 5 万元** |

⚠️ **mock 不实现任何限额累计逻辑。** Ⅱ / Ⅲ 类户的日/年累计限额在 mock 里只是
`AccountTier.limits` 里的一句**展示文案**，转账、消费、取现都不检查它。
真后端必须实现（见第 8 节 Q8）。

#### 银行卡（`BankCard.status`）

`CardStatus = 'active' | 'locked' | 'pending' | 'replaced'`

```
   POST /cards/open
   ────────────────►  pending（待激活）
                        │  │
   POST /cards/:id/lock │  │  POST /cards/:id/replace
        {locked:false}  │  │
                        ▼  │
                      active（使用中）◄──┐
                        │               │
   POST /cards/:id/lock │               │ POST /cards/:id/lock {locked:false}
        {locked:true}   ▼               │
                      locked（已锁定）──┘
                        │
   POST /cards/:id/replace
                        ▼
                    replaced（已换卡）  ← 终态
                        │
                        └─► 同时产出一张新的 pending 卡（卡号变更）
```

合法流转与副作用：

| 起点 | 操作 | 终点 | 副作用 |
| --- | --- | --- | --- |
| — | `POST /api/cards/open` | `pending` | 扣制卡费 + 落台账；新卡 `onlinePayment=false`、`overseasPayment=false`、`dailyLimit=200_000` |
| `active` | `lock {true}` | `locked` | **同时把 `onlinePayment` / `overseasPayment` 置 false** |
| `locked` | `lock {false}` | `active` | **不恢复**那两个开关 |
| `active` / `locked` | `replace` | 旧卡 → `replaced`，并产出一张新 `pending` 卡 | 扣换卡费 + 落台账；新卡卡号变更、两个开关 false；新卡安全码重新生成 |
| `replaced` | `lock` | **拒绝** `CARD_REPLACED` 400 | — |
| `replaced` | `replace` | **拒绝** `CARD_REPLACED` 400 | — |
| `pending` | `secrets` | **拒绝** `CARD_NOT_DELIVERED` 409 | — |
| `replaced` | `secrets` | **拒绝** `CARD_REPLACED` 409 | — |
| `locked` | `settings` 里开 `onlinePayment` / `overseasPayment` | **拒绝** `CARD_LOCKED` 400 | — |
| `active` | `settings` 改 `dailyLimit` | 状态不变 | 可随时调 |

**不变量**：
- 一张卡必须绑定 `accountId`（必填）。卡是支付工具、账户才装钱。
- 同一 `accountId` 可以有多张卡。
- 安全码与完整卡号不随卡列表下发。
- `replaced` 是**终态**：任何后续写操作都应被拒（mock 在 `settings` 上漏了，见第 6 节）。

#### 理财账户（`WealthAccount.opened`）

```
未开立 (opened=false)
   │  POST /api/wealth/account/open
   │  前置：风险测评已完成且在有效期内 + 身份核验 + 已签协议 + 已选资金账户
   ▼
已开立 (opened=true)   ← 终态，没有任何接口能关闭它
```

- **开立前置顺序不能变**：先测评分级 → 再开户，因为 `riskLevelAtOpening`
  要在开立时确定并记录下来。
- `opened === false` 时，申购被 `WEALTH_ACCOUNT_REQUIRED` 403 拒绝；
  `GET /api/wealth/overview` 仍应正常返回（前端要读 `account.opened` 来决定显示什么）。
- 前端在未开立时**仍然展示产品超市**（先看后买），所以产品列表接口不能要求已开户。

#### 理财持仓（`WealthHolding`）

持仓没有 `status` 字段，用两个字段表达：

- `redeemableAt: string | null`：封闭期结束、可赎回的日期；**活期产品为 `null`**
- `closed: boolean`：**当前**是否处于封闭期，由后端按「现在 < redeemableAt」判定

```
申购（openEnded=false）→ redeemableAt = 申购时间 + term 天数，closed = true
                         到期后 closed 自动变 false（服务端判定，不落库）
申购（openEnded=true） → redeemableAt = null，closed = false
closed=true  时 redeem → 拒绝 IN_CLOSED_PERIOD 400
部分赎回 → 按份额比例扣减 principal，shares 保留 2 位小数
全部赎回（shares <= 0）→ 删除该持仓
```

- 同一产品多次申购**合并为一条持仓**：`shares` 相加、`costNav` 按加权平均重算、
  `principal` 累加。
- **`marketValue` / `profit` / `profitRate` / `closed` 不落库**，读取时按
  `shares × 产品最新 nav` 实时推导（见 2.6.3）。README §7 明确要求
  「『是否处于封闭期』也由后端判定，不让前端拿 `Date.now()` 在渲染期算」。

#### 风险评估（`RiskAssessment`）

```
未测评 (done=false, expired=true, level='C1', score=0, assessedAt='', expiresAt='')
   │  POST /api/wealth/risk/assess
   ▼
已测评有效 (done=true, expired=false, expiresAt = assessedAt + 1 年)
   │  时间流逝超过 1 年
   ▼
已过期 (done=true, expired=true)   ← 视同未测评，购买被拦
   │  重新提交测评
   ▼
已测评有效（覆盖旧结果）
```

- **`expired` 由后端算**（`!done || 现在 > expiresAt`）。前端会区分
  「未评估」与「已过期」两种展示，所以 `done` 与 `expired` 都要正确。
- 过期后**不自动清零** `done` / `score` / `level`——只是 `expired=true`。

#### 交易（`Transaction.status`）

`TransactionStatus = 'success' | 'pending' | 'failed'`

- mock **只产生 `success`**：所有种子交易与所有写操作落的台账都是 `success`。
- `pending` / `failed` 只有类型定义，没有产生路径。
- 枚举必须完整保留（`lib/tx.ts` 有 `STATUS_LABEL` 映射：
  `success 交易成功 / pending 处理中 / failed 交易失败`），
  一旦后端返回别的值，`STATUS_LABEL[t.status]` 会是 `undefined`，界面上显示空白。
  真后端做异步结算时可以用这两个值，但**不能引入第四种状态**。

#### 风控规则（`SecurityOverview.riskRules[].enabled`）

- 规则是固定集合，`enabled` 可开关，`PATCH /api/security/rules/:id` 切换。
- 切换后 `score` 与 `level` 必须重算并随响应下发（见 2.8.2）。
- `id` 是前端传的键，**不要改成别的命名**（种子里是 `rule_amount`、
  `rule_overseas`、`rule_new_device`、`rule_night`）。

### 4.4 幂等与并发：哪些重复调用会被拒

| 场景 | 重复调用的结果 | 实现依据 |
| --- | --- | --- |
| 重复换卡 | **拒绝** `CARD_REPLACED` 400 `'该卡已换卡，无法重复操作'` | `replaceCard` 开头判 `status === 'replaced'` |
| 重复开理财账户 | **拒绝** `ALREADY_OPENED` 400 `'理财账户已开立，无需重复开户'` | `openWealthAccount` 开头判 `opened` |
| 重复使用短信验证码 | **拒绝** `SMS_NOT_SENT` 400——成功时把 `pendingSms` 置 `null`，「用过即废，防止一码多开」 | `openAccount` / `openWealthAccount` / `changePhone` |
| 重复调用开户（同一次验证码） | 第二次因验证码已作废被拒 | 同上 |
| 重复锁卡 | **允许**（幂等）：锁已锁的卡仍是 `locked`，不报错 | `setCardLock` 直接赋值 |
| 重复解锁 | **允许**（幂等） | 同上 |
| 重复改卡设置 | **允许**（幂等） | `updateCardSettings` 直接 assign |
| 重复启停自动扣款 | **允许**（幂等） | `setAutoDebitEnabled` 直接赋值 |
| 重复启停风控规则 | **允许**（幂等）**但每次都会写一条安全日志** | `setSecurityRule` 无条件插日志 |
| 重复提交同一笔转账 | **没有幂等保护**：会真的转两次、落两笔台账 | `submitTransfer` 无任何去重键 |
| 重复申购 | **没有幂等保护**：会真的扣两次钱 | `subscribeWealth` 无去重键 |
| 重复赎回 | 部分赎回可重复；全部赎回后 `holding` 被删除，再调返回 `HOLDING_NOT_FOUND` 404 | `redeemWealth` |
| 重复支付密码错误 | 累加 `payPasswordFailures`，到 3 次锁定（423） | `verifyPayPassword` |

⚠️ **转账与申购缺少幂等键是整个契约里最需要后端补的地方。** 前端在提交期间会把按钮
置为 `loading`（`submitting`），但网络重试或用户双击仍可能重复提交。
`TransferRequest` / `WealthSubscribeRequest` 里**没有** `idempotencyKey` 之类的字段，
前端也不会生成。建议后端支持一个**可选的幂等键请求头**（纯增量，不改前端），
否则请明确接受「可能重复扣款」的风险。见第 8 节 Q1。

**并发**：mock 是单线程 + 内存对象，天然串行。真后端在以下两处必须加锁或做
乐观并发控制，否则会出现超扣：

1. **扣余额**（转账、制卡费、申购）：「读 available → 判断 → 扣减」必须是原子操作，
   否则两笔并发转账都能通过余额校验，把账户扣成负数。
2. **换卡**：两笔并发 `replaceCard` 会让旧卡产生两张新卡，
   因为 `status === 'replaced'` 的检查是读到快照后做的。
   建议对 `cardId` 加行锁，或用条件更新
   （`UPDATE cards SET status='replaced' WHERE id=? AND status<>'replaced'`，
   受影响行数为 0 即返回 `CARD_REPLACED`）。

### 4.5 时间与过期

| 项目 | 时长 | 何时开始算 | 前端怎么用 |
| --- | --- | --- | --- |
| 短信验证码 | **5 分钟** | 发送时 | 只显示「5 分钟内有效」；倒计时 60 秒是**前端自己**的发送冷却，与有效期无关 |
| 换汇报价锁价 | **30 秒**（`quoteTtlSeconds`，由后端下发） | **前端收到报价的本地时刻** | 逐秒倒计时；到期自动重新询价并提示「请核对到账金额」 |
| 风险测评 | **1 年** | `assessedAt` | 显示「有效期至 YYYY-MM-DD」；`expired` 由后端给 |
| 安全码可见 | **60 秒**（`revealSeconds`，由后端下发） | 前端收到 `CardSecrets` 的本地时刻 | 到点**真把值从 state 删掉** |
| 人脸 / 短信票据 | **mock 永不过期** | — | 后端需自定，见第 8 节 Q12 |
| 回单下载链接 | mock 为 `null` | — | `expiresAt` 与签名有效期一致，真后端自定 |

**关于报价倒计时的两条硬约定**（README §10.1 明确记录，实现时不要「优化」掉）：

1. 前端**从收到报价的本地时刻起算**，**不使用 `quotedAt`**——用服务端时间会受
   客户端与服务端时钟偏差影响。所以后端给 `quotedAt` 只作为记录，前端不拿它算倒计时。
2. **过期必须重新询价**，不能拿旧价格成交。前端到点自动重新调
   `POST /api/transfers/quote` 并弹提示。

**关于交易编号的确定性**（README §7 明确要求）：`referenceNo` 必须由记录 id
**确定性派生**而非随机生成——同一条记录每次刷新、每次重新登录拿到的号必须一样，
否则客服无法核对。mock 用 FNV-1a 散列出 19 位、固定以 `2` 开头；
真后端用什么算法都行，**只要保证「同一笔交易永远同一个号」**。

### 4.6 敏感信息：哪些字段绝对不能出现在列表接口里

这是整个契约里安全等级最高的一条。

**绝不进 `GET /api/cards`（`listCards`）的字段**：

| 字段 | 说明 |
| --- | --- |
| `pan`（完整卡号） | 只在 `POST /api/cards/:id/secrets` 的响应里出现 |
| `cvv`（安全码） | 同上 |

- 前端 `BankCard` 类型上**根本没有这两个字段**——不是「接口里记得删」，是类型系统就不允许。
  mock 把安全码存在**另一张表** `db.cardSecrets`（`Record<string, { cvv, pan }>`）里，
  与 `db.cards` 分开，从数据层保证「卡列表接口不可能带出敏感字段」。
  真后端同理：**建议物理分表 + 列级加密**，并确保卡列表的 SELECT 不碰这张表。
- 卡列表**可以**有的：`last4`（后四位）、`expiry`（有效期，本身就印在卡面上）、
  `cardholder`。这三样不是秘密（README §12.4：眼睛一开就能看到的是本来就在客户端的东西）。
- 取安全码的接口必须：
  1. **单独验支付密码**（不是登录密码——登录态泄露不等于能拿到安全码）
  2. **先验身再看卡状态**（否则密码不对的人也能从报错文案里探到卡的状态）
  3. 只在这**一次响应**里出现，服务端不落明文
  4. 前端拿到后**不落 localStorage**，并带 `revealSeconds` 时限

**其他敏感字段的处理**：

| 字段 | 出现在哪里 | 处理 |
| --- | --- | --- |
| `counterpartyAccountNo` | 只在 `TransactionDetail`（详情 / 导出），**不在列表** | **已脱敏**（`6222 **** **** 3445`） |
| `Payee.accountNo` | `GET /api/payees` | **明文**（常用收款人是用户自己存的，前端 `applyPayee` 需要它回填） |
| `ReceivingInfo.accountNo` | `GET /api/receiving` | **明文，不脱敏**——账号是**收款项**，本来就是给人抄去转账的；遮起来反而妨碍用 |
| `Account.balance` / `available` | 账户接口 | 明文下发，**由前端遮罩**（`useReveal` 每块一只眼睛，且状态不落 localStorage） |
| `CardSecrets.expiry` | secrets 接口 | 明文（不是秘密） |
| 登录密码 / 支付密码 | — | **任何响应里都不出现**。mock 只在本地库里存明文（演示），真后端存不可逆摘要 |
| `smsCode` / `demoCode` | 请求 / `SmsCodeResult` | 真后端**绝不回传验证码**；请求里的验证码只在当次校验用，不落库 |

**特别注意 `TransferResult.identifier`**：mock 回的是**脱敏后**的标识
（见 2.3.6 的脱敏表），转账台账的 `detail.counterpartyAccountNo` 存的也是这个脱敏值
（「转账详情里只回显掩码，不落明文」）。真后端请照做：
**台账里存脱敏值或加密值，不要存可用于再次转账的完整明文。**

### 4.7 合规文案：为什么必须由后端下发或与前端共用同一来源

下面这些字符串是**监管规定必须原样出现**的，不是营销话术。它们集中在
`app/src/lib/wealth.ts` 与 `app/src/lib/account-opening.ts`，**页面显示与 mock 校验
共用同一份来源**——两边各写一份的话，改了界面上的那句、服务端还在校验旧的，
就会出现「我明明抄对了却过不去」，而这种 bug 只在用户抱怨时才被发现。

| 常量 | 字符串 | 用途 | 依据 |
| --- | --- | --- | --- |
| `WEALTH_DEPOSIT_WARNING` | `理财非存款、产品有风险、投资须谨慎` | 风险揭示书首句，醒目位置 | 《理财公司理财产品销售管理暂行办法》第四十九条第一项 |
| `BENCHMARK_DISCLAIMER` | `业绩比较基准不是预期收益率，不代表未来表现和实际收益，不构成收益承诺` | 业绩比较基准下方紧跟 | 《银行保险机构资产管理产品信息披露管理办法》（2026-09-01 施行） |
| `RISK_ACKNOWLEDGEMENT` | `本人已经阅读风险揭示，愿意承担投资风险` | **服务端逐字校验**（申购） | 同办法第四十九条第七项 |
| `WEALTH_INVESTMENT_AGREEMENT` | `本人已阅读并同意《理财产品投资协议》《风险揭示书》及《投资者权益须知》，自愿开立理财账户并独立承担投资风险` | **服务端逐字校验**（开理财户） | 同上 |
| `ACCOUNT_OPENING_PLEDGE` | `本人充分了解并清楚知晓出租、出借、出售、购买账户的相关法律责任和惩戒措施，承诺依法依规开立和使用本人账户` | **服务端逐字校验**（开银行户） | 银发〔2019〕85 号 |
| `ACCOUNT_MISUSE_PENALTY` | `出租、出借、出售、购买银行账户的单位和个人，5 年内暂停其银行账户非柜面业务、支付账户所有业务，并不得为其新开立账户` | 开户页醒目告知 | 同上 |

**前端对后端的硬性要求**：

1. **逐字校验的三句必须一模一样。** 前端把常量原文（或空串）发过去，
   后端必须与**同一份字符串**比对。任何空白差异、全角 / 半角差异、标点差异都会导致拒绝。
   建议后端把这几句**做进配置或数据库**，并在发布时用同一份常量做一次一致性校验。
2. **文案必须由后端下发或与前端共用**——`RISK_MISMATCH` 的 `message`
   就是这样：它由 `suitabilityMessage()` 生成，逻辑（C 与 R 的比较）在
   `lib/wealth.ts` 里，前端和服务端必须用同一套规则，否则会出现
   「按钮说能买、接口说不能买」。
3. **`BENCHMARK_DISCLAIMER` 与 `WEALTH_DEPOSIT_WARNING` 虽然由前端渲染**，
   但它们所描述的事实（非保本、业绩比较基准不是预期收益）必须与后端
   `WealthProduct.principalProtected` / `benchmark.basis` 的口径一致。
   `principalProtected` 在类型上就是字面量 `false`，**后端不要试图返回 `true`**。
4. **`benchmark` 的两种形态都必须带 `basis`**（测算依据），且**取用时永远带上它**
   ——法规要求「不得单独或突出使用绝对数值、区间数值展示业绩比较基准」。
5. **「抄录」与「确认」是两回事，不要合并实现**：
   - 理财（`RISK_ACKNOWLEDGEMENT`、`WEALTH_INVESTMENT_AGREEMENT`）＝
     监管要求投资者**完整抄录**，所以前端做的是文本输入框 + 后端逐字比对。
   - 开户（`ACCOUNT_OPENING_PLEDGE`）＝银发〔2019〕85 号要求由客户**确认**，
     所以前端做的是勾选框，勾了就把常量原文发过去、后端逐字比对。
     这个差别是照着法规原文做的，不是偷懒。

另外两条展示口径（后端提供数据时要理解前端为什么这么显示）：

- **风险等级用通俗说法前置**：界面显示的是「中低风险 · 非保本 `R2`」，`R2` 符号退到次要。
  映射在 `RISK_PLAIN_LABEL`。后端只需给 `risk: 'R2'`。
- **费用分两组**：`ongoingFees`（按日计提、已体现在净值里，投资者看不到单独扣款）
  与 `transactionFees`（一次性收取、投资者额外承担）。
  **两类混在一起列，用户会以为自己被收了两遍。**

### 4.8 其余必须实现、否则前端会崩或行为不对的不变量

| # | 不变量 | 不满足会怎样 |
| --- | --- | --- |
| 1 | `Paged.items` 必须按 `createdAt` 倒序 | 交易列表顺序错乱，与「交易后余额」视图对不上 |
| 2 | `balanceBefore + signedAmount === balanceAfter` | 交易详情页的对账恒等式失败，`tools/check-tx-detail.mjs` 会红 |
| 3 | `transaction.detail.referenceNo` 每次请求都相同 | 客服无法核对；用户会以为看错了号 |
| 4 | `listCards()` 不返回 `pan` / `cvv` | 安全漏洞 |
| 5 | `CardSecrets` 只在 secrets 接口出现，且带 `revealSeconds` | 安全漏洞 |
| 6 | `listTransactions()` 不返回 `TransactionDetail` 的字段 | 分页列表体积膨胀（契约设计意图被违反） |
| 7 | `GET /api/accounts` 的第一个元素是主活期账户 | 转账 / 转入 / 理财扣款全都会用错账户 |
| 8 | `(region, code)` 成对定位银行 | 境内转账选到一家香港银行，或反之 |
| 9 | `CardBinResolution` 的四种 `status` 都要能返回 | 「暂不支持该银行」与「位数不够」分不开，用户被误拦 |
| 10 | `CashFlow.points` 正好 `days` 个、升序、含零值日 | 面积图错位 |
| 11 | `monthNetChange` 与 `SpendingAnalysis.total` 口径自洽 | 首页「本月收入」算出错值（`netChange + spending.total`） |
| 12 | `payeeCurrency` 只在 fps 通道产生换汇报价 | 银行账户转账会莫名多出一个「预计到账」外币金额 |
| 13 | 手续费在台账里是**独立一笔** | 导出 CSV 会重复计一次支出；回单与流水对不上 |
| 14 | 制卡 / 换卡收费必须**落台账** | 对账单上凭空少一笔（README §7 明确记录过这个 bug） |
| 15 | 理财申购 / 赎回必须**落台账** | 理财与存款之间的资金流动在对账单上对不上 |
| 16 | 赎回入账金额是**净额**（已扣赎回费） | 用户看到的到账金额与实际不符 |
| 17 | `WealthProduct.principalProtected` 恒为 `false` | 合规问题 |
| 18 | `WealthProduct.category` 与 `risk` 的取值必须在枚举内 | `CATEGORY_LABEL` / `RISK_PLAIN_LABEL` 查出 `undefined`，界面空白 |
| 19 | `WealthHolding.closed` 由后端判定 | 前端会在渲染期算时间，渲染变非纯函数（README §7 明确禁止） |
| 20 | `SecurityLog.level` 只有 `'info'` / `'warn'` | 别的值不会触发顶栏小红点，也不会显示成 warning 色 |
| 21 | 换绑手机号必须写 `level: 'warn'` 的安全日志 | 高危操作无痕 |
| 22 | 支付密码错误码必须**包含子串 `PAY_PASSWORD`** | 密码框不会被清空（见 1.6） |
| 23 | `exportTransactions` 的 `fileName` 必须以 `.csv` 结尾 | 浏览器下载的文件没有扩展名 |
| 24 | `ReceiptFile.url` 可以为 `null`，前端要能退回打印 | 演示部署拿不到回单 |
| 25 | `WealthOverview.account.accountNo` 未开立时必须是 `''`（空串），不能是 `null` | 前端直接渲染该字符串；`null` 会渲染成空白，`undefined` 会崩 |
| 26 | `SupportMessage.actions[].to` 必须是前端路由 | 传后端 URL 会跳出一个 404 页面 |
| 27 | 换绑手机号必须校验验证码是发往**新**号的 | 可拿别人的验证码换绑 |

---

## 5. 前端对后端的隐含假设

这些假设**没有写在类型里**，但前端代码依赖它们。不满足时，后端会以「没人说过」为由
实现成别的样子，而前端会静默地显示错东西或直接崩。

### 5.1 「数组第一个就是我要的那个」

| 位置 | 假设 |
| --- | --- |
| `TransferPage.tsx:123` | `accounts.data?.[0]` = 付款账户 |
| `DashboardPage.tsx:44` | `accounts.data?.[0]` = 首页展示的活期账户 |
| `CardsPage.tsx` | `BankCard.accountId` 要能在 `accounts` 里查到 |
| `AnalysisPage.tsx` | `account.data?.[0]` = 流水与导出的账户 |
| `WealthPage.tsx` | `accounts.data?.[0]` = 理财开户时可选的资金账户 |
| mock 内部 | `chargeCardFee` / `subscribeWealth` / `redeemWealth` / `getReceivingInfo` / `openCard` 全部硬取 `db.accounts[0]` |

→ **`GET /api/accounts` 必须把主活期账户排在第一个。**

### 5.2 「这个字段一定存在」

| 字段 | 前端怎么用 | 缺失的后果 |
| --- | --- | --- |
| `Account.monthNetChange` | `DashboardPage` 直接算 `balance - monthNetChange` | `NaN`，涨跌标签显示 `NaN%` |
| `Account.tier` | 开户结果、账户卡片 | `undefined` |
| `BankCard.accountId` | 卡片下方「资金账户：…」 | 显示 `undefined` |
| `Transaction.signedAmount` | 首页、交易详情 | `NaN` |
| `TransactionDetail.referenceNo` | 交易详情页、回单文件名 | 显示 `undefined` |
| `TransactionDetail.balanceBefore` / `balanceAfter` | 对账两行 | `NaN` |
| `WealthProduct.nav` / `navHistory` | 首页 / 详情净值走势 | 图表空 |
| `WealthOverview.risk` | 理财页顶部状态 | 崩（`risk.expired` / `risk.level` 直接取属性） |
| `SecurityOverview.riskRules` / `logs` / `devices` | 安全页三块列表 | `.map` 崩 |
| `SpendingAnalysis.trend` | 近 6 月柱图 | `.map` 崩 |
| `CashFlow.points` | 面积图 | `.map` 崩 |
| `Paged.items` / `page` / `size` / `total` | 分页控件 | 崩或分页错乱 |
| `WealthAccount.opened` / `accountNo` | 理财页闸门 | 崩（`accountNo` 会做 `.slice()`） |

→ **所有非可选字段都不能省。** 类型里标了 `?` 的才是可选的：
`BankCard.shippingAddress`、`BankCard.issuingFee`、
`TransactionDetail` 里除前 7 个（`referenceNo`、`channel`、`paymentMethod`、
`accountLabel`、`accountNo`、`settleCurrency`、`balanceBefore`、`balanceAfter`
——共 8 个）之外的字段、`FpsResolveResult` 里除 `registered` 之外的字段、
`WealthProduct.sevenDayYield`、`TransferQuote.fx` 与 `confirmReason`、
`SupportMessage.actions`。

### 5.3 「枚举只有这几个值」

| 枚举 | 值 | 用在哪 |
| --- | --- | --- |
| `Currency` | `'CNY' &#124; 'USD' &#124; 'HKD'` | `CURRENCY_LABEL` / `CURRENCY_SYMBOL` 查表 |
| `AccountKind` | `'current' &#124; 'savings' &#124; 'deposit'` | 开户、账户标签 |
| `AccountClass` | `'I' &#124; 'II' &#124; 'III'` | 账户类别（**大写罗马数字字符串，不是 `1/2/3`**） |
| `TransactionDirection` | `'in' &#124; 'out'` | 收支方向 |
| `TransactionCategory` | 8 个：`salary transfer dining shopping housing transport subscription other` | `CATEGORY_LABEL` 查表 |
| `TransactionStatus` | `'success' &#124; 'pending' &#124; 'failed'` | `STATUS_LABEL` 查表 |
| `TransactionChannel` | `'quickpay' &#124; 'card' &#124; 'transfer' &#124; 'account' &#124; 'interest'` | `CHANNEL_LABEL` 查表 |
| `TransferChannel` | `'bank' &#124; 'fps'` | 转账通道 |
| `TransferScope` | `'domestic' &#124; 'overseas'` | 境内 / 境外 |
| `FpsIdType` | `'mobile' &#124; 'email' &#124; 'fpsid'` | 转数快标识类型 |
| `FpsMethod` | `FpsIdType &#124; 'account'` | 汇款方式，**比 `FpsIdType` 多一个 `'account'`** |
| `BankRegion` | `'CN' &#124; 'HK'` | `BANK_REGION_LABEL` 查表（`内地` / `香港`） |
| `CardStatus` | `'active' &#124; 'locked' &#124; 'pending' &#124; 'replaced'` | `CardsPage.STATUS_META` 查表，**别的值会让整张卡片渲染崩** |
| `CardTheme` | `'ink' &#124; 'gold'` | 卡面配色 |
| `CardNetwork` | `'visa' &#124; 'unionpay'` | 卡组织标记 |
| `CardKind` | `'debit' &#124; 'credit'` | — |
| `RiskLevel` | `'R1'…'R5'` | `RISK_PLAIN_LABEL` / `RISK_DEFINITION` 查表 |
| `RiskTolerance` | `'C1'…'C5'` | `TOLERANCE_LABEL` 查表 |
| `WealthCategory` | `'cash' &#124; 'fixed' &#124; 'mixed' &#124; 'equity' &#124; 'derivative'` | `CATEGORY_LABEL`（理财版）查表 |
| `CardBinResolution.status` | `'matched' &#124; 'incomplete' &#124; 'unsupported' &#124; 'not-applicable'` | **四种都必须能返回** |
| `SecurityLog.level` | `'info' &#124; 'warn'` | 顶栏小红点 |
| `SupportMessage.role` | `'user' &#124; 'agent'` | 气泡左右 |
| `Benchmark.kind` | `'formula' &#124; 'range'` | `benchmarkLabel()` 分支 |
| `verifyIdentity` 的 `channel` | `'sms' &#124; 'face'` | 前端只传 `'face'` |

**注意 `AccountClass` 是 `'I' / 'II' / 'III'`（罗马数字字符串），
不是数字 `1/2/3`，也不是 `'TYPE_I'`。** 开户时前端直接把它发给后端、
后端把它原样放回 `AccountOpeningResult.tier`。

**注意 `FpsMethod` 有四个值**（`account`、`mobile`、`email`、`fpsid`），
而 `FpsIdType` 只有三个。别把 `'account'` 当成标识类型。

**注意 `Account.kind` 的 `'deposit'` 是「定期存款」**，不是「入金动作」；
入金动作是 `POST /api/accounts/:id/deposit`。两者同名但无关，别混。

### 5.4 查表未命中 = 界面静默空白（不会报错）

上面所有「查表」都是 `Record<Enum, string>` 的**直接下标**，没有兜底：

```ts
CATEGORY_LABEL[t.category]       // 未知 category → undefined
STATUS_LABEL[t.status]           // 未知 status   → undefined
CHANNEL_LABEL[t.detail.channel]  // 未知 channel  → undefined
RISK_PLAIN_LABEL[risk]           // 未知 risk     → undefined
CARD_STATUS_META[card.status]    // 未知 status   → CardsPage 会崩
BANK_REGION_LABEL[bankRegion]    // 未知 region   → undefined
CURRENCY_SYMBOL[currency]        // 未知 currency → undefined
```

React 渲染 `undefined` 不会抛错，只是**那一格什么都不显示**。
所以后端返回一个拼错的枚举值时，前端的表现是「静默空白」而不是报错——
这类问题最难被发现。**枚举必须严格按上表。**

唯一会**崩**的是 `CardsPage`（它在 `STATUS_META[card.status].label` 上直接取属性），
以及 `WealthPage` / `SecurityPage` 在缺失整个对象时的 `.map` 与属性访问。

### 5.5 顺序与排序

| 数据 | 前端假设 | 依据 |
| --- | --- | --- |
| `listTransactions` | `createdAt` **倒序** | mock 排序 + 新交易插入头部 |
| `listPayees` | `lastUsedAt` **倒序**（前端再取前 4） | mock 显式排序 |
| `SpendingAnalysis.categories` | `amount` **从大到小** | mock 排序；「最大支出分类」取 `[0]` |
| `SpendingAnalysis.trend` | 近 6 月，**从旧到新**（最后一个元素是本月） | mock 从 `-5` 循环到 `0` |
| `CashFlow.points` | **从旧到新，最后一个是今天** | mock 从 `days-1` 循环到 `0` |
| `SecurityOverview.logs` | `createdAt` **倒序**（最新在最前） | mock 插到数组头 |
| `SecurityOverview.riskRules` | 无顺序要求（但 `id` 必须稳定） | — |
| `SecurityOverview.devices` | 无顺序要求（`current: true` 那条要标「本设备」） | — |
| `Bank[]` | 无顺序要求（`BankPicker` 自己按 `code` 排，非数字 code 排最前） | `BankPicker` 内部排序 |
| `Account[]` | **`[0]` 是主活期账户** | 见 5.1 |
| `CardProduct[]` | **至少 1 个；申卡默认取下标 1** | `CardApplicationModal.tsx:55,58` |
| `RiskQuestion[]` | 顺序即题号；`answers` 是**下标数组** | `submitRiskAssessment` |
| `WealthProduct[]` | 无顺序要求 | — |
| `WealthHolding[]` | 无顺序要求 | — |
| `AutoDebit[]` | 无顺序要求 | — |
| `AccountTier[]` | 无顺序要求（前端按 `tier` 查找） | `OpenAccountPage` 用 `find` |

### 5.6 其他具体假设

1. **`Bank.logo` 是可直接渲染的 URL 路径**（`/banks/cn-102.svg`）。
   前端 `<img src={logo}>`，不做任何拼接。缺失或加载失败时退回品牌色块 + 首字。
2. **`Bank.color` 是 CSS 颜色字符串**（`#C7000B`），前端直接当样式用。
3. **`Bank.primaryBin` 只有在「选定收款行 → 补全卡号前缀」时被用**，
   **香港的银行一律为空**（香港走银行账户号，没有 BIN）。
   前端逻辑：`if (bank.region !== 'CN' || isFps || !bank.primaryBin) return`。
4. **`navDate` 是 `YYYY-MM-DD`**，前端直接展示。
5. **`RiskAssessment.expiresAt` 必须是 ISO 字符串**——前端靠 `.slice(0, 10)` 取日期部分。
   **不要返回 `YYYY/MM/DD` 或带中文的格式**；未测评时用空串。
6. **`SupportMessage.actions[].to` 是前端路由字符串**（`/transfer`、`/cards`、
   `/security`、`/analysis`、`/support`、`/`），前端直接 `navigate(to)`。
   别下发完整 URL 或后端地址。
7. **`referenceNo` 是纯数字字符串**（mock 以 `2` 开头，19 位）。
   交易详情页有「复制交易编号」按钮，格式错误不影响功能但影响核对的严肃性。
8. **`last4` 是 4 位数字字符串**（`'8888'`），前端直接拼在「尾号 …」后面。
9. **`expiry` 是 `'MM/YY'`**（`'08/29'`），前端直接展示。
10. **`cardholder` 是英文大写名**（`'LIN XIAOMAN'`），印在卡面上。前端不做格式化。
11. **`Account.accountNo` 原样渲染**（首页明文展示），前端不脱敏、不加空格。
    mock 的种子账号是 19 位纯数字（`8820000000112233445`）。
12. **`Account.label` 已经是完整的中文标签**（种子是 `活期账户`，
    开户生成的是 `活期账户（Ⅱ 类户）`），前端直接渲染，不再拼接 tier 名。
13. **`WealthHolding.productName` / `category` / `risk` 是产品信息的冗余**，
    前端列表直接用它们，不回头查产品。**换产品名时要一起更新。**
14. **`WealthRedeemResult.estimatedAmount` 是净额**（赎回），
    前端当作「预计到账」直接展示。
15. **`TransferQuote.confirmReason` 只在 `requiresConfirm === true` 时被读**，
    前端兜底是 `'该笔转账金额较大，请再次确认收款人信息。'`。
16. **`FpsResolveResult.name` 已经是部分隐藏的**，前端直接展示，**不再二次脱敏**。
    如果后端回明文，界面上就是明文。
17. **`ReceivingInfo.fpsMobile` 是手机号原文**（`'13800138000'`），
    前端直接展示并允许复制——它是要给对方抄的收款项。
18. **`AccountTier.limits[].value` 是纯中文字符串**（`无上限`、
    `日累计合计 1 万元、年累计合计 20 万元`），前端不做数字解析。
19. **`AccountOpeningResult.limits` 应与对应 `AccountTier.limits` 一致**
    （前端在开户完成页回显这一份）。
20. **`SupportReply.canned` 前端目前不读**（只取 `message`），但请照实填。
21. **`FpsResolveResult.bankRegion` 恒为 `'HK'`**（转数快是香港清算网络）。
    前端把它当作既成事实，不校验。
22. **`ReceivingInfo.bankRegion` 决定收款银行那行的中文后缀**：
    `CN` → `内地`、`HK` → `香港`。
23. **多语言**：全部文案都是中文硬编码在前后端两侧，**没有 i18n 层**。
    后端返回的中文 `message` 会直接出现在界面上。
24. **前端不发送任何自定义请求头**（除了 `Content-Type` 与 `Authorization`），
    也不发送 cookie（没有 `credentials: 'include'`）。
    如果后端要基于 Cookie 的会话，需要先改前端。

---

## 6. 前后端边界上的已知缺口

本节如实列出 `http.ts` 与 mock 两套实现之间的差异，以及只在其中一边存在的东西。

**核对方式**：把 `BankApi` 接口的方法名、`routes` 的键、`createHttpApi` 的返回对象、
`createMockApi` 的返回对象四方对照，再用 `grep -rn` 扫全仓库的调用点。
可复现的命令列在 6.5。

### 6.1 只在定义里、两边都没实现

| 项 | 情况 |
| --- | --- |
| `routes.card(id)` → `GET /api/cards/:id` | **只在 `routes` 里有**。`BankApi` 接口没有对应方法，`createHttpApi` 与 `createMockApi` 都没有实现，全仓库零调用。属于遗留定义。 |

### 6.2 路由表里有、README 接口清单里没有

README §3 的「已定义的接口面」漏了 6 条。**以 `routes` 为准**（它才是契约）：

| 路由 | 说明 |
| --- | --- |
| `GET /api/cards/:id/secrets` | **README 漏了**（§12.4 讲了业务，但接口清单里没有） |
| `POST /api/wealth/account/open` | **README 漏了**（§16 正文里提到了 `WEALTH_ACCOUNT_REQUIRED`） |
| `PATCH /api/security/rules/:id` | **README 漏了** |
| `PATCH /api/auth/phone` | **README 漏了**（§18.3 讲了业务，但没列路径，也没写方法） |
| `GET /api/receiving` | **README 漏了**（§12.5 讲了业务） |
| `GET /api/cards/:id` | **README 漏了**，且无实现（见 6.1） |

另外 README 接口清单里写的 `POST /api/security/verify` 与
`GET /api/security/overview`、`POST /api/security/password` 都在 `routes` 里，一致。

### 6.3 两套实现行为不一致的地方

| # | 项 | mock 的行为 | 真后端应当怎样 | 影响 |
| --- | --- | --- | --- | --- |
| 1 | `logout` | **把整个演示库重置回种子状态** | 只作废当前 token / 会话，**不删用户数据** | 若照抄 mock，「登出＝清空账户」 |
| 2 | 手机号校验（`login`） | `/^\d{11}$/`——`00000000000` 也能登录 | 应与 `sendSmsCode` 一致：`/^1[3-9]\d{9}$/` | 演示环境能登入不存在的号 |
| 3 | `verifyIdentity` 的票据 | 恒返回 `verify.<channel>.<时间戳>`，**不校验、不过期、不绑定用户**，消费处只判非空 | 签发有效期 + 一次性 + 绑定用户与用途的票据，并在消费处校验 | 目前任何人拿任意字符串都能过 `FACE_REQUIRED` |
| 4 | `smsCode` 与手机号绑定（`openAccount`） | **不校验** `pendingSms.phone` 是否等于开户手机号 | 必须校验（`changePhone` 就校验了，`openAccount` 漏了） | 拿到任意手机号的验证码可为他人开户 |
| 5 | `quoteTransfer` 找不到账户 | 静默回退 `accounts[0]` | 返回 404 `ACCOUNT_NOT_FOUND` | 传错 id 会按错误账户报价 |
| 6 | 转账锁价票据 | **完全没有**：`TransferRequest` 无票据字段，服务端按成交时汇率重算 | 需要一种锁价凭证机制 | 用户可能以过期汇率成交（README §10.1 明确禁止） |
| 7 | `TransferResult.referenceNo` | `` `LC${Date.now().toString().slice(-10)}` ``，**与台账记录的 `detail.referenceNo` 不是同一个值** | 两者必须是同一个号 | 转账成功页的「流水号」与交易详情页的「交易编号」对不上 |
| 8 | `openAccount` 的账号格式 | `'6222' + 13 位随机` = **17 位**（`slice(0,19)` 是死代码） | 按本行账号规则生成（README §11 与种子数据用 `8820…` 19 位） | 新开的账号可能落在**工商银行的真实 BIN** 上 |
| 9 | 换卡后的旧卡 | 旧的 `cardSecrets` 记录**不删** | 应清理或标记失效 | 数据泄漏面 + 垃圾数据 |
| 10 | `setCardLock` 对 `pending` 卡 | 允许，会把状态改成 `locked` / `active`（跳过激活） | 应拒绝 | 未收到的卡被当作已激活 |
| 11 | `updateCardSettings` 对 `replaced` 卡 | **允许**（不拦），而 `setCardLock` 拦了 | 两者应一致：`replaced` 是终态 | 已换发的旧卡还能改设置 |
| 12 | `updateCardSettings` 的 `dailyLimit` | **不校验范围**，可设成负数或天文数字 | 应校验档位 / 上限 | 风控参数被绕过 |
| 13 | `redeemWealth` 的到账账户 | 一律 `accounts[0]` | README §16 说「款项回到**申购时使用的账户**」 | 多账户用户赎回到错账户 |
| 14 | 持仓不记录申购账户 | `WealthHolding` 里没有账户字段 | 需要记录，否则 #13 做不到 | 同上（契约需加字段） |
| 15 | `submitTransfer` 的收款人判重 | fps `account` 方式下 `accountNo` 只在 `fpsMethod === 'account'` 时写入 payee，但判重键的 `fpsId` 已带值 → **同一收款人每次转账都新建一条** | 判重键应稳定 | 常用收款人列表里堆重复项 |
| 16 | 网络延迟 | 每个方法 `await delay(100~760ms)` 模拟 | 无需模拟 | — |
| 17 | 客服对话落库 | `listSupportMessages` 读 localStorage，`sendSupportMessage` **不写回** | 真实后端应持久化 | 刷新后对话丢失 |
| 18 | `identityVerified` | 种子恒为 `true`，没有任何接口能改它 | 应由真身份核验结果驱动 | 「身份已认证」永远为真，安全评分永远 +12 |
| 19 | 种子安全日志 | 含「修改转账限额」「开启境外交易」，但 mock 里**没有**对应的写日志逻辑 | 真后端应在这些操作时写日志 | 日志与实际操作不一致 |
| 20 | `spending` 的月份时区 | 用**本地时间**取月键，却用 `iso.slice(0,7)`（UTC）过滤与分组 | 统一一个时区 | 跨月边界上统计错月 |
| 21 | `listWealthProducts` 的 `navDate` | 读列表时统一改成「今天」，覆盖种子的 `''` | 应返回真实的净值日期 | 净值日期永远是今天 |
| 22 | `withBalances` 的余额回推 | 按账户**当前**余额沿倒序台账反推 | 真后端可以直接落库 `balanceBefore`/`balanceAfter`，但**必须保证恒等式** | 若落库则历史交易的余额不会随之后的交易变化（mock 的行为意味着「重算」） |
| 23 | `confirmReason` 的文案 | `` `单笔金额超过 ¥${(500_000 / 100).toLocaleString('zh-CN')}，需二次确认` `` → `单笔金额超过 ¥5,000.00，需二次确认` | 照抄 | — |
| 24 | `WealthPage` 的 `maxRiskFor` 提示 | **前端本地计算** `maxRiskFor(risk.level)` 并展示「可购买 R3 及以下」 | 后端若改了适当性规则而前端不改，会两边说法不一致 | 建议后端把规则做成可配置，或接受前端写死 |

### 6.4 README 与 mock 冲突的地方（不擅自选一个）

| # | README 说 | mock 做 | 说明 |
| --- | --- | --- | --- |
| 1 | §12.5：「『模拟一笔转入』**退到第二屏**，并且明确标着演示」；§5 与 §7 又把「转入」当正式功能描述 | `POST /api/accounts/:id/deposit` 会真的加余额并落台账，有 ¥50,000 单笔上限 | 这个接口到底是「演示装置」还是「正式入账」，需要产品与后端确认 |
| 2 | §11：「本行是虚构机构，不占真实行别代码与号段，账号改用内部格式（`8820…`）」 | `openAccount` 生成的账号是 `6222…`（工商的真实号段） | 见 6.3 #8 |
| 3 | §9：「交易编号（19 位）…由 id 确定性派生…同一条记录每次刷新拿到的号都一样」 | 台账里的 `detail.referenceNo` 是确定性派生的，但 `submitTransfer` 返回的 `TransferResult.referenceNo` 是时间戳派生的——**同一笔转账两个号** | 见 6.3 #7 |
| 4 | §3 的接口清单 | `routes` 里多出 6 条 / 少了 0 条 | 见 6.2 |
| 5 | §13.3：「赎回则反向入账」 | 入账的是**净额**（已扣赎回费），没有单独的赎回费台账 | 与申购的「扣全额、费用内扣、一笔台账」口径不同，需确认 |
| 6 | §16：「款项回到**申购时使用的账户**」 | 一律进 `accounts[0]`，且持仓没记录申购账户 | 见 6.3 #13 / #14 |
| 7 | §18.1：「重置密码」不在需要核身的列表里 | `changePassword` 只验原密码 | 一致，但真后端是否需要短信 / 人脸需确认 |
| 8 | §7：「手续费：银行通道境外按 0.1% 计费、最低 ¥50.00；境内与转数快免费」 | 一致 | 无冲突 |
| 9 | §7：「单笔上限：银行通道 ¥50,000.00；转数快 ¥10,000.00」 | 一致 | 无冲突 |
| 10 | §7：「风控：单笔 ≥ ¥5,000.00 触发二次确认」 | 一致（`amount >= 500_000`） | 无冲突 |
| 11 | §8：「消费分析的月份参数已打通接口，UI 暂只展示当月」 | 一致（`getSpending()` 不传 month） | 无冲突 |
| 12 | §12.4：安全码「**60 秒后真把值清掉**」 | `revealSeconds: 60`，前端按它清 | 一致 |
| 13 | §10.2：导出列「15 列」 | `EXPORT_COLUMNS` 正好 15 条 | 一致 |
| 14 | §9：「任何一笔流水可点进凭证页：…支持浏览器打印回单」 | `ReceiptFile.url` 为 `null`，前端退回 `window.print()` | 一致（`url: null` 是能力声明） |
| 15 | §5 表格：「投资与资产 → 理财 … 风险测评（6 题，有效期一年）」 | `RISK_QUESTIONS` 正好 6 题 | 一致 |
| 16 | §13：「6 只产品覆盖 R1–R5 五个等级与五种分类」 | `WEALTH_PRODUCTS` 正好 6 只 | 一致 |
| 17 | §11：收款银行名录「内地 20 家、香港 35 家」（55 家） | `CN_BANKS` 20 条（含本行 LCB）、`HK_BANKS` 35 条 | 一致；注意 BIN 表只覆盖**19 家**（不含本行） |
| 18 | §7：「收款标识校验：银行卡号 12–19 位；转数快手机号 8 位（4–9 开头）/ FPS ID 7 位 / 电邮格式 / 收款账号 ≥6 位」 | 一致 | 无冲突 |
| 19 | §9：「交易编号（19 位）与授权码（6 位）」 | `makeReferenceNo` 出 19 位、`makeAuthCode` 出 6 位 | 一致；但只有 `card` / `quickpay` 渠道有 `authCode` |
| 20 | §6：「只有手上一条数据都没有时才算 `loading`」 | `useAsync` 一致 | 与后端无关，仅说明前端行为 |

### 6.5 我核对的方式（可复现）

```bash
# 1) 路由表全量
# 1) 路由表全量（47 个键）
sed -n '/export const routes/,/} as const/p' app/src/api/contract.ts

# 2) BankApi 的方法签名全量（46 个方法）
sed -n '/export interface BankApi/,/^}/p' app/src/api/contract.ts

# 3) 两套实现的方法名，对照缺少的（http.ts 的 headers 要排除）
grep -oP '^\s{4}\K[a-zA-Z]+(?=:)' app/src/api/http.ts | grep -v '^headers$' | sort > /tmp/http.txt
grep -oP '^\s{4}async \K[a-zA-Z]+' app/src/api/mock/index.ts | sort > /tmp/mock.txt
diff /tmp/http.txt /tmp/mock.txt        # 预期无输出（各 46 个）

# 4) 所有调用点
grep -rn "api\.[a-zA-Z]*(" app/src/pages app/src/components app/src/store app/src/lib

# 5) 全部错误码（78 处 throw / 53 个不同 code）
grep -n "new ApiError(" app/src/api/mock/index.ts

# 6) 引用了 routes 的地方（找只定义不实现的键）
grep -n "routes\.[a-zA-Z]*" app/src/api/http.ts app/src/api/mock/index.ts

# 7) 敏感字段是否泄漏进列表 DTO
sed -n '/export function toTransactionListItem/,/^}/p' app/src/api/mock/db.ts
grep -n "pan&#124;cvv" app/src/api/types.ts   # 只在 CardSecrets 里出现
```

**核对结论（脚本逐个比对，非目测）**：

- `routes` 共 **47** 个键；其中 **46** 个能一一映射到 `BankApi` 的方法。
- `BankApi` 共 **46** 个方法；`createHttpApi` 与 `createMockApi` **各 46 个**，
  与接口完全一致（差集为空，无多无少）。
- 唯一多出来的是 `routes.card`（`GET /api/cards/:id`），**不被任何一方实现**（见 6.1）。
- 全部 46 个方法在 `app/src/pages`、`app/src/components`、`app/src/store` 里的调用点
  已用 `grep -rn` 逐个登记到第 2 节各接口的「用在」一栏。

---

## 7. 建议的实现顺序（按依赖）

### 第 0 层：地基（不做完，后面全部无法联调）

1. **统一响应与错误体**：成功响应是裸数据、失败体是扁平 `{ message, code }`、
   判错只看 `!res.ok`（第 1.4 / 1.5 节）。这一层错了，前端所有错误提示都会变成
   「请求失败（500）」，而且拿不到任何业务原因。
2. **鉴权**：`Authorization: Bearer <token>`；
   `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/profile`。
   同时把 `sms-code` 与 `/api/accounts/open` 设为**可匿名访问**。
3. **枚举与金额口径**：第 5.3 节的枚举值 + 所有金额是**整数分**。**先定死再写业务。**
4. **`GET /api/accounts`**：它是几乎所有页面的第一个请求，
   而且**第一个元素必须是主活期账户**（第 5.1 节）。

### 第 1 层：只读数据（能让页面「看起来是活的」）

5. `GET /api/accounts`、`GET /api/accounts/:id`、`GET /api/accounts/tiers`
6. `GET /api/accounts/:id/transactions`（**含倒序分页与筛选口径**）
7. `GET /api/transactions/:id`（**含对账恒等式与确定性 `referenceNo`**）
8. `GET /api/banks`（**(region, code) 成对**）、`GET /api/receiving`
9. `GET /api/cards`、`GET /api/cards/products`
10. `GET /api/analysis/spending`、`GET /api/analysis/cashflow`、`GET /api/autodebits`

做完这一层，总览、消费分析、银行卡、转账的收款人选择都能真实渲染。
**注意第 8 项是第 3 层转账的硬前置**——转账必须先能选收款行。

### 第 2 层：支付密码与卡管理（第一条「会扣钱」的链路）

11. **支付密码校验**（三段式：查锁定 → 查格式 → 比对值；登录时清零）
12. `POST /api/cards/open`（**先验密码再收钱 + 落台账**）
13. `POST /api/cards/:id/lock`、`PATCH /api/cards/:id/settings`
    （含锁卡联动关闭两个开关；前端是乐观更新，返回的必须是权威值）
14. `POST /api/cards/:id/replace`（含**重复换卡拒绝**）
15. `POST /api/cards/:id/secrets`（**唯一的敏感字段出口**，含 60 秒 + 先验身后看状态）

这一层做错了是资金安全问题，建议配好自动化测试再往下走。

### 第 3 层：转账（最复杂的只写链路）

16. `POST /api/cards/bin`（卡 BIN 识别，四种 `status` 都要能返回）
17. `POST /api/fps/resolve`（含姓名**部分隐藏**）
18. `POST /api/transfers/quote`（限额 / 费率 / ETA / 大额确认 / 换汇报价 + 锁价）
19. `POST /api/transfers`（脱敏 `identifier`、**手续费独立台账**、收款人簿）
20. `POST /api/accounts/:id/deposit`（转入，口径需先确认，见第 8 节 Q9）
21. `GET /api/accounts/:id/transactions/export`、`GET /api/transactions/:id/receipt`

### 第 4 层：开户与身份核验

22. `POST /api/auth/sms-code`（**5 分钟 + 一次性**）
23. `POST /api/security/verify`（**票据要有真有效期与用途绑定**，它是第 24、27 项的输入）
24. `POST /api/accounts/open`（承诺语句逐字校验、Ⅰ 类户拒绝、验证码与手机号绑定）

⚠️ 第 22 与 23 项必须**早于** `accounts/open` 与 `wealth/account/open`，
因为后两者依赖验证码与票据。

### 第 5 层：理财

25. `GET /api/wealth/products`、`GET /api/wealth/products/:code`、
    `GET /api/wealth/risk/questions`
26. `POST /api/wealth/risk/assess`（**一年有效期**，等级映射见 2.6.6）
27. `POST /api/wealth/account/open`（**先测评后开户**）
28. `GET /api/wealth/overview`（**市值 / 收益 / `closed` 全部实时推导**）
29. `POST /api/wealth/subscribe`（**四道硬拦截：理财户 → 测评 → 适当性 → 抄录**）
30. `POST /api/wealth/redeem`

### 第 6 层：安全中心与客服

31. `GET /api/security/overview`、`PATCH /api/security/rules/:id`
32. `POST /api/security/password`、`PATCH /api/auth/phone`
33. `PATCH /api/autodebits/:id`（列表接口已在第 1 层）
34. `GET /api/support/messages`、`POST /api/support/chat`

### 排优先级时的三条判断依据

- **先做「前端首屏就要用」的**：`accounts` → `transactions` → `banks` → `cards`。
  这几个不做，页面全是骨架屏，联调无从谈起。
- **再做「会改变状态」的**：扣钱（开卡 / 转账 / 申购）与状态机（锁卡 / 换卡 / 开户）。
  这部分错一次就是资金或合规问题。
- **最后做「纯展示」的**：分析类、安全概览、客服。
  它们错了不影响资金安全，但**枚举必须正确**，否则界面会静默空白（第 5.4 节）。

---

## 8. 待后端确认的开放问题

以下每一条都是**靠 mock 推断、或 mock 与 README 冲突**的地方。
前端**没有**明确依据能定，请后端（或产品）拍板。每条都标注了推断依据。

### 8.1 契约层面的缺口（必须补，否则实现不出来）

| # | 问题 | 现状与依据 |
| --- | --- | --- |
| **Q1** | **转账 / 申购的幂等键** | `TransferRequest` 与 `WealthSubscribeRequest` **都没有** `idempotencyKey` 之类字段，前端也不会生成。mock 无去重，重复请求会重复扣款。需要一种防重复机制（建议支持可选请求头，纯增量、不改前端）。 |
| **Q2** | **换汇锁价凭证** | `TransferRequest` 里没有任何锁价票据字段。mock 的注释写明「真实系统在这里校验锁价票据是否还在有效期内」，但代码只是重算汇率。README §10.1 明确要求「不能让用户拿过期的价格成交」。需要设计：客户端回传 `quotedAt` / 报价 id？服务端缓存报价？**过期后返回什么错误码**（目前契约里没有这个码）？ |
| **Q3** | **`TransferResult.referenceNo` 与台账 `detail.referenceNo` 的关系** | mock 里是两个不同的号（时间戳派生 vs id 确定性派生）。README §9 要求确定性派生。**真后端应让两者相同**——但请确认：转账成功页展示的「流水号」就是稍后交易详情页的「交易编号」吗？ |
| **Q4** | **`GET /api/cards/:id` 要不要实现** | `routes.card` 存在但无方法、无实现、零引用。要么补进契约，要么删掉。 |
| **Q5** | **`logout` 的真实语义** | mock 是「清空演示库」。真后端应只作废会话，但需要确认是否还有其他副作用（刷新 token 失效、踢出其他设备、清缓存）。 |
| **Q6** | **token 过期与 401 的处理** | 前端收到 401 **不会**自动跳登录页，只弹错误文案（路由守卫只看本地有没有 `user` 对象）。是否需要约定一个专门的错误码（如 `TOKEN_EXPIRED`）让前端做强制登出？目前契约里没有。 |
| **Q7** | **`GET /api/transactions/:id` 的可查询期限** | 错误文案是「交易不存在**或已超出可查询期限**」，说明存在一个期限概念，但**没有任何地方定义它是多久**。需要后端给出（并让导出接口同样遵守）。 |
| **Q8** | **Ⅱ / Ⅲ 类户限额超限时的错误码** | 契约里**没有**这个码。如果真后端实现限额，必须新增一个（建议与前端约定）。 |

### 8.2 业务口径需要拍板

| # | 问题 | 现状与依据 |
| --- | --- | --- |
| **Q9** | **Ⅱ / Ⅲ 类户的日/年累计限额是否真的实现** | mock **完全不实现**，只有 `AccountTier.limits` 的展示文案。真后端按《银发〔2015〕392 号 / 银发〔2018〕16 号》实现的话，涉及：累计口径（按账户还是按客户）、超限时的错误码、限额在哪个时点、哪个时区重置。**这组数字写错就是误导用户**，请照监管原文实现。 |
| **Q10** | **`POST /api/accounts/:id/deposit` 的定位** | README §12.5 说它是「退到第二屏的演示装置」，§5 / §7 又当正式功能。真后端要不要实现？如果实现：`channel` 的取值范围（目前是宽松的 `string`，前端只传 `'salary'` / `'card'`）、上限（mock 是 ¥50,000）是否保留？ |
| **Q11** | **开户生成的账号格式** | mock 生成 `6222…`（**工商银行的真实 BIN**），与 README §11 和种子数据（`8820…` 19 位）冲突。真后端用自己的账号规则即可；前端只是原样渲染，无格式假设。 |
| **Q12** | **`changePassword` 是否需要核身** | mock 只验原密码。README §18.1 的表格里「重置密码」不在需要核身的列表里。真后端是否要加短信 / 人脸？ |
| **Q13** | **`verifyIdentity` 票据的生命周期与用途绑定** | mock 签发不过期、不绑定用户与用途、消费处也不校验真伪。需要定义：有效期多久、是否一次性、是否绑定 `purpose`（开户 / 开理财户 / 换手机号）、消费后是否作废。 |
| **Q14** | **`openAccount` 是否要校验验证码与手机号绑定** | mock 漏了（`changePhone` 校验了）。README §14.3 只说「验证码一次性」，没说绑定哪个号。真后端应当校验——请确认。 |
| **Q15** | **理财赎回的到账账户** | README §16 说「款项回到**申购时使用的账户**」，mock 一律进 `accounts[0]`，且 `WealthHolding` 里没有记录申购账户的字段。要按 README 实现的话，**持仓需要新增一个字段**（契约变更）。 |
| **Q16** | **赎回入账是净额还是全额** | mock 入账的是**净额**（已扣赎回费），没有单独的赎回费台账；而申购是「扣全额、费用内扣、只落一笔台账」。两种口径不一致，README 也没写。 |
| **Q17** | **`monthNetChange` 与 `spending.total` 的时区** | 两者必须能相加（首页用 `netChange + spending.total` 算「本月收入」）。mock 一个用本地月、一个用 UTC 月。需要统一时区口径。 |
| **Q18** | **`Account.balance` 与 `available` 的差额是什么** | 种子数据里活期 `12_864_055` vs `12_764_055`，差 **100000 分（¥1,000.00）**，mock 没有任何地方记录或改变这个差额。真后端要定义「冻结 / 在途」的构成与变化时机。 |
| **Q19** | **`dailyLimit` 的合法范围与校验** | 前端预设 `[200_000, 500_000, 1_000_000, 5_000_000]`，mock **不校验**。需要后端给出范围与超范围的错误码（契约里**没有**）。 |
| **Q20** | **`pending` / `replaced` 状态的卡在哪些接口上被拒** | mock 允许对 `pending` 卡 lock（等于跳过激活），`updateCardSettings` 也不拦 `replaced`。需要一份明确的「状态 × 接口」拒绝矩阵。 |
| **Q21** | **`CARD_REPLACED` 的 HTTP status** | 同一 code 在 mock 里有 **400**（锁卡 / 换卡）与 **409**（查安全码）两种。要统一还是保留？ |
| **Q22** | **`cardholder` / `expiry` / `last4` 由谁生成** | mock 里 `expiry` 恒为 `'05/31'`、`cardholder` 从已有卡抄、`last4` 随机。真后端必须由发卡系统给真值。 |
| **Q23** | **卡 BIN 表的数据来源与更新机制** | mock 的表由 `tools/gen-bin-table.mjs` 从公开码表生成 275 条（内地 19 家、只收借记卡、6 位、`62` 开头）。真后端应接银联 / 网联的 BIN 库，并定义更新频率。**本行前缀 `882000` 不从公开码表来**，需要后端自己保留一条。 |
| **Q24** | **「仅支持内地 19 家银行」这句话写死在前端** | `TransferPage.tsx:327` 的文案里有硬编码的 `19`。如果后端扩展收录范围，**这句话会变成假的**。要不要改成后端下发？ |
| **Q25** | **客服话术里的存款利率** | `CANNED_RULES` 写「活期年化 0.30%，储蓄账户 1.55%，定期存款 2.10%」，与种子 `interestRate`（`0.003 / 0.0155 / 0.021`）一致。真后端若改利率，话术要同步。 |
| **Q26** | **`SupportMessage` 的持久化** | mock 存在 localStorage，服务端不落库。真后端要落库吗？`actions` 里的前端路由要不要后端知道？ |
| **Q27** | **`sendSmsCode` 的 `demoCode` 字段是否保留** | 真后端绝不能返回验证码。字段是否保留需确认（前端不做判空，缺失不会崩）。 |
| **Q28** | **`SecurityOverview.score` / `level` 的真实模型** | mock 是 `60 + (identityVerified?12:0) + 规则数*6`，4 条全开也只有 96 分，永远到不了 100。`level` 的中文串由后端下发（前端直接渲染），需要定义真实评分维度与三档阈值。 |
| **Q29** | **`identityVerified` 由什么驱动** | mock 种子恒为 `true`，没有接口能改。真后端应由真身份核验结果驱动，并定义失效条件。 |
| **Q30** | **`redeemableAt` 的计算规则** | mock 从 `term` 字符串里抽数字（`'90 天' → 90`），抽不到默认 90，时刻设为当天 09:00。真后端应按产品规则与**工作日**计算。 |
| **Q31** | **`yesterdayProfit` 的口径** | mock 用「最近两日净值差 × 份额」，且只在净值序列 ≥ 2 个点时算。真实口径应按自然日 + 份额确认日判断。 |
| **Q32** | **多次申购后的「确认日期」** | 合并持仓时 mock **不更新** `purchasedAt`（永远是最早那笔）。监管要求「及时告知确认日期、确认份额和金额」，多次申购该报哪个日期？ |
| **Q33** | **`TransferQuote.maxAmount` 的语义** | mock 是 `min(available, singleLimit)`，**没有减手续费**。境外转账时用户按 `maxAmount` 输入、加上手续费后会余额不足。需要明确它是「可转出金额」还是「可支出金额」。 |
| **Q34** | **外币交易手续费 1.95% 与换汇点差 0.35% 的关系** | 种子外币交易用 `USD_CNY_RATE = 7.2958`（基准 × 1.0195，注释说是「1.95% 外币交易手续费」），而换汇报价用 `FX_SPREAD = 0.0035`（0.35%）。**两个费率不同**，回单文案也分别写「已包括 1.95% 外币交易手续费」与「已包括 0.35% 换汇点差」。需要确认这是两个真实存在的不同费用，还是 mock 的口径不一致。 |
| **Q35** | **导出 CSV 的「记账汇率」方向不统一** | 转账回单存**反向**汇率（`1 / fx.rate`），种子外币交易存**正向**（`1 USD = CNY 7.2958`），两者共用同一列。README §10.1 解释反向是有意的，但导出表里会同时出现两种方向。是否需要区分说明？ |
| **Q36** | **持仓的 `purchasedAt` / `costNav` 与赎回的关系** | 部分赎回时 mock 只按份额比例扣 `principal`，**不动 `costNav`**。需要确认这是否符合真实会计口径。 |
| **Q37** | **风控规则与业务逻辑的关系** | `rule_amount`（大额二次确认）的 `enabled` 状态与 `TransferQuote.requiresConfirm` **没有任何联动**：mock 无论规则是否开启都会在大额时 `requiresConfirm: true`。真后端要不要让规则开关真正影响转账行为？ |
| **Q38** | **`rule_overseas` / `rule_new_device` / `rule_night` 的实际作用** | 三条都只有展示与日志，mock 里没有任何业务行为与之绑定（比如境外转账触发人工复核、深夜交易推送）。真后端要实现到什么程度？ |

### 8.3 mock 自身可疑、但没有明确依据的地方

| # | 观察 | 为什么可疑 |
| --- | --- | --- |
| **Q39** | `openCard` 的 `last4` 用 `Math.floor(1000 + Math.random() * 8999)` | 会生成 `1000`，且分布不均匀。真后端由发卡系统给。 |
| **Q40** | 换卡不删旧卡的 `cardSecrets` | 垃圾数据 + 泄漏面。 |
| **Q41** | 种子安全日志缺「修改单日限额」「开卡」「换卡」等操作 | 日志里有「修改转账限额」「开启境外交易」但没有对应写日志逻辑——说明**这两条日志是期望存在的**，真后端应该补上。 |
| **Q42** | `hideMiddle` 的掩码规则 | `梁乐怡`→`梁*怡`（保首尾）、2 字名 `李四`→`李*`。与真实转数快的掩码规则可能不同，请按 HKICL 规范确认。 |
| **Q43** | 账户 `label` 的生成规则不一致 | 种子的 Ⅰ 类活期 `label` 是 `活期账户`（无类别后缀），而 `openAccount` 生成的是 `活期账户（Ⅱ 类户）`。需要统一。 |
| **Q44** | `cards[1].productName` 是 `招财猫 · 云闪付联名卡`，`CARD_PRODUCTS` 里叫 `招财猫 · 云闪付借记卡` | 同一产品两个名字。 |
| **Q45** | `cards[0].productName` 是 `招财猫 · 星享借记卡`，`CARD_PRODUCTS` 里**没有**这个产品 | 换卡时 `find(p => p.network === card.network)` 会命中 Visa 产品，于是「星享借记卡」换成「Visa 全球借记卡」并收 ¥35.00。换卡的定价规则需要确认。 |
| **Q46** | `CARD_PAYMENT_METHOD = '招财猫 · 星享借记卡 尾号 8888'` 是**硬编码常量** | 所有卡类 / 快捷支付的 `paymentMethod` 都用这一句，包括尾号 3366 的那张卡。真后端应按实际卡生成。 |
| **Q47** | `deposit` 的 `channel` 类型是宽松的 `string` | 契约层没有约束，未知 `channel` 的行为未定义。 |
| **Q48** | `WealthPage` 显示 `risk.expiresAt.slice(0, 10)` | 未测评时 `expiresAt` 是空串（安全）。但若后端返回 `null`，`.slice` 会崩。请保证未测评时是 `''`。 |
| **Q49** | `spending` 的 `monthOverMonth` 在「上月为 0」时给 0 | 数学上是无穷大，mock 直接给 0。这里没有对外展示百分比时的语义定义（前端可能显示 `+0.0%`）。 |
| **Q50** | `resolveFps` 的 `bankCount` 是硬编码在 `FPS_REGISTRY` 的 | 真后端应从登记册实时取。 |
| **Q51** | `openAccount` 生成账号时 `slice(0,19)` 是死代码 | 实际永远是 17 位。说明写这段代码时以为会超长。 |
| **Q52** | `WealthHolding.marketValue` / `profit` / `profitRate` / `closed` 在种子数据里是占位 `0` / `false` | 因为读取时会被 `withDerivedHoldings` 覆盖。真后端如果不做实时推导而直接落库，会把占位值返回出去。 |
| **Q53** | `withDerived`（`monthNetChange`）按月过滤时用 `localMonth`，而 `getSpending` 用 `iso.slice(0,7)` | 同一份交易数据有两个月份口径，首页把它们相加。 |
| **Q54** | `bank?.code === 'LCB'` 被用来判断「本行转账 = 实时到账」 | 用 `code` 而不是 `internal` 标记判断；README §11 明确要求所有查找走 `findBank(banks, code, region)` 并禁止裸 code 比较。这里是一个漏网的裸比较。 |
| **Q55** | `applyPayee` 里 `p.bankCode as string` 是强制断言 | 若后端返回的 fps 收款人没有 `bankCode`，把常用收款人填进表单时会留下上一个市场的银行选择。 |

---

## 附：本文档核对过的源码位置

| 结论类别 | 出处 |
| --- | --- |
| 路由表 / 方法签名 / `ApiError` 定义 | `app/src/api/contract.ts` |
| 全部请求响应类型、枚举、合规注释 | `app/src/api/types.ts` |
| 请求方法、鉴权头、错误解析、查询参数拼装 | `app/src/api/http.ts` |
| 全部业务校验、错误码、限额、状态流转、文案模板 | `app/src/api/mock/index.ts` |
| 种子数据、常量（费率 / 定价 / 限额 / 银行名录 / 卡产品 / 理财规则 / 问卷） | `app/src/api/mock/db.ts` |
| 卡 BIN 表（275 条）与 `PRIMARY_BIN`（19 条） | `app/src/api/mock/bin-table.ts` |
| 卡 BIN 识别纯函数、本行前缀 `882000` | `app/src/api/mock/card-bin.ts` |
| BIN 表生成规则（19 家 / 借记卡 / 6 位 / 62 开头 / 冲突丢弃） | `tools/gen-bin-table.mjs` |
| 收款标识格式化 / 校验 / 脱敏、`CARD_BIN_LENGTH` | `app/src/lib/account.ts` |
| 邮寄地址校验 | `app/src/lib/address.ts` |
| 理财合规文案、适当性规则、风险与费率标签 | `app/src/lib/wealth.ts` |
| 开户承诺语句与惩戒文案 | `app/src/lib/account-opening.ts` |
| 收款信息的行结构与复制文本 | `app/src/lib/receiving.ts` |
| 银行市场标签 `内地` / `香港` | `app/src/lib/bank.ts` |
| 交易分类中文标签 | `app/src/lib/categories.ts` |
| 交易渠道 / 状态中文标签 | `app/src/lib/tx.ts` |
| 金额 / 汇率 / 日期 / 手机号 / 账号格式化 | `app/src/lib/format.ts` |
| CSV 转义与 UTF-8 BOM | `app/src/lib/csv.ts` |
| 浏览器下载 | `app/src/lib/download.ts` |
| SWR 语义（写操作后不回到骨架屏） | `app/src/lib/useAsync.ts` |
| 敏感块「一只眼睛」、状态不落 localStorage | `app/src/lib/useReveal.ts` |
| token / 用户 / 演示库的存储键 | `app/src/lib/storage.ts` |
| 登录态、路由守卫、乐观更新、错误展示 | `app/src/store/session.tsx`、`app/src/pages/*`、`app/src/components/**` |
| 环境变量与开发代理 | `app/src/api/index.ts`、`app/vite.config.ts`、`app/.env.development` |
| 各接口的前端调用点 | `grep -rn "api\." app/src/pages app/src/components app/src/store app/src/lib` |
| 项目架构决策与业务口径 | `README.md`（1008 行，全文阅读） |
